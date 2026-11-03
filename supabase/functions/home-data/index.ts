
// supabase/functions/home-data/index.ts
// Home screen data for the signed-in staff member. Deploy with Verify JWT ON.
// Body (all optional): { "scope": "all" | "month" | "payroll", "month": "YYYY-MM" }
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

// Business-day settings. Somalia = UTC+3, no DST, Friday off.
// Override in Edge Function secrets: APP_TZ_OFFSET_MINUTES=180, WEEKEND_DAYS=5   (0=Sun ... 6=Sat, e.g. "5,6")
const rawOffset = Number(Deno.env.get("APP_TZ_OFFSET_MINUTES") ?? "180");
const TZ_OFFSET_MIN = Number.isFinite(rawOffset) ? rawOffset : 180;
const WEEKEND_DAYS = (Deno.env.get("WEEKEND_DAYS") ?? "5")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

// Payroll display setting (optional secret): PAYROLL_CURRENCY=USD
const CURRENCY = Deno.env.get("PAYROLL_CURRENCY") ?? "USD";

const RECENT_LOOKBACK_DAYS = 45;
const CHART_DAYS = 14;
const RECENT_COUNT = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const bodySchema = z.object({
  scope: z.enum(["all", "month", "payroll"]).default("all"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must look like 2026-10.").optional(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// ───────────── date helpers (all dates are "YYYY-MM-DD" in the business time zone) ─────────────
const DAY_MS = 86_400_000;
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const fromYmd = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => toYmd(new Date(fromYmd(s).getTime() + n * DAY_MS));
const isWeekend = (s: string) => WEEKEND_DAYS.includes(fromYmd(s).getUTCDay());
const localYmd = (utcMs: number) => toYmd(new Date(utcMs + TZ_OFFSET_MIN * 60_000));
const r2 = (n: number) => Math.round(n * 100) / 100;

function minuteOfDay(ts: string | null): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + TZ_OFFSET_MIN * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

// ───────────── types ─────────────
type Row = {
  date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: string;
  late_minutes: number;
  source: string;
};

type Rec = {
  date: string;
  in_min: number | null;
  out_min: number | null;
  late_min: number;
  status: "present" | "late" | "absent";
  source: "qr" | "manual";
  synthetic: boolean;
};

type StaffRow = {
  id: string;
  full_name: string;
  job_title: string;
  status: string;
  must_change_password: boolean;
  created_at: string;
  shift_start: string;
  shift_end: string;
  grace_minutes: number;
  company_id: string | null;
  branch_id: string | null;
  monthly_salary: number | string | null;
  scheduled_shifts: unknown;
  check_in_method: "biometric" | "selfie";
  branches: { name: string } | { name: string }[] | null;
};

function toRec(row: Row): Rec {
  const absent = row.status === "absent";
  const late = !absent && (row.status === "late" || row.late_minutes > 0);
  return {
    date: row.date,
    in_min: absent ? null : minuteOfDay(row.check_in_at),
    out_min: absent ? null : minuteOfDay(row.check_out_at),
    late_min: late ? row.late_minutes : 0,
    status: absent ? "absent" : late ? "late" : "present",
    source: row.source === "manual" || row.status === "manual" ? "manual" : "qr",
    synthetic: false,
  };
}

// Ascending list of records for [start, end]: real rows + synthetic absences.
// A synthetic absence = a past working day (not weekend, not before the staff was created) with no row.
// Today never becomes a synthetic absence (the day is not over).
function buildRecords(
  start: string,
  end: string,
  today: string,
  created: string,
  rows: Map<string, Row>,
): Rec[] {
  const out: Rec[] = [];
  const last = end < today ? end : today;
  for (let d = start; d <= last; d = addDays(d, 1)) {
    const row = rows.get(d);
    if (row) {
      out.push(toRec(row));
    } else if (d < today && d >= created && !isWeekend(d)) {
      out.push({ date: d, in_min: null, out_min: null, late_min: 0, status: "absent", source: "qr", synthetic: true });
    }
  }
  return out;
}

function summarize(recs: Rec[]) {
  let present = 0, late = 0, absent = 0;
  for (const r of recs) {
    if (r.status === "absent") {
      if (!isWeekend(r.date)) absent++; // an absent mark on a weekend is not a missed working day
    } else if (r.status === "late") late++;
    else present++;
  }
  const attended = present + late;
  const workingDays = attended + absent;
  return {
    present,
    late,
    absent,
    attended,
    working_days: workingDays,
    attendance_pct: workingDays > 0 ? Math.round((attended / workingDays) * 100) : 0,
  };
}

async function loadCaller(request: Request): Promise<StaffRow> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Please sign in.");

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) throw new ApiError(401, "UNAUTHORIZED", "Your session expired. Please sign in again.");

  const { data: staff, error } = await supabase
    .from("staff")
    .select(
      "id,full_name,job_title,status,must_change_password,created_at,shift_start,shift_end,grace_minutes,company_id,branch_id,monthly_salary,scheduled_shifts,check_in_method,branches(name)",
    )
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (error) {
    console.error("staff lookup failed:", error.message);
    throw new ApiError(500, "SERVER_ERROR", "Something went wrong. Try again.");
  }
  if (!staff) throw new ApiError(403, "NO_STAFF", "No staff profile is linked to this account.");
  if (staff.status !== "active") throw new ApiError(403, "STAFF_INACTIVE", "Your account is inactive. Contact HR.");
  if (staff.must_change_password) throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Change your password first.");
  return staff as unknown as StaffRow;
}

async function loadRows(staffId: string, from: string, to: string): Promise<Map<string, Row>> {
  const { data, error } = await supabase
    .from("attendance")
    .select("date,check_in_at,check_out_at,status,late_minutes,source")
    .eq("staff_id", staffId)
    .gte("date", from)
    .lte("date", to);
  if (error) {
    console.error("attendance query failed:", error.message);
    throw new ApiError(500, "SERVER_ERROR", "Could not load attendance. Try again.");
  }
  const map = new Map<string, Row>();
  for (const r of (data ?? []) as Row[]) map.set(r.date, r);
  return map;
}

function todayBlock(row: Row | undefined) {
  if (!row) return { state: "NOT_CHECKED_IN", in_min: null, out_min: null, late_min: 0 };
  const rec = toRec(row);
  if (rec.status === "absent") return { state: "ABSENT", in_min: null, out_min: null, late_min: 0 };
  if (rec.in_min === null) return { state: "NOT_CHECKED_IN", in_min: null, out_min: null, late_min: 0 };
  const state = rec.out_min !== null ? "CHECKED_OUT" : rec.status === "late" ? "LATE" : "CHECKED_IN";
  return { state, in_min: rec.in_min, out_min: rec.out_min, late_min: rec.late_min };
}

// ───────────── payroll (display only: same rules as the company panel) ─────────────
type Shift = { number: number; startMin: number; endMin: number };
type PayrollAttendance = {
  date: string;
  shift_number: number | null;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  late_minutes: number | null;
  note: string | null;
  source?: string;
};

const shiftLength = (s: Shift) => (s.endMin > s.startMin ? s.endMin - s.startMin : s.endMin + 1440 - s.startMin);

// Match the company panel: compare actual check-in to the scheduled start in UTC+3,
// then deduct only the minutes after the five-minute grace period.
function panelLateMinutes(record: PayrollAttendance, shift: Shift | undefined) {
  if (!record.check_in_at) return 0;
  if (!shift) return Math.max(0, Number(record.late_minutes) || 0);
  const hour = String(Math.floor(shift.startMin / 60)).padStart(2, "0");
  const minute = String(shift.startMin % 60).padStart(2, "0");
  const start = Date.parse(`${record.date}T${hour}:${minute}:00+03:00`);
  return Math.max(0, Math.floor((Date.parse(record.check_in_at) - start) / 60_000) - 5);
}

function scheduleOf(staff: StaffRow, date?: string): Shift[] {
  const raw = Array.isArray(staff.scheduled_shifts) ? (staff.scheduled_shifts as any[]) : [];
  const weekly = raw.some((s) => Number.isInteger(s?.day));
  const selected = weekly && date ? raw.filter((s) => s?.day === fromYmd(date).getUTCDay()) : weekly ? [] : raw;
  const list: Shift[] = selected
    .filter((s) => s && typeof s.start === "string" && typeof s.end === "string")
    .map((s, i) => ({ number: i + 1, startMin: timeToMin(s.start), endMin: timeToMin(s.end) }));
  if (list.length || weekly) return list;
  return [{ number: 1, startMin: timeToMin(staff.shift_start), endMin: timeToMin(staff.shift_end) }];
}

async function computePayroll(staff: StaffRow, monthKey: string, today: string) {
  const [y, m] = monthKey.split("-").map(Number);
  const monthStart = `${monthKey}-01`;
  const monthEnd = toYmd(new Date(Date.UTC(y, m, 0)));
  const nowMin = minuteOfDay(new Date().toISOString()) ?? 0;

  const holidaysReq = staff.company_id
    ? supabase.from("holidays").select("date,name,branch_id").eq("company_id", staff.company_id).gte("date", monthStart).lte("date", monthEnd)
    : Promise.resolve({ data: [], error: null });

  const [attRes, leaveRes, holRes] = await Promise.all([
    supabase
      .from("attendance")
      .select("date,shift_number,status,check_in_at,check_out_at,late_minutes,note")
      .eq("staff_id", staff.id)
      .gte("date", monthStart)
      .lte("date", monthEnd),
    supabase
      .from("leave_requests")
      .select("leave_type,start_date,end_date")
      .eq("staff_id", staff.id)
      .eq("status", "approved")
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart),
    holidaysReq,
  ]);
  if (attRes.error) throw new Error(`attendance: ${attRes.error.message}`);
  if (leaveRes.error) throw new Error(`leave_requests: ${leaveRes.error.message}`);
  if (holRes.error) throw new Error(`holidays: ${holRes.error.message}`);

  const records = (attRes.data ?? []) as PayrollAttendance[];
  const attMap = new Map<string, PayrollAttendance>();
  for (const a of records) attMap.set(`${a.date}|${a.shift_number ?? 1}`, a);

  const holMap = new Map<string, string>();
  for (const h of (holRes.data ?? []) as any[]) {
    if (h.branch_id == null || h.branch_id === staff.branch_id) holMap.set(h.date, h.name);
  }

  const leaves = (leaveRes.data ?? []) as { leave_type: string; start_date: string; end_date: string }[];
  const leaveOn = (date: string) => leaves.find((l) => l.start_date <= date && l.end_date >= date);

  const schedules = new Map<string, Shift[]>(datesOfMonth(monthStart, monthEnd).map((date): [string, Shift[]] => [date, scheduleOf(staff, date)]));
  const dateShifts = (date: string) => schedules.get(date) ?? [];
  const scheduledDates = [...schedules].filter(([date, shifts]) => !isWeekend(date) && shifts.length > 0).map(([date]) => date);
  const totalMin = scheduledDates.length ? scheduledDates.reduce((sum, date) => sum + dateShifts(date).reduce((day, shift) => day + shiftLength(shift), 0), 0) / scheduledDates.length : 0;
  const hoursPerDay = totalMin / 60;
  // The Next.js payroll panel currently applies a fixed five-minute grace.
  const grace = 5;
  const salary = Number(staff.monthly_salary) || 0;

  const dates: string[] = [];
  for (let d = monthStart; d <= monthEnd; d = addDays(d, 1)) if (!isWeekend(d)) dates.push(d);

  const payableDates = scheduledDates.filter((date) => !holMap.has(date));
  const workingDays = payableDates.length;
  const daily = workingDays > 0 ? salary / workingDays : 0;
  const perMin = workingDays > 0 && hoursPerDay > 0 ? salary / workingDays / hoursPerDay / 60 : 0;
  const isEstimate = today <= monthEnd;

  const lateByShift = new Map<string, number>();
  let lateMinutes = 0;
  let lateDed = 0;
  for (const record of records) {
    const sched = dateShifts(record.date);
    const shift = sched[Math.max(0, (record.shift_number ?? 1) - 1)];
    const late = panelLateMinutes(record, shift);
    lateByShift.set(`${record.date}|${record.shift_number ?? 1}`, late);
    const dailyMinutes = sched.reduce((sum, item) => sum + shiftLength(item), 0);
    const recordRate = workingDays > 0 && dailyMinutes > 0 ? salary / workingDays / (dailyMinutes / 60) / 60 : 0;
    lateMinutes += late;
    lateDed += recordRate * late;
  }
  let absDed = 0;
  let absentDays = 0;
  let expectedDays = 0;
  let attendanceDays = 0;
  let elapsed = 0;
  const days: unknown[] = [];

  for (const date of dates) {
    const holidayName = holMap.get(date);
    const sched = dateShifts(date);
    if (!holidayName && sched.length && date < today) elapsed += 1;
    else if (!holidayName && sched.length && date === today && totalMin > 0) {
      const done = sched.reduce((a, s) => a + Math.min(Math.max(nowMin - s.startMin, 0), shiftLength(s)), 0);
      elapsed += done / totalMin;
    }

    const leave = leaveOn(date);
    const dateRecords = records.filter((record) => record.date === date);
    const presentToday = dateRecords.some((record) => ["present", "late", "manual"].includes(record.status));
    const excusedToday = dateRecords.some((record) => ["leave", "sick", "holiday"].includes(record.status)) || Boolean(leave);
    const eligiblePast = !holidayName && sched.length > 0 && date < today && !excusedToday;
    if (eligiblePast) {
      expectedDays += 1;
      if (presentToday) attendanceDays += 1;
      else absentDays += 1;
    }

    const rows: any[] = [];
    for (const s of sched) {
      const a = attMap.get(`${date}|${s.number}`);
      const row: any = {
        shift_number: s.number,
        start_min: s.startMin,
        end_min: s.endMin,
        kind: "on_time",
        in_min: null,
        out_min: null,
        late_min: 0,
        counted_late_min: 0,
        deduction: 0,
        is_estimate: isEstimate,
        note: a?.note ?? null,
      };

      if (a && ["leave", "sick", "holiday"].includes(a.status)) {
        row.kind = a.status;
      } else if (a?.check_in_at) {
        row.in_min = minuteOfDay(a.check_in_at);
        row.out_min = minuteOfDay(a.check_out_at);
        const counted = lateByShift.get(`${date}|${s.number}`) ?? 0;
        if (counted > 0) {
          row.kind = "late";
          row.late_min = counted;
          row.counted_late_min = counted;
          const dateMinutes = sched.reduce((sum, item) => sum + shiftLength(item), 0);
          const dateRate = workingDays > 0 && dateMinutes > 0 ? salary / workingDays / (dateMinutes / 60) / 60 : 0;
          row.deduction = r2(counted * dateRate);
        }
      } else if (holMap.has(date)) {
        row.kind = "holiday";
        row.note = holMap.get(date);
      } else if (leave) {
        row.kind = leave.leave_type === "sick" ? "sick" : "leave";
      } else {
        const over = date < today || (date === today && s.endMin > s.startMin && nowMin >= s.endMin);
        row.kind = a?.status === "absent" || over ? "unexcused" : "future";
      }
      rows.push(row);
    }

    if (eligiblePast && !presentToday) {
      const first = rows[0];
      if (first) {
        first.deduction = r2(daily);
        first.kind = "unexcused";
      }
      absDed += daily;
    }
    days.push({ date, shifts: rows, holiday: holidayName ?? null, attendance_recorded: presentToday });
  }

  lateDed = r2(lateDed);
  absDed = r2(absDed);

  return {
    key: monthKey,
    currency: CURRENCY,
    summary: {
      monthly_salary: salary,
      currency: CURRENCY,
      grace_minutes: grace,
      late_minutes: lateMinutes,
      lateness_deduction: lateDed,
      unexcused_absent_days: absentDays,
      absence_deduction: absDed,
      estimated_net: r2(Math.max(0, salary - lateDed - absDed)),
      daily_salary: r2(daily),
      per_minute_rate: r2(perMin),
      payable_days: workingDays,
      expected_days: expectedDays,
      attendance_days: attendanceDays,
      attendance_percentage: expectedDays > 0 ? Math.round(attendanceDays / expectedDays * 100) : null,
      is_estimate: isEstimate,
      period_start: monthStart,
      period_end: monthEnd,
      working_days: workingDays,
      elapsed_working_days: r2(elapsed),
      earned_so_far: r2(Math.max(0, daily * elapsed - lateDed - absDed)),
    },
    days,
  };
}

