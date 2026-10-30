import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth/authorization";
import { auditFilterSchema } from "@/lib/validation/schemas";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  const supabase = createAdminSupabaseClient();
  
  const { searchParams } = new URL(request.url);
  const parsed = auditFilterSchema.safeParse(Object.fromEntries(searchParams));
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error.errors[0].message } },
      { status: 400 }
    );
  }
  
  const { page, limit, action, deviceId, accountId, result, from, to } = parsed.data;
  
  let query = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  
  if (action) query = query.eq("action", action);
  if (deviceId) query = query.eq("device_id", deviceId);
  if (accountId) query = query.eq("account_id", accountId);
  if (result) query = query.eq("result", result);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);
  
  const { data: logs, error, count } = await query.range((page - 1) * limit, page * limit - 1);
  
  if (error) {
    console.error("[AUDIT LOGS] Error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to fetch audit logs" } },
      { status: 500 }
    );
  }
  
  return NextResponse.json({
    data: logs,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
}