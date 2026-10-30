import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireUserId, requireAccountOwner } from "@/lib/auth/authorization";
import { accountCreateSchema, accountUpdateSchema, paginationSchema, otpImportSchema } from "@/lib/validation/schemas";
import { parseOtpAuthUris } from "@/lib/validation/otp-uri";
import { encryptTotpSecret, decryptTotpSecret } from "@/lib/security/totp-crypto";
import { logAccountCreated, logAccountAssigned, logAccountUnassigned } from "@/lib/audit";
import { enforceRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  const supabase = createAdminSupabaseClient();
  
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
  const deviceId = searchParams.get("deviceId");
  const enabled = searchParams.get("enabled");
  
  let query = supabase
    .from("totp_accounts")
    .select(
      `
      id,
      user_id,
      device_id,
      name,
      issuer,
      account_label,
      algorithm,
      digits,
      period,
      sort_order,
      enabled,
      created_at,
      updated_at,
      devices (
        name,
        api_key_prefix
      ),
      totp_secrets (
        ciphertext,
        iv,
        auth_tag
      )
    `,
      { count: "exact" }
    )
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  
  if (deviceId) {
    query = query.eq("device_id", deviceId);
  }
  
  if (enabled !== null) {
    query = query.eq("enabled", enabled === "true");
  }
  
  const { data: rawAccounts, error, count } = await query.range((page - 1) * limit, page * limit - 1);
  
  if (error) {
    console.error("[ACCOUNTS LIST] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to fetch accounts" } },
      { status: 500 }
    );
  }

  const accounts = (rawAccounts || []).map((account: any) => {
    let secret = "";
    try {
      const rawSecret = account.totp_secrets;
      const secretData = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
      if (secretData?.ciphertext && secretData?.iv && secretData?.auth_tag) {
        const decrypted = decryptTotpSecret(
          Buffer.from(secretData.ciphertext),
          Buffer.from(secretData.iv),
          Buffer.from(secretData.auth_tag)
        );
        secret = decrypted.secret;
      }
    } catch {
      secret = "";
    }

    const device = Array.isArray(account.devices) ? account.devices[0] : account.devices;
    return {
      id: account.id,
      user_id: account.user_id,
      device_id: account.device_id,
      name: account.name,
      issuer: account.issuer,
      account_label: account.account_label,
      algorithm: account.algorithm,
      digits: account.digits,
      period: account.period,
      sort_order: account.sort_order,
      enabled: account.enabled,
      created_at: account.created_at,
      updated_at: account.updated_at,
      device_name: device?.name || null,
      device_prefix: device?.api_key_prefix || null,
      secret,
    };
  });
  
  return NextResponse.json({
    data: accounts,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
}

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  await enforceRateLimit(`account_create:${userId}`, "account_creation");
  
  const body = await request.json();
  const parsed = accountCreateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.errors[0].message } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  
  if (parsed.data.deviceId) {
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id")
      .eq("id", parsed.data.deviceId)
      .eq("user_id", userId)
      .eq("active", true)
      .is("revoked_at", null)
      .single();
    
    if (deviceError || !device) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "Invalid or inactive device" } },
        { status: 400 }
      );
    }
  }
  
  const encrypted = encryptTotpSecret(parsed.data.secret);
  
  const { data: account, error } = await supabase
    .from("totp_accounts")
    .insert({
      user_id: userId,
      device_id: parsed.data.deviceId ?? null,
      name: parsed.data.name,
      issuer: parsed.data.issuer ?? null,
      account_label: parsed.data.accountLabel ?? null,
      algorithm: parsed.data.algorithm,
      digits: parsed.data.digits,
      period: parsed.data.period,
    })
    .select()
    .single();
  
  if (error) {
    console.error("[ACCOUNT CREATE] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create account" } },
      { status: 500 }
    );
  }
  
  const { error: secretError } = await supabase
    .from("totp_secrets")
    .insert({
      account_id: account.id,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
    });
  
  if (secretError) {
    console.error("[ACCOUNT CREATE] Secret error:", secretError);
    await supabase.from("totp_accounts").delete().eq("id", account.id);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to store secret" } },
      { status: 500 }
    );
  }
  
  await logAccountCreated(userId, account.id, account.name, parsed.data.deviceId ?? null, ip);
  
  if (parsed.data.deviceId) {
    await logAccountAssigned(userId, account.id, account.name, parsed.data.deviceId, "", ip);
  }
  
  return NextResponse.json({ data: { ...account, secret: parsed.data.secret } }, { status: 201 });
}