import "server-only";
import { createClient } from "@supabase/supabase-js";

const supabaseSchema = process.env["NEXT_PUBLIC_SUPABASE_SCHEMA"] || "authenticator";

export function createAdminSupabaseClient() {
  return createClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      db: {
        schema: supabaseSchema,
      },
    }
  );
}
