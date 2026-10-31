import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; }, "Enter a valid calendar date.");
const schema = z.object({ company_id: z.string().uuid(), actor: z.string().uuid(), staff_id: z.string().uuid(), leave_type: z.enum(["annual","sick","emergency","unpaid","maternity","other"]), start_date: date, end_date: date, reason: z.string().trim().min(1).max(1000) }).refine(value => value.end_date >= value.start_date, "End date must be on or after the start date.");
const WEEKEND_DAYS = [5];
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!secret || request.headers.get("x-admin-secret") !== secret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Invalid leave details." }, 400);
  const input = parsed.data;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: staff, error: staffError } = await supabase.from("staff").select("id,company_id,branch_id,status").eq("id", input.staff_id).eq("company_id", input.company_id).maybeSingle();
  if (staffError) return response({ error: staffError.message }, 500);
  if (!staff) return response({ error: "Staff member was not found in this company." }, 404);
  const dates: string[] = [];
  const cursor = new Date(`${input.start_date}T00:00:00Z`), end = new Date(`${input.end_date}T00:00:00Z`);
  while (cursor <= end) { dates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  if (dates.length > 366) return response({ error: "A leave request cannot exceed 366 calendar days." }, 400);
  const { data: holidays, error: holidayError } = await supabase.from("holidays").select("date,branch_id").eq("company_id", input.company_id).in("date", dates);
  if (holidayError) return response({ error: holidayError.message }, 500);
  const holidayDates = new Set((holidays ?? []).filter(item => item.branch_id === null || item.branch_id === staff.branch_id).map(item => item.date));
  const { data: existing, error: attendanceError } = await supabase.from("attendance").select("date,status").eq("staff_id", staff.id).in("date", dates);
  if (attendanceError) return response({ error: attendanceError.message }, 500);
  const byDate = new Map((existing ?? []).map(item => [item.date, item.status]));
  const eligible: string[] = [], skippedReasons: { date: string; reason: string }[] = [];
  for (const date of dates) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (WEEKEND_DAYS.includes(dow)) { skippedReasons.push({ date, reason: "weekend" }); continue; }
    if (holidayDates.has(date)) { skippedReasons.push({ date, reason: "holiday" }); continue; }
    const status = byDate.get(date);
    if (["present", "late", "manual"].includes(status ?? "")) { skippedReasons.push({ date, reason: "real check-in already recorded" }); continue; }
    if (["leave", "sick"].includes(status ?? "")) { skippedReasons.push({ date, reason: "leave already recorded" }); continue; }
    eligible.push(date);
  }
  const { data: leave, error: leaveError } = await supabase.from("leave_requests").insert({ staff_id: staff.id, leave_type: input.leave_type, start_date: input.start_date, end_date: input.end_date, reason: input.reason, created_by: "admin" }).select("id").single();
  if (leaveError) return response({ error: leaveError.message }, 400);
  if (eligible.length) {
    const rows = eligible.map(date => ({ staff_id: staff.id, branch_id: staff.branch_id, date, status: input.leave_type === "sick" ? "sick" : "leave", source: "leave", late_minutes: 0, note: `${input.leave_type}: ${input.reason}`, created_by: "admin" }));
    const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "staff_id,date" });
    if (error) { await supabase.from("leave_requests").delete().eq("id", leave.id); return response({ error: error.message }, 400); }
  }
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: input.actor, action: "leave.created", target: leave.id });
  if (auditError) return response({ error: auditError.message }, 500);
  return response({ ok: true, leave_id: leave.id, days_created: eligible.length, days_skipped: skippedReasons.length, skipped_reasons: skippedReasons });
});
