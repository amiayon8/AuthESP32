import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { enforceRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
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
      { error: { code: "INVALID_REQUEST", message: parsed.error.errors[0].message } },
      { status: 400, headers: getRateLimitHeaders({ allowed: true, remaining: 0, resetTime: 0, totalRequests: 0 }) }
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
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  
  if (error) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
      { status: 401 }
    );
  }
  
  const response = NextResponse.json({ data: { user: data.user } });
  
  return response;
}