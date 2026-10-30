export function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = "";
  
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (!char) continue;
    const value = alphabet.indexOf(char);
    if (value === -1) continue;
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }

  return new Uint8Array(bytes);
}

export function formatTotpCode(code: string): string {
  if (code.length === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  if (code.length === 8) {
    return `${code.slice(0, 4)} ${code.slice(4)}`;
  }
  return code;
}

export function getSecondsRemaining(period = 30): number {
  const now = Math.floor(Date.now() / 1000);
  return period - (now % period);
}

export async function generateTotpCode(
  secret: string,
  period = 30,
  digits = 6,
  algorithm: "SHA1" | "SHA256" | "SHA512" = "SHA1"
): Promise<string> {
  if (!secret) return "------";

  try {
    const keyBytes = base32Decode(secret);
    if (keyBytes.length === 0) return "------";

    let algoName = "SHA-1";
    if (algorithm === "SHA256") algoName = "SHA-256";
    if (algorithm === "SHA512") algoName = "SHA-512";

    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      keyBytes as unknown as BufferSource,
      { name: "HMAC", hash: { name: algoName } },
      false,
      ["sign"]
    );

    const epochSeconds = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epochSeconds / period);

    const counterBuffer = new ArrayBuffer(8);
    const counterView = new DataView(counterBuffer);
    counterView.setBigUint64(0, BigInt(counter));

    const signature = await window.crypto.subtle.sign("HMAC", cryptoKey, counterBuffer);
    const hmacBytes = new Uint8Array(signature);
    const offset = hmacBytes[hmacBytes.length - 1]! & 0x0f;

    const dataView = new DataView(signature, offset, 4);
    const binary = dataView.getUint32(0) & 0x7fffffff;
    const otp = binary % Math.pow(10, digits);

    return otp.toString().padStart(digits, "0");
  } catch {
    return "------";
  }
}
