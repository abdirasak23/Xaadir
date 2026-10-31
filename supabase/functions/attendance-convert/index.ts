import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; }, "Enter a valid calendar date.");
const schema = z.object({ company_id: z.string().uuid(), actor: z.string().uuid(), attendance_id: z.string().uuid().optional(), staff_id: z.string().uuid().optional(), date: date.optional(), new_status: z.enum(["leave","sick"]), leave_type: z.enum(["annual","sick","emergency","unpaid","maternity","other"]), reason: z.string().trim().min(1).max(1000) }).refine(value => value.attendance_id || (value.staff_id && value.date), "Provide an attendance ID or staff and date.");
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET"); if (!secret || request.headers.get("x-admin-secret") !== secret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Invalid attendance conversion." }, 400);
  const input = parsed.data, supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let record: any = null;
  if (input.attendance_id) {
    const { data, error } = await supabase.from("attendance").select("id,staff_id,branch_id,date,status,staff!inner(company_id)").eq("id", input.attendance_id).eq("staff.company_id", input.company_id).maybeSingle();
    if (error) return response({ error: error.message }, 500); record = data;
  } else {
    const { data: staff, error } = await supabase.from("staff").select("id,branch_id").eq("id", input.staff_id!).eq("company_id", input.company_id).maybeSingle();
    if (error) return response({ error: error.message }, 500); if (staff) record = { staff_id: staff.id, branch_id: staff.branch_id, date: input.date };
    const { data: attendance, error: attendanceError } = await supabase.from("attendance").select("id,status,shift_number").eq("staff_id", input.staff_id!).eq("date", input.date!).order("shift_number").limit(1).maybeSingle();
    if (attendanceError) return response({ error: attendanceError.message }, 500);
    if (attendance) { record = { ...record, ...attendance }; }
  }
  if (!record) return response({ error: "Staff attendance was not found in this company." }, 404);
  if (record.status && record.status !== "absent") return response({ error: "Only an absent or unrecorded workday can be converted." }, 409);
  const { data, error } = await supabase.from("attendance").upsert({ id: record.id, staff_id: record.staff_id, branch_id: record.branch_id, date: record.date, shift_number: record.shift_number ?? 1, status: input.new_status, source: "leave", late_minutes: 0, note: `${input.leave_type}: ${input.reason}`, created_by: "admin", check_in_at: null, check_out_at: null }, { onConflict: "staff_id,date,shift_number" }).select().single();
  if (error) return response({ error: error.message }, 400);
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: input.actor, action: "attendance.converted_to_leave", target: data.id }); if (auditError) return response({ error: auditError.message }, 500);
  return response({ ok: true, attendance: data });
});
