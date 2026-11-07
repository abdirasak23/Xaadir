import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const schema = z.object({
  staff_id: z.string().uuid(), company_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsedDate = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
  }),
  shift_number: z.number().int().min(1).max(8).default(1),
  full_day_present: z.boolean().default(false),
  check_in_at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
  check_out_at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
  reason: z.string().trim().max(500).optional().default(""),
});
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const adminSecret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!adminSecret || request.headers.get("x-admin-secret") !== adminSecret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Invalid attendance details." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: staff, error: staffError } = await supabase.from("staff").select("id,company_id,branch_id,shift_start,shift_end,scheduled_shifts,grace_minutes,status").eq("id", parsed.data.staff_id).eq("company_id", parsed.data.company_id).maybeSingle();
  if (staffError) return response({ error: staffError.message }, 500);
  if (!staff || staff.status !== "active") return response({ error: "Active staff member not found." }, 404);
  const weekday = new Date(`${parsed.data.date}T00:00:00Z`).getUTCDay();
  const configured = Array.isArray(staff.scheduled_shifts) ? staff.scheduled_shifts as { start: string; end: string; day?: number }[] : [];
  const shifts = configured.some(shift => shift.day !== undefined)
    ? configured.filter(shift => shift.day === weekday).map(({ start, end }) => ({ start: start.slice(0, 5), end: end.slice(0, 5) }))
    : configured.length ? configured.map(({ start, end }) => ({ start: start.slice(0, 5), end: end.slice(0, 5) }))
      : [{ start: staff.shift_start.slice(0, 5), end: staff.shift_end.slice(0, 5) }];
  if (parsed.data.full_day_present) {
    if (!shifts.length) return response({ error: "This staff member has no shift scheduled on that date." }, 400);
    const { data: existing, error: existingError } = await supabase.from("attendance").select("*")
      .eq("staff_id", staff.id).eq("date", parsed.data.date);
    if (existingError) return response({ error: existingError.message }, 500);
    const byShift = new Map((existing ?? []).map(row => [row.shift_number ?? 1, row]));
    if (shifts.some((_, index) => ["leave", "sick", "holiday"].includes(byShift.get(index + 1)?.status ?? ""))) {
      return response({ error: "This date already has leave, sick, or holiday recorded. Review that entry before marking the day present." }, 409);
    }
    const entries = shifts.flatMap((_, index) => {
      const shiftNumber = index + 1;
      const scheduledShift = shifts[index];
      const checkIn = new Date(`${parsed.data.date}T${scheduledShift.start}:00+03:00`);
      const overnight = scheduledShift.end <= scheduledShift.start;
      const checkOutDate = overnight
        ? new Date(new Date(`${parsed.data.date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
        : parsed.data.date;
      const checkOut = new Date(`${checkOutDate}T${scheduledShift.end}:00+03:00`);
      return [{
        staff_id: staff.id, branch_id: staff.branch_id, date: parsed.data.date,
        shift_number: shiftNumber, check_in_at: checkIn.toISOString(), check_out_at: checkOut.toISOString(),
        status: "present", late_minutes: 0, source: "manual", created_by: "admin", note: parsed.data.reason || null,
      }];
    });
    let saved: any[] = [];
    if (entries.length) {
      const { data, error } = await supabase.from("attendance").upsert(entries, { onConflict: "staff_id,date,shift_number" }).select();
      if (error) return response({ error: error.message }, 400);
      saved = data ?? [];
    }
    for (const row of saved) {
      const { error: auditError } = await supabase.from("audit_log").insert({ actor: "admin", action: "attendance.manual_full_day", target: row.id });
      if (auditError) return response({ error: auditError.message }, 500);
    }
    return response({ status: "present", shift_count: shifts.length, updated_count: saved.length });
  }
  if (parsed.data.shift_number > shifts.length) return response({ error: shifts.length ? "Choose a scheduled shift for this staff member." : "This staff member has no shift scheduled on that date." }, 400);
  const selectedShift = shifts[parsed.data.shift_number - 1];
  const overnight = selectedShift.end <= selectedShift.start;
  const checkIn = parsed.data.check_in_at ? new Date(`${parsed.data.date}T${parsed.data.check_in_at}:00+03:00`) : null;
  const checkOutDate = overnight && parsed.data.check_in_at && parsed.data.check_out_at && parsed.data.check_out_at < parsed.data.check_in_at
    ? new Date(new Date(`${parsed.data.date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
    : parsed.data.date;
  const checkOut = parsed.data.check_out_at ? new Date(`${checkOutDate}T${parsed.data.check_out_at}:00+03:00`) : null;
  if (!checkIn && checkOut) return response({ error: "Check-in time is required when check-out is provided." }, 400);
  if (checkIn && checkOut && checkOut < checkIn) return response({ error: "Check-out must be after check-in." }, 400);
  const [shiftHour, shiftMinute] = shifts[parsed.data.shift_number - 1].start.split(":").map(Number);
  const shift = new Date(`${parsed.data.date}T${String(shiftHour).padStart(2, "0")}:${String(shiftMinute).padStart(2, "0")}:00+03:00`);
  const lateMinutes = checkIn ? Math.max(0, Math.floor((checkIn.getTime() - shift.getTime()) / 60000) - staff.grace_minutes) : 0;
  const record = {
    staff_id: staff.id, branch_id: staff.branch_id, date: parsed.data.date, shift_number: parsed.data.shift_number,
    check_in_at: checkIn?.toISOString() ?? null, check_out_at: checkOut?.toISOString() ?? null,
    status: !checkIn ? "absent" : lateMinutes > 0 ? "late" : "present",
    late_minutes: lateMinutes, source: "manual", created_by: "admin", note: parsed.data.reason || null,
  };
  const { data, error } = await supabase.from("attendance").upsert(record, { onConflict: "staff_id,date,shift_number" }).select().single();
  if (error) return response({ error: error.message }, 400);
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: "admin", action: "attendance.manual", target: data.id });
  if (auditError) return response({ error: auditError.message }, 500);
  return response(data);
});
