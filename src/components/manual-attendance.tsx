"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Field, Input, Notice, PageHeading } from "@/components/ui";
import { localDateInTimezone } from "../../shared/attendance-rules";

type Shift = { start: string; end: string; day?: number };
type Staff = { id: string; full_name: string; staff_code: string; status: string; shift_start?: string; shift_end?: string; scheduled_shifts?: Shift[] };
type AttendanceRow = { staff_id: string; shift_number?: number; check_in_at: string | null; check_out_at: string | null; status: string; note?: string | null };
type RosterStatus = "present" | "absent";
const today = localDateInTimezone();
const weekDayName = (day: number) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
const shiftsFor = (person: Staff, day: number): Shift[] => {
  const configured = person.scheduled_shifts ?? [];
  if (configured.some(shift => shift.day !== undefined)) return configured.filter(shift => shift.day === day).map(({ start, end }) => ({ start: start.slice(0, 5), end: end.slice(0, 5) }));
  return configured.length ? configured.map(({ start, end }) => ({ start: start.slice(0, 5), end: end.slice(0, 5) })) : [{ start: person.shift_start?.slice(0, 5) ?? "09:00", end: person.shift_end?.slice(0, 5) ?? "17:00" }];
};
const attendedStatuses = new Set(["present", "late", "manual"]);

