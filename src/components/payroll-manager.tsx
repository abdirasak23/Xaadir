"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Loading, Notice, PageHeading } from "@/components/ui";
import { localDateInTimezone, WEEKEND_DAYS } from "../../shared/attendance-rules";

type Shift = { start: string; end: string };
type Staff = { id: string; full_name: string; staff_code: string; job_title: string; branch_id: string; status: string; monthly_salary: number; scheduled_shifts: Shift[] | null; shift_start: string; shift_end: string; branches?: { name: string } | null };
type Attendance = { id: string; staff_id: string; date: string; shift_number: number; check_in_at: string | null; check_out_at: string | null; status: string; late_minutes: number; note: string | null; source: string };
type Leave = { staff_id: string; leave_type: string; start_date: string; end_date: string; status: string; reason: string };
type Holiday = { date: string; name: string; branch_id: string | null };
type PayrollData = { month: string; from: string; to: string; staff: Staff[]; attendance: Attendance[]; leaves: Leave[]; holidays: Holiday[] };
type HistoryRow = { date: string; shift: string; checkIn: string; checkOut: string; status: string; late: number; deduction: number; note: string };

const thisMonth = localDateInTimezone().slice(0, 7);
const hourFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function amount(value: number) { return hourFormatter.format(Number.isFinite(value) ? value : 0); }
function displayTime(value: string | null) { return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"; }
function getShifts(person: Staff): Shift[] {
  return person.scheduled_shifts?.length ? person.scheduled_shifts : [{ start: person.shift_start.slice(0, 5), end: person.shift_end.slice(0, 5) }];
}
function isWorkday(date: string) { return !(WEEKEND_DAYS as readonly number[]).includes(new Date(`${date}T00:00:00Z`).getUTCDay()); }
function daysBetween(from: string, to: string) {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) { days.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return days;
}
function lateAfterGrace(record: Attendance, shifts: Shift[]) {
  if (!record.check_in_at) return 0;
  const shift = shifts[Math.max(0, (record.shift_number ?? 1) - 1)];
  if (!shift) return Math.max(0, record.late_minutes ?? 0);
  const start = Date.parse(`${record.date}T${shift.start}:00+03:00`);
  return Math.max(0, Math.floor((new Date(record.check_in_at).getTime() - start) / 60000) - 5);
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
      setStaffId(current => body.staff.some((person: Staff) => person.id === current) ? current : body.staff[0]?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load payroll."); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const person = data?.staff.find(item => item.id === staffId) ?? null;
  const result = useMemo(() => {
    if (!data || !person) return null;
    const shifts = getShifts(person);
    const dailyHours = shifts.reduce((total, shift) => total + (Date.parse(`1970-01-01T${shift.end}:00Z`) - Date.parse(`1970-01-01T${shift.start}:00Z`)) / 3600000, 0);
    const monthDates = daysBetween(data.from, data.to);
    const holidays = new Set(data.holidays.filter(item => item.branch_id === null || item.branch_id === person.branch_id).map(item => item.date));
    const approvedLeave = data.leaves.filter(item => item.staff_id === person.id);
    const isOnLeave = (date: string) => approvedLeave.some(item => item.start_date <= date && item.end_date >= date);
    const payableDays = monthDates.filter(date => isWorkday(date) && !holidays.has(date)).length;
    const today = localDateInTimezone();
    const workDatesSoFar = monthDates.filter(date => date < today && isWorkday(date) && !holidays.has(date));
    const records = data.attendance.filter(item => item.staff_id === person.id);
    const presentDates = new Set(records.filter(item => ["present", "late", "manual"].includes(item.status)).map(item => item.date));
    const leaveDates = new Set(records.filter(item => ["leave", "sick", "holiday"].includes(item.status)).map(item => item.date));
    const absentDates = workDatesSoFar.filter(date => !presentDates.has(date) && !leaveDates.has(date) && !isOnLeave(date));
    const lateMinutes = records.reduce((sum, record) => sum + lateAfterGrace(record, shifts), 0);
    const salary = Number(person.monthly_salary ?? 0);
    const dailySalary = payableDays > 0 ? salary / payableDays : 0;
    const lateDeduction = dailyHours > 0 ? salary / Math.max(payableDays, 1) / dailyHours / 60 * lateMinutes : 0;
    const absenceDeduction = dailySalary * absentDates.length;
    const net = Math.max(0, salary - lateDeduction - absenceDeduction);
    const rows: HistoryRow[] = records.map(record => {
      const late = lateAfterGrace(record, shifts);
      const grace = shifts[record.shift_number - 1];
      const leaveRecord = approvedLeave.find(item => item.start_date <= record.date && item.end_date >= record.date);
      const holiday = data.holidays.find(item => item.date === record.date && (item.branch_id === null || item.branch_id === person.branch_id));
      const status = record.status === "leave" ? (leaveRecord?.leave_type ?? "leave") : record.status === "holiday" ? "holiday" : record.status;
      return { date: record.date, shift: grace ? `${grace.start}–${grace.end}` : `Shift ${record.shift_number}`, checkIn: displayTime(record.check_in_at), checkOut: displayTime(record.check_out_at), status, late, deduction: dailyHours > 0 ? salary / Math.max(payableDays, 1) / dailyHours / 60 * late : 0, note: record.note ?? holiday?.name ?? leaveRecord?.reason ?? (record.source === "manual" ? "Manual entry" : "") };
    });
    for (const date of absentDates) rows.push({ date, shift: "All shifts", checkIn: "—", checkOut: "—", status: "unexcused absence", late: 0, deduction: dailySalary, note: "No attendance or approved leave recorded" });
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));
    return { salary, dailyHours, payableDays, lateMinutes, lateDeduction, absenceDeduction, absentDays: absentDates.length, net, rows, shifts };
  }, [data, person]);

  const summary = result && { salary: result.salary, lateDeduction: result.lateDeduction, absenceDeduction: result.absenceDeduction, net: result.net, lateMinutes: result.lateMinutes, absentDays: result.absentDays };
  return <>
    <PageHeading eyebrow="People & pay" title="Payroll" description="Review one employee’s monthly pay, late deductions, absences, and attendance evidence." action={<button type="button" onClick={() => void load()} className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">Refresh</button>} />
    {error && <div className="mb-5"><Notice error>{error}</Notice></div>}
    <Card className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="grid flex-1 gap-4 sm:grid-cols-2"><label className="text-xs font-medium text-neutral-600">Payroll month<input aria-label="Payroll month" type="month" value={month} onChange={event => setMonth(event.target.value)} className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm" /></label><label className="text-xs font-medium text-neutral-600">Staff member<select aria-label="Staff member" value={staffId} onChange={event => setStaffId(event.target.value)} disabled={!data?.staff.length} className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm"><option value="">Choose staff</option>{data?.staff.map(item => <option key={item.id} value={item.id}>{item.full_name} · {item.staff_code}</option>)}</select></label></div>{person && result && <div className="flex gap-2"><button onClick={() => summary && exportPdf(person, month, result.rows, summary)} className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800">Download PDF</button><button onClick={() => summary && exportExcel(person, month, result.rows, summary)} className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">Download Excel</button></div>}</Card>
    {loading ? <Card><Loading /></Card> : !data?.staff.length ? <Card className="py-14 text-center"><p className="font-semibold">No staff records</p><p className="mt-1 text-sm text-neutral-500">Create staff and add each person’s monthly salary and daily schedule to begin payroll.</p></Card> : person && result && summary ? <>
      <Card className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-neutral-400">Pay statement · {month}</p><h2 className="mt-1 text-xl font-semibold">{person.full_name}</h2><p className="mt-1 text-sm text-neutral-500">{person.staff_code} · {person.job_title} · {person.branches?.name ?? "Branch"}</p><p className="mt-3 text-xs text-neutral-500">Schedule: {result.shifts.map(shift => `${shift.start}–${shift.end}`).join("  ·  ")} ({amount(result.dailyHours)} scheduled hours/day)</p></div><div className="sm:text-right"><p className="text-xs text-neutral-500">Net salary</p><p className="mt-1 text-3xl font-semibold tabular-nums">{amount(result.net)}</p></div></Card>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Monthly salary" value={amount(result.salary)} detail={`${result.payableDays} scheduled workdays`} /><Metric label="Late time" value={`${result.lateMinutes} min`} detail="After 5-minute grace" /><Metric label="Late deductions" value={amount(result.lateDeduction)} detail={`${amount(result.dailyHours)} scheduled hours/day`} /><Metric label="Unexcused absences" value={`${result.absentDays} days`} detail={`Deduction ${amount(result.absenceDeduction)}`} /><Metric label="Estimated net pay" value={amount(result.net)} detail="Salary less attendance deductions" dark /></div>
      <Card className="mb-5"><h3 className="text-sm font-semibold">How this is calculated</h3><p className="mt-2 text-xs leading-5 text-neutral-600">Late deduction = monthly salary ÷ scheduled working days ÷ scheduled daily hours ÷ 60 × late minutes. Lateness begins after the first 5 minutes of each scheduled shift. Net salary = monthly salary − late deductions − (daily salary × unexcused absent workdays). Fridays and branch holidays are excluded. Future days and approved leave are not counted as absences.</p></Card>
      <Card className="min-w-0 p-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 p-5"><div><h3 className="text-sm font-semibold">Attendance and deduction history</h3><p className="mt-1 text-xs text-neutral-500">Every shift has its own check-in and check-out record.</p></div><span className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">{result.rows.length} entries</span></div>{result.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[870px] text-left text-xs"><thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400"><tr>{["Date", "Shift", "Check-in", "Check-out", "Status", "Late", "Deduction"].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{result.rows.map((row, index) => <tr key={`${row.date}-${row.shift}-${index}`} className="hover:bg-neutral-50/70"><td className="px-4 py-3.5 tabular-nums">{row.date}</td><td className="px-4 py-3.5 font-medium">{row.shift}</td><td className="px-4 py-3.5 tabular-nums">{row.checkIn}</td><td className="px-4 py-3.5 tabular-nums">{row.checkOut}</td><td className="px-4 py-3.5 capitalize">{row.status}</td><td className="px-4 py-3.5 tabular-nums">{row.late ? `${row.late} min` : "—"}</td><td className="px-4 py-3.5 font-semibold tabular-nums">{row.deduction ? amount(row.deduction) : "—"}{row.note && <p className="mt-1 max-w-56 truncate font-normal text-neutral-400" title={row.note}>{row.note}</p>}</td></tr>)}</tbody></table></div> : <div className="p-10 text-center text-sm text-neutral-500">No attendance or absence entries for this month yet.</div>}</Card>
    </> : null}
  </>;
}

function Metric({ label, value, detail, dark = false }: { label: string; value: string; detail: string; dark?: boolean }) {
  return <Card className={dark ? "bg-black text-white" : ""}><p className={`text-xs ${dark ? "text-white/60" : "text-neutral-500"}`}>{label}</p><p className="mt-2 truncate text-xl font-semibold tabular-nums">{value}</p><p className={`mt-1 text-[11px] ${dark ? "text-white/60" : "text-neutral-400"}`}>{detail}</p></Card>;
}
