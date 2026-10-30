import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const resetSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  await enforceRateLimit(`password_reset:${ip}`, "auth");
  
  const body = await request.json();
  const parsed = resetSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.errors[0].message } },
      { status: 400 }
    );
  }
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        },
      },
      db: {
        schema: process.env["NEXT_PUBLIC_SUPABASE_SCHEMA"] || "authenticator",
      },
    }
  );
  
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
  });
  
  if (error) {
    console.error("[PASSWORD RESET] Error:", error);
  }
  
  return NextResponse.json({ data: { success: true } });
}