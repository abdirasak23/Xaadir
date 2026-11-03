"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Loading, Notice, PageHeading } from "@/components/ui";
import { localDateInTimezone, WEEKEND_DAYS } from "../../shared/attendance-rules";

type Shift = { start: string; end: string; day?: number };
type Staff = { id: string; full_name: string; staff_code: string; job_title: string; branch_id: string; status: string; monthly_salary: number; scheduled_shifts: Shift[] | null; shift_start: string; shift_end: string; branches?: { name: string } | null };
type Attendance = { id: string; staff_id: string; date: string; shift_number: number; check_in_at: string | null; check_out_at: string | null; status: string; late_minutes: number; note: string | null; source: string };
type Leave = { staff_id: string; leave_type: string; start_date: string; end_date: string; status: string; reason: string };
type Holiday = { date: string; name: string; branch_id: string | null };
type PayrollData = { month: string; from: string; to: string; staff: Staff[]; attendance: Attendance[]; leaves: Leave[]; holidays: Holiday[] };
type HistoryRow = { date: string; shift: string; checkIn: string; checkOut: string; status: string; late: number; deduction: number; note: string };
type PayrollSummary = { salary: number; dailyHours: number; payableDays: number; expectedDays: number; attendanceDays: number; attendancePercentage: number | null; lateMinutes: number; lateDeduction: number; absenceDeduction: number; absentDays: number; net: number; rows: HistoryRow[]; shifts: Shift[] };