export function ManualAttendance() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [date, setDate] = useState(today);
  const [scope, setScope] = useState<"all_shifts" | "specific_shift">("all_shifts");
  const [shiftNumber, setShiftNumber] = useState(1);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [draft, setDraft] = useState<Record<string, RosterStatus>>({});
  const [leaveStaffId, setLeaveStaffId] = useState("");
  const [leaveKind, setLeaveKind] = useState<"leave" | "sick">("leave");
  const [leaveReason, setLeaveReason] = useState("");
  const [tab, setTab] = useState<"roster" | "leave">("roster");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [staffLoading, setStaffLoading] = useState(true);
  const dayNumber = new Date(`${date}T00:00:00Z`).getUTCDay();

  const loadRecords = useCallback(async () => {
    const response = await fetch(`/api/attendance?from=${date}&to=${date}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load attendance records.");
    if (Array.isArray(data)) setRecords(data);
  }, [date]);

  useEffect(() => {
    void fetch("/api/staff").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load staff.");
      const active = data.filter((person: Staff) => person.status === "active");
      setStaff(active);
      if (active[0]) setLeaveStaffId(active[0].id);
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load staff.")).finally(() => setStaffLoading(false));
  }, []);
  useEffect(() => {
    setDraft({});
    void loadRecords().catch(reason => setError(reason instanceof Error ? reason.message : "Could not load attendance records."));
  }, [loadRecords]);

  const roster = useMemo(() => staff.map(person => ({ person, shifts: shiftsFor(person, dayNumber) }))
    .filter(item => scope === "all_shifts" ? item.shifts.length > 0 : item.shifts.length >= shiftNumber), [staff, dayNumber, scope, shiftNumber]);

  function savedStatus(person: Staff, shifts: Shift[]): RosterStatus | "mixed" | "leave" | "sick" | "holiday" | "" {
    const relevant = scope === "all_shifts"
      ? shifts.map((_, index) => records.find(record => record.staff_id === person.id && (record.shift_number ?? 1) === index + 1)).filter(Boolean) as AttendanceRow[]
      : records.filter(record => record.staff_id === person.id && (record.shift_number ?? 1) === shiftNumber);
    if (!relevant.length) return "";
    if (relevant.some(record => record.status === "leave" || record.status === "sick" || record.status === "holiday")) {
      return relevant.find(record => record.status === "leave" || record.status === "sick" || record.status === "holiday")!.status as "leave" | "sick" | "holiday";
    }
    const presentCount = relevant.filter(record => attendedStatuses.has(record.status)).length;
    const absentCount = relevant.filter(record => record.status === "absent").length;
    if (presentCount && absentCount) return "mixed";
    if (presentCount) return "present";
    if (absentCount === (scope === "all_shifts" ? shifts.length : 1)) return "absent";
    return "";
  }

  function statusFor(person: Staff, shifts: Shift[]) {
    return draft[person.id] ?? savedStatus(person, shifts);
  }

  async function saveRoster() {
    setBusy(true); setError(""); setNotice("");
    try {
      const entries = roster.flatMap(({ person }) => {
        const status = draft[person.id];
        return status ? [{ staff_id: person.id, status }] : [];
      });
      if (!entries.length) throw new Error("Mark at least one staff member Present or Absent before saving.");
      const response = await fetch("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-roster", date, scope, shift_number: shiftNumber, check_in_at: checkIn, check_out_at: checkOut, entries }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save the daily attendance roster.");
      setNotice(`Saved attendance for ${body.saved_staff_count} staff across ${body.saved_shift_count} shift records.`);
      setDraft({});
      await loadRecords();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the daily attendance roster.");
    } finally { setBusy(false); }
  }

  async function saveLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert", staff_id: leaveStaffId, date, new_status: leaveKind, leave_type: leaveKind === "sick" ? "sick" : "other", reason: leaveReason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not record leave.");
      setNotice(`${leaveKind === "sick" ? "Sick day" : "Leave"} recorded for ${date}.`);
      setLeaveReason("");
      await loadRecords();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record leave."); }
    finally { setBusy(false); }
  }

  const markedPresent = roster.filter(({ person }) => draft[person.id] === "present").length;
  const markedAbsent = roster.filter(({ person }) => draft[person.id] === "absent").length;
  const excludedCount = roster.filter(({ person, shifts }) => ["leave", "sick", "holiday"].includes(statusFor(person, shifts))).length;
  const pendingCount = roster.length - markedPresent - markedAbsent - excludedCount;
  const maxShift = Math.max(1, ...staff.map(person => shiftsFor(person, dayNumber).length));

  return <>
    <PageHeading eyebrow="Attendance" title="Manual entry" description="Set attendance for the whole team in one step, or correct a specific shift." action={<a href="/attendance" className="text-sm font-semibold text-forest hover:underline">Back to dashboard</a>} />
    {error && <div className="mb-4"><Notice error>{error}</Notice></div>}{notice && <div className="mb-4"><Notice>{notice}</Notice></div>}
    <div className="mb-5 inline-flex rounded-xl bg-neutral-100 p-1" role="tablist" aria-label="Manual attendance mode">
      <button type="button" role="tab" aria-selected={tab === "roster"} onClick={() => { setTab("roster"); setError(""); }} className={`rounded-lg px-4 py-2.5 text-xs font-semibold ${tab === "roster" ? "bg-white text-black shadow-sm" : "text-neutral-500"}`}>Daily staff roster</button>
      <button type="button" role="tab" aria-selected={tab === "leave"} onClick={() => { setTab("leave"); setError(""); }} className={`rounded-lg px-4 py-2.5 text-xs font-semibold ${tab === "leave" ? "bg-white text-black shadow-sm" : "text-neutral-500"}`}>Leave / sick</button>
    </div>

    {tab === "roster" ? <Card className="p-0">
      <div className="border-b border-neutral-100 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-neutral-400">Save selected staff</p><h2 className="mt-1 text-lg font-semibold">Daily attendance</h2><p className="mt-1 text-xs text-neutral-500">Mark the staff you want to record or correct. Unmarked staff are left unchanged.</p></div>
          <Field label="Attendance date"><Input type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Field label="Record scope"><select value={scope} onChange={event => { setScope(event.target.value as typeof scope); setDraft({}); }} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm"><option value="all_shifts">Full day: all scheduled shifts</option><option value="specific_shift">Specific shift: team correction</option></select></Field>
          {scope === "specific_shift" ? <Field label="Shift number"><select value={shiftNumber} onChange={event => { setShiftNumber(Number(event.target.value)); setDraft({}); }} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm">{Array.from({ length: maxShift }, (_, index) => <option key={index} value={index + 1}>Shift {index + 1}</option>)}</select></Field> : <div className="flex items-end"><p className="rounded-xl bg-emerald-50 px-3.5 py-3 text-xs leading-5 text-emerald-800">Full day applies Present or Absent to every scheduled shift. Present uses each shift's scheduled check-in and checkout times.</p></div>}
        </div>
        {scope === "specific_shift" && <div className="mt-3 grid gap-3 rounded-xl bg-neutral-50 p-3 sm:grid-cols-2 sm:p-4">
          <Field label="Check-in time (optional)"><Input type="time" value={checkIn} onChange={event => setCheckIn(event.target.value)} /></Field>
          <Field label="Check-out time (optional)"><Input type="time" value={checkOut} onChange={event => setCheckOut(event.target.value)} /></Field>
          <p className="text-[11px] leading-5 text-neutral-500 sm:col-span-2">Selected times apply to this shift for everyone marked Present. Leave them blank to use each staff member's scheduled times. Overnight checkout is saved on the following date.</p>
        </div>}
        <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-lg">
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] font-medium text-emerald-700">Present</p><p className="mt-1 text-xl font-semibold text-emerald-900">{markedPresent}</p></div>
          <div className="rounded-xl bg-rose-50 p-3"><p className="text-[10px] font-medium text-rose-700">Absent</p><p className="mt-1 text-xl font-semibold text-rose-900">{markedAbsent}</p></div>
          <div className="rounded-xl bg-neutral-100 p-3"><p className="text-[10px] font-medium text-neutral-500">Needs a mark</p><p className="mt-1 text-xl font-semibold text-neutral-800">{pendingCount}</p></div>
        </div>
      </div>

      {staffLoading ? <div className="p-10 text-center text-sm text-neutral-500">Loading staff...</div> : roster.length === 0 ? <div className="p-10 text-center"><p className="text-sm font-semibold">No scheduled staff</p><p className="mt-1 text-xs text-neutral-500">No active staff have a shift for this day and scope.</p></div> : <div className="divide-y divide-neutral-100">
        {roster.map(({ person, shifts }) => {
          const current = statusFor(person, shifts);
          const shiftLabel = scope === "all_shifts" ? shifts.map((shift, index) => `Shift ${index + 1}: ${shift.start}-${shift.end}`).join("; ") : `Shift ${shiftNumber}: ${shifts[shiftNumber - 1].start}-${shifts[shiftNumber - 1].end}`;
          const special = current === "leave" || current === "sick" || current === "holiday";
          return <div key={person.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{person.full_name}</p><p className="mt-0.5 text-[11px] text-neutral-500">{person.staff_code} <span className="mx-1 text-neutral-300"> - </span> {shiftLabel}</p>{current === "mixed" && <p className="mt-1 text-[10px] font-medium text-amber-700">Mixed shift records  -  choose one status to correct this scope</p>}{special && <p className="mt-1 text-[10px] font-medium capitalize text-violet-700">Already recorded as {current}; resolve that entry before changing attendance</p>}</div>
            <div className="grid grid-cols-2 gap-2 sm:w-56">
              <button type="button" disabled={special} aria-pressed={current === "present"} onClick={() => setDraft(value => ({ ...value, [person.id]: "present" }))} className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${current === "present" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"} disabled:cursor-not-allowed disabled:opacity-40`}>Present</button>
              <button type="button" disabled={special} aria-pressed={current === "absent"} onClick={() => setDraft(value => ({ ...value, [person.id]: "absent" }))} className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${current === "absent" ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"} disabled:cursor-not-allowed disabled:opacity-40`}>Absent</button>
            </div>
          </div>;
        })}
      </div>}
      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-neutral-100 bg-white/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs text-neutral-500">{weekDayName(dayNumber)} · {roster.length} scheduled staff · {markedPresent + markedAbsent} marked to save{excludedCount ? ` · ${excludedCount} excused` : ""}</p>
        <Button type="button" onClick={() => void saveRoster()} disabled={busy || staffLoading || markedPresent + markedAbsent === 0}>{busy ? "Saving…" : `Save ${markedPresent + markedAbsent || "selected"} staff`}</Button>
      </div>
    </Card> : <Card className="max-w-xl">
      <h2 className="text-lg font-semibold">Record leave or sick day</h2><p className="mb-5 mt-1 text-xs text-neutral-500">Apply an excused status to one staff member for the selected date.</p>
      <form className="space-y-4" onSubmit={saveLeave}>
        <Field label="Staff member"><select required value={leaveStaffId} onChange={event => setLeaveStaffId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm"><option value="">Select staff member</option>{staff.map(person => <option key={person.id} value={person.id}>{person.full_name}  -  {person.staff_code}</option>)}</select></Field>
        <Field label="Date"><Input type="date" required value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="Record as"><select value={leaveKind} onChange={event => setLeaveKind(event.target.value as "leave" | "sick")} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm"><option value="leave">Leave</option><option value="sick">Sick</option></select></Field>
        <Field label="Reason (required)"><textarea required minLength={1} maxLength={1000} rows={3} value={leaveReason} onChange={event => setLeaveReason(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm" placeholder="Add a short reason" /></Field>
        <Button disabled={busy || !leaveStaffId}>{busy ? "Saving..." : "Save leave / sick day"}</Button>
      </form>
    </Card>}
  </>;
}
