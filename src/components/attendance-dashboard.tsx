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
type AttendanceTableRow = { key: string; person: Staff; date: string; shiftNumber: number; checkIn: string | null; checkOut: string | null; status: string; lateMinutes: number; source: string; note: string | null };
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
function attendanceStatusClass(status: string) {
  if (["Present", "present", "manual", "late"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["Absent", "absent"].includes(status)) return "bg-rose-50 text-rose-700";
  if (status === "Excused" || status === "leave" || status === "sick" || status === "holiday") return "bg-violet-50 text-violet-700";
  return "bg-neutral-100 text-neutral-600";
}
function attendanceState(status: string) {
  if (["present", "late", "manual"].includes(status)) return "Present";
  if (["leave", "sick", "holiday"].includes(status)) return "Excused";
  if (status.toLowerCase() === "absent") return "Absent";
  return status;
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function excelCell(value: unknown) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function downloadExcel(summaries: AttendanceSummary[], records: Attendance[], branches: Branch[], from: string, to: string) {
  const makeTable = (headings: unknown[], rows: unknown[][]) => [headings, ...rows].map((row, index) => `<tr>${row.map(value => `<${index ? "td" : "th"}>${excelCell(value)}</${index ? "td" : "th"}>`).join("")}</tr>`).join("");
  const summaryHeadings = ["Staff name", "Staff code", "Branch", "Present days (includes late)", "Absent workdays", "Leave days", "Sick days", "Holiday days", "Late minutes", "Attendance rate"];
  const summaryRows = summaries.map(summary => [summary.person.full_name, summary.person.staff_code, branches.find(item => item.id === summary.person.branch_id)?.name ?? "", summary.daysPresent, summary.daysAbsent, summary.daysLeave, summary.daysSick, summary.daysHoliday, summary.lateMinutes, `${summary.percentage}%`]);
  const detailsHeading = ["Date", "Staff name", "Staff code", "Branch", "Shift", "Check-in", "Check-out", "Status", "Late minutes", "Source", "Notes"];
  const detailRows = records.map(record => {
    const summary = summaries.find(item => item.person.id === record.staff_id);
    return [record.date, summary?.person.full_name ?? record.staff_id, summary?.person.staff_code ?? "", branches.find(item => item.id === summary?.person.branch_id)?.name ?? record.staff?.branches?.name ?? "", record.shift_number ?? 1, formatTime(record.check_in_at), formatTime(record.check_out_at), attendanceState(record.status), record.late_minutes, record.source, record.note ?? ""];
  });
  const html = `<html><head><meta charset="utf-8"></head><body><h2>Attendance summary · ${excelCell(from)} to ${excelCell(to)}</h2><table>${makeTable(summaryHeadings, summaryRows)}</table><br><h2>Recorded check-in details</h2><table>${makeTable(detailsHeading, detailRows)}</table></body></html>`;
  downloadBlob(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }), `xaadir-staff-attendance-${from}-to-${to}.xls`);
}
function downloadPdf(summaries: AttendanceSummary[], records: Attendance[], branches: Branch[], from: string, to: string) {
  const clean = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "-").replace(/[\\()]/g, "\\$&");
  const pad = (value: unknown, size: number) => String(value ?? "").slice(0, size).padEnd(size, " ");
  const lines = [`XAADIR - STAFF ATTENDANCE SUMMARY`, `Period: ${from} to ${to}`, `Staff listed: ${summaries.length} | Recorded check-in rows: ${records.length}`, "", "STAFF                 CODE       BRANCH           PRESENT ABSENT LEAVE SICK HOLIDAY RATE", "-----------------------------------------------------------------------------------------------"];
  for (const summary of summaries) {
    const branchName = branches.find(item => item.id === summary.person.branch_id)?.name ?? "";
    lines.push(`${pad(summary.person.full_name, 21)} ${pad(summary.person.staff_code, 10)} ${pad(branchName, 16)} ${String(summary.daysPresent).padStart(7)} ${String(summary.daysAbsent).padStart(5)} ${String(summary.daysLeave).padStart(4)} ${String(summary.daysSick).padStart(3)} ${String(summary.daysHoliday).padStart(7)} ${String(summary.percentage).padStart(3)}%`);
  }
  lines.push("", "RECORDED CHECK-IN DETAILS", "DATE       STAFF                 CODE        SHIFT CHECK-IN  CHECK-OUT STATUS       LATE");
  for (const record of records) {
    const person = summaries.find(item => item.person.id === record.staff_id)?.person;
    lines.push(`${record.date} ${pad(person?.full_name ?? "Unknown staff", 20)} ${pad(person?.staff_code ?? "", 10)} S${record.shift_number ?? 1}    ${pad(formatTime(record.check_in_at), 12)} ${pad(formatTime(record.check_out_at), 12)} ${pad(attendanceState(record.status), 11)} ${record.late_minutes ?? 0}m`);
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
  const [weeklyRecords, setWeeklyRecords] = useState<Attendance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [from, setFrom] = useState(today), [to, setTo] = useState(today), [branch, setBranch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordStatus, setRecordStatus] = useState("all");
  const [recordPage, setRecordPage] = useState(1);
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
        const weekStart = new Date(`${today}T00:00:00Z`);
        weekStart.setUTCDate(weekStart.getUTCDate() - 6);
        const weekParams = new URLSearchParams({ from: weekStart.toISOString().slice(0, 10), to: today });
        if (branch) { params.set("branch", branch); todayParams.set("branch", branch); weekParams.set("branch", branch); }
        const [attendanceResponse, todayResponse, weekResponse, staffResponse, leaveResponse] = await Promise.all([
          fetch(`/api/attendance?${params}`), fetch(`/api/attendance?${todayParams}`), fetch(`/api/attendance?${weekParams}`), fetch(`/api/staff${branch ? `?branch=${branch}` : ""}`), fetch("/api/leave"),
        ]);
        const attendanceData = await attendanceResponse.json(), todayData = await todayResponse.json(), weekData = await weekResponse.json(), staffData = await staffResponse.json(), leaveData = await leaveResponse.json();
        if (!active) return;
        if (!attendanceResponse.ok || !todayResponse.ok || !weekResponse.ok || !staffResponse.ok || !leaveResponse.ok) setError(attendanceData.error ?? todayData.error ?? weekData.error ?? staffData.error ?? leaveData.error ?? "Could not load attendance.");
        else { setRecords(attendanceData); setTodayRecords(todayData); setWeeklyRecords(weekData); setStaff(staffData.filter((person: Staff) => person.status === "active")); setHolidays(leaveData.holidays ?? []); setError(""); }
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
    const presentToday = new Set(daily.filter(record => ["present", "late", "manual"].includes(record.status)).map(record => record.staff_id)).size;
    const onLeaveToday = new Set(daily.filter(record => ["leave", "sick", "holiday"].includes(record.status)).map(record => record.staff_id)).size;
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
    return { presentToday, absentToday, onLeaveToday, percentage: denominator ? Math.round(attended / denominator * 100) : null };
  }, [records, todayRecords, staff, from, to, workDates]);
  const todayRoster = useMemo(() => staff.map(person => {
    const entries = todayRecords.filter(record => record.staff_id === person.id);
    const attended = entries.some(record => ["present", "late", "manual"].includes(record.status));
    const excused = entries.some(record => ["leave", "sick", "holiday"].includes(record.status));
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const configured = person.scheduled_shifts ?? [];
    const shifts = configured.some(shift => shift.day !== undefined)
      ? configured.filter(shift => shift.day === weekday)
      : configured.length ? configured : person.shift_start && person.shift_end ? [{ start: person.shift_start, end: person.shift_end }] : [];
    const sessions = shifts.map((shift, index) => {
      const record = entries.find(item => (item.shift_number ?? 1) === index + 1);
      return { number: index + 1, schedule: `${shift.start.slice(0, 5)}-${shift.end.slice(0, 5)}`, checkIn: record?.check_in_at ?? null, checkOut: record?.check_out_at ?? null, lateMinutes: record?.status === "late" ? record.late_minutes ?? 0 : 0 };
    });
    return { person, entries, sessions, attended, excused, status: attended ? "Present" : excused ? "Excused" : shifts.length ? "Absent" : "No shift today", lateMinutes: sessions.reduce((sum, session) => sum + session.lateMinutes, 0) };
  }).sort((a, b) => Number(b.attended) - Number(a.attended) || a.person.full_name.localeCompare(b.person.full_name)), [staff, todayRecords]);
  const summaries = useMemo(() => staff.map(person => {
    const entries = records.filter(record => record.staff_id === person.id);
    const daysPresent = new Set(entries.filter(record => ["present", "late", "manual"].includes(record.status)).map(record => record.date)).size;
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
  const attendanceRows = useMemo<AttendanceTableRow[]>(() => {
    const activeStaff = new Map(staff.map(person => [person.id, person]));
    const rows: AttendanceTableRow[] = records.flatMap(record => {
      const person = activeStaff.get(record.staff_id);
      return person ? [{ key: record.id, person, date: record.date, shiftNumber: record.shift_number ?? 1, checkIn: record.check_in_at, checkOut: record.check_out_at, status: record.status, lateMinutes: record.late_minutes ?? 0, source: record.source, note: record.note }] : [];
    });
    const end = to > today ? today : to;
    if (from <= end) {
      for (const person of staff) {
        const dates = workDates(from, end, person);
        for (const date of dates) {
          const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
          const configured = person.scheduled_shifts ?? [];
          const shifts = configured.some(shift => shift.day !== undefined)
            ? configured.filter(shift => shift.day === weekday)
            : configured.length ? configured : person.shift_start && person.shift_end ? [{ start: person.shift_start, end: person.shift_end }] : [];
          const dayRows = records.filter(record => record.staff_id === person.id && record.date === date);
          for (const [index] of shifts.entries()) {
            const shiftNumber = index + 1;
            if (dayRows.some(record => (record.shift_number ?? 1) === shiftNumber)) continue;
            rows.push({
              key: `missing:${person.id}:${date}:${shiftNumber}`,
              person,
              date,
              shiftNumber,
              checkIn: null,
              checkOut: null,
              status: dayRows.length ? "No entry" : date === today ? "Not checked in" : "Absent",
              lateMinutes: 0,
              source: "-",
              note: null,
            });
          }
        }
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date) || a.person.full_name.localeCompare(b.person.full_name) || a.shiftNumber - b.shiftNumber);
  }, [records, staff, from, to, workDates]);
  const filteredAttendanceRows = useMemo(() => attendanceRows.filter(row => {
    const query = recordSearch.trim().toLowerCase();
    const matchesSearch = !query || row.person.full_name.toLowerCase().includes(query) || row.person.staff_code.toLowerCase().includes(query);
    const matchesStatus = recordStatus === "all"
      || (recordStatus === "present" && ["present", "late", "manual"].includes(row.status))
      || (recordStatus === "absent" && ["absent", "Absent"].includes(row.status))
      || (recordStatus === "excused" && ["leave", "sick", "holiday"].includes(row.status))
      || (recordStatus === "not-recorded" && ["No entry", "Not checked in"].includes(row.status));
    return matchesSearch && matchesStatus;
  }), [attendanceRows, recordSearch, recordStatus]);
  const recordsPerPage = 20;
  const recordPageCount = Math.max(1, Math.ceil(filteredAttendanceRows.length / recordsPerPage));
  const pagedAttendanceRows = filteredAttendanceRows.slice((recordPage - 1) * recordsPerPage, recordPage * recordsPerPage);
  useEffect(() => setRecordPage(1), [from, to, branch]);
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
  const weekBars = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - (6 - index));
    const date = day.toISOString().slice(0, 10);
    const dayRecords = weeklyRecords.filter(record => record.date === date);
    const presentIds = new Set(dayRecords.filter(record => ["present", "late", "manual"].includes(record.status)).map(record => record.staff_id));
    const excusedIds = new Set(dayRecords.filter(record => ["leave", "sick", "holiday"].includes(record.status)).map(record => record.staff_id));
    const scheduled = staff.filter(person => workDates(date, date, person).length > 0);
    const absent = date <= today ? scheduled.filter(person => !presentIds.has(person.id) && !excusedIds.has(person.id)).length : 0;
    return { date, label: day.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }), present: presentIds.size, absent };
  });
  const chartMax = Math.max(1, ...weekBars.map(day => Math.max(day.present, day.absent)));

  return <><PageHeading eyebrow="Workforce insights" title="Attendance" description="Daily visibility into check-ins, punctuality and attendance patterns." action={<a href="/attendance/manual" className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800"><HugeiconsIcon icon={Add01Icon} size={17} strokeWidth={2} />Manual entry</a>} />
    {error && <div className="mb-4"><Notice error>{error}</Notice></div>}
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 text-[10px] text-neutral-600 shadow-sm"><span className="mr-1 font-medium">Attendance status</span>{[['Present · includes late','bg-emerald-100 text-emerald-700'],['Absent','bg-rose-100 text-rose-700'],['Excused','bg-violet-100 text-violet-700'],['No record yet','bg-neutral-100 text-neutral-700']].map(([label,style])=><span key={label} className={`rounded-full px-2.5 py-1 font-medium ${style}`}>{label}</span>)}</div>
    <Card className="mb-6"><div className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Attendance overview</h2><p className="mt-1 text-xs text-slate-500">Choose a quick range or customize dates.</p></div><div className="flex flex-wrap rounded-xl bg-neutral-100 p-1">{[["Today","today"],["Yesterday","yesterday"],["This week","week"],["This month","month"]].map(([label,value])=><button key={value} onClick={()=>setPreset(value as "today"|"yesterday"|"week"|"month")} className={`rounded-lg px-3 py-2 text-[11px] font-medium transition ${isPresetActive(value as "today"|"yesterday"|"week"|"month")?"bg-white text-black shadow-sm":"text-neutral-500 hover:text-black"}`}>{label}</button>)}</div></div><div className="grid grid-cols-2 gap-3 md:flex md:items-end"><label className="space-y-1 text-[11px] font-medium text-slate-500">From<Input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label className="space-y-1 text-[11px] font-medium text-slate-500">To<Input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label><label className="space-y-1 text-[11px] font-medium text-slate-500 md:min-w-44">Branch<select className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={branch} onChange={event => setBranch(event.target.value)}><option value="">All branches</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></div></Card>
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[{ label: "Present today", value: metrics.presentToday, hint: "Includes on-time and late arrivals", badge: "bg-emerald-50", dot: "bg-emerald-500" }, { label: "Absent today", value: metrics.absentToday, hint: "Scheduled staff without attendance", badge: "bg-rose-50", dot: "bg-rose-500" }, { label: "Excused today", value: metrics.onLeaveToday, hint: "Leave, sick, or holiday", badge: "bg-violet-50", dot: "bg-violet-500" }, { label: "Attendance rate", value: metrics.percentage === null ? "N/A" : `${metrics.percentage}%`, hint: "Selected date range", badge: "bg-teal-50", dot: "bg-teal-500" }].map(({ label, value, hint, badge, dot }) => <Card key={label} className="relative overflow-hidden p-5"><div className="flex items-start justify-between"><p className="text-xs font-medium text-neutral-500">{label}</p><span className={`grid h-9 w-9 place-items-center rounded-xl ${badge}`}><span className={`h-2.5 w-2.5 rounded-full ${dot}`} /></span></div><p className="mt-4 text-[34px] font-semibold leading-none tracking-tight text-black">{value}</p><p className="mt-2 text-[11px] text-neutral-400">{hint}</p></Card>)}
    </div>
    <div className="mb-6">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><h2 className="font-semibold">Attendance trend</h2><p className="mt-1 text-xs text-neutral-500">Present includes staff who arrived late.</p></div>
          <div className="flex flex-wrap gap-4 text-[11px] text-neutral-600"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Present</span><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" />Absent</span></div>
        </div>
        <div className="mt-6 flex h-44 items-end gap-2 sm:gap-4">
          {weekBars.map(day => <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div className="flex h-36 w-full items-end justify-center gap-1">
              <div title={"Present: " + day.present} className="w-3 rounded-t-md bg-emerald-500 transition-all sm:w-5" style={{ height: Math.max(day.present ? 5 : 1, day.present / chartMax * 100) + "%" }} />
              <div title={"Absent: " + day.absent} className="w-3 rounded-t-md bg-rose-400 transition-all sm:w-5" style={{ height: Math.max(day.absent ? 5 : 1, day.absent / chartMax * 100) + "%" }} />
            </div>
            <span className="text-[10px] text-neutral-400">{day.label}</span>
          </div>)}
        </div>
      </Card>
    </div>

    <Card className="min-w-0 p-0">
      <div className="flex flex-col gap-4 border-b border-neutral-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div><h2 className="font-semibold">Today&apos;s attendance roster</h2><p className="mt-1 text-xs text-neutral-500">One row per staff member. Late arrivals are included in Present and marked beside their check-in.</p><p className="mt-2 text-[11px] text-neutral-400">Present {metrics.presentToday} | Absent {metrics.absentToday} | Excused {metrics.onLeaveToday}</p></div>
        <div className="flex gap-2">
          <button onClick={() => downloadExcel(summaries, records, branches, from, to)} disabled={loading || staff.length === 0} className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40">Export Excel</button>
          <button onClick={() => downloadPdf(summaries, records, branches, from, to)} disabled={loading || staff.length === 0} className="rounded-xl bg-black px-3.5 py-2.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-40">Download PDF</button>
        </div>
      </div>
      {loading ? <Loading /> : todayRoster.length === 0 ? <div className="p-10 text-center text-sm text-neutral-500">No active staff found.</div> : <>
        <div className="divide-y divide-neutral-100 md:hidden">
          {todayRoster.map(row => <div key={row.person.id} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3"><button type="button" onClick={() => setSelected(row.person)} className="min-w-0 text-left"><span className="block truncate text-sm font-semibold">{row.person.full_name}</span><span className="mt-0.5 block text-[10px] text-neutral-400">{row.person.staff_code}{branches.find(item => item.id === row.person.branch_id) ? " | " + branches.find(item => item.id === row.person.branch_id)?.name : ""}</span></button><span className={"shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium " + attendanceStatusClass(row.status === "Present" ? "present" : row.status === "Absent" ? "absent" : row.status === "Excused" ? "leave" : "other")}>{row.status}</span></div>
            {row.sessions.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-3">
              <div><p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-in</p>{row.sessions.map(session => <p key={session.number} className="py-0.5 text-xs tabular-nums">S{session.number} {formatTime(session.checkIn)}{session.lateMinutes > 0 ? <span className="ml-1 text-[10px] font-medium text-amber-700">Late {session.lateMinutes}m</span> : null}</p>)}</div>
              <div><p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-out</p>{row.sessions.map(session => <p key={session.number} className="py-0.5 text-xs tabular-nums">S{session.number} {formatTime(session.checkOut)}</p>)}</div>
            </div> : <p className="mt-2 text-xs text-neutral-400">No shift scheduled today</p>}
          </div>)}
        </div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400"><tr>{["Staff member", "Scheduled shifts", "Check-in", "Check-out", "Attendance"].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-neutral-100">{todayRoster.map(row => <tr key={row.person.id} className="hover:bg-neutral-50">
            <td className="px-4 py-3.5"><button type="button" onClick={() => setSelected(row.person)} className="text-left"><span className="block font-medium text-neutral-900">{row.person.full_name}</span><span className="mt-0.5 block text-[10px] text-neutral-400">{row.person.staff_code}</span></button></td>
            <td className="px-4 py-3.5">{row.sessions.length ? row.sessions.map(session => <p key={session.number} className="py-0.5 tabular-nums">S{session.number} {session.schedule}</p>) : <span className="text-neutral-400">No shift</span>}</td>
            <td className="px-4 py-3.5">{row.sessions.map(session => <p key={session.number} className="py-0.5 tabular-nums">{formatTime(session.checkIn)}{session.lateMinutes > 0 ? <span className="ml-1 text-[10px] font-medium text-amber-700">Late {session.lateMinutes}m</span> : null}</p>)}</td>
            <td className="px-4 py-3.5">{row.sessions.map(session => <p key={session.number} className="py-0.5 tabular-nums">{formatTime(session.checkOut)}</p>)}</td>
            <td className="px-4 py-3.5"><span className={"rounded-full px-2.5 py-1 text-[10px] font-medium " + attendanceStatusClass(row.status === "Present" ? "present" : row.status === "Absent" ? "absent" : row.status === "Excused" ? "leave" : "other")}>{row.status}</span></td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </Card>
    <Card className="mt-6 min-w-0 p-0">
      <div className="border-b border-neutral-100 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="font-semibold">Check-in and checkout records</h2><p className="mt-1 text-xs text-neutral-500">Every recorded shift in the selected date range, plus scheduled workdays with no attendance record.</p></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:w-[min(100%,520px)]">
            <Input aria-label="Search staff attendance" placeholder="Search staff name or code" value={recordSearch} onChange={event => { setRecordSearch(event.target.value); setRecordPage(1); }} />
            <select aria-label="Filter attendance status" value={recordStatus} onChange={event => { setRecordStatus(event.target.value); setRecordPage(1); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <option value="all">All attendance</option><option value="present">Present (includes late)</option><option value="absent">Absent</option><option value="excused">Excused</option><option value="not-recorded">No record yet</option>
            </select>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-neutral-400">{filteredAttendanceRows.length} shift records</p>
      </div>
      {loading ? <Loading /> : pagedAttendanceRows.length === 0 ? <div className="p-10 text-center text-sm text-neutral-500">No attendance records match these filters.</div> : <>
        <div className="divide-y divide-neutral-100 md:hidden">
          {pagedAttendanceRows.map(row => <button key={row.key} type="button" onClick={() => setSelected(row.person)} className="w-full px-4 py-3.5 text-left transition hover:bg-neutral-50">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{row.person.full_name}</p><p className="mt-0.5 truncate text-[11px] text-neutral-500">{row.person.staff_code} · Shift {row.shiftNumber} · {new Date(`${row.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium ${attendanceStatusClass(attendanceState(row.status))}`}>{attendanceState(row.status)}</span></div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs"><p><span className="text-[10px] uppercase tracking-wide text-neutral-400">In </span><span className="font-medium tabular-nums">{formatTime(row.checkIn)}</span></p><p><span className="text-[10px] uppercase tracking-wide text-neutral-400">Out </span><span className="font-medium tabular-nums">{formatTime(row.checkOut)}</span></p></div>
            {row.lateMinutes > 0 && <p className="mt-1 text-[10px] font-medium text-amber-700">{row.lateMinutes} minutes late</p>}
          </button>)}
        </div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400"><tr>{["Date", "Staff", "Branch", "Shift", "Check-in", "Check-out", "Status", "Late", "Source"].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{pagedAttendanceRows.map(row => <tr key={row.key} tabIndex={0} role="button" onClick={() => setSelected(row.person)} onKeyDown={event => { if (event.key === "Enter") setSelected(row.person); }} className="cursor-pointer transition hover:bg-neutral-50"><td className="whitespace-nowrap px-4 py-3.5 tabular-nums">{row.date}</td><td className="px-4 py-3.5"><p className="font-medium text-neutral-900">{row.person.full_name}</p><p className="mt-0.5 text-[10px] text-neutral-400">{row.person.staff_code}</p></td><td className="max-w-40 truncate px-4 py-3.5">{branches.find(item => item.id === row.person.branch_id)?.name ?? "-"}</td><td className="px-4 py-3.5">Shift {row.shiftNumber}</td><td className="whitespace-nowrap px-4 py-3.5 font-medium tabular-nums">{formatTime(row.checkIn)}</td><td className="whitespace-nowrap px-4 py-3.5 font-medium tabular-nums">{formatTime(row.checkOut)}</td><td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${attendanceStatusClass(attendanceState(row.status))}`}>{attendanceState(row.status)}</span></td><td className="px-4 py-3.5">{row.lateMinutes ? `${row.lateMinutes} min` : "-"}</td><td className="px-4 py-3.5 capitalize">{row.source}</td></tr>)}</tbody></table></div>
        <div className="flex flex-col gap-2 border-t border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] text-neutral-500">Showing {Math.min(filteredAttendanceRows.length, (recordPage - 1) * recordsPerPage + 1)}-{Math.min(filteredAttendanceRows.length, recordPage * recordsPerPage)} of {filteredAttendanceRows.length}</p><div className="flex gap-2"><button type="button" onClick={() => setRecordPage(page => Math.max(1, page - 1))} disabled={recordPage <= 1} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium disabled:opacity-40">Previous</button><span className="self-center px-2 text-xs text-neutral-500">Page {recordPage} of {recordPageCount}</span><button type="button" onClick={() => setRecordPage(page => Math.min(recordPageCount, page + 1))} disabled={recordPage >= recordPageCount} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium disabled:opacity-40">Next</button></div></div>
      </>}
    </Card>
    <div className="hidden"><Card className="min-w-0 p-0"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Staff attendance</h2><p className="mt-1 text-xs text-slate-500">Select a staff member to inspect check-in and check-out details.</p></div>
      {loading ? <Loading /> : summaries.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">No active staff found.</div> :
        <div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400"><tr>{["Staff", "Days present", "Days late", "Late minutes", "Attendance"].map(name => <th key={name} className="px-5 py-3 font-semibold">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{summaries.map(summary => <tr key={summary.person.id} tabIndex={0} role="button" onClick={() => setSelected(summary.person)} onKeyDown={event => { if (event.key === "Enter") setSelected(summary.person); }} className="cursor-pointer hover:bg-emerald-50/40"><td className="px-5 py-4"><p className="font-semibold">{summary.person.full_name}</p><p className="text-xs text-slate-400">{summary.person.staff_code}</p></td><td className="px-5 py-4">{summary.daysPresent}</td><td className="px-5 py-4">{summary.daysLate}</td><td className="px-5 py-4">{summary.lateMinutes} min</td><td className="px-5 py-4"><span className="font-semibold text-forest">{summary.percentage}%</span><div className="mt-1 h-1.5 w-24 rounded-full bg-slate-100"><div className="h-full rounded-full bg-forest" style={{ width: `${Math.min(100, summary.percentage)}%` }} /></div></td></tr>)}</tbody></table></div>}
    </Card></div>
    {selectedSummary && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={event=>{if(event.target===event.currentTarget)setSelected(null);}}><section role="dialog" aria-modal="true" aria-label={`${selected?.full_name} attendance details`} className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
      <div className="flex items-start justify-between border-b border-slate-100 p-5"><div><p className="text-xs font-bold uppercase tracking-wider text-forest">Daily records</p><h2 className="mt-1 text-xl font-bold">{selected?.full_name}</h2><p className="text-xs text-slate-500">{selected?.staff_code}  -  Complete attendance history</p></div><button onClick={() => setSelected(null)} className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100" aria-label="Close">Close</button></div>
      <div className="max-h-[calc(90vh-90px)] overflow-auto p-5">{selfiesLoading ? <div className="py-10"><Loading /></div> : selectedHistory.length===0 ? <p className="rounded-2xl bg-neutral-50 p-8 text-center text-sm text-neutral-500">No attendance history is available for this staff member.</p> : <div className="space-y-3">{selectedHistory.map(record=><article key={record.id} className="rounded-2xl border border-neutral-100 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{new Date(`${record.date}T00:00:00`).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</p><p className="mt-1 text-[11px] text-neutral-500">{record.staff?.branches?.name??"Branch not listed"}  -  {record.source==="manual"?"Added manually":"QR check-in"}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${attendanceStatusClass(attendanceState(record.status))}`}>{attendanceState(record.status)}</span></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-in time</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatTime(record.check_in_at)}</p></div><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Check-out time</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatTime(record.check_out_at)}</p></div></div><SelfieEvidence attendanceId={record.id} selfies={record.selfies ?? []} method={record.staff?.check_in_method} loading={selfiesLoading} error={selfiesError} /><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-500"><span>Late by <b className="font-medium text-neutral-800">{record.late_minutes??0} min</b></span>{record.distance_m!==null&&<span>Distance <b className="font-medium text-neutral-800">{record.distance_m} m</b></span>}{record.note&&<span className="basis-full pt-1">Note: {record.note}</span>}</div></article>)}</div>}</div>
      {selectedSummary.missingDates.length > 0 && <section className="border-t border-rose-100 bg-rose-50/60 p-5"><h3 className="text-sm font-semibold text-rose-900">Missing past workdays</h3><p className="mt-1 text-xs text-rose-700">Convert an absent day to leave or sick time. A reason is required.</p><div className="mt-3 space-y-2">{selectedSummary.missingDates.map(date=><div key={date} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"><span className="text-xs font-medium">{date}</span><div className="flex gap-2"><button onClick={() => void convertAbsent(selectedSummary.person, date, "leave")} className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700">Convert to leave</button><button onClick={() => void convertAbsent(selectedSummary.person, date, "sick")} className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-[11px] font-semibold text-teal-700">Convert to sick</button></div></div>)}</div></section>}
    </section></div>}
  </>;
}