function datesOfMonth(start: string, end: string) {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST.");

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})) ?? {});
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid request.");
    const { scope } = parsed.data;

    const staff = await loadCaller(request);

    const today = localYmd(Date.now());
    const created = localYmd(Date.parse(staff.created_at));

    // Requested month (defaults to the current one).
    const monthKey = parsed.data.month ?? today.slice(0, 7);
    if (monthKey > today.slice(0, 7)) throw new ApiError(400, "INVALID_MONTH", "That month has not started yet.");

    // Payroll only (used by the month picker and the payroll sheet).
    if (scope === "payroll") {
      try {
        return json({ payroll: await computePayroll(staff, monthKey, today) });
      } catch (e) {
        console.error("payroll failed:", e instanceof Error ? e.message : "unknown");
        throw new ApiError(500, "SERVER_ERROR", "Could not load your pay. Try again.");
      }
    }

    const monthStart = `${monthKey}-01`;
    const [y, m] = monthKey.split("-").map(Number);
    const monthEnd = toYmd(new Date(Date.UTC(y, m, 0)));

    const fromDate = scope === "all"
      ? [monthStart, addDays(today, -RECENT_LOOKBACK_DAYS)].sort()[0]
      : monthStart;
    const toDate = monthEnd < today ? monthEnd : today;
    const rows = await loadRows(staff.id, fromDate, scope === "all" ? today : toDate);

    const monthRecs = buildRecords(monthStart, monthEnd, today, created, rows);
    const month = {
      key: monthKey,
      summary: summarize(monthRecs),
      records: [...monthRecs].reverse(), // newest first
    };

    if (scope === "month") return json({ month });

    // Chart: check-in minute per day, last 14 days including today.
    const chartDays: { date: string; check_in_min: number | null; late: boolean }[] = [];
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const row = rows.get(d);
      const rec = row ? toRec(row) : null;
      chartDays.push({
        date: d,
        check_in_min: rec && rec.status !== "absent" ? rec.in_min : null,
        late: rec?.status === "late",
      });
    }

    // Last 5 records (real rows + missed working days), newest first.
    const recent = buildRecords(addDays(today, -RECENT_LOOKBACK_DAYS), today, today, created, rows)
      .reverse()
      .slice(0, RECENT_COUNT);

    // Pay card: never let a payroll problem break the whole home screen.
    let payroll: unknown = null;
    try {
      payroll = await computePayroll(staff, today.slice(0, 7), today);
    } catch (e) {
      console.error("payroll failed:", e instanceof Error ? e.message : "unknown");
    }

    const branch = Array.isArray(staff.branches) ? staff.branches[0] : staff.branches;
    const fullName = staff.full_name.trim();
    const todayShifts = scheduleOf(staff, today);

    return json({
      server_date: today,
      greeting: {
        first_name: fullName.split(/\s+/)[0] ?? fullName,
        full_name: fullName,
        job_title: staff.job_title,
        branch_name: branch?.name ?? "",
      },
      shift: {
        start_min: todayShifts[0]?.startMin ?? null,
        end_min: todayShifts[0]?.endMin ?? null,
        shifts: todayShifts.map(({ number, startMin, endMin }) => ({ number, start_min: startMin, end_min: endMin })),
        grace_minutes: staff.grace_minutes,
      },
      check_in_method: staff.check_in_method ?? "biometric",
      today: todayBlock(rows.get(today)),
      month,
      chart: { shift_start_min: todayShifts[0]?.startMin ?? null, days: chartDays },
      recent,
      payroll,
    });
  } catch (error) {
    if (error instanceof ApiError) return json({ code: error.code, error: error.message }, error.status);
    console.error("home-data error:", error instanceof Error ? error.message : "unknown");
    return json({ code: "SERVER_ERROR", error: "Something went wrong. Try again." }, 500);
  }
});
