import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function POST(request: NextRequest) {
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
  
  await supabase.auth.signOut();
  
  return NextResponse.json({ data: { success: true } });
}