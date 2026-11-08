import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const manualSchema = z.object({
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
const rosterSchema = z.object({
  action: z.literal("save-roster"),
  company_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  scope: z.enum(["all_shifts", "specific_shift"]),
  shift_number: z.number().int().min(1).max(8),
  check_in_at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
  check_out_at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
  entries: z.array(z.object({ staff_id: z.string().uuid(), status: z.enum(["present", "absent"]) })).min(1).max(500),
});
const schema = z.union([rosterSchema, manualSchema]);
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const adminSecret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!adminSecret || request.headers.get("x-admin-secret") !== adminSecret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Invalid attendance details." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if ("action" in parsed.data) {
    const input = parsed.data;
    const staffIds = [...new Set(input.entries.map(entry => entry.staff_id))];
    if (staffIds.length !== input.entries.length) return response({ error: "Each staff member can appear only once in the daily roster." }, 400);
    const { data: rosterStaff, error: rosterStaffError } = await supabase.from("staff")
      .select("id,company_id,branch_id,full_name,shift_start,shift_end,scheduled_shifts,grace_minutes,status")
      .eq("company_id", input.company_id).in("id", staffIds);
    if (rosterStaffError) return response({ error: rosterStaffError.message }, 500);
    if (!rosterStaff || rosterStaff.length !== staffIds.length || rosterStaff.some(person => person.status !== "active")) {
      return response({ error: "One or more staff members are inactive or do not belong to this company. Refresh the roster and try again." }, 400);
    }
    const entries: Record<string, unknown>[] = [];
    for (const person of rosterStaff) {
      const selected = input.entries.find(entry => entry.staff_id === person.id)!;
      const configured = Array.isArray(person.scheduled_shifts) ? person.scheduled_shifts as { start: string; end: string; day?: number }[] : [];
      const shifts = configured.some(shift => shift.day !== undefined)
        ? configured.filter(shift => shift.day === new Date(`${input.date}T00:00:00Z`).getUTCDay()).map(({ start, end }) => ({ start: start.slice(0, 5), end: end.slice(0, 5) }))
        : configured.length ? configured.map(({ start, end }) => ({ start: start.slice(0, 5), end: end.slice(0, 5) }))
          : [{ start: person.shift_start.slice(0, 5), end: person.shift_end.slice(0, 5) }];
      if (!shifts.length) continue;
      const targetShifts = input.scope === "all_shifts"
        ? shifts.map((shift, index) => ({ shift, number: index + 1 }))
        : shifts[input.shift_number - 1] ? [{ shift: shifts[input.shift_number - 1], number: input.shift_number }] : [];
      if (!targetShifts.length) continue;
      const { data: existing, error: existingError } = await supabase.from("attendance").select("shift_number,status")
        .eq("staff_id", person.id).eq("date", input.date);
      if (existingError) return response({ error: existingError.message }, 500);
      const existingByShift = new Map((existing ?? []).map(row => [row.shift_number ?? 1, row]));
      if (targetShifts.some(({ number }) => ["leave", "sick", "holiday"].includes(existingByShift.get(number)?.status ?? ""))) {
        return response({ error: `${person.full_name} has leave, sick, or holiday recorded on this date. Review that entry before saving the roster.` }, 409);
      }
      for (const { shift: scheduledShift, number } of targetShifts) {
        let checkInAt: string | null = null;
        let checkOutAt: string | null = null;
        let lateMinutes = 0;
        let status = "absent";
        if (selected.status === "present") {
          const customTimes = input.scope === "specific_shift";
          const checkInTime = customTimes && input.check_in_at ? input.check_in_at : scheduledShift.start;
          const checkOutTime = customTimes && input.check_out_at ? input.check_out_at : scheduledShift.end;
          const checkIn = new Date(`${input.date}T${checkInTime}:00+03:00`);
          const checkOutDate = checkOutTime <= checkInTime
            ? new Date(new Date(`${input.date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
            : input.date;
          const checkOut = new Date(`${checkOutDate}T${checkOutTime}:00+03:00`);
          if (checkOut <= checkIn) return response({ error: `Check-out must be after check-in for ${person.full_name}, shift ${number}.` }, 400);
          checkInAt = checkIn.toISOString();
          checkOutAt = checkOut.toISOString();
          const shiftStart = new Date(`${input.date}T${scheduledShift.start}:00+03:00`);
          lateMinutes = Math.max(0, Math.floor((checkIn.getTime() - shiftStart.getTime()) / 60000) - (person.grace_minutes ?? 5));
          status = lateMinutes > 0 ? "late" : "present";
        }
        entries.push({
          staff_id: person.id, branch_id: person.branch_id, date: input.date, shift_number: number,
          check_in_at: checkInAt, check_out_at: checkOutAt, status, late_minutes: lateMinutes,
          source: "manual", created_by: "admin", note: null,
        });
      }
    }
    if (!entries.length) return response({ error: "No scheduled shifts were found for the selected staff and date." }, 400);
    const { data: saved, error: saveError } = await supabase.from("attendance")
      .upsert(entries, { onConflict: "staff_id,date,shift_number" }).select("id,staff_id,status,shift_number");
    if (saveError) return response({ error: saveError.message }, 400);
    const auditRows = (saved ?? []).map(row => ({ actor: "admin", action: "attendance.manual_roster", target: row.id }));
    if (auditRows.length) {
      const { error: auditError } = await supabase.from("audit_log").insert(auditRows);
      if (auditError) return response({ error: auditError.message }, 500);
    }
    return response({ saved_staff_count: input.entries.length, saved_shift_count: (saved ?? []).length });
  }
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
