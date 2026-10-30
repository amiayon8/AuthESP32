import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseSchema = process.env["NEXT_PUBLIC_SUPABASE_SCHEMA"] || "authenticator";

export function createServerSupabaseClient() {
  const cookieStore = cookies();
  
  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
      db: {
        schema: supabaseSchema,
      },
    }
  );
}
