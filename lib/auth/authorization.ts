import "server-only";
import crypto from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { hashApiKey, bufferToBytea } from "@/lib/security/totp-crypto";
import type { Device, TotpAccount } from "@/lib/types/database";

export async function requireUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  const adminClient = createAdminSupabaseClient();
  await adminClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: (user.user_metadata?.display_name as string) || user.email || "User",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
  
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
  const keyHash = bufferToBytea(hashApiKey(apiKey));
  
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