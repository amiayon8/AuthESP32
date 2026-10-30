import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { AuditAction, AuditResult } from "@/lib/types/database";

export interface AuditLogEntry {
  user_id?: string | null;
  device_id?: string | null;
  account_id?: string | null;
  action: AuditAction;
  result: AuditResult;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  const supabase = createAdminSupabaseClient();
  
  try {
    await supabase.rpc("log_audit_event", {
      p_user_id: entry.user_id ?? null,
      p_device_id: entry.device_id ?? null,
      p_account_id: entry.account_id ?? null,
      p_action: entry.action,
      p_result: entry.result,
      p_ip_address: entry.ip_address ?? null,
      p_user_agent: entry.user_agent ?? null,
      p_metadata: entry.metadata ?? {},
    });
  } catch (error) {
    console.error("[AUDIT] Failed to log event:", error);
  }
}

export async function logDeviceCreated(
  userId: string,
  deviceId: string,
  deviceName: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    device_id: deviceId,
    action: "device_created",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { device_name: deviceName },
  });
}

export async function logDeviceRevoked(
  userId: string,
  deviceId: string,
  deviceName: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    device_id: deviceId,
    action: "device_revoked",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { device_name: deviceName },
  });
}

export async function logDeviceReactivated(
  userId: string,
  deviceId: string,
  deviceName: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    device_id: deviceId,
    action: "device_reactivated",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { device_name: deviceName },
  });
}

export async function logApiKeyRotated(
  userId: string,
  deviceId: string,
  deviceName: string,
  oldPrefix: string,
  newPrefix: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    device_id: deviceId,
    action: "api_key_rotated",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { device_name: deviceName, old_prefix: oldPrefix, new_prefix: newPrefix },
  });
}

export async function logAccountCreated(
  userId: string,
  accountId: string,
  accountName: string,
  deviceId: string | null,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    account_id: accountId,
    device_id: deviceId,
    action: "account_created",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { account_name: accountName },
  });
}

export async function logAccountUpdated(
  userId: string,
  accountId: string,
  accountName: string,
  changes: Record<string, unknown>,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    account_id: accountId,
    action: "account_updated",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { account_name: accountName, changes },
  });
}

export async function logAccountDeleted(
  userId: string,
  accountId: string,
  accountName: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    account_id: accountId,
    action: "account_deleted",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { account_name: accountName },
  });
}

export async function logAccountEnabled(
  userId: string,
  accountId: string,
  accountName: string,
  enabled: boolean,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    account_id: accountId,
    action: enabled ? "account_enabled" : "account_disabled",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { account_name: accountName },
  });
}

export async function logSecretReplaced(
  userId: string,
  accountId: string,
  accountName: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    account_id: accountId,
    action: "secret_replaced",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { account_name: accountName },
  });
}

export async function logAccountAssigned(
  userId: string,
  accountId: string,
  accountName: string,
  deviceId: string,
  deviceName: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    account_id: accountId,
    device_id: deviceId,
    action: "account_assigned",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { account_name: accountName, device_name: deviceName },
  });
}

export async function logAccountUnassigned(
  userId: string,
  accountId: string,
  accountName: string,
  oldDeviceId: string,
  oldDeviceName: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    user_id: userId,
    account_id: accountId,
    device_id: oldDeviceId,
    action: "account_unassigned",
    result: "success",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { account_name: accountName, old_device_name: oldDeviceName },
  });
}

export async function logDeviceSync(
  deviceId: string,
  accountCount: number,
  success: boolean,
  errorCode?: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    device_id: deviceId,
    action: "device_sync",
    result: success ? "success" : "failure",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { account_count: accountCount, error_code: errorCode },
  });
}

export async function logFailedDeviceAuth(
  devicePrefix: string | null,
  reason: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    action: "failed_device_auth",
    result: "failure",
    ip_address: ip,
    user_agent: userAgent,
    metadata: { device_prefix: devicePrefix, reason },
  });
}