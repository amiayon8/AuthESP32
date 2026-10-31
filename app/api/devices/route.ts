import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth/authorization";
import { deviceCreateSchema, paginationSchema } from "@/lib/validation/schemas";
import { generateApiKey, bufferToBytea } from "@/lib/security/totp-crypto";
import { logDeviceCreated } from "@/lib/audit";
import { enforceRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  const supabase = createAdminSupabaseClient();
  
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
  
  const { data: devices, error, count } = await supabase
    .from("device_summary")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  if (error) {
    console.error("[DEVICES LIST] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to fetch devices" } },
      { status: 500 }
    );
  }
  
  return NextResponse.json({
    data: devices,
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
  
  await enforceRateLimit(`device_create:${userId}`, "device_provisioning");
  
  const body = await request.json();
  const parsed = deviceCreateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message || parsed.error.message } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  
  const { data: existingDevice } = await supabase
    .from("devices")
    .select("id")
    .eq("device_identifier", parsed.data.deviceIdentifier)
    .single();
  
  if (existingDevice) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Device identifier already exists" } },
      { status: 409 }
    );
  }
  
  const { key, prefix, hash } = generateApiKey();
  
  const { data: device, error } = await supabase
    .from("devices")
    .insert({
      user_id: userId,
      name: parsed.data.name,
      device_identifier: parsed.data.deviceIdentifier,
      api_key_hash: bufferToBytea(hash),
      api_key_prefix: prefix,
    })
    .select()
    .single();
  
  if (error) {
    console.error("[DEVICE CREATE] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create device" } },
      { status: 500 }
    );
  }
  
  await logDeviceCreated(userId, device.id, device.name, ip);
  
  return NextResponse.json({
    data: {
      ...device,
      api_key: key,
      api_key_prefix: prefix,
    },
  }, { status: 201 });
}