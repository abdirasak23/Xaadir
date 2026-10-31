import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyContext } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export async function GET(request: NextRequest) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const month = request.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!monthSchema.safeParse(month).success) return NextResponse.json({ error: "Choose a valid payroll month." }, { status: 400 });
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const supabase = getSupabaseAdmin();
  const [staffResult, attendanceResult, leaveResult, holidayResult] = await Promise.all([
    supabase.from("staff").select("id,full_name,staff_code,job_title,branch_id,status,monthly_salary,scheduled_shifts,shift_start,shift_end,grace_minutes,branches(name)").eq("company_id", company.companyId).order("full_name"),
    supabase.from("attendance").select("id,staff_id,branch_id,date,shift_number,check_in_at,check_out_at,status,late_minutes,source,note,staff!inner(company_id)").eq("staff.company_id", company.companyId).gte("date", from).lte("date", to).order("date").order("shift_number"),
    supabase.from("leave_requests").select("id,staff_id,leave_type,start_date,end_date,status,reason").eq("status", "approved").lte("start_date", to).gte("end_date", from),
    supabase.from("holidays").select("id,date,name,branch_id").eq("company_id", company.companyId).gte("date", from).lte("date", to),
  ]);
  const failure = staffResult.error ?? attendanceResult.error ?? leaveResult.error ?? holidayResult.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 500 });
  const staffIds = new Set((staffResult.data ?? []).map(person => person.id));
  return NextResponse.json({
    month, from, to,
    staff: staffResult.data ?? [],
    attendance: (attendanceResult.data ?? []).filter(row => staffIds.has(row.staff_id)),
    leaves: (leaveResult.data ?? []).filter(row => staffIds.has(row.staff_id)),
    holidays: holidayResult.data ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}
