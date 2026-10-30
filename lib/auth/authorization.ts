import "server-only";
import crypto from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Device, TotpAccount } from "@/lib/types/database";

export async function requireUser() {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }
  
  return user;
}

export async function requireUserId(): Promise<string> {
  const user = await requireUser();
  return user.id;
}

export async function requireDeviceOwner(deviceId: string): Promise<{ userId: string; device: Device }> {
  const userId = await requireUserId();
  const supabase = createAdminSupabaseClient();
  
  const { data: device, error } = await supabase
    .from("devices")
    .select("*")
    .eq("id", deviceId)
    .eq("user_id", userId)
    .single();
  
  if (error || !device) {
    notFound();
  }
  
  return { userId, device };
}

export async function requireAccountOwner(accountId: string): Promise<{ userId: string; account: TotpAccount }> {
  const userId = await requireUserId();
  const supabase = createAdminSupabaseClient();
  
  const { data: account, error } = await supabase
    .from("totp_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", userId)
    .single();
  
  if (error || !account) {
    notFound();
  }
  
  return { userId, account };
}

export async function requireDeviceByApiKey(apiKey: string): Promise<Device> {
  const supabase = createAdminSupabaseClient();
  const keyHash = hashApiKeyForQuery(apiKey);
  
  const { data: device, error } = await supabase
    .from("devices")
    .select("*")
    .eq("api_key_hash", keyHash)
    .single();
  
  if (error || !device) {
    throw new Error("INVALID_API_KEY");
  }
  
  if (!device.active) {
    throw new Error("DEVICE_INACTIVE");
  }
  
  if (device.revoked_at) {
    throw new Error("DEVICE_REVOKED");
  }
  
  return device;
}

function hashApiKeyForQuery(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}