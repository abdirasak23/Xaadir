"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Card, Input, Loading, Notice, PageHeading } from "@/components/ui";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { localDateInTimezone, WEEKEND_DAYS } from "../../shared/attendance-rules";

type Staff = { id: string; full_name: string; staff_code: string; status: string; branch_id: string; annual_leave_days?: number; scheduled_shifts?: { start: string; end: string; day?: number }[]; shift_start?: string; shift_end?: string };
type Holiday = { id: string; date: string; name: string; branch_id: string | null };
type Attendance = {
  id: string; staff_id: string; branch_id: string; date: string; shift_number?: number; check_in_at: string | null; check_out_at: string | null;
  status: string; late_minutes: number; source: string; lat: number | null; lng: number | null; distance_m: number | null;
  wifi_bssid: string | null; ip: string | null; device_id: string | null; note: string | null; created_by: string | null; created_at: string;
  staff?: { full_name: string; staff_code: string; branch_id: string; check_in_method?: "biometric" | "selfie"; branches?: { name: string } };
  selfies?: AttendanceSelfie[];
};
type AttendanceSelfie = { id: string; attendance_id: string; kind: "check_in" | "check_out"; review_status: "pending" | "approved" | "rejected"; review_note: string | null; created_at: string; preview_url: string | null; download_url: string | null };
type Branch = { id: string; name: string };
type AttendanceSummary = { person: Staff; entries: Attendance[]; daysPresent: number; daysLate: number; daysLeave: number; daysSick: number; daysHoliday: number; daysAbsent: number; lateMinutes: number; percentage: number; expectedDays: number };
const today = localDateInTimezone();
function SelfieEvidence({ attendanceId, selfies, method, loading, error }: { attendanceId: string; selfies: AttendanceSelfie[]; method?: "biometric" | "selfie"; loading: boolean; error: string }) {
  const photos = selfies.filter(item => item.attendance_id === attendanceId);
  const entries = [["Check-in selfie", photos.find(item => item.kind === "check_in")], ["Check-out selfie", photos.find(item => item.kind === "check_out")]] as const;
  return <section className="mt-4 rounded-xl border border-neutral-100 p-3.5">
    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-xs font-semibold">Selfie evidence</h3>{photos.length > 0 && <span className="text-[10px] text-neutral-400">Private links expire in 1 hour</span>}</div>
    {error ? <p className="text-xs text-rose-600">{error}</p> : <div className="grid gap-3 sm:grid-cols-2">
      {entries.map(([label, photo]) => <div key={label} className="overflow-hidden rounded-xl bg-neutral-50 p-3">
        <p className="mb-2 text-[11px] font-medium text-neutral-600">{label}</p>
        {loading ? <p className="py-5 text-center text-xs text-neutral-400">Loading photo...</p> : photo ? (photo.preview_url ? <>
          <a href={photo.preview_url} target="_blank" rel="noreferrer" aria-label={`Open ${label}`} className="block overflow-hidden rounded-lg bg-white"><Image src={photo.preview_url} alt={label} width={640} height={480} unoptimized className="h-40 w-full object-contain" /></a>
          <div className="mt-2 flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${photo.review_status === "approved" ? "bg-emerald-50 text-emerald-700" : photo.review_status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{photo.review_status === "approved" ? "Approved" : photo.review_status === "rejected" ? "Rejected" : "Pending review"}</span>{photo.download_url && <a href={photo.download_url} className="text-[11px] font-semibold text-neutral-800 underline underline-offset-2">Download</a>}</div>
          {photo.review_note && <p className="mt-2 text-[11px] text-neutral-500">{photo.review_note}</p>}
        </> : <p className="py-5 text-center text-xs text-neutral-400">Photo file is unavailable right now. Refresh attendance to retry.</p>) : <p className="py-5 text-center text-xs text-neutral-400">{method === "selfie" ? "No selfie was saved for this event." : "Biometric check-in - no selfie expected."}</p>}
      </div>)}
    </div>}
  </section>;
}
function formatTime(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 5) : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function excelCell(value: unknown) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function downloadExcel(summaries: AttendanceSummary[], records: Attendance[], branches: Branch[], from: string, to: string) {
  const makeTable = (headings: unknown[], rows: unknown[][]) => [headings, ...rows].map((row, index) => `<tr>${row.map(value => `<${index ? "td" : "th"}>${excelCell(value)}</${index ? "td" : "th"}>`).join("")}</tr>`).join("");
  const summaryHeadings = ["Staff name", "Staff code", "Branch", "Present days", "Late days", "Absent workdays", "Leave days", "Sick days", "Holiday days", "Late minutes", "Attendance rate"];
  const summaryRows = summaries.map(summary => [summary.person.full_name, summary.person.staff_code, branches.find(item => item.id === summary.person.branch_id)?.name ?? "", summary.daysPresent, summary.daysLate, summary.daysAbsent, summary.daysLeave, summary.daysSick, summary.daysHoliday, summary.lateMinutes, `${summary.percentage}%`]);
  const detailsHeading = ["Date", "Staff name", "Staff code", "Branch", "Shift", "Check-in", "Check-out", "Status", "Late minutes", "Source", "Notes"];
  const detailRows = records.map(record => {
    const summary = summaries.find(item => item.person.id === record.staff_id);
    return [record.date, summary?.person.full_name ?? record.staff_id, summary?.person.staff_code ?? "", branches.find(item => item.id === summary?.person.branch_id)?.name ?? record.staff?.branches?.name ?? "", record.shift_number ?? 1, formatTime(record.check_in_at), formatTime(record.check_out_at), record.status, record.late_minutes, record.source, record.note ?? ""];
  });
  const html = `<html><head><meta charset="utf-8"></head><body><h2>Attendance summary · ${excelCell(from)} to ${excelCell(to)}</h2><table>${makeTable(summaryHeadings, summaryRows)}</table><br><h2>Recorded check-in details</h2><table>${makeTable(detailsHeading, detailRows)}</table></body></html>`;
  downloadBlob(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }), `xaadir-staff-attendance-${from}-to-${to}.xls`);
}
function downloadPdf(summaries: AttendanceSummary[], records: Attendance[], branches: Branch[], from: string, to: string) {
  const clean = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "-").replace(/[\\()]/g, "\\$&");
  const pad = (value: unknown, size: number) => String(value ?? "").slice(0, size).padEnd(size, " ");
  const lines = [`XAADIR - STAFF ATTENDANCE SUMMARY`, `Period: ${from} to ${to}`, `Staff listed: ${summaries.length} | Recorded check-in rows: ${records.length}`, "", "STAFF                 CODE       BRANCH           PRESENT LATE ABSENT LEAVE SICK HOLIDAY RATE", "-----------------------------------------------------------------------------------------------"];
  for (const summary of summaries) {
    const branchName = branches.find(item => item.id === summary.person.branch_id)?.name ?? "";
    lines.push(`${pad(summary.person.full_name, 21)} ${pad(summary.person.staff_code, 10)} ${pad(branchName, 16)} ${String(summary.daysPresent).padStart(3)} ${String(summary.daysLate).padStart(4)} ${String(summary.daysAbsent).padStart(5)} ${String(summary.daysLeave).padStart(4)} ${String(summary.daysSick).padStart(3)} ${String(summary.daysHoliday).padStart(7)} ${String(summary.percentage).padStart(3)}%`);
  }
  lines.push("", "RECORDED CHECK-IN DETAILS", "DATE       STAFF                 CODE        SHIFT CHECK-IN  CHECK-OUT STATUS       LATE");
  for (const record of records) {
    const person = summaries.find(item => item.person.id === record.staff_id)?.person;
    lines.push(`${record.date} ${pad(person?.full_name ?? "Unknown staff", 20)} ${pad(person?.staff_code ?? "", 10)} S${record.shift_number ?? 1}    ${pad(formatTime(record.check_in_at), 12)} ${pad(formatTime(record.check_out_at), 12)} ${pad(record.status, 11)} ${record.late_minutes ?? 0}m`);
  }
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 42) pages.push(lines.slice(i, i + 42));
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  pages.forEach((page, index) => {
    const pageId = pageIds[index], streamId = pageId + 1;
    const commands = ["BT", "/F1 8.5 Tf", "34 570 Td", "12 TL", ...page.flatMap((line, lineIndex) => [lineIndex ? "T*" : "", `(${clean(line)}) Tj`]).filter(Boolean), "ET"].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${new TextEncoder().encode(commands).length} >>\nstream\n${commands}\nendstream`;
  });
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets[i] = new TextEncoder().encode(pdf).length; pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  downloadBlob(new Blob([pdf], { type: "application/pdf" }), `xaadir-staff-attendance-${from}-to-${to}.pdf`);
}

export function AttendanceDashboard() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [records, setRecords] = useState<Attendance[]>([]);
  const [todayRecords, setTodayRecords] = useState<Attendance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [from, setFrom] = useState(today), [to, setTo] = useState(today), [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState<Staff | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<Attendance[]>([]);
  const [selfiesLoading, setSelfiesLoading] = useState(false);
  const [selfiesError, setSelfiesError] = useState("");
  useEffect(() => {
    void fetch("/api/branches").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load branches.");
      setBranches(data);
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load branches."));
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ from, to });
        const todayParams = new URLSearchParams({ from: today, to: today });
        if (branch) { params.set("branch", branch); todayParams.set("branch", branch); }
        const [attendanceResponse, todayResponse, staffResponse, leaveResponse] = await Promise.all([
          fetch(`/api/attendance?${params}`), fetch(`/api/attendance?${todayParams}`), fetch(`/api/staff${branch ? `?branch=${branch}` : ""}`), fetch("/api/leave"),
        ]);
        const attendanceData = await attendanceResponse.json(), todayData = await todayResponse.json(), staffData = await staffResponse.json(), leaveData = await leaveResponse.json();
        if (!active) return;
        if (!attendanceResponse.ok || !todayResponse.ok || !staffResponse.ok || !leaveResponse.ok) setError(attendanceData.error ?? todayData.error ?? staffData.error ?? leaveData.error ?? "Could not load attendance.");
        else { setRecords(attendanceData); setTodayRecords(todayData); setStaff(staffData.filter((person: Staff) => person.status === "active")); setHolidays(leaveData.holidays ?? []); setError(""); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load attendance.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [from, to, branch]);
  const workDates = useCallback((start: string, end: string, person?: Staff) => {
    const dates: string[] = []; const d = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`);
    while (d <= last) { const date = d.toISOString().slice(0, 10); const weekday = d.getUTCDay(); const holiday = holidays.some(item => item.date === date && (item.branch_id === null || item.branch_id === person?.branch_id)); const schedule = person?.scheduled_shifts ?? []; const scheduled = schedule.some(shift => shift.day !== undefined) ? schedule.some(shift => shift.day === weekday) : schedule.length > 0 || Boolean(person?.shift_start && person?.shift_end); if (!WEEKEND_DAYS.includes(weekday as 5) && scheduled && !holiday) dates.push(date); d.setUTCDate(d.getUTCDate() + 1); }
    return dates;
  }, [holidays]);
  const metrics = useMemo(() => {
    const activeStaff = new Set(staff.map(person => person.id));
    const daily = todayRecords.filter(record => activeStaff.has(record.staff_id));
    const presentToday = new Set(daily.filter(record => record.status === "present" || record.status === "manual").map(record => record.staff_id)).size;
    const lateToday = new Set(daily.filter(record => record.status === "late").map(record => record.staff_id)).size;
    const onLeaveToday = new Set(daily.filter(record => record.status === "leave" || record.status === "sick").map(record => record.staff_id)).size;
    const presentIds = new Set(daily.filter(record => ["present", "late", "manual", "leave", "sick", "holiday"].includes(record.status)).map(record => record.staff_id));
    const absentToday = staff.filter(person => workDates(today, today, person).length > 0 && !presentIds.has(person.id)).length;
    const end = to > today ? today : to;
    let denominator = 0;
    for (const person of staff) {
      const days = workDates(from, end, person);
      const excused = new Set(records.filter(record => record.staff_id === person.id && ["leave", "sick", "holiday"].includes(record.status)).map(record => record.date));
      denominator += Math.max(0, days.length - [...excused].filter(date => days.includes(date)).length);
    }
    const attended = new Set(records.filter(record => activeStaff.has(record.staff_id) && ["present", "late", "manual"].includes(record.status)).map(record => `${record.staff_id}:${record.date}`)).size;
    return { presentToday, lateToday, absentToday, onLeaveToday, percentage: denominator ? Math.round(attended / denominator * 100) : null };
  }, [records, todayRecords, staff, from, to, workDates]);
  const summaries = useMemo(() => staff.map(person => {
    const entries = records.filter(record => record.staff_id === person.id);
    const daysPresent = new Set(entries.filter(record => ["present", "manual"].includes(record.status)).map(record => record.date)).size;
    const daysLate = new Set(entries.filter(record => record.status === "late").map(record => record.date)).size;
    const lateMinutes = entries.reduce((sum, record) => sum + (record.late_minutes ?? 0), 0);
    const daysLeave = new Set(entries.filter(record => record.status === "leave").map(record => record.date)).size, daysSick = new Set(entries.filter(record => record.status === "sick").map(record => record.date)).size, daysHoliday = new Set(entries.filter(record => record.status === "holiday").map(record => record.date)).size;
    const calcEnd = to > today ? today : to, working = calcEnd >= from ? workDates(from, calcEnd, person) : [];
    const divisor = Math.max(0, working.length - new Set(entries.filter(record => ["leave", "sick", "holiday"].includes(record.status)).map(record => record.date).filter(date => working.includes(date))).size);
    const attendedDates = new Set(entries.filter(record => ["present", "late", "manual"].includes(record.status)).map(record => record.date));
    const missingDates = working.filter(date => date < today && (!entries.some(record => record.date === date) || entries.some(record => record.date === date && record.status === "absent")));
    const daysAbsent = working.filter(date => date < today && !attendedDates.has(date) && !entries.some(record => record.date === date && ["leave", "sick", "holiday"].includes(record.status))).length;
    const attendedDays = attendedDates.size;
    return { person, entries, daysPresent, daysLate, daysLeave, daysSick, daysHoliday, daysAbsent, missingDates, lateMinutes, expectedDays: divisor, percentage: divisor ? Math.round(attendedDays / divisor * 100) : 0 };
  }), [staff, records, from, to, workDates]);
  const selectedSummary = selected ? summaries.find(item => item.person.id === selected.id) : null;
  useEffect(() => {
    if (!selected) { setSelectedHistory([]); setSelfiesError(""); return; }
    let active = true;
    setSelfiesLoading(true); setSelfiesError("");
    const params = new URLSearchParams({ staff_id: selected.id });
    void fetch(`/api/attendance/selfies?${params}`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load attendance selfies.");
      if (active) setSelectedHistory(Array.isArray(body.records) ? body.records : []);
    }).catch(reason => { if (active) setSelfiesError(reason instanceof Error ? reason.message : "Could not load attendance selfies."); })
      .finally(() => { if (active) setSelfiesLoading(false); });
    return () => { active = false; };
  }, [selected]);
  async function convertAbsent(person: Staff, date: string, status: "leave" | "sick") {
    const reason = window.prompt(`Reason for marking ${person.full_name} as ${status} on ${date}:`);
    if (!reason?.trim()) return;
    try {
      const response = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "convert", staff_id: person.id, date, new_status: status, leave_type: status === "sick" ? "sick" : "other", reason }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not update attendance.");
      setRecords(current => [data.attendance, ...current.filter(item => !(item.staff_id === person.id && item.date === date))]);
      if (date === today) setTodayRecords(current => [data.attendance, ...current.filter(item => !(item.staff_id === person.id && item.date === date))]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update attendance."); }
  }
  const presetRange = (preset: "today" | "yesterday" | "week" | "month") => {
    const current = new Date(`${today}T00:00:00Z`);
    const asDate = (date: Date) => date.toISOString().slice(0, 10);
    if (preset === "today") return { from: today, to: today };
    if (preset === "yesterday") { current.setUTCDate(current.getUTCDate() - 1); const date = asDate(current); return { from: date, to: date }; }
    if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
    const mondayOffset = (current.getUTCDay() + 6) % 7;
    current.setUTCDate(current.getUTCDate() - mondayOffset);
    return { from: asDate(current), to: today };
  };
  const setPreset = (preset: "today" | "yesterday" | "week" | "month") => {
    const range = presetRange(preset); setFrom(range.from); setTo(range.to);
  };
  const isPresetActive = (preset: "today" | "yesterday" | "week" | "month") => {
    const range = presetRange(preset); return from === range.from && to === range.to;
  };
  const weekBars = Array.from({length:7}, (_, index) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (6-index)); const date = d.toISOString().slice(0,10); return { date, label:d.toLocaleDateString(undefined,{weekday:"short",timeZone:"UTC"}), count:new Set(records.filter(record=>record.date===date && ["present","late","manual"].includes(record.status)).map(record=>record.staff_id)).size }; });

  return <><PageHeading eyebrow="Workforce insights" title="Attendance" description="Daily visibility into check-ins, punctuality and attendance patterns." action={<a href="/attendance/manual" className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800"><HugeiconsIcon icon={Add01Icon} size={17} strokeWidth={2} />Manual entry</a>} />
    {error && <div className="mb-4"><Notice error>{error}</Notice></div>}
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 text-[10px] text-neutral-600 shadow-sm">Status legend: {[['Present','bg-emerald-100 text-emerald-700'],['Late','bg-amber-100 text-amber-700'],['Absent','bg-rose-100 text-rose-700'],['Manual','bg-blue-100 text-blue-700'],['Leave','bg-violet-100 text-violet-700'],['Sick','bg-teal-100 text-teal-700'],['Holiday','bg-neutral-100 text-neutral-700']].map(([label,style])=><span key={label} className={`rounded-full px-2.5 py-1 font-medium ${style}`}>{label}</span>)}</div>
    <Card className="mb-6"><div className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Attendance overview</h2><p className="mt-1 text-xs text-slate-500">Choose a quick range or customize dates.</p></div><div className="flex flex-wrap rounded-xl bg-neutral-100 p-1">{[["Today","today"],["Yesterday","yesterday"],["This week","week"],["This month","month"]].map(([label,value])=><button key={value} onClick={()=>setPreset(value as "today"|"yesterday"|"week"|"month")} className={`rounded-lg px-3 py-2 text-[11px] font-medium transition ${isPresetActive(value as "today"|"yesterday"|"week"|"month")?"bg-white text-black shadow-sm":"text-neutral-500 hover:text-black"}`}>{label}</button>)}</div></div><div className="grid grid-cols-2 gap-3 md:flex md:items-end"><label className="space-y-1 text-[11px] font-medium text-slate-500">From<Input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label className="space-y-1 text-[11px] font-medium text-slate-500">To<Input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label><label className="space-y-1 text-[11px] font-medium text-slate-500 md:min-w-44">Branch<select className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={branch} onChange={event => setBranch(event.target.value)}><option value="">All branches</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></div></Card>
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {[[ "Present today", metrics.presentToday, "Checked in on time", "bg-emerald-50", "bg-emerald-500"], ["Late today", metrics.lateToday, "Arrived after shift start", "bg-amber-50", "bg-amber-500"], ["Absent today", metrics.absentToday, "No attendance recorded", "bg-neutral-100", "bg-neutral-500"], ["On leave today", metrics.onLeaveToday, "Leave and sick", "bg-violet-50", "bg-violet-500"], ["Attendance rate", metrics.percentage === null ? "N/A" : `${metrics.percentage}%`, "Eligible working days", "bg-teal-50", "bg-teal-500"]].map(([label, value, hint, badge, dot]) => <Card key={String(label)} className="relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-card"><div className="flex items-start justify-between"><p className="text-xs font-medium text-neutral-500">{label}</p><span className={`grid h-9 w-9 place-items-center rounded-xl ${badge}`}><span className={`h-2.5 w-2.5 rounded-full ${dot}`} /></span></div><p className="mt-4 text-[34px] font-semibold leading-none tracking-tight text-black">{value}</p><p className="mt-2 text-[11px] text-neutral-400">{hint}</p></Card>)}
    </div>
    <div className="mb-6 grid gap-4 lg:grid-cols-[1.25fr_.75fr]"><Card><div className="flex items-start justify-between"><div><h2 className="font-semibold">Weekly activity</h2><p className="mt-1 text-xs text-neutral-500">Recorded attendance by day</p></div><span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[10px] text-neutral-500">Last 7 days</span></div><div className="mt-6 flex h-36 items-end justify-between gap-3">{weekBars.map(bar=><div key={bar.date} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] tabular-nums text-neutral-500">{bar.count}</span><div className="w-full max-w-8 rounded-t-lg bg-neutral-100" style={{height:`${Math.max(8,Math.round(bar.count/Math.max(1,...weekBars.map(b=>b.count))*90))}%`}}><div className="h-full w-full rounded-t-lg bg-black" /></div><span className="text-[10px] text-neutral-400">{bar.label}</span></div>)}</div></Card><Card><h2 className="font-semibold">Today at a glance</h2><p className="mt-1 text-xs text-neutral-500">Attendance status across your active team</p><div className="mt-5 space-y-4">{[["Present",metrics.presentToday,"bg-black"],["Late",metrics.lateToday,"bg-amber-400"],["Absent",metrics.absentToday,"bg-neutral-300"],["On leave / sick",metrics.onLeaveToday,"bg-violet-500"]].map(([label,value,color])=><div key={String(label)}><div className="mb-1.5 flex justify-between text-xs"><span className="text-neutral-600">{label}</span><span className="font-medium">{value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className={`h-full rounded-full ${color}`} style={{width:`${staff.length?Math.min(100,Number(value)/staff.length*100):0}%`}} /></div></div>)}</div></Card></div>
    <Card className="min-w-0 p-0"><div className="flex flex-col gap-4 border-b border-neutral-100 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Team attendance</h2><p className="mt-1 text-xs text-neutral-500">All active staff are included, with status totals and recorded shift details for this period.</p></div><div className="flex gap-2"><button onClick={()=>downloadExcel(summaries,records,branches,from,to)} disabled={loading||staff.length===0} className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40">Export Excel</button><button onClick={()=>downloadPdf(summaries,records,branches,from,to)} disabled={loading||staff.length===0} className="rounded-xl bg-black px-3.5 py-2.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-40">Download PDF</button></div></div>
      {loading ? <Loading /> : summaries.length===0 ? <div className="p-10 text-center text-sm text-neutral-400">No active staff found.</div> : <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{summaries.map(summary=>{const latest=summary.entries[0];const chip=latest?.status==="late"?"bg-amber-50 text-amber-700":latest?.status==="leave"?"bg-violet-50 text-violet-700":latest?.status==="sick"?"bg-teal-50 text-teal-700":latest?.status==="holiday"?"bg-neutral-100 text-neutral-700":latest?.status==="absent"?"bg-rose-50 text-rose-700":latest?.status==="manual"?"bg-blue-50 text-blue-700":latest?"bg-emerald-50 text-emerald-700":"bg-neutral-100 text-neutral-500";return <button key={summary.person.id} type="button" onClick={()=>setSelected(summary.person)} className="rounded-2xl border border-neutral-100 p-4 text-left transition hover:-translate-y-0.5 hover:border-neutral-200 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"><div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-neutral-100 text-xs font-semibold">{summary.person.full_name.split(/\s+/).slice(0,2).map(word=>word[0]).join("").toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{summary.person.full_name}</p><p className="mt-0.5 text-[11px] text-neutral-500">{summary.person.staff_code}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${chip}`}>{latest?.status??"No record"}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-in</p><p className="mt-1 text-sm font-semibold tabular-nums">{formatTime(latest?.check_in_at??null)}</p></div><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-out</p><p className="mt-1 text-sm font-semibold tabular-nums">{formatTime(latest?.check_out_at??null)}</p></div></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-neutral-50 p-3 text-center"><div><p className="text-[9px] uppercase text-neutral-400">Present</p><p className="mt-1 text-xs font-semibold">{summary.daysPresent}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Late</p><p className="mt-1 text-xs font-semibold">{summary.daysLate}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Absent</p><p className="mt-1 text-xs font-semibold">{summary.daysAbsent}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Leave</p><p className="mt-1 text-xs font-semibold">{summary.daysLeave}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Sick</p><p className="mt-1 text-xs font-semibold">{summary.daysSick}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Holiday</p><p className="mt-1 text-xs font-semibold">{summary.daysHoliday}</p></div></div><div className="mt-3 flex justify-between text-[11px] text-neutral-500"><span>{summary.lateMinutes} late minutes</span><span className="font-semibold text-black">{summary.percentage === null ? "â€”" : `${summary.percentage}%`}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-black" style={{width:`${summary.percentage === null ? 0 : Math.min(100,summary.percentage)}%`}} /></div><p className="mt-3 text-[10px] text-neutral-400">{latest?.date??"No attendance yet"} Â· select for details</p></button>;})}</div>}
    </Card>
    <div className="hidden"><Card className="min-w-0 p-0"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Staff attendance</h2><p className="mt-1 text-xs text-slate-500">Select a staff member to inspect check-in and check-out details.</p></div>
      {loading ? <Loading /> : summaries.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">No active staff found.</div> :
        <div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400"><tr>{["Staff", "Days present", "Days late", "Late minutes", "Attendance"].map(name => <th key={name} className="px-5 py-3 font-semibold">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{summaries.map(summary => <tr key={summary.person.id} tabIndex={0} role="button" onClick={() => setSelected(summary.person)} onKeyDown={event => { if (event.key === "Enter") setSelected(summary.person); }} className="cursor-pointer hover:bg-emerald-50/40"><td className="px-5 py-4"><p className="font-semibold">{summary.person.full_name}</p><p className="text-xs text-slate-400">{summary.person.staff_code}</p></td><td className="px-5 py-4">{summary.daysPresent}</td><td className="px-5 py-4">{summary.daysLate}</td><td className="px-5 py-4">{summary.lateMinutes} min</td><td className="px-5 py-4"><span className="font-semibold text-forest">{summary.percentage}%</span><div className="mt-1 h-1.5 w-24 rounded-full bg-slate-100"><div className="h-full rounded-full bg-forest" style={{ width: `${Math.min(100, summary.percentage)}%` }} /></div></td></tr>)}</tbody></table></div>}
    </Card></div>
    {selectedSummary && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={event=>{if(event.target===event.currentTarget)setSelected(null);}}><section role="dialog" aria-modal="true" aria-label={`${selected?.full_name} attendance details`} className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
      <div className="flex items-start justify-between border-b border-slate-100 p-5"><div><p className="text-xs font-bold uppercase tracking-wider text-forest">Daily records</p><h2 className="mt-1 text-xl font-bold">{selected?.full_name}</h2><p className="text-xs text-slate-500">{selected?.staff_code} Â· Complete attendance history</p></div><button onClick={() => setSelected(null)} className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100" aria-label="Close">âœ•</button></div>
      <div className="max-h-[calc(90vh-90px)] overflow-auto p-5">{selfiesLoading ? <div className="py-10"><Loading /></div> : selectedHistory.length===0 ? <p className="rounded-2xl bg-neutral-50 p-8 text-center text-sm text-neutral-500">No attendance history is available for this staff member.</p> : <div className="space-y-3">{selectedHistory.map(record=><article key={record.id} className="rounded-2xl border border-neutral-100 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{new Date(`${record.date}T00:00:00`).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</p><p className="mt-1 text-[11px] text-neutral-500">{record.staff?.branches?.name??"Branch not listed"} Â· {record.source==="manual"?"Added manually":"QR check-in"}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${record.status==="late"?"bg-amber-50 text-amber-700":record.status==="absent"?"bg-neutral-100 text-neutral-600":"bg-emerald-50 text-emerald-700"}`}>{record.status}</span></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-in time</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatTime(record.check_in_at)}</p></div><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-out time</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatTime(record.check_out_at)}</p></div></div><SelfieEvidence attendanceId={record.id} selfies={record.selfies ?? []} method={record.staff?.check_in_method} loading={selfiesLoading} error={selfiesError} /><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-500"><span>Late by <b className="font-medium text-neutral-800">{record.late_minutes??0} min</b></span>{record.distance_m!==null&&<span>Distance <b className="font-medium text-neutral-800">{record.distance_m} m</b></span>}{record.note&&<span className="basis-full pt-1">Note: {record.note}</span>}</div></article>)}</div>}</div>
      {selectedSummary.missingDates.length > 0 && <section className="border-t border-rose-100 bg-rose-50/60 p-5"><h3 className="text-sm font-semibold text-rose-900">Missing past workdays</h3><p className="mt-1 text-xs text-rose-700">Convert an absent day to leave or sick time. A reason is required.</p><div className="mt-3 space-y-2">{selectedSummary.missingDates.map(date=><div key={date} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"><span className="text-xs font-medium">{date}</span><div className="flex gap-2"><button onClick={() => void convertAbsent(selectedSummary.person, date, "leave")} className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700">Convert to leave</button><button onClick={() => void convertAbsent(selectedSummary.person, date, "sick")} className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-[11px] font-semibold text-teal-700">Convert to sick</button></div></div>)}</div></section>}
    </section></div>}
  </>;
}
