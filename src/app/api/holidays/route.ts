import { NextRequest, NextResponse } from "next/server";
import { getCompanyContext } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { callAdminFunction } from "@/lib/edge";
import { z } from "zod";
import { dateSchema, uuidSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const company = await getCompanyContext(); if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const year = request.nextUrl.searchParams.get("year");
  if (year && !/^\d{4}$/.test(year)) return NextResponse.json({ error: "Invalid year." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: branches, error: branchError } = await supabase.from("branches").select("id,name").eq("company_id", company.companyId).order("name");
  if (branchError) return NextResponse.json({ error: branchError.message }, { status: 500 });
  const branchIds = (branches ?? []).map(branch => branch.id);
  let query = supabase.from("holidays").select("*, branches(name)").eq("company_id", company.companyId).order("date", { ascending: false });
  if (year) query = query.gte("date", `${year}-01-01`).lte("date", `${year}-12-31`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ branches: branches ?? [], holidays: (data ?? []).filter(item => item.branch_id === null || branchIds.includes(item.branch_id)) }, { headers: { "Cache-Control": "no-store" } });
}
const saveSchema = z.object({ date: dateSchema, name: z.string().trim().min(1).max(120), branch_id: uuidSchema.nullable() });
const deleteSchema = z.object({ holiday_id: uuidSchema });
export async function POST(request: Request) {
  const company = await getCompanyContext(); if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    if (body && typeof body === "object" && "holiday_id" in body) {
      const parsed = deleteSchema.safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Invalid holiday." }, { status: 400 });
      return NextResponse.json(await callAdminFunction("holiday-delete", { ...parsed.data, company_id: company.companyId, actor: company.userId }));
    }
    const parsed = saveSchema.safeParse(body); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid holiday details." }, { status: 400 });
    return NextResponse.json(await callAdminFunction("holiday-save", { ...parsed.data, company_id: company.companyId, actor: company.userId }), { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Holiday update failed." }, { status: 400 }); }
}
