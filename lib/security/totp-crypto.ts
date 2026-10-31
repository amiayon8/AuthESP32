import "server-only";
import crypto from "crypto";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKeyBuffer(): Buffer {
  const encryptionKey = process.env.TOTP_ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error("TOTP_ENCRYPTION_KEY environment variable is not set");
  }

  if (encryptionKey.length !== 64) {
    throw new Error("TOTP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }

  return Buffer.from(encryptionKey, "hex");
}

function normalizeBase32(secret: string): string {
  return secret
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

function isValidBase32(secret: string): boolean {
  const normalized = normalizeBase32(secret);
  if (normalized.length === 0) return false;
  if (!/^[A-Z2-7]+=*$/.test(normalized)) return false;
  
  try {
    const buffer = Buffer.from(normalized, "base64");
    return buffer.length >= 16 && buffer.length <= 64;
  } catch {
    return false;
  }
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface DecryptedSecret {
  secret: string;
}

export function encryptTotpSecret(secret: string): EncryptedSecret {
  const normalized = normalizeBase32(secret);
  
  if (!isValidBase32(normalized)) {
    throw new Error("Invalid TOTP secret format: must be valid Base32");
  }
  
  const keyBuffer = getEncryptionKeyBuffer();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
  
  const secretBuffer = Buffer.from(normalized, "utf8");
  const ciphertext = Buffer.concat([cipher.update(secretBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid authentication tag length");
  }
  
  return {
    ciphertext,
    iv,
    authTag,
  };
}

export function decryptTotpSecret(
  ciphertext: Buffer,
  iv: Buffer,
  authTag: Buffer
): DecryptedSecret {
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
  }
  
  const keyBuffer = getEncryptionKeyBuffer();
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Decryption failed: invalid ciphertext, IV, or authentication tag");
  }
  
  const secret = decrypted.toString("utf8");
  
  if (!isValidBase32(secret)) {
    throw new Error("Decrypted data is not a valid TOTP secret");
  }
  
  return { secret };
}

export function validateBase32Secret(secret: string): { valid: boolean; normalized?: string; error?: string } {
  if (!secret || secret.trim().length === 0) {
    return { valid: false, error: "Secret is required" };
  }
  
  const normalized = normalizeBase32(secret);
  
  if (!/^[A-Z2-7]+=*$/.test(normalized)) {
    return { valid: false, error: "Secret contains invalid Base32 characters (only A-Z, 2-7 allowed)" };
  }
  
  if (normalized.length < 16) {
    return { valid: false, error: "Secret is too short (minimum 16 Base32 characters / 80 bits)" };
  }
  
  if (normalized.length > 128) {
    return { valid: false, error: "Secret is too long (maximum 128 Base32 characters)" };
  }
  
  return { valid: true, normalized };
}

export function generateApiKey(): { key: string; prefix: string; hash: Buffer } {
  const keyBytes = crypto.randomBytes(32);
  const key = "esp_live_" + keyBytes.toString("base64url");
  const prefix = key.slice(0, 12);
  const hash = crypto.createHash("sha256").update(key).digest();
  
  return { key, prefix, hash };
}

export function hashApiKey(key: string): Buffer {
  return crypto.createHash("sha256").update(key).digest();
}

export function verifyApiKey(key: string, hash: Buffer): boolean {
  const computedHash = hashApiKey(key);
  return crypto.timingSafeEqual(computedHash, hash);
}

export function bufferToBytea(buffer: Buffer): string {
  return "\\x" + buffer.toString("hex");
}

export function byteaToBuffer(value: string | Buffer | any): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    return Buffer.from(hex, "hex");
  }
  if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return Buffer.from(value || "");
}
