import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireDeviceOwner } from "@/lib/auth/authorization";
import { apiKeyRotateSchema, deviceIdSchema } from "@/lib/validation/schemas";
import { generateApiKey } from "@/lib/security/totp-crypto";
import { logApiKeyRotated } from "@/lib/audit";
import { enforceRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

interface RouteParams {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { userId, device } = await requireDeviceOwner(params.id);
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  await enforceRateLimit(`key_rotate:${userId}`, "api_key_rotation");
  
  const body = await request.json();
  const parsed = apiKeyRotateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.errors[0].message } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  const { key, prefix, hash } = generateApiKey();
  const oldPrefix = device.api_key_prefix;
  
  const { error } = await supabase
    .from("devices")
    .update({
      api_key_hash: hash,
      api_key_prefix: prefix,
      config_version: device.config_version + 1,
    })
    .eq("id", device.id);
  
  if (error) {
    console.error("[API KEY ROTATE] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to rotate API key" } },
      { status: 500 }
    );
  }
  
  await logApiKeyRotated(userId, device.id, device.name, oldPrefix, prefix, ip);
  
  return NextResponse.json({
    data: {
      api_key: key,
      api_key_prefix: prefix,
    },
  });
}