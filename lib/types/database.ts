export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Profile {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  user_id: string;
  name: string;
  device_identifier: string;
  api_key_hash: Buffer | string;
  api_key_prefix: string;
  active: boolean;
  revoked_at: string | null;
  last_sync_at: string | null;
  last_seen_at: string | null;
  config_version: number;
  sync_failure_count: number;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface TotpAccount {
  id: string;
  user_id: string;
  device_id: string | null;
  name: string;
  issuer: string | null;
  account_label: string | null;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TotpSecret {
  account_id: string;
  ciphertext: Buffer | string;
  iv: Buffer | string;
  auth_tag: Buffer | string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  device_id: string | null;
  account_id: string | null;
  action: AuditAction;
  result: AuditResult;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Json;
  created_at: string;
}

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type AuditAction =
  | "device_created"
  | "device_revoked"
  | "device_reactivated"
  | "api_key_rotated"
  | "account_created"
  | "account_updated"
  | "account_deleted"
  | "account_enabled"
  | "account_disabled"
  | "secret_replaced"
  | "account_assigned"
  | "account_unassigned"
  | "device_sync"
  | "failed_device_auth"
  | "user_login"
  | "user_logout"
  | "password_changed";

export type AuditResult = "success" | "failure";

export interface DeviceSummary extends Device {
  active_account_count: number;
  total_account_count: number;
}

export interface AccountSummary extends TotpAccount {
  device_name: string | null;
  device_prefix: string | null;
}

export interface SyncAccount {
  name: string;
  secret: string;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}