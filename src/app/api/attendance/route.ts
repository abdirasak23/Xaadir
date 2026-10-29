import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { dateSchema, uuidSchema } from "@/lib/validation";
import { z } from "zod";
import { getCompanyContext } from "@/lib/company-auth";

export async function GET(request: NextRequest) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const fallbackDate = new Date().toISOString().slice(0, 10);
  const parsed = z.object({
    from: dateSchema.default(fallbackDate),
    to: dateSchema.default(fallbackDate),
    branch: uuidSchema.optional(),
  }).safeParse({
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
    branch: request.nextUrl.searchParams.get("branch") ?? undefined,
  });
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "Invalid attendance filters." }, { status: 400 });
  const { from, to, branch } = parsed.data;
  let query = supabase.from("attendance").select("*, staff!inner(full_name,staff_code,branch_id,company_id,branches(name))").eq("staff.company_id", company.companyId).gte("date", from).lte("date", to).order("date", { ascending: false });
  if (branch) query = query.eq("branch_id", branch);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const { manualAttendanceSchema } = await import("@/lib/validation");
  const parsed = manualAttendanceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid attendance details." }, { status: 400 });
  try {
    const result = await (await import("@/lib/edge")).callAdminFunction("manual-attendance", {
      ...parsed.data,
      company_id: company.companyId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Manual attendance failed." }, { status: 400 });
  }
}
