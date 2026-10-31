import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  
  await enforceRateLimit(`login:${ip}`, "auth");
  
  const body = await request.json();
  const parsed = loginSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message || parsed.error.message } },
      { status: 400 }
    );
  }

  let response = NextResponse.json({ data: { success: true } });
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
      db: {
        schema: process.env["NEXT_PUBLIC_SUPABASE_SCHEMA"] || "authenticator",
      },
    }
  );
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  
  if (error) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: error.message || "Invalid credentials" } },
      { status: 401 }
    );
  }

  if (data.user) {
    const adminClient = createAdminSupabaseClient();
    await adminClient
      .from("profiles")
      .upsert(
        {
          id: data.user.id,
          display_name: (data.user.user_metadata?.display_name as string) || data.user.email || "User",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
  }
  
  return NextResponse.json(
    { data: { user: data.user } },
    { headers: response.headers }
  );
}
