import { z } from "zod";

export interface ParsedOtpAuth {
  issuer: string | null;
  account: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 8;
  period: number;
}

const algorithmSchema = z.enum(["SHA1", "SHA256", "SHA512"]);
const digitsSchema = z.union([z.literal(6), z.literal(8)]);

function parseAlgorithm(value: string | null): "SHA1" | "SHA256" | "SHA512" {
  if (!value) return "SHA1";
  const upper = value.toUpperCase();
  const parsed = algorithmSchema.safeParse(upper);
  if (parsed.success) return parsed.data;
  return "SHA1";
}

function parseDigits(value: string | null): 6 | 8 {
  if (!value) return 6;
  const parsed = parseInt(value, 10);
  const result = digitsSchema.safeParse(parsed);
  if (result.success) return result.data;
  return 6;
}

function parsePeriod(value: string | null): number {
  if (!value) return 30;
  const parsed = parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 300) return parsed;
  return 30;
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function parseOtpAuthUri(uri: string): ParsedOtpAuth {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("Invalid URI format");
  }

  if (url.protocol !== "otpauth:") {
    throw new Error("Must be an otpauth:// URI");
  }

  if (url.hostname !== "totp") {
    throw new Error("Only TOTP type is supported");
  }

  const path = url.pathname.slice(1);
  const [issuerPart, accountPart] = path.split(":", 2);
  
  let issuer: string | null = null;
  let account: string;
  
  if (accountPart) {
    issuer = decodeUrlComponent(issuerPart);
    account = decodeUrlComponent(accountPart);
  } else {
    account = decodeUrlComponent(issuerPart);
  }

  const secret = url.searchParams.get("secret");
  if (!secret) {
    throw new Error("Missing secret parameter");
  }

  const normalizedSecret = secret.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z2-7]+=*$/.test(normalizedSecret)) {
    throw new Error("Secret must be valid Base32");
  }

  return {
    issuer,
    account,
    secret: normalizedSecret,
    algorithm: parseAlgorithm(url.searchParams.get("algorithm")),
    digits: parseDigits(url.searchParams.get("digits")),
    period: parsePeriod(url.searchParams.get("period")),
  };
}

export function parseOtpAuthUris(uris: string[]): ParsedOtpAuth[] {
  return uris.map((uri, index) => {
    try {
      return parseOtpAuthUri(uri.trim());
    } catch (error) {
      throw new Error(`URI ${index + 1}: ${error instanceof Error ? error.message : "Invalid URI"}`);
    }
  });
}

export function maskSecret(secret: string): string {
  if (secret.length <= 4) return "*".repeat(secret.length);
  return secret.slice(0, 2) + "*".repeat(secret.length - 4) + secret.slice(-2);
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return maskSecret(email);
  const maskedLocal = local.length <= 2 ? "*".repeat(local.length) : local[0] + "*".repeat(local.length - 1);
  return `${maskedLocal}@${domain}`;
}