import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { decryptTotpSecret, hashApiKey, bufferToBytea, byteaToBuffer } from "@/lib/security/totp-crypto";
import { logDeviceSync, logFailedDeviceAuth } from "@/lib/audit";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  
  const apiKey = request.headers.get("x-api-key") ?? request.nextUrl.searchParams.get("apiKey");
  
  if (!apiKey) {
    await logFailedDeviceAuth(null, "missing_api_key", ip, userAgent);
    return new NextResponse(
      JSON.stringify({ error: "MISSING_API_KEY" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  
  const rateLimitResult = await rateLimit(`sync:${apiKey.slice(0, 20)}`, "device_sync");
  
  if (!rateLimitResult.allowed) {
    await logFailedDeviceAuth(apiKey.slice(0, 12), "rate_limited", ip, userAgent);
    return new NextResponse(
      JSON.stringify({ error: "RATE_LIMITED" }),
      { 
        status: 429, 
        headers: { 
          "Content-Type": "application/json",
          ...getRateLimitHeaders(rateLimitResult),
        } 
      }
    );
  }
  
  const keyHash = bufferToBytea(hashApiKey(apiKey));
  const supabase = createAdminSupabaseClient();
  
  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("*")
    .eq("api_key_hash", keyHash)
    .single();
  
  if (deviceError || !device) {
    await logFailedDeviceAuth(apiKey.slice(0, 12), "invalid_key", ip, userAgent);
    return new NextResponse(
      JSON.stringify({ error: "INVALID_API_KEY" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  
  if (!device.active) {
    await logFailedDeviceAuth(device.api_key_prefix, "inactive", ip, userAgent);
    return new NextResponse(
      JSON.stringify({ error: "DEVICE_INACTIVE" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  
  if (device.revoked_at) {
    await logFailedDeviceAuth(device.api_key_prefix, "revoked", ip, userAgent);
    return new NextResponse(
      JSON.stringify({ error: "DEVICE_REVOKED" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  
  const { data: accounts, error: accountsError } = await supabase
    .from("totp_accounts")
    .select(`
      id,
      name,
      issuer,
      account_label,
      algorithm,
      digits,
      period,
      totp_secrets!inner (
        ciphertext,
        iv,
        auth_tag
      )
    `)
    .eq("device_id", device.id)
    .eq("user_id", device.user_id)
    .eq("enabled", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  
  if (accountsError) {
    console.error("[ESP32 SYNC] Accounts query error:", accountsError);
    await logDeviceSync(device.id, 0, false, "QUERY_ERROR", ip, userAgent);
    await supabase.rpc("record_device_sync", {
      p_device_id: device.id,
      p_success: false,
      p_error_code: "QUERY_ERROR",
    });
    return new NextResponse(
      JSON.stringify({ error: "INTERNAL_ERROR" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  
  if (!accounts || accounts.length === 0) {
    await logDeviceSync(device.id, 0, false, "NO_ACCOUNTS_ASSIGNED", ip, userAgent);
    await supabase.rpc("record_device_sync", {
      p_device_id: device.id,
      p_success: false,
      p_error_code: "NO_ACCOUNTS_ASSIGNED",
    });
    return new NextResponse(
      JSON.stringify({ error: "NO_ACCOUNTS_ASSIGNED" }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }
  
  const syncAccounts = accounts.map((account) => {
    const rawSecret = account.totp_secrets;
    const secretData = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
    if (!secretData || !secretData.ciphertext || !secretData.iv || !secretData.auth_tag) {
      throw new Error(`Missing secret data for account ${account.id}`);
    }
    
    const { secret } = decryptTotpSecret(
      byteaToBuffer(secretData.ciphertext),
      byteaToBuffer(secretData.iv),
      byteaToBuffer(secretData.auth_tag)
    );
    
    return {
      name: account.name,
      secret,
    };
  });
  
  await logDeviceSync(device.id, syncAccounts.length, true, undefined, ip, userAgent);
  await supabase.rpc("record_device_sync", {
    p_device_id: device.id,
    p_success: true,
  });
  
  const latency = Date.now() - startTime;
  console.log(`[ESP32 SYNC] Device ${device.api_key_prefix} synced ${syncAccounts.length} accounts in ${latency}ms`);
  
  return new NextResponse(JSON.stringify(syncAccounts), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      ...getRateLimitHeaders(rateLimitResult),
    },
  });
}