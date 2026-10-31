"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Field, Input, Notice, PageHeading } from "@/components/ui";
import { localDateInTimezone } from "../../shared/attendance-rules";

type Staff = { id: string; full_name: string; staff_code: string; status: string };
type AttendanceRow = { staff_id: string; check_in_at: string | null; check_out_at: string | null; status: string; note?: string | null };
const today = localDateInTimezone();

export function ManualAttendance() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(today);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"attendance" | "leave">("attendance");
  const [leaveKind, setLeaveKind] = useState<"leave" | "sick">("leave");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch("/api/staff").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load staff.");
      const active = data.filter((person: Staff) => person.status === "active");
      setStaff(active); if (active[0]) setStaffId(active[0].id);
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load staff."));
  }, []);
  useEffect(() => { void fetch(`/api/attendance?from=${date}&to=${date}`).then(response => response.json()).then(data => { if (Array.isArray(data)) setRecords(data); }).catch(() => setRecords([])); }, [date]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const payload = mode === "attendance" ? { staff_id: staffId, date, check_in_at: checkIn, check_out_at: checkOut, reason } : { action: "convert", staff_id: staffId, date, new_status: leaveKind, leave_type: leaveKind === "sick" ? "sick" : "other", reason };
      const response = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) setError(body.error ?? "Attendance record could not be saved.");
      else { setNotice(mode === "attendance" ? `Manual attendance saved as ${body.status}${body.late_minutes ? `, ${body.late_minutes} minutes late` : ""}.` : `${leaveKind === "sick" ? "Sick day" : "Leave"} recorded for ${date}.`); setReason(""); void fetch(`/api/attendance?from=${date}&to=${date}`).then(response => response.json()).then(data => { if (Array.isArray(data)) setRecords(data); }); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Attendance record could not be saved.");
    } finally { setBusy(false); }
  }
  return <><PageHeading eyebrow="Attendance" title="Manual entry" description="Record or correct attendance using the employee's configured shift and grace period." action={<a href="/attendance" className="text-sm font-semibold text-forest hover:underline">← Back to dashboard</a>} />
    <Card className="mb-6 min-w-0 p-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 p-5"><div><h2 className="text-sm font-semibold">Staff attendance</h2><p className="mt-1 text-xs text-neutral-500">Check-in and check-out records for the selected date.</p></div><label className="text-[11px] font-medium text-neutral-500">Date<Input className="mt-1" type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400"><tr>{["Staff member","Check-in","Check-out","Status"].map(label=><th key={label} className="px-5 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{staff.map(person=>{const record=records.find(item=>item.staff_id===person.id);const chip=record?.status==="leave"?"bg-violet-50 text-violet-700":record?.status==="sick"?"bg-teal-50 text-teal-700":record?.status==="holiday"?"bg-neutral-100 text-neutral-700":record?.status==="late"?"bg-amber-50 text-amber-700":record?.status==="absent"?"bg-rose-50 text-rose-700":record?.status==="manual"?"bg-blue-50 text-blue-700":"bg-emerald-50 text-emerald-700";return <tr key={person.id}><td className="px-5 py-3.5"><p className="font-medium">{person.full_name}</p><p className="mt-0.5 text-[10px] text-neutral-400">{person.staff_code}</p></td><td className="px-5 py-3.5 tabular-nums">{record?.check_in_at?new Date(record.check_in_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"—"}</td><td className="px-5 py-3.5 tabular-nums">{record?.check_out_at?new Date(record.check_out_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"—"}</td><td className="px-5 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${chip}`}>{record?.status??"Not recorded"}</span>{record?.note&&<p className="mt-1 max-w-48 truncate text-[10px] text-neutral-400">{record.note}</p>}</td></tr>;})}</tbody></table></div></Card>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card><h2 className="text-lg font-bold">Record attendance</h2><p className="mb-6 mt-1 text-sm text-slate-500">Records are saved to the shared attendance register with source marked as manual.</p>
        {error && <div className="mb-4"><Notice error>{error}</Notice></div>}{notice && <div className="mb-4"><Notice>{notice}</Notice></div>}
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-neutral-100 p-1"><button type="button" onClick={() => setMode("attendance")} className={`rounded-lg px-3 py-2 text-xs font-medium ${mode === "attendance" ? "bg-white text-black shadow-sm" : "text-neutral-500"}`}>Check-in / out</button><button type="button" onClick={() => setMode("leave")} className={`rounded-lg px-3 py-2 text-xs font-medium ${mode === "leave" ? "bg-white text-black shadow-sm" : "text-neutral-500"}`}>Mark leave / sick</button></div>
        <form className="space-y-5" onSubmit={submit}>
          <Field label="Staff member"><select required value={staffId} onChange={event => setStaffId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm"><option value="">Select staff member</option>{staff.map(person => <option key={person.id} value={person.id}>{person.full_name} · {person.staff_code}</option>)}</select></Field>
          <Field label="Date"><Input type="date" required value={date} onChange={event => setDate(event.target.value)} /></Field>
          {mode === "attendance" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Check-in time (optional)"><Input type="time" value={checkIn} onChange={event => setCheckIn(event.target.value)} /></Field><Field label="Check-out time (optional)"><Input type="time" value={checkOut} onChange={event => setCheckOut(event.target.value)} /></Field></div> : <Field label="Record as"><select value={leaveKind} onChange={event => setLeaveKind(event.target.value as "leave" | "sick")} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm"><option value="leave">Leave</option><option value="sick">Sick</option></select></Field>}
          <Field label="Reason (required)"><textarea required minLength={1} maxLength={1000} rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why this record is being added or corrected..." className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-emerald-100" /></Field>
          <Button disabled={busy || !staffId}>{busy ? "Saving..." : mode === "attendance" ? "Save manual attendance" : "Save leave / sick day"}</Button>
        </form>
      </Card>
      <Card className="bg-emerald-950 text-white"><span className="text-2xl">✦</span><h2 className="mt-4 text-lg font-bold">Consistent calculations</h2><p className="mt-2 text-sm leading-6 text-emerald-50/75">Late minutes use the same shift start and grace period as QR check-ins. If no check-in is provided, the entry is recorded as absent.</p><div className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-emerald-50/60">Every manual update is tagged with the admin actor and writes an audit entry.</div></Card>
    </div>
  </>;
}
