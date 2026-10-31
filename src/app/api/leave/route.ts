import { NextResponse } from "next/server";
import { getCompanyContext } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { callAdminFunction } from "@/lib/edge";
import { z } from "zod";
import { dateSchema, uuidSchema } from "@/lib/validation";

export async function GET() {
  const company = await getCompanyContext(); if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("leave_requests").select("*, staff!inner(id,full_name,staff_code,branch_id,company_id,branches(name))").eq("staff.company_id", company.companyId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const branches = await supabase.from("branches").select("id,name").eq("company_id", company.companyId).order("name");
  if (branches.error) return NextResponse.json({ error: branches.error.message }, { status: 500 });
  const branchIds = (branches.data ?? []).map(item => item.id);
  const holidays = await supabase.from("holidays").select("*, branches(name)").eq("company_id", company.companyId).order("date", { ascending: false });
  if (holidays.error) return NextResponse.json({ error: holidays.error.message }, { status: 500 });
  return NextResponse.json({ leaves: data ?? [], holidays: (holidays.data ?? []).filter(item => item.branch_id === null || branchIds.includes(item.branch_id)) }, { headers: { "Cache-Control": "no-store" } });
}

const createSchema = z.object({ staff_id: uuidSchema, leave_type: z.enum(["annual","sick","emergency","unpaid","maternity","other"]), start_date: dateSchema, end_date: dateSchema, reason: z.string().trim().min(1).max(1000) }).refine(value => value.end_date >= value.start_date, "End date must be on or after the start date.");
const cancelSchema = z.object({ action: z.literal("cancel"), leave_id: uuidSchema, from_date: dateSchema.optional() });
export async function POST(request: Request) {
  const company = await getCompanyContext(); if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const cancel = cancelSchema.safeParse(body);
  try {
    if (cancel.success) return NextResponse.json(await callAdminFunction("leave-cancel", { ...cancel.data, company_id: company.companyId, actor: company.userId }));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid leave details." }, { status: 400 });
    return NextResponse.json(await callAdminFunction("leave-save", { ...parsed.data, company_id: company.companyId, actor: company.userId }), { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Leave request failed." }, { status: 400 }); }
}
