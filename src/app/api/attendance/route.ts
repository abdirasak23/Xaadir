import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { dateSchema, timeSchema, uuidSchema } from "@/lib/validation";
import { z } from "zod";
import { getCompanyContext } from "@/lib/company-auth";
import { localDateInTimezone } from "../../../../shared/attendance-rules";

export async function GET(request: NextRequest) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const fallbackDate = localDateInTimezone();
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
  let query = supabase.from("attendance").select("*, staff!inner(full_name,staff_code,branch_id,company_id,check_in_method,branches(name))").eq("staff.company_id", company.companyId).gte("date", from).lte("date", to).order("date", { ascending: false }).order("shift_number", { ascending: false });
  if (branch) query = query.eq("branch_id", branch);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const { manualAttendanceSchema } = await import("@/lib/validation");
  const body = await request.json().catch(() => null);
  const rosterSchema = z.object({
    action: z.literal("save-roster"),
    date: dateSchema,
    scope: z.enum(["all_shifts", "specific_shift"]),
    shift_number: z.number().int().min(1).max(8),
    check_in_at: timeSchema.or(z.literal("")),
    check_out_at: timeSchema.or(z.literal("")),
    entries: z.array(z.object({
      staff_id: uuidSchema,
      status: z.enum(["present", "absent"]),
      times: z.array(z.object({
        shift_number: z.number().int().min(1).max(8),
        check_in_at: timeSchema.or(z.literal("")),
        check_out_at: timeSchema.or(z.literal("")),
      })).max(8).optional(),
    })).min(1).max(500),
  });
  const roster = rosterSchema.safeParse(body);
  if (roster.success) {
    try {
      const input = roster.data;
      const staffIds = [...new Set(input.entries.map(entry => entry.staff_id))];
      if (staffIds.length !== input.entries.length) return NextResponse.json({ error: "Each staff member can appear only once." }, { status: 400 });
      const supabase = getSupabaseAdmin();
      const { data: people, error: peopleError } = await supabase.from("staff")
        .select("id,full_name,branch_id,status,shift_start,shift_end,scheduled_shifts,grace_minutes")
        .eq("company_id", company.companyId).in("id", staffIds);
      if (peopleError) throw new Error(peopleError.message);
      if (!people || people.length !== staffIds.length || people.some(person => person.status !== "active")) {
        return NextResponse.json({ error: "A selected staff member is inactive or outside this company. Refresh and try again." }, { status: 400 });
      }

      const entries: Record<string, unknown>[] = [];
      for (const person of people) {
        const selected = input.entries.find(entry => entry.staff_id === person.id)!;
        const configured = Array.isArray(person.scheduled_shifts) ? person.scheduled_shifts as { start: string; end: string; day?: number }[] : [];
        const dayShifts = configured.some(shift => shift.day !== undefined)
          ? configured.filter(shift => shift.day === new Date(`${input.date}T00:00:00Z`).getUTCDay())
          : configured;
        const shifts = (dayShifts.length ? dayShifts : configured.length ? [] : [{ start: person.shift_start, end: person.shift_end }])
          .map(shift => ({ start: shift.start.slice(0, 5), end: shift.end.slice(0, 5) }));
        const targets = input.scope === "all_shifts"
          ? shifts.map((shift, index) => ({ shift, number: index + 1 }))
          : shifts[input.shift_number - 1] ? [{ shift: shifts[input.shift_number - 1], number: input.shift_number }] : [];
        if (!targets.length) return NextResponse.json({ error: `${person.full_name} has no shift in the selected scope for this date.` }, { status: 400 });

        const { data: existing, error: existingError } = await supabase.from("attendance").select("shift_number,status")
          .eq("staff_id", person.id).eq("date", input.date);
        if (existingError) throw new Error(existingError.message);
        const oldByShift = new Map((existing ?? []).map(row => [row.shift_number ?? 1, row]));
        if (targets.some(({ number }) => ["leave", "sick", "holiday"].includes(oldByShift.get(number)?.status ?? ""))) {
          return NextResponse.json({ error: `${person.full_name} has leave, sick, or holiday recorded for a selected shift. Resolve that entry before changing it.` }, { status: 409 });
        }

        for (const { shift, number } of targets) {
          let checkInAt: string | null = null;
          let checkOutAt: string | null = null;
          let lateMinutes = 0;
          let status = "absent";
          if (selected.status === "present") {
            const useCustom = input.scope === "specific_shift";
            const individualTimes = selected.times?.find(value => value.shift_number === number);
            const inTime = individualTimes?.check_in_at || (useCustom && input.check_in_at) || shift.start;
            const outTime = individualTimes?.check_out_at || (useCustom && input.check_out_at) || shift.end;
            const checkIn = new Date(`${input.date}T${inTime}:00+03:00`);
            const overnight = outTime <= inTime;
            const outDate = overnight
              ? new Date(new Date(`${input.date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
              : input.date;
            const checkOut = new Date(`${outDate}T${outTime}:00+03:00`);
            if (checkOut <= checkIn) return NextResponse.json({ error: `Check-out must be after check-in for ${person.full_name}, shift ${number}.` }, { status: 400 });
            checkInAt = checkIn.toISOString();
            checkOutAt = checkOut.toISOString();
            const scheduledStart = new Date(`${input.date}T${shift.start}:00+03:00`);
            lateMinutes = Math.max(0, Math.floor((checkIn.getTime() - scheduledStart.getTime()) / 60_000) - (person.grace_minutes ?? 5));
            status = lateMinutes > 0 ? "late" : "present";
          }
          entries.push({ staff_id: person.id, branch_id: person.branch_id, date: input.date, shift_number: number,
            check_in_at: checkInAt, check_out_at: checkOutAt, status, late_minutes: lateMinutes,
            source: "manual", created_by: company.userId, note: null });
        }
      }

      const { data: saved, error: saveError } = await supabase.from("attendance")
        .upsert(entries, { onConflict: "staff_id,date,shift_number" }).select("id");
      if (saveError) throw new Error(saveError.message);
      const audits = (saved ?? []).map(row => ({ actor: `hr:${company.userId}`, action: "attendance.manual_roster", target: row.id }));
      if (audits.length) {
        const { error: auditError } = await supabase.from("audit_log").insert(audits);
        if (auditError) throw new Error(auditError.message);
      }
      return NextResponse.json({ saved_staff_count: input.entries.length, saved_shift_count: (saved ?? []).length });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the daily attendance roster." }, { status: 400 });
    }
  }
  const convertSchema = z.object({ action: z.literal("convert"), attendance_id: uuidSchema.optional(), staff_id: uuidSchema.optional(), date: dateSchema.optional(), new_status: z.enum(["leave", "sick"]), leave_type: z.enum(["annual", "sick", "emergency", "unpaid", "maternity", "other"]), reason: z.string().trim().min(1).max(1000) });
  const convert = convertSchema.safeParse(body);
  if (convert.success) {
    try { return NextResponse.json(await (await import("@/lib/edge")).callAdminFunction("attendance-convert", { ...convert.data, company_id: company.companyId, actor: company.userId })); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Attendance conversion failed." }, { status: 400 }); }
  }
  const parsed = manualAttendanceSchema.safeParse(body);
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
