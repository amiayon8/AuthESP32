import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireDeviceOwner } from "@/lib/auth/authorization";
import { deviceUpdateSchema, deviceIdSchema, apiKeyRotateSchema, deviceRevokeSchema, deviceDeleteSchema } from "@/lib/validation/schemas";
import { generateApiKey, hashApiKey } from "@/lib/security/totp-crypto";
import { logApiKeyRotated, logDeviceRevoked, logDeviceReactivated } from "@/lib/audit";
import { enforceRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { device } = await requireDeviceOwner(params.id);
  const supabase = createAdminSupabaseClient();
  
  const { data: accounts, error } = await supabase
    .from("account_summary")
    .select("*")
    .eq("device_id", device.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  
  if (error) {
    console.error("[DEVICE GET] Accounts error:", error);
  }
  
  return NextResponse.json({
    data: {
      ...device,
      accounts: accounts || [],
    },
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { userId, device } = await requireDeviceOwner(params.id);
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  const body = await request.json();
  const parsed = deviceUpdateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.errors[0].message } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  const updates: Record<string, unknown> = {};
  
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;
  
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "No valid fields to update" } },
      { status: 400 }
    );
  }
  
  if (parsed.data.active === false && device.active) {
    updates.revoked_at = new Date().toISOString();
    const { error } = await supabase
      .from("devices")
      .update(updates)
      .eq("id", device.id);
    
    if (error) {
      console.error("[DEVICE REVOKE] Error:", error);
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Failed to revoke device" } },
        { status: 500 }
      );
    }
    
    await logDeviceRevoked(userId, device.id, device.name, ip);
    return NextResponse.json({ data: { success: true } });
  }
  
  if (parsed.data.active === true && !device.active) {
    updates.revoked_at = null;
    const { error } = await supabase
      .from("devices")
      .update(updates)
      .eq("id", device.id);
    
    if (error) {
      console.error("[DEVICE REACTIVATE] Error:", error);
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Failed to reactivate device" } },
        { status: 500 }
      );
    }
    
    await logDeviceReactivated(userId, device.id, device.name, ip);
    return NextResponse.json({ data: { success: true } });
  }
  
  const { error } = await supabase
    .from("devices")
    .update(updates)
    .eq("id", device.id);
  
  if (error) {
    console.error("[DEVICE UPDATE] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update device" } },
      { status: 500 }
    );
  }
  
  return NextResponse.json({ data: { success: true } });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { userId, device } = await requireDeviceOwner(params.id);
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  const body = await request.json();
  const parsed = deviceDeleteSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.errors[0].message } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  
  const { error } = await supabase
    .from("devices")
    .delete()
    .eq("id", device.id);
  
  if (error) {
    console.error("[DEVICE DELETE] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to delete device" } },
      { status: 500 }
    );
  }
  
  await logDeviceRevoked(userId, device.id, device.name, ip);
  
  return NextResponse.json({ data: { success: true } });
}