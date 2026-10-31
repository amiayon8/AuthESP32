import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireAccountOwner } from "@/lib/auth/authorization";
import { secretReplaceSchema, accountIdSchema } from "@/lib/validation/schemas";
import { encryptTotpSecret, bufferToBytea } from "@/lib/security/totp-crypto";
import { logSecretReplaced } from "@/lib/audit";
import { enforceRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { userId, account } = await requireAccountOwner(id);
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  await enforceRateLimit(`secret_replace:${userId}`, "secret_replacement");
  
  const body = await request.json();
  const parsed = secretReplaceSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message || parsed.error.message } },
      { status: 400 }
    );
  }
  
  const supabase = createAdminSupabaseClient();
  const encrypted = encryptTotpSecret(parsed.data.secret);
  
  const { error } = await supabase
    .from("totp_secrets")
    .update({
      ciphertext: bufferToBytea(encrypted.ciphertext),
      iv: bufferToBytea(encrypted.iv),
      auth_tag: bufferToBytea(encrypted.authTag),
    })
    .eq("account_id", account.id);
  
  if (error) {
    console.error("[SECRET REPLACE] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to replace secret" } },
      { status: 500 }
    );
  }
  
  await logSecretReplaced(userId, account.id, account.name, ip);
  
  return NextResponse.json({ data: { success: true } });
}