import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth/authorization";
import { otpImportSchema } from "@/lib/validation/schemas";
import { parseOtpAuthUris } from "@/lib/validation/otp-uri";
import { encryptTotpSecret } from "@/lib/security/totp-crypto";
import { logAccountCreated, logAccountAssigned } from "@/lib/audit";
import { enforceRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  await enforceRateLimit(`account_import:${userId}`, "account_creation");
  
  const body = await request.json();
  const parsed = otpImportSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.errors[0].message } },
      { status: 400 }
    );
  }
  
  let parsedAccounts;
  try {
    parsedAccounts = parseOtpAuthUris(parsed.data.uris);
  } catch (error) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: error instanceof Error ? error.message : "Invalid URI" } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  
  let deviceId = parsed.data.deviceId;
  if (deviceId) {
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id")
      .eq("id", deviceId)
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
  
  const results = [];
  
  for (const parsedAccount of parsedAccounts) {
    const encrypted = encryptTotpSecret(parsedAccount.secret);
    
    const { data: account, error } = await supabase
      .from("totp_accounts")
      .insert({
        user_id: userId,
        device_id: deviceId ?? null,
        name: parsedAccount.account,
        issuer: parsedAccount.issuer,
        account_label: parsedAccount.issuer,
        algorithm: parsedAccount.algorithm,
        digits: parsedAccount.digits,
        period: parsedAccount.period,
      })
      .select()
      .single();
    
    if (error) {
      console.error("[OTP IMPORT] Account error:", error);
      results.push({ success: false, account: parsedAccount.account, error: error.message });
      continue;
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
      console.error("[OTP IMPORT] Secret error:", secretError);
      await supabase.from("totp_accounts").delete().eq("id", account.id);
      results.push({ success: false, account: parsedAccount.account, error: "Failed to store secret" });
      continue;
    }
    
    await logAccountCreated(userId, account.id, account.name, deviceId ?? null, ip);
    
    if (deviceId) {
      await logAccountAssigned(userId, account.id, account.name, deviceId, "", ip);
    }
    
    results.push({ success: true, account: account.name, id: account.id });
  }
  
  const successCount = results.filter(r => r.success).length;
  
  return NextResponse.json({
    data: {
      imported: successCount,
      failed: results.length - successCount,
      results,
    },
  });
}