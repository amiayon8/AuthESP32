import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireAccountOwner, requireDeviceOwner } from "@/lib/auth/authorization";
import { accountUpdateSchema, accountIdSchema, secretReplaceSchema, accountDeleteSchema } from "@/lib/validation/schemas";
import { encryptTotpSecret, decryptTotpSecret } from "@/lib/security/totp-crypto";
import { logAccountUpdated, logAccountDeleted, logAccountEnabled, logSecretReplaced, logAccountAssigned, logAccountUnassigned } from "@/lib/audit";
import { enforceRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { account } = await requireAccountOwner(id);
  
  return NextResponse.json({ data: account });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { userId, account } = await requireAccountOwner(id);
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  const body = await request.json();
  const parsed = accountUpdateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message || parsed.error.message } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  const updates: Record<string, unknown> = {};
  const changes: Record<string, { from?: unknown; to?: unknown }> = {};
  
  if (parsed.data.name !== undefined && parsed.data.name !== account.name) {
    updates.name = parsed.data.name;
    changes.name = { from: account.name, to: parsed.data.name };
  }
  if (parsed.data.issuer !== undefined && parsed.data.issuer !== account.issuer) {
    updates.issuer = parsed.data.issuer;
    changes.issuer = { from: account.issuer, to: parsed.data.issuer };
  }
  if (parsed.data.accountLabel !== undefined && parsed.data.accountLabel !== account.account_label) {
    updates.account_label = parsed.data.accountLabel;
    changes.account_label = { from: account.account_label, to: parsed.data.accountLabel };
  }
  if (parsed.data.algorithm !== undefined && parsed.data.algorithm !== account.algorithm) {
    updates.algorithm = parsed.data.algorithm;
    changes.algorithm = { from: account.algorithm, to: parsed.data.algorithm };
  }
  if (parsed.data.digits !== undefined && parsed.data.digits !== account.digits) {
    updates.digits = parsed.data.digits;
    changes.digits = { from: account.digits, to: parsed.data.digits };
  }
  if (parsed.data.period !== undefined && parsed.data.period !== account.period) {
    updates.period = parsed.data.period;
    changes.period = { from: account.period, to: parsed.data.period };
  }
  if (parsed.data.enabled !== undefined && parsed.data.enabled !== account.enabled) {
    updates.enabled = parsed.data.enabled;
    changes.enabled = { from: account.enabled, to: parsed.data.enabled };
  }
  if (parsed.data.sortOrder !== undefined && parsed.data.sortOrder !== account.sort_order) {
    updates.sort_order = parsed.data.sortOrder;
    changes.sort_order = { from: account.sort_order, to: parsed.data.sortOrder };
  }
  
  let oldDeviceId: string | null = null;
  let oldDeviceName = "";
  
  if (parsed.data.deviceId !== undefined) {
    if (parsed.data.deviceId === null) {
      if (account.device_id) {
        oldDeviceId = account.device_id;
        updates.device_id = null;
        changes.device_id = { from: account.device_id, to: null };
      }
    } else if (parsed.data.deviceId !== account.device_id) {
      const { data: device, error: deviceError } = await supabase
        .from("devices")
        .select("id, name")
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
      
      if (account.device_id) {
        oldDeviceId = account.device_id;
        oldDeviceName = "";
      }
      updates.device_id = parsed.data.deviceId;
      changes.device_id = { from: account.device_id, to: parsed.data.deviceId };
    }
  }
  
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "No valid fields to update" } },
      { status: 400 }
    );
  }
  
  const { error } = await supabase
    .from("totp_accounts")
    .update(updates)
    .eq("id", account.id);
  
  if (error) {
    console.error("[ACCOUNT UPDATE] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update account" } },
      { status: 500 }
    );
  }
  
  if (changes["enabled"] !== undefined) {
    await logAccountEnabled(userId, account.id, account.name, Boolean(changes["enabled"].to), ip);
  } else if (Object.keys(changes).length > 0) {
    await logAccountUpdated(userId, account.id, account.name, changes, ip);
  }
  
  if (changes["device_id"]) {
    if (oldDeviceId) {
      await logAccountUnassigned(userId, account.id, account.name, oldDeviceId, oldDeviceName, ip);
    }
    const newTargetDeviceId = changes["device_id"].to;
    if (newTargetDeviceId && typeof newTargetDeviceId === "string") {
      const { data: newDevice } = await supabase
        .from("devices")
        .select("name")
        .eq("id", newTargetDeviceId)
        .single();
      await logAccountAssigned(userId, account.id, account.name, newTargetDeviceId, newDevice?.name || "", ip);
    }
  }
  
  return NextResponse.json({ data: { success: true } });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { userId, account } = await requireAccountOwner(id);
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  const body = await request.json();
  const parsed = accountDeleteSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message || parsed.error.message } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  
  const { error } = await supabase
    .from("totp_accounts")
    .delete()
    .eq("id", account.id);
  
  if (error) {
    console.error("[ACCOUNT DELETE] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to delete account" } },
      { status: 500 }
    );
  }
  
  await logAccountDeleted(userId, account.id, account.name, ip);
  
  return NextResponse.json({ data: { success: true } });
}