import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; });
const schema = z.object({ company_id: z.string().uuid(), actor: z.string().trim().min(1).max(120), scope: z.enum(["staff","day","all"]), staff_ids: z.array(z.string().uuid()).max(1000).default([]), date_from: dateSchema, date_to: dateSchema, include_notes: z.boolean().default(true), include_attendance: z.boolean().default(true), note_type: z.enum(["conversation","promise","warning","last_chance","praise","lateness","absence","other"]).optional(), page: z.number().int().min(1).default(1), notes_page: z.number().int().min(1).default(1), record_export: z.boolean().default(true) });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const PAGE_SIZE = 25, DAY_MS = 86400000, WEEKEND = new Set([5]), TIMEZONE = "Africa/Mogadishu";
const dateRange = (from: string, to: string) => { const out: string[] = []; for (let d = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); d <= end; d = new Date(d.getTime() + DAY_MS)) out.push(d.toISOString().slice(0,10)); return out; };
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const minute = (stamp: string | null) => { if (!stamp) return null; const d = new Date(new Date(stamp).getTime() + 180 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (value: string) => { const [h,m] = value.split(":").map(Number); return h * 60 + m; };
const localToday = () => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const v = (t: string) => p.find(x => x.type === t)?.value ?? ""; return `${v("year")}-${v("month")}-${v("day")}`; };
function shiftsFor(staff: any, date: string) { const configured = Array.isArray(staff.scheduled_shifts) ? staff.scheduled_shifts : []; const weekly = configured.some((s: any) => Number.isInteger(s?.day)); const selected = weekly ? configured.filter((s: any) => s.day === weekday(date)) : configured; const shifts = selected.filter((s: any) => s && typeof s.start === "string" && typeof s.end === "string").map((s: any) => ({ start: s.start.slice(0,5), end: s.end.slice(0,5) })); return shifts.length || weekly ? shifts : [{ start: String(staff.shift_start).slice(0,5), end: String(staff.shift_end).slice(0,5) }]; }
const span = (shift: { start: string; end: string }) => { const length = hm(shift.end) - hm(shift.start); return length > 0 ? length : length + 1440; };

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!secret || request.headers.get("x-admin-secret") !== secret) return respond({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ error: parsed.error.issues[0]?.message ?? "Invalid report request." }, 400);
  const input = parsed.data;
  if (input.date_to < input.date_from || dateRange(input.date_from, input.date_to).length > 366) return respond({ error: "Choose a valid range of no more than 366 days." }, 400);
  if (input.scope === "day" && input.date_from !== input.date_to) return respond({ error: "A single-day report must use the same start and end date." }, 400);
  if (input.scope === "staff" && input.staff_ids.length < 1) return respond({ error: "Select at least one staff member." }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  let staffQuery = db.from("staff").select("id,full_name,staff_code,job_title,branch_id,status,created_at,shift_start,shift_end,scheduled_shifts,branches(name)").eq("company_id", input.company_id).order("full_name");
  if (input.staff_ids.length) staffQuery = staffQuery.in("id", input.staff_ids);
  const staffRes = await staffQuery.range((input.page - 1) * PAGE_SIZE, input.page * PAGE_SIZE - 1);
  if (staffRes.error) return respond({ error: "Could not load report staff." }, 500);
  const staff = staffRes.data ?? [], ids = staff.map(person => person.id);
  const [attendanceRes, leaveRes, holidayRes, noteRes] = await Promise.all([
    input.include_attendance && ids.length ? db.from("attendance").select("id,staff_id,branch_id,date,shift_number,status,check_in_at,check_out_at,late_minutes,source,note").in("staff_id", ids).gte("date", input.date_from).lte("date", input.date_to).order("date").order("shift_number") : Promise.resolve({ data: [], error: null }),
    ids.length ? db.from("leave_requests").select("staff_id,leave_type,start_date,end_date,status").in("staff_id", ids).eq("status", "approved").lte("start_date", input.date_to).gte("end_date", input.date_from) : Promise.resolve({ data: [], error: null }),
    db.from("holidays").select("date,name,branch_id").eq("company_id", input.company_id).gte("date", input.date_from).lte("date", input.date_to),
    input.include_notes && ids.length ? (() => { let q = db.from("hr_notes").select("id,staff_id,note_date,note_time,type,title,body,status,follow_up_date,visibility,locked,author,updated_at,created_at", { count: "exact" }).eq("company_id", input.company_id).in("staff_id", ids).is("deleted_at", null).gte("note_date", input.date_from).lte("note_date", input.date_to).order("note_date", { ascending: false }).order("created_at", { ascending: false }); if (input.note_type) q = q.eq("type", input.note_type); return q.range((input.notes_page - 1) * PAGE_SIZE, input.notes_page * PAGE_SIZE - 1); })() : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);
  const fail = attendanceRes.error ?? leaveRes.error ?? holidayRes.error ?? noteRes.error;
  if (fail) return respond({ error: "Could not load report details." }, 500);
  const attendance = attendanceRes.data ?? [], leaves = leaveRes.data ?? [], holidays = holidayRes.data ?? [], today = localToday();
  const staffReports = staff.map(person => {
    const own = attendance.filter(row => row.staff_id === person.id), ownLeaves = leaves.filter(row => row.staff_id === person.id);
    const holidayDates = new Set(holidays.filter(h => h.branch_id === null || h.branch_id === person.branch_id).map(h => h.date));
    const rowsByDate = new Map<string, any[]>(); for (const row of own) rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row]);
    let lateCount = 0, lateMinutes = 0, leaveDays = 0, sickDays = 0, earlyLeaveMinutes = 0, missingCheckouts = 0;
    for (const row of own) {
      if (row.status === "late" || (Number(row.late_minutes) || 0) > 0) { lateCount++; lateMinutes += Math.max(0, Number(row.late_minutes) || 0); }
      if (["present","late","manual"].includes(row.status) && row.check_in_at && !row.check_out_at && row.date < today) missingCheckouts++;
      if (row.check_out_at && row.date < today) { const shift = shiftsFor(person, row.date)[(row.shift_number ?? 1) - 1]; const out = minute(row.check_out_at); if (shift && out !== null && out < hm(shift.end)) earlyLeaveMinutes += hm(shift.end) - out; }
    }
    const relevantDates = dateRange(input.date_from, input.date_to).filter(date => !WEEKEND.has(weekday(date)) && date < today && shiftsFor(person, date).length > 0 && !holidayDates.has(date));
    let absentDays = 0;
    for (const date of relevantDates) {
      const leave = ownLeaves.find(item => item.start_date <= date && item.end_date >= date);
      const entries = rowsByDate.get(date) ?? [];
      if (entries.some(row => ["leave","sick","holiday"].includes(row.status))) continue;
      if (leave) { if (leave.leave_type === "sick") sickDays++; else leaveDays++; continue; }
      const shifts = shiftsFor(person, date);
      const attended = entries.some(row => shifts[row.shift_number - 1] && ["present","late","manual"].includes(row.status) && row.check_in_at);
      if (!attended) absentDays++;
    }
    const noteCount = (noteRes.data ?? []).filter(note => note.staff_id === person.id).length;
    return { staff: person, attendance_summary: input.include_attendance ? { days_present: relevantDates.length - absentDays - leaveDays - sickDays, late_count: lateCount, late_minutes: lateMinutes, absent_days: absentDays, leave_days: leaveDays, sick_days: sickDays, early_leave_minutes: earlyLeaveMinutes, missing_checkouts: missingCheckouts } : null, attendance: input.include_attendance ? own : [], note_count: noteCount };
  });
  if (input.record_export) {
    let exportIds = input.staff_ids;
    if (!exportIds.length) { const { data: allIds, error: idsError } = await db.from("staff").select("id").eq("company_id", input.company_id); if (idsError) return respond({ error: "Could not record report export." }, 500); exportIds = (allIds ?? []).map(item => item.id); }
    const { error } = await db.from("report_exports").insert({ company_id: input.company_id, exported_by: input.actor, scope: input.scope, staff_ids: exportIds, date_from: input.date_from, date_to: input.date_to, include_notes: input.include_notes });
    if (error) return respond({ error: "Could not record report export." }, 500);
    const { error: auditError } = await db.from("audit_log").insert({ actor: `hr:${input.actor}`, action: "hr_report.export", target: input.company_id });
    if (auditError) return respond({ error: "Export recorded, but its audit event could not be recorded." }, 500);
  }
  const { count: totalStaff } = await db.from("staff").select("id", { count: "exact", head: true }).eq("company_id", input.company_id);
  const notesTotal = noteRes.count ?? 0;
  return respond({ scope: input.scope, date_from: input.date_from, date_to: input.date_to, page: input.page, page_size: PAGE_SIZE, notes_page: input.notes_page, notes_page_size: PAGE_SIZE, total_staff: input.staff_ids.length || totalStaff || 0, has_more: staff.length === PAGE_SIZE, staff: staffReports, notes: input.include_notes ? noteRes.data ?? [] : [], notes_total: notesTotal, notes_has_more: input.include_notes && notesTotal > input.notes_page * PAGE_SIZE });
});
