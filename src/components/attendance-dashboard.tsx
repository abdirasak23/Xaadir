"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Input, Loading, Notice, PageHeading } from "@/components/ui";
import { localDateInTimezone, WEEKEND_DAYS } from "../../shared/attendance-rules";

type Staff = { id: string; full_name: string; staff_code: string; status: string; branch_id: string; annual_leave_days?: number };
type Holiday = { id: string; date: string; name: string; branch_id: string | null };
type Attendance = {
  id: string; staff_id: string; branch_id: string; date: string; check_in_at: string | null; check_out_at: string | null;
  status: string; late_minutes: number; source: string; lat: number | null; lng: number | null; distance_m: number | null;
  wifi_bssid: string | null; ip: string | null; device_id: string | null; note: string | null; created_by: string | null; created_at: string;
  staff?: { full_name: string; staff_code: string; branch_id: string; branches?: { name: string } };
};
type Branch = { id: string; name: string };
const today = localDateInTimezone();
function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 5) : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}
function excelCell(value: unknown) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function downloadExcel(records: Attendance[], staff: Staff[], from: string, to: string) {
  const headings = ["Date", "Staff name", "Staff code", "Branch", "Check-in", "Check-out", "Status", "Late minutes", "Source", "Notes"];
  const rows = records.map(record => {
    const person = staff.find(item => item.id === record.staff_id);
    return [record.date, person?.full_name ?? record.staff_id, person?.staff_code ?? "", record.staff?.branches?.name ?? "", formatTime(record.check_in_at), formatTime(record.check_out_at), record.status, record.late_minutes, record.source, record.note ?? ""];
  });
  const table = [headings, ...rows].map((row, index) => `<tr>${row.map(value => `<${index ? "td" : "th"}>${excelCell(value)}</${index ? "td" : "th"}>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset="utf-8"></head><body><table>${table}</table></body></html>`;
  downloadBlob(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }), `xaadir-attendance-${from}-to-${to}.xls`);
}
function downloadPdf(records: Attendance[], staff: Staff[], from: string, to: string) {
  const clean = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "-").replace(/[\\()]/g, "\\$&");
  const lines = [`XAADIR - ATTENDANCE REPORT`, `Period: ${from} to ${to}`, `Records: ${records.length}`, "", "DATE       STAFF                 CODE        CHECK-IN  CHECK-OUT STATUS       LATE", "--------------------------------------------------------------------------------"];
  for (const record of records) {
    const person = staff.find(item => item.id === record.staff_id);
    lines.push(`${record.date} ${(person?.full_name ?? "Unknown staff").slice(0, 20).padEnd(20)} ${(person?.staff_code ?? "").slice(0, 10).padEnd(10)} ${formatTime(record.check_in_at).padEnd(9)} ${formatTime(record.check_out_at).padEnd(9)} ${record.status.slice(0, 11).padEnd(11)} ${record.late_minutes ?? 0}m`);
  }
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 48) pages.push(lines.slice(i, i + 48));
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  pages.forEach((page, index) => {
    const pageId = pageIds[index], streamId = pageId + 1;
    const commands = ["BT", "/F1 9 Tf", "40 755 Td", "13 TL", ...page.flatMap((line, lineIndex) => [lineIndex ? "T*" : "", `(${clean(line)}) Tj`]).filter(Boolean), "ET"].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${new TextEncoder().encode(commands).length} >>\nstream\n${commands}\nendstream`;
  });
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets[i] = new TextEncoder().encode(pdf).length; pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  downloadBlob(new Blob([pdf], { type: "application/pdf" }), `xaadir-attendance-${from}-to-${to}.pdf`);
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
    while (d <= last) { const date = d.toISOString().slice(0, 10); const holiday = holidays.some(item => item.date === date && (item.branch_id === null || item.branch_id === person?.branch_id)); if (!WEEKEND_DAYS.includes(d.getUTCDay() as 5) && !holiday) dates.push(date); d.setUTCDate(d.getUTCDate() + 1); }
    return dates;
  }, [holidays]);
  const metrics = useMemo(() => {
    const activeStaff = new Set(staff.map(person => person.id));
    const daily = todayRecords.filter(record => activeStaff.has(record.staff_id));
    const presentToday = daily.filter(record => record.status === "present" || record.status === "manual").length;
    const lateToday = daily.filter(record => record.status === "late").length;
    const onLeaveToday = daily.filter(record => record.status === "leave" || record.status === "sick").length;
    const presentIds = new Set(daily.filter(record => ["present", "late", "manual", "leave", "sick", "holiday"].includes(record.status)).map(record => record.staff_id));
    const absentToday = staff.filter(person => workDates(today, today, person).length > 0 && !presentIds.has(person.id)).length;
    const end = to > today ? today : to;
    let denominator = 0;
    for (const person of staff) {
      const days = workDates(from, end, person);
      const excused = new Set(records.filter(record => record.staff_id === person.id && ["leave", "sick", "holiday"].includes(record.status)).map(record => record.date));
      denominator += Math.max(0, days.length - [...excused].filter(date => days.includes(date)).length);
    }
    const attended = records.filter(record => activeStaff.has(record.staff_id) && ["present", "late", "manual"].includes(record.status)).length;
    return { presentToday, lateToday, absentToday, onLeaveToday, percentage: denominator ? Math.round(attended / denominator * 100) : null };
  }, [records, todayRecords, staff, from, to, workDates]);
  const summaries = useMemo(() => staff.map(person => {
    const entries = records.filter(record => record.staff_id === person.id);
    const daysPresent = entries.filter(record => ["present", "late", "manual"].includes(record.status)).length;
    const daysLate = entries.filter(record => record.status === "late").length;
    const lateMinutes = entries.reduce((sum, record) => sum + (record.late_minutes ?? 0), 0);
    const daysLeave = entries.filter(record => record.status === "leave").length, daysSick = entries.filter(record => record.status === "sick").length, daysHoliday = entries.filter(record => record.status === "holiday").length;
    const calcEnd = to > today ? today : to, working = calcEnd >= from ? workDates(from, calcEnd, person) : [];
    const divisor = Math.max(0, working.length - new Set(entries.filter(record => ["leave", "sick", "holiday"].includes(record.status)).map(record => record.date).filter(date => working.includes(date))).size);
    const presentDates = new Set(entries.filter(record => ["present", "late", "manual"].includes(record.status)).map(record => record.date));
    const missingDates = working.filter(date => date < today && (!entries.some(record => record.date === date) || entries.some(record => record.date === date && record.status === "absent")));
    const daysAbsent = working.filter(date => date < today && !presentDates.has(date) && !entries.some(record => record.date === date && ["leave", "sick", "holiday"].includes(record.status))).length;
    return { person, entries, daysPresent, daysLate, daysLeave, daysSick, daysHoliday, daysAbsent, missingDates, lateMinutes, percentage: divisor ? Math.round(daysPresent / divisor * 100) : 0 };
  }), [staff, records, from, to, workDates]);
  const selectedSummary = selected ? summaries.find(item => item.person.id === selected.id) : null;
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
  const setPreset = (preset: "today" | "yesterday" | "week") => {
    const now = new Date(`${today}T12:00:00+03:00`); const day = (offset: number) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
    if (preset === "today") { setFrom(day(0)); setTo(day(0)); }
    if (preset === "yesterday") { setFrom(day(-1)); setTo(day(-1)); }
    if (preset === "week") { setFrom(day(-6)); setTo(day(0)); }
  };
  const weekBars = Array.from({length:7}, (_, index) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (6-index)); const date = d.toISOString().slice(0,10); return { date, label:d.toLocaleDateString(undefined,{weekday:"short",timeZone:"UTC"}), count:records.filter(record=>record.date===date && ["present","late","manual"].includes(record.status)).length }; });

  return <><PageHeading eyebrow="Workforce insights" title="Attendance" description="Daily visibility into check-ins, punctuality and attendance patterns." action={<a href="/attendance/manual" className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white">＋ Manual entry</a>} />
    {error && <div className="mb-4"><Notice error>{error}</Notice></div>}
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 text-[10px] text-neutral-600 shadow-sm">Status legend: {[['Present','bg-emerald-100 text-emerald-700'],['Late','bg-amber-100 text-amber-700'],['Absent','bg-rose-100 text-rose-700'],['Manual','bg-blue-100 text-blue-700'],['Leave','bg-violet-100 text-violet-700'],['Sick','bg-teal-100 text-teal-700'],['Holiday','bg-neutral-100 text-neutral-700']].map(([label,style])=><span key={label} className={`rounded-full px-2.5 py-1 font-medium ${style}`}>{label}</span>)}</div>
    <Card className="mb-6"><div className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Attendance overview</h2><p className="mt-1 text-xs text-slate-500">Choose a quick range or customize dates.</p></div><div className="flex rounded-xl bg-neutral-100 p-1">{[["Today","today"],["Yesterday","yesterday"],["This week","week"]].map(([label,value])=><button key={value} onClick={()=>setPreset(value as "today"|"yesterday"|"week")} className={`rounded-lg px-3 py-2 text-[11px] font-medium transition ${((value==="today"&&from===today&&to===today)||(value==="yesterday"&&from===to)||(value==="week"&&from!==today))?"bg-white text-black shadow-sm":"text-neutral-500 hover:text-black"}`}>{label}</button>)}</div></div><div className="grid grid-cols-2 gap-3 md:flex md:items-end"><label className="space-y-1 text-[11px] font-medium text-slate-500">From<Input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label className="space-y-1 text-[11px] font-medium text-slate-500">To<Input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label><label className="space-y-1 text-[11px] font-medium text-slate-500 md:min-w-44">Branch<select className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={branch} onChange={event => setBranch(event.target.value)}><option value="">All branches</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></div></Card>
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {[[ "Present today", metrics.presentToday, "Checked in on time", "bg-emerald-50", "bg-emerald-500"], ["Late today", metrics.lateToday, "Arrived after shift start", "bg-amber-50", "bg-amber-500"], ["Absent today", metrics.absentToday, "No attendance recorded", "bg-neutral-100", "bg-neutral-500"], ["On leave today", metrics.onLeaveToday, "Leave and sick", "bg-violet-50", "bg-violet-500"], ["Attendance rate", metrics.percentage === null ? "—" : `${metrics.percentage}%`, "Eligible working days", "bg-teal-50", "bg-teal-500"]].map(([label, value, hint, badge, dot]) => <Card key={String(label)} className="relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-card"><div className="flex items-start justify-between"><p className="text-xs font-medium text-neutral-500">{label}</p><span className={`grid h-9 w-9 place-items-center rounded-xl ${badge}`}><span className={`h-2.5 w-2.5 rounded-full ${dot}`} /></span></div><p className="mt-4 text-[34px] font-semibold leading-none tracking-tight text-black">{value}</p><p className="mt-2 text-[11px] text-neutral-400">{hint}</p></Card>)}
    </div>
    <div className="mb-6 grid gap-4 lg:grid-cols-[1.25fr_.75fr]"><Card><div className="flex items-start justify-between"><div><h2 className="font-semibold">Weekly activity</h2><p className="mt-1 text-xs text-neutral-500">Recorded attendance by day</p></div><span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[10px] text-neutral-500">Last 7 days</span></div><div className="mt-6 flex h-36 items-end justify-between gap-3">{weekBars.map(bar=><div key={bar.date} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] tabular-nums text-neutral-500">{bar.count}</span><div className="w-full max-w-8 rounded-t-lg bg-neutral-100" style={{height:`${Math.max(8,Math.round(bar.count/Math.max(1,...weekBars.map(b=>b.count))*90))}%`}}><div className="h-full w-full rounded-t-lg bg-black" /></div><span className="text-[10px] text-neutral-400">{bar.label}</span></div>)}</div></Card><Card><h2 className="font-semibold">Today at a glance</h2><p className="mt-1 text-xs text-neutral-500">Attendance status across your active team</p><div className="mt-5 space-y-4">{[["Present",metrics.presentToday,"bg-black"],["Late",metrics.lateToday,"bg-amber-400"],["Absent",metrics.absentToday,"bg-neutral-300"],["On leave / sick",metrics.onLeaveToday,"bg-violet-500"]].map(([label,value,color])=><div key={String(label)}><div className="mb-1.5 flex justify-between text-xs"><span className="text-neutral-600">{label}</span><span className="font-medium">{value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className={`h-full rounded-full ${color}`} style={{width:`${staff.length?Math.min(100,Number(value)/staff.length*100):0}%`}} /></div></div>)}</div></Card></div>
    <Card className="min-w-0 p-0"><div className="flex flex-col gap-4 border-b border-neutral-100 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Team attendance</h2><p className="mt-1 text-xs text-neutral-500">Check-in and check-out times for the latest attendance record per staff member in this range.</p></div><div className="flex gap-2"><button onClick={()=>downloadExcel(records,staff,from,to)} disabled={loading||records.length===0} className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40">Export Excel</button><button onClick={()=>downloadPdf(records,staff,from,to)} disabled={loading||records.length===0} className="rounded-xl bg-black px-3.5 py-2.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-40">Download PDF</button></div></div>
      {loading ? <Loading /> : summaries.length===0 ? <div className="p-10 text-center text-sm text-neutral-400">No active staff found.</div> : <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{summaries.map(summary=>{const latest=summary.entries[0];const chip=latest?.status==="late"?"bg-amber-50 text-amber-700":latest?.status==="leave"?"bg-violet-50 text-violet-700":latest?.status==="sick"?"bg-teal-50 text-teal-700":latest?.status==="holiday"?"bg-neutral-100 text-neutral-700":latest?.status==="absent"?"bg-rose-50 text-rose-700":latest?.status==="manual"?"bg-blue-50 text-blue-700":latest?"bg-emerald-50 text-emerald-700":"bg-neutral-100 text-neutral-500";return <button key={summary.person.id} type="button" onClick={()=>setSelected(summary.person)} className="rounded-2xl border border-neutral-100 p-4 text-left transition hover:-translate-y-0.5 hover:border-neutral-200 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"><div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-neutral-100 text-xs font-semibold">{summary.person.full_name.split(/\s+/).slice(0,2).map(word=>word[0]).join("").toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{summary.person.full_name}</p><p className="mt-0.5 text-[11px] text-neutral-500">{summary.person.staff_code}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${chip}`}>{latest?.status??"No record"}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-in</p><p className="mt-1 text-sm font-semibold tabular-nums">{formatTime(latest?.check_in_at??null)}</p></div><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-out</p><p className="mt-1 text-sm font-semibold tabular-nums">{formatTime(latest?.check_out_at??null)}</p></div></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-neutral-50 p-3 text-center"><div><p className="text-[9px] uppercase text-neutral-400">Present</p><p className="mt-1 text-xs font-semibold">{summary.daysPresent}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Late</p><p className="mt-1 text-xs font-semibold">{summary.daysLate}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Absent</p><p className="mt-1 text-xs font-semibold">{summary.daysAbsent}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Leave</p><p className="mt-1 text-xs font-semibold">{summary.daysLeave}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Sick</p><p className="mt-1 text-xs font-semibold">{summary.daysSick}</p></div><div><p className="text-[9px] uppercase text-neutral-400">Holiday</p><p className="mt-1 text-xs font-semibold">{summary.daysHoliday}</p></div></div><div className="mt-3 flex justify-between text-[11px] text-neutral-500"><span>{summary.lateMinutes} late minutes</span><span className="font-semibold text-black">{summary.percentage === null ? "—" : `${summary.percentage}%`}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-black" style={{width:`${summary.percentage === null ? 0 : Math.min(100,summary.percentage)}%`}} /></div><p className="mt-3 text-[10px] text-neutral-400">{latest?.date??"No attendance yet"} · select for details</p></button>;})}</div>}
    </Card>
    <div className="hidden"><Card className="min-w-0 p-0"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Staff attendance</h2><p className="mt-1 text-xs text-slate-500">Select a staff member to inspect check-in and check-out details.</p></div>
      {loading ? <Loading /> : summaries.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">No active staff found.</div> :
        <div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400"><tr>{["Staff", "Days present", "Days late", "Late minutes", "Attendance"].map(name => <th key={name} className="px-5 py-3 font-semibold">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{summaries.map(summary => <tr key={summary.person.id} tabIndex={0} role="button" onClick={() => setSelected(summary.person)} onKeyDown={event => { if (event.key === "Enter") setSelected(summary.person); }} className="cursor-pointer hover:bg-emerald-50/40"><td className="px-5 py-4"><p className="font-semibold">{summary.person.full_name}</p><p className="text-xs text-slate-400">{summary.person.staff_code}</p></td><td className="px-5 py-4">{summary.daysPresent}</td><td className="px-5 py-4">{summary.daysLate}</td><td className="px-5 py-4">{summary.lateMinutes} min</td><td className="px-5 py-4"><span className="font-semibold text-forest">{summary.percentage}%</span><div className="mt-1 h-1.5 w-24 rounded-full bg-slate-100"><div className="h-full rounded-full bg-forest" style={{ width: `${Math.min(100, summary.percentage)}%` }} /></div></td></tr>)}</tbody></table></div>}
    </Card></div>
    {selectedSummary && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={event=>{if(event.target===event.currentTarget)setSelected(null);}}><section role="dialog" aria-modal="true" aria-label={`${selected?.full_name} attendance details`} className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
      <div className="flex items-start justify-between border-b border-slate-100 p-5"><div><p className="text-xs font-bold uppercase tracking-wider text-forest">Daily records</p><h2 className="mt-1 text-xl font-bold">{selected?.full_name}</h2><p className="text-xs text-slate-500">{selected?.staff_code} · {from} to {to}</p></div><button onClick={() => setSelected(null)} className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button></div>
      <div className="max-h-[calc(90vh-90px)] overflow-auto p-5">{selectedSummary.entries.length===0 ? <p className="rounded-2xl bg-neutral-50 p-8 text-center text-sm text-neutral-500">No attendance records in this date range.</p> : <div className="space-y-3">{selectedSummary.entries.map(record=><article key={record.id} className="rounded-2xl border border-neutral-100 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{new Date(`${record.date}T00:00:00`).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</p><p className="mt-1 text-[11px] text-neutral-500">{record.staff?.branches?.name??"Branch not listed"} · {record.source==="manual"?"Added manually":"QR check-in"}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${record.status==="late"?"bg-amber-50 text-amber-700":record.status==="absent"?"bg-neutral-100 text-neutral-600":"bg-emerald-50 text-emerald-700"}`}>{record.status}</span></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-in time</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatTime(record.check_in_at)}</p></div><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-out time</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatTime(record.check_out_at)}</p></div></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-500"><span>Late by <b className="font-medium text-neutral-800">{record.late_minutes??0} min</b></span>{record.distance_m!==null&&<span>Distance <b className="font-medium text-neutral-800">{record.distance_m} m</b></span>}{record.note&&<span className="basis-full pt-1">Note: {record.note}</span>}</div></article>)}</div>}</div>
      {selectedSummary.missingDates.length > 0 && <section className="border-t border-rose-100 bg-rose-50/60 p-5"><h3 className="text-sm font-semibold text-rose-900">Missing past workdays</h3><p className="mt-1 text-xs text-rose-700">Convert an absent day to leave or sick time. A reason is required.</p><div className="mt-3 space-y-2">{selectedSummary.missingDates.map(date=><div key={date} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"><span className="text-xs font-medium">{date}</span><div className="flex gap-2"><button onClick={() => void convertAbsent(selectedSummary.person, date, "leave")} className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700">Convert to leave</button><button onClick={() => void convertAbsent(selectedSummary.person, date, "sick")} className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-[11px] font-semibold text-teal-700">Convert to sick</button></div></div>)}</div></section>}
    </section></div>}
  </>;
}
