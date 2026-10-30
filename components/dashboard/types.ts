export interface UiDevice {
  id: string;
  name: string;
  device_identifier: string;
  api_key_prefix: string;
  active: boolean;
  revoked_at: string | null;
  last_sync_at: string | null;
  last_seen_at: string | null;
  config_version: number;
  sync_failure_count: number;
  last_error_code: string | null;
  created_at: string;
  active_account_count?: number;
  total_account_count?: number;
}

export interface UiAccount {
  id: string;
  name: string;
  issuer: string | null;
  account_label: string | null;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  device_id: string | null;
  device_name?: string | null;
  device_prefix?: string | null;
  secret?: string;
}

export interface UiAuditLog {
  id: string;
  user_id: string | null;
  device_id: string | null;
  account_id: string | null;
  action: string;
  result: "success" | "failure";
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type DashboardTab = "authenticator" | "devices" | "audit" | "guide";