const thisMonth = localDateInTimezone().slice(0, 7);
const hourFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function amount(value: number) { return hourFormatter.format(Number.isFinite(value) ? value : 0); }
function displayTime(value: string | null) { return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"; }
function getShifts(person: Staff, date?: string): Shift[] {
  const configured = person.scheduled_shifts ?? [];
  if (!configured.length) return [{ start: person.shift_start.slice(0, 5), end: person.shift_end.slice(0, 5) }];
  if (!configured.some(shift => shift.day !== undefined) || !date) return configured.filter(shift => shift.day === undefined);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return configured.filter(shift => shift.day === weekday);
}
function shiftMinutes(shift: Shift) { const start = Number(shift.start.slice(0, 2)) * 60 + Number(shift.start.slice(3, 5)); const end = Number(shift.end.slice(0, 2)) * 60 + Number(shift.end.slice(3, 5)); return end > start ? end - start : end + 1440 - start; }
function isWorkday(date: string) { return !(WEEKEND_DAYS as readonly number[]).includes(new Date(`${date}T00:00:00Z`).getUTCDay()); }
function daysBetween(from: string, to: string) {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) { days.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return days;
}
function lateAfterGrace(record: Attendance, person: Staff) {
  if (!record.check_in_at) return 0;
  const shifts = getShifts(person, record.date);
  const shift = shifts[Math.max(0, (record.shift_number ?? 1) - 1)];
  if (!shift) return Math.max(0, record.late_minutes ?? 0);
  const start = Date.parse(`${record.date}T${shift.start}:00+03:00`);
  return Math.max(0, Math.floor((new Date(record.check_in_at).getTime() - start) / 60000) - 5);
}
function calculatePayroll(data: PayrollData, person: Staff): PayrollSummary {
  const monthDates = daysBetween(data.from, data.to);
  const holidays = new Set(data.holidays.filter(item => item.branch_id === null || item.branch_id === person.branch_id).map(item => item.date));
  const approvedLeave = data.leaves.filter(item => item.staff_id === person.id);
  const isOnLeave = (date: string) => approvedLeave.some(item => item.start_date <= date && item.end_date >= date);
  const scheduledDates = monthDates.filter(date => isWorkday(date) && getShifts(person, date).length > 0);
  const dailyHours = scheduledDates.length ? scheduledDates.reduce((sum, date) => sum + getShifts(person, date).reduce((day, shift) => day + shiftMinutes(shift) / 60, 0), 0) / scheduledDates.length : 0;
  const payableDays = scheduledDates.filter(date => !holidays.has(date)).length;
  const today = localDateInTimezone();
  const workDatesSoFar = monthDates.filter(date => date < today && isWorkday(date) && !holidays.has(date) && getShifts(person, date).length > 0);
  const records = data.attendance.filter(item => item.staff_id === person.id);
  const presentDates = new Set(records.filter(item => ["present", "late", "manual"].includes(item.status)).map(item => item.date));
  const leaveDates = new Set(records.filter(item => ["leave", "sick", "holiday"].includes(item.status)).map(item => item.date));
  const eligiblePastDates = workDatesSoFar.filter(date => !isOnLeave(date) && !leaveDates.has(date));
  const absentDates = eligiblePastDates.filter(date => !presentDates.has(date));
  const attendanceDays = eligiblePastDates.filter(date => presentDates.has(date)).length;
  const attendancePercentage = eligiblePastDates.length ? Math.round(attendanceDays / eligiblePastDates.length * 100) : null;
  const lateMinutes = records.reduce((sum, record) => sum + lateAfterGrace(record, person), 0);
  const salary = Number(person.monthly_salary ?? 0);
  const dailySalary = payableDays > 0 ? salary / payableDays : 0;
  const rateForDate = (date: string) => { const hours = getShifts(person, date).reduce((sum, shift) => sum + shiftMinutes(shift) / 60, 0); return hours > 0 ? salary / Math.max(payableDays, 1) / hours / 60 : 0; };
  const lateDeduction = records.reduce((sum, record) => sum + lateAfterGrace(record, person) * rateForDate(record.date), 0);
  const absenceDeduction = dailySalary * absentDates.length;
  const net = Math.max(0, salary - lateDeduction - absenceDeduction);
  const rows: HistoryRow[] = records.map(record => {
    const shifts = getShifts(person, record.date);
    const perMin = rateForDate(record.date);
    const late = lateAfterGrace(record, person);
    const shift = shifts[record.shift_number - 1];
    const leaveRecord = approvedLeave.find(item => item.start_date <= record.date && item.end_date >= record.date);
    const holiday = data.holidays.find(item => item.date === record.date && (item.branch_id === null || item.branch_id === person.branch_id));
    const status = record.status === "leave" ? (leaveRecord?.leave_type ?? "leave") : record.status === "holiday" ? "holiday" : record.status;
    return { date: record.date, shift: shift ? `${shift.start}-${shift.end}` : `Shift ${record.shift_number}`, checkIn: displayTime(record.check_in_at), checkOut: displayTime(record.check_out_at), status, late, deduction: dailyHours > 0 ? perMin * late : 0, note: record.note ?? holiday?.name ?? leaveRecord?.reason ?? (record.source === "manual" ? "Manual entry" : "") };
  });
  for (const date of absentDates) rows.push({ date, shift: "All shifts", checkIn: "—", checkOut: "—", status: "unexcused absence", late: 0, deduction: dailySalary, note: "No attendance or approved leave recorded" });
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));
  return { salary, dailyHours, payableDays, expectedDays: eligiblePastDates.length, attendanceDays, attendancePercentage, lateMinutes, lateDeduction, absenceDeduction, absentDays: absentDates.length, net, rows, shifts: getShifts(person) };
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeCell(value: unknown) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function exportExcel(person: Staff, month: string, rows: HistoryRow[], summary: { salary: number; lateDeduction: number; absenceDeduction: number; net: number; lateMinutes: number; absentDays: number }) {
  const headings = ["Date", "Shift", "Check-in", "Check-out", "Status", "Late minutes (after 5 min grace)", "Deduction", "Notes"];
  const body = rows.map(row => [row.date, row.shift, row.checkIn, row.checkOut, row.status, row.late, amount(row.deduction), row.note]);
  const summaryRows = [["Staff", person.full_name], ["Staff code", person.staff_code], ["Payroll month", month], ["Monthly salary", amount(summary.salary)], ["Late minutes", summary.lateMinutes], ["Late deductions", amount(summary.lateDeduction)], ["Unexcused absent days", summary.absentDays], ["Absence deductions", amount(summary.absenceDeduction)], ["Net salary", amount(summary.net)]];
  const table = (data: unknown[][]) => data.map((row, index) => `<tr>${row.map(value => `<${index === 0 ? "th" : "td"}>${safeCell(value)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset="utf-8"></head><body><h2>Xaadir payroll · ${safeCell(person.full_name)}</h2><table>${table(summaryRows)}</table><br/><table>${table([headings, ...body])}</table></body></html>`;
  download(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }), `xaadir-payroll-${person.staff_code}-${month}.xls`);
}
function exportPdf(person: Staff, month: string, rows: HistoryRow[], summary: { salary: number; lateDeduction: number; absenceDeduction: number; net: number; lateMinutes: number; absentDays: number }) {
  const clean = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "-").replace(/[\\()]/g, "\\$&");
  const lines = ["XAADIR - PAYROLL STATEMENT", `Staff: ${person.full_name} (${person.staff_code})`, `Role: ${person.job_title}   Branch: ${person.branches?.name ?? "-"}`, `Month: ${month}`, "", `Monthly salary: ${amount(summary.salary)}`, `Late minutes after 5-minute grace: ${summary.lateMinutes}`, `Late deductions: ${amount(summary.lateDeduction)}`, `Unexcused absent days: ${summary.absentDays}`, `Absence deductions: ${amount(summary.absenceDeduction)}`, `NET SALARY: ${amount(summary.net)}`, "", "DATE       SHIFT       CHECK-IN  CHECK-OUT STATUS       LATE   DEDUCTION", "------------------------------------------------------------------------"];
  for (const row of rows) lines.push(`${row.date} ${row.shift.padEnd(11)} ${row.checkIn.padEnd(9)} ${row.checkOut.padEnd(9)} ${row.status.slice(0, 11).padEnd(11)} ${String(row.late).padEnd(6)} ${amount(row.deduction)}`);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 49) pages.push(lines.slice(i, i + 49));
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"; objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  pages.forEach((page, index) => { const pageId = pageIds[index], streamId = pageId + 1; const commands = ["BT", "/F1 9 Tf", "38 755 Td", "13 TL", ...page.flatMap((line, lineIndex) => [lineIndex ? "T*" : "", `(${clean(line)}) Tj`]).filter(Boolean), "ET"].join("\n"); objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`; objects[streamId] = `<< /Length ${new TextEncoder().encode(commands).length} >>\nstream\n${commands}\nendstream`; });
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (let index = 1; index < objects.length; index++) { offsets[index] = new TextEncoder().encode(pdf).length; pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  download(new Blob([pdf], { type: "application/pdf" }), `xaadir-payroll-${person.staff_code}-${month}.pdf`);
}
function exportAllExcel(data: PayrollData, results: Map<string, PayrollSummary>) {
  const summaryHead = ["Staff", "Staff code", "Role", "Branch", "Monthly salary", "Attendance %", "Attended days", "Expected days", "Late minutes", "Late deduction", "Unexcused absent days", "Absence deduction", "Net salary"];
  const summaryRows = data.staff.map(person => { const item = results.get(person.id)!; return [person.full_name, person.staff_code, person.job_title, person.branches?.name ?? "", amount(item.salary), item.attendancePercentage === null ? "N/A" : `${item.attendancePercentage}%`, item.attendanceDays, item.expectedDays, item.lateMinutes, amount(item.lateDeduction), item.absentDays, amount(item.absenceDeduction), amount(item.net)]; });
  const detailHead = ["Staff", "Staff code", "Date", "Shift", "Check-in", "Check-out", "Status", "Late minutes", "Deduction", "Notes"];
  const details = data.staff.flatMap(person => (results.get(person.id)?.rows ?? []).map(row => [person.full_name, person.staff_code, row.date, row.shift, row.checkIn, row.checkOut, row.status, row.late, amount(row.deduction), row.note]));
  const table = (rows: unknown[][]) => rows.map((row, index) => `<tr>${row.map(value => `<${index === 0 ? "th" : "td"}>${safeCell(value)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset="utf-8"></head><body><h2>Xaadir payroll · ${safeCell(data.month)}</h2><h3>All staff payroll summary</h3><table>${table([summaryHead, ...summaryRows])}</table><br/><h3>Attendance and deductions detail</h3><table>${table([detailHead, ...details])}</table></body></html>`;
  download(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }), `xaadir-payroll-all-staff-${data.month}.xls`);
}
function exportAllPdf(data: PayrollData, results: Map<string, PayrollSummary>) {
  const lines = [`XAADIR - ALL STAFF PAYROLL`, `Month: ${data.month}`, `Staff count: ${data.staff.length}`, "", "STAFF SUMMARY", "STAFF / CODE                 SALARY       ATTENDANCE LATE MIN LATE CUT    ABSENT NET PAY"];
  for (const person of data.staff) { const item = results.get(person.id)!; const label = `${person.full_name} / ${person.staff_code}`.slice(0, 28).padEnd(28); lines.push(`${label} ${amount(item.salary).padStart(11)} ${(item.attendancePercentage === null ? "N/A" : `${item.attendancePercentage}%`).padStart(10)} ${String(item.lateMinutes).padStart(7)} ${amount(item.lateDeduction).padStart(10)} ${String(item.absentDays).padStart(6)} ${amount(item.net).padStart(11)}`); }
  lines.push("", "ATTENDANCE AND DEDUCTION DETAIL");
  for (const person of data.staff) { lines.push("", `${person.full_name} (${person.staff_code})`); for (const row of results.get(person.id)?.rows ?? []) lines.push(`${row.date} ${row.shift.padEnd(11)} ${row.checkIn.padEnd(8)} ${row.checkOut.padEnd(8)} ${row.status.slice(0, 12).padEnd(12)} ${String(row.late).padStart(4)}m ${amount(row.deduction).padStart(10)} ${row.note.slice(0, 30)}`); }
  const clean = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "-").replace(/[\\()]/g, "\\$&");
  const pages: string[][] = []; for (let i = 0; i < lines.length; i += 49) pages.push(lines.slice(i, i + 49));
  const objects: string[] = []; objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"; objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
  const pageIds = pages.map((_, index) => 4 + index * 2); objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  pages.forEach((page, index) => { const pageId = pageIds[index], streamId = pageId + 1; const commands = ["BT", "/F1 8 Tf", "30 755 Td", "12 TL", ...page.flatMap((line, lineIndex) => [lineIndex ? "T*" : "", `(${clean(line)}) Tj`]).filter(Boolean), "ET"].join("\n"); objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`; objects[streamId] = `<< /Length ${new TextEncoder().encode(commands).length} >>\nstream\n${commands}\nendstream`; });
  let pdf = "%PDF-1.4\n"; const offsets = [0]; for (let index = 1; index < objects.length; index++) { offsets[index] = new TextEncoder().encode(pdf).length; pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = new TextEncoder().encode(pdf).length; pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  download(new Blob([pdf], { type: "application/pdf" }), `xaadir-payroll-all-staff-${data.month}.pdf`);
}

export function PayrollManager() {
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<PayrollData | null>(null);
  const [staffId, setStaffId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/payroll?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load payroll.");
      setData(body);
      setStaffId(current => body.staff.some((person: Staff) => person.id === current) ? current : "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load payroll."); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const person = data?.staff.find(item => item.id === staffId) ?? null;
  const result = useMemo(() => {
    if (!data || !person) return null;
    const monthDates = daysBetween(data.from, data.to);
    const holidays = new Set(data.holidays.filter(item => item.branch_id === null || item.branch_id === person.branch_id).map(item => item.date));
    const approvedLeave = data.leaves.filter(item => item.staff_id === person.id);
    const isOnLeave = (date: string) => approvedLeave.some(item => item.start_date <= date && item.end_date >= date);
    const scheduledDates = monthDates.filter(date => isWorkday(date) && getShifts(person, date).length > 0);
    const dailyHours = scheduledDates.length ? scheduledDates.reduce((sum, date) => sum + getShifts(person, date).reduce((day, shift) => day + shiftMinutes(shift) / 60, 0), 0) / scheduledDates.length : 0;
    const payableDays = scheduledDates.filter(date => !holidays.has(date)).length;
    const today = localDateInTimezone();
    const workDatesSoFar = monthDates.filter(date => date < today && isWorkday(date) && !holidays.has(date) && getShifts(person, date).length > 0);
    const records = data.attendance.filter(item => item.staff_id === person.id);
    const presentDates = new Set(records.filter(item => ["present", "late", "manual"].includes(item.status)).map(item => item.date));
    const leaveDates = new Set(records.filter(item => ["leave", "sick", "holiday"].includes(item.status)).map(item => item.date));
    const absentDates = workDatesSoFar.filter(date => !presentDates.has(date) && !leaveDates.has(date) && !isOnLeave(date));
    const lateMinutes = records.reduce((sum, record) => sum + lateAfterGrace(record, person), 0);
    const salary = Number(person.monthly_salary ?? 0);
    const dailySalary = payableDays > 0 ? salary / payableDays : 0;
    const rateForDate = (date: string) => { const hours = getShifts(person, date).reduce((sum, shift) => sum + shiftMinutes(shift) / 60, 0); return hours > 0 ? salary / Math.max(payableDays, 1) / hours / 60 : 0; };
    const lateDeduction = records.reduce((sum, record) => sum + lateAfterGrace(record, person) * rateForDate(record.date), 0);
    const absenceDeduction = dailySalary * absentDates.length;
    const net = Math.max(0, salary - lateDeduction - absenceDeduction);
    const rows: HistoryRow[] = records.map(record => {
      const shifts = getShifts(person, record.date);
      const late = lateAfterGrace(record, person);
      const perMin = rateForDate(record.date);
      const grace = shifts[record.shift_number - 1];
      const leaveRecord = approvedLeave.find(item => item.start_date <= record.date && item.end_date >= record.date);
      const holiday = data.holidays.find(item => item.date === record.date && (item.branch_id === null || item.branch_id === person.branch_id));
      const status = record.status === "leave" ? (leaveRecord?.leave_type ?? "leave") : record.status === "holiday" ? "holiday" : record.status;
      return { date: record.date, shift: grace ? `${grace.start}–${grace.end}` : `Shift ${record.shift_number}`, checkIn: displayTime(record.check_in_at), checkOut: displayTime(record.check_out_at), status, late, deduction: perMin * late, note: record.note ?? holiday?.name ?? leaveRecord?.reason ?? (record.source === "manual" ? "Manual entry" : "") };
    });
    for (const date of absentDates) rows.push({ date, shift: "All shifts", checkIn: "—", checkOut: "—", status: "unexcused absence", late: 0, deduction: dailySalary, note: "No attendance or approved leave recorded" });
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));
    return { salary, dailyHours, payableDays, lateMinutes, lateDeduction, absenceDeduction, absentDays: absentDates.length, net, rows, shifts: getShifts(person) };
  }, [data, person]);

  const summary = result && { salary: result.salary, lateDeduction: result.lateDeduction, absenceDeduction: result.absenceDeduction, net: result.net, lateMinutes: result.lateMinutes, absentDays: result.absentDays };
  const roster = useMemo(() => (data?.staff ?? []).map(item => ({ person: item, payroll: data ? calculatePayroll(data, item) : null })), [data]);
  const allSalary = roster.reduce((sum, item) => sum + (item.payroll?.salary ?? 0), 0);
  const allNet = roster.reduce((sum, item) => sum + (item.payroll?.net ?? 0), 0);
  const attendanceWithData = roster.map(item => item.payroll?.attendancePercentage).filter((value): value is number => value !== null && value !== undefined);
  const averageAttendance = attendanceWithData.length ? Math.round(attendanceWithData.reduce((sum, value) => sum + value, 0) / attendanceWithData.length) : null;
  return <>
    <PageHeading eyebrow="People & pay" title="Payroll" description={person ? "Review this employee’s pay, deductions, and attendance evidence." : "Compare salary, attendance, and estimated net pay for your whole team."} action={<div className="flex flex-wrap gap-2">{person && <button type="button" onClick={() => setStaffId("")} className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">← All staff</button>}{!person && data && <><button type="button" onClick={() => exportAllPdf(data, new Map(roster.map(item => [item.person.id, item.payroll!])))} className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800">Download all PDF</button><button type="button" onClick={() => exportAllExcel(data, new Map(roster.map(item => [item.person.id, item.payroll!])))} className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">Download all Excel</button></> }<button type="button" onClick={() => void load()} className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">Refresh</button></div>} />
    {error && <div className="mb-5"><Notice error>{error}</Notice></div>}
    <Card className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="grid flex-1 gap-4 sm:grid-cols-2"><label className="text-xs font-medium text-neutral-600">Payroll month<input aria-label="Payroll month" type="month" value={month} onChange={event => setMonth(event.target.value)} className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm" /></label><label className="text-xs font-medium text-neutral-600">Staff member<select aria-label="Staff member" value={staffId} onChange={event => setStaffId(event.target.value)} disabled={!data?.staff.length} className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm"><option value="">Choose staff</option>{data?.staff.map(item => <option key={item.id} value={item.id}>{item.full_name} · {item.staff_code}</option>)}</select></label></div>{person && result && <div className="flex gap-2"><button onClick={() => summary && exportPdf(person, month, result.rows, summary)} className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800">Download PDF</button><button onClick={() => summary && exportExcel(person, month, result.rows, summary)} className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">Download Excel</button></div>}</Card>
    {loading ? <Card><Loading /></Card> : !data?.staff.length ? <Card className="py-14 text-center"><p className="font-semibold">No staff records</p><p className="mt-1 text-sm text-neutral-500">Create staff and add each person’s monthly salary and daily schedule to begin payroll.</p></Card> : person && result && summary ? <>
      <Card className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-neutral-400">Pay statement · {month}</p><h2 className="mt-1 text-xl font-semibold">{person.full_name}</h2><p className="mt-1 text-sm text-neutral-500">{person.staff_code} · {person.job_title} · {person.branches?.name ?? "Branch"}</p><p className="mt-3 text-xs text-neutral-500">Schedule: {result.shifts.map(shift => `${shift.start}–${shift.end}`).join("  ·  ")} ({amount(result.dailyHours)} scheduled hours/day)</p></div><div className="sm:text-right"><p className="text-xs text-neutral-500">Net salary</p><p className="mt-1 text-3xl font-semibold tabular-nums">{amount(result.net)}</p></div></Card>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Monthly salary" value={amount(result.salary)} detail={`${result.payableDays} scheduled workdays`} /><Metric label="Late time" value={`${result.lateMinutes} min`} detail="After 5-minute grace" /><Metric label="Late deductions" value={amount(result.lateDeduction)} detail={`${amount(result.dailyHours)} scheduled hours/day`} /><Metric label="Unexcused absences" value={`${result.absentDays} days`} detail={`Deduction ${amount(result.absenceDeduction)}`} /><Metric label="Estimated net pay" value={amount(result.net)} detail="Salary less attendance deductions" dark /></div>
      <Card className="mb-5"><h3 className="text-sm font-semibold">How this is calculated</h3><p className="mt-2 text-xs leading-5 text-neutral-600">Late deduction = monthly salary ÷ scheduled working days ÷ scheduled daily hours ÷ 60 × late minutes. Lateness begins after the first 5 minutes of each scheduled shift. Net salary = monthly salary − late deductions − (daily salary × unexcused absent workdays). Fridays and branch holidays are excluded. Future days and approved leave are not counted as absences.</p></Card>
      <Card className="min-w-0 p-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 p-5"><div><h3 className="text-sm font-semibold">Attendance and deduction history</h3><p className="mt-1 text-xs text-neutral-500">Every shift has its own check-in and check-out record.</p></div><span className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">{result.rows.length} entries</span></div>{result.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[870px] text-left text-xs"><thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400"><tr>{["Date", "Shift", "Check-in", "Check-out", "Status", "Late", "Deduction"].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{result.rows.map((row, index) => <tr key={`${row.date}-${row.shift}-${index}`} className="hover:bg-neutral-50/70"><td className="px-4 py-3.5 tabular-nums">{row.date}</td><td className="px-4 py-3.5 font-medium">{row.shift}</td><td className="px-4 py-3.5 tabular-nums">{row.checkIn}</td><td className="px-4 py-3.5 tabular-nums">{row.checkOut}</td><td className="px-4 py-3.5 capitalize">{row.status}</td><td className="px-4 py-3.5 tabular-nums">{row.late ? `${row.late} min` : "—"}</td><td className="px-4 py-3.5 font-semibold tabular-nums">{row.deduction ? amount(row.deduction) : "—"}{row.note && <p className="mt-1 max-w-56 truncate font-normal text-neutral-400" title={row.note}>{row.note}</p>}</td></tr>)}</tbody></table></div> : <div className="p-10 text-center text-sm text-neutral-500">No attendance or absence entries for this month yet.</div>}</Card>
    </> : <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Staff on payroll" value={String(roster.length)} detail={`Payroll month ${month}`} /><Metric label="Combined monthly salary" value={amount(allSalary)} detail="Current base salary for all staff" /><Metric label="Estimated net payroll" value={amount(allNet)} detail="After attendance deductions" dark /><Metric label="Average attendance" value={averageAttendance === null ? "—" : `${averageAttendance}%`} detail="Completed scheduled days so far" /></div>
      <Card className="min-w-0 p-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 p-5"><div><h2 className="text-sm font-semibold">Staff payroll</h2><p className="mt-1 text-xs text-neutral-500">Select a staff member to open their full monthly statement.</p></div><span className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">{roster.length} staff</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400"><tr>{["Staff member", "Monthly salary", "Attendance", "Late minutes", "Total deductions", "Estimated net"].map(label => <th key={label} className="px-5 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{roster.map(({ person: member, payroll }) => {
          const percent = payroll?.attendancePercentage;
          const deductions = (payroll?.lateDeduction ?? 0) + (payroll?.absenceDeduction ?? 0);
          return <tr key={member.id} tabIndex={0} role="button" onClick={() => setStaffId(member.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setStaffId(member.id); } }} className="cursor-pointer transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black/20">
            <td className="px-5 py-4"><p className="text-sm font-semibold text-neutral-900">{member.full_name}</p><p className="mt-1 text-[11px] text-neutral-500">{member.staff_code} · {member.job_title} · {member.branches?.name ?? "Branch"}</p></td>
            <td className="px-5 py-4"><p className="text-lg font-bold tabular-nums text-neutral-950">{amount(Number(member.monthly_salary ?? 0))}</p><p className="mt-1 text-[10px] text-neutral-400">Base monthly pay</p></td>
            <td className="px-5 py-4"><div className="flex items-center gap-2"><span className="min-w-10 font-semibold tabular-nums">{percent === null || percent === undefined ? "—" : `${percent}%`}</span><div className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-black" style={{ width: `${percent ?? 0}%` }} /></div></div><p className="mt-1 text-[10px] text-neutral-400">{payroll?.attendanceDays ?? 0} / {payroll?.expectedDays ?? 0} completed days</p></td>
            <td className="px-5 py-4 tabular-nums">{payroll?.lateMinutes ?? 0} min<p className="mt-1 text-[10px] text-neutral-400">{amount(payroll?.lateDeduction ?? 0)} deduction</p></td>
            <td className="px-5 py-4 font-medium tabular-nums">{amount(deductions)}<p className="mt-1 text-[10px] font-normal text-neutral-400">Late + unexcused absence</p></td>
            <td className="px-5 py-4"><p className="text-base font-bold tabular-nums">{amount(payroll?.net ?? 0)}</p><p className="mt-1 text-[10px] text-neutral-400">Estimated net pay</p></td>
          </tr>;
        })}</tbody></table></div>
        {roster.length === 0 && <div className="p-10 text-center text-sm text-neutral-500">No staff records are available for payroll.</div>}
      </Card>
    </>}
  </>;
}

function Metric({ label, value, detail, dark = false }: { label: string; value: string; detail: string; dark?: boolean }) {
  return <Card className={dark ? "bg-black text-white" : ""}><p className={`text-xs ${dark ? "text-white/60" : "text-neutral-500"}`}>{label}</p><p className="mt-2 truncate text-xl font-semibold tabular-nums">{value}</p><p className={`mt-1 text-[11px] ${dark ? "text-white/60" : "text-neutral-400"}`}>{detail}</p></Card>;
}
