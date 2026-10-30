import { z } from "zod";

export const deviceCreateSchema = z.object({
  name: z.string().min(1, "Device name is required").max(100, "Name too long"),
  deviceIdentifier: z.string().min(1, "Device identifier is required").max(64, "Identifier too long"),
});

export const deviceUpdateSchema = z.object({
  name: z.string().min(1, "Device name is required").max(100, "Name too long").optional(),
  active: z.boolean().optional(),
});

export const deviceIdSchema = z.object({
  id: z.string().uuid("Invalid device ID"),
});

export const accountCreateSchema = z.object({
  name: z.string().min(1, "Account name is required").max(100, "Name too long"),
  issuer: z.string().max(100, "Issuer too long").optional(),
  accountLabel: z.string().max(100, "Account label too long").optional(),
  secret: z.string().min(16, "Secret too short").max(128, "Secret too long"),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).default("SHA1"),
  digits: z.union([z.literal(6), z.literal(8)]).default(6),
  period: z.number().int().positive().max(300).default(30),
  deviceId: z.string().uuid("Invalid device ID").optional(),
});

export const accountUpdateSchema = z.object({
  name: z.string().min(1, "Account name is required").max(100, "Name too long").optional(),
  issuer: z.string().max(100, "Issuer too long").optional(),
  accountLabel: z.string().max(100, "Account label too long").optional(),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional(),
  digits: z.union([z.literal(6), z.literal(8)]).optional(),
  period: z.number().int().positive().max(300).optional(),
  enabled: z.boolean().optional(),
  deviceId: z.string().uuid("Invalid device ID").nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const accountIdSchema = z.object({
  id: z.string().uuid("Invalid account ID"),
});

export const secretReplaceSchema = z.object({
  secret: z.string().min(16, "Secret too short").max(128, "Secret too long"),
});

export const otpUriSchema = z.string().regex(
  /^otpauth:\/\/totp\//,
  "Must be a valid otpauth://totp/ URI"
);

export const otpImportSchema = z.object({
  uris: z.array(otpUriSchema).min(1, "At least one URI required").max(50, "Too many URIs"),
  deviceId: z.string().uuid("Invalid device ID").optional(),
});

export const apiKeyRotateSchema = z.object({
  confirmation: z.literal("ROTATE", {
    errorMap: () => ({ message: "Must type 'ROTATE' to confirm" }),
  }),
});

export const deviceRevokeSchema = z.object({
  confirmation: z.literal("REVOKE", {
    errorMap: () => ({ message: "Must type 'REVOKE' to confirm" }),
  }),
});

export const deviceDeleteSchema = z.object({
  confirmation: z.literal("DELETE", {
    errorMap: () => ({ message: "Must type 'DELETE' to confirm" }),
  }),
});

export const accountDeleteSchema = z.object({
  confirmation: z.literal("DELETE", {
    errorMap: () => ({ message: "Must type 'DELETE' to confirm" }),
  }),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const auditFilterSchema = z.object({
  action: z.enum([
    "device_created",
    "device_revoked",
    "device_reactivated",
    "api_key_rotated",
    "account_created",
    "account_updated",
    "account_deleted",
    "account_enabled",
    "account_disabled",
    "secret_replaced",
    "account_assigned",
    "account_unassigned",
    "device_sync",
    "failed_device_auth",
    "user_login",
    "user_logout",
    "password_changed",
  ]).optional(),
  deviceId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  result: z.enum(["success", "failure"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DeviceUpdateInput = z.infer<typeof deviceUpdateSchema>;
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type SecretReplaceInput = z.infer<typeof secretReplaceSchema>;
export type OtpImportInput = z.infer<typeof otpImportSchema>;