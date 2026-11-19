"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Loading, Notice, PageHeading } from "@/components/ui";

type Shift = { start: string; end: string; day?: number };
type Staff = {
  id: string;
  full_name: string;
  staff_code: string;
  job_title: string;
  department?: string | null;
  status: string;
  branch_id: string;
  scheduled_shifts?: Shift[] | null;
  shift_start?: string;
  shift_end?: string;
  branches?: { name: string } | null;
};

const weekdays = ["Sabti", "Axad", "Isniin", "Talaado", "Arbaco", "Khamiis", "Jimco"];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Mogadishu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ymd = (date: Date) => date.toISOString().slice(0, 10);
function saturdayOf(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 1) % 7));
  return ymd(date);
}
function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return ymd(date);
}
function prettyDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
function shiftsForDate(staff: Staff, date: string): Shift[] {
  const shifts = Array.isArray(staff.scheduled_shifts) ? staff.scheduled_shifts : [];
  if (shifts.some(shift => shift.day !== undefined)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return shifts.filter(shift => shift.day === weekday);
  }
  if (shifts.length) return shifts;
  return staff.shift_start && staff.shift_end ? [{ start: staff.shift_start, end: staff.shift_end }] : [];
}
function clock(value: string) {
  const [hourPart, minutePart] = value.slice(0, 5).split(":");
  const hour = Number(hourPart);
  if (!Number.isInteger(hour) || !Number.isInteger(Number(minutePart))) return value;
  return `${hour % 12 || 12}:${minutePart} ${hour < 12 ? "AM" : "PM"}`;
}
function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function ScheduleManager() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [department, setDepartment] = useState("all");
  const [search, setSearch] = useState("");
  const [weekStart, setWeekStart] = useState(() => saturdayOf(today()));

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch("/api/staff", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load staff schedules.");
        if (active) {
          setStaff((Array.isArray(body) ? body : []).filter((person: Staff) => person.status === "active"));
          setError("");
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load staff schedules.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const departments = useMemo(() => [...new Set(staff.map(person => person.department?.trim() || "Unassigned"))].sort((a, b) => a.localeCompare(b)), [staff]);
  const filteredStaff = useMemo(() => staff.filter(person => {
    const name = person.department?.trim() || "Unassigned";
    const matchesDepartment = department === "all" || name === department;
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query || [person.full_name, person.staff_code, person.job_title, name].some(value => value.toLocaleLowerCase().includes(query));
    return matchesDepartment && matchesSearch;
  }).sort((a, b) => a.full_name.localeCompare(b.full_name)), [staff, department, search]);

  const weekDates = useMemo(() => weekdays.map((_, index) => addDays(weekStart, index)), [weekStart]);
  const firstYear = new Date(`${weekDates[0]}T00:00:00Z`).getUTCFullYear();
  const lastYear = new Date(`${weekDates[6]}T00:00:00Z`).getUTCFullYear();
  const weekTitle = firstYear === lastYear
    ? `${prettyDate(weekDates[0])} – ${prettyDate(weekDates[6])}, ${firstYear}`
    : `${prettyDate(weekDates[0])}, ${firstYear} – ${prettyDate(weekDates[6])}, ${lastYear}`;
  const totalShifts = filteredStaff.reduce((total, person) => total + weekDates.reduce((count, date) => count + shiftsForDate(person, date).length, 0), 0);
  const workingStaff = filteredStaff.filter(person => weekDates.some(date => shiftsForDate(person, date).length > 0)).length;

  function exportDepartmentPdf() {
    if (!filteredStaff.length) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("Allow pop-ups to open the schedule PDF preview.");
      return;
    }
    const title = department === "all" ? "All departments" : department;
    const rows = filteredStaff.map(person => {
      const weekCells = weekDates.map(date => {
        const shifts = shiftsForDate(person, date);
        const contents = shifts.length
          ? shifts.map(shift => `<div class="time-chip">${escapeHtml(clock(shift.start))}<span class="arrow">–</span>${escapeHtml(clock(shift.end))}</div>`).join("")
          : '<span class="off">Fasax</span>';
        return `<td>${contents}</td>`;
      }).join("");
      return `<tr><td class="person"><b>${escapeHtml(person.full_name)}</b><span>${escapeHtml(person.staff_code)} · ${escapeHtml(person.job_title)}</span><small>${escapeHtml(person.branches?.name ?? "")}</small></td>${weekCells}</tr>`;
    }).join("");
    const logoBase = `${window.location.origin}/images/`;
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Xaadir · ${escapeHtml(title)} · ${escapeHtml(weekTitle)}</title><style>
      @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#171717;margin:0;background:#fff}.brand{display:flex;align-items:center;justify-content:center;gap:14px;padding:2px 0 11px;border-bottom:1px solid #e5e7eb}.brand img{max-width:175px;max-height:45px;object-fit:contain}.cross{font-size:20px;font-weight:700;color:#9ca3af}.heading{display:flex;justify-content:space-between;align-items:end;margin:15px 0 11px}.eyebrow{font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#6b7280;font-weight:700}.heading h1{font-size:22px;margin:5px 0 4px;letter-spacing:-.4px}.heading p{font-size:10px;color:#6b7280;margin:0}.summary{font-size:9px;color:#4b5563;text-align:right;background:#f3f4f6;border-radius:8px;padding:8px 11px}table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;border:1px solid #e5e7eb;border-radius:9px;overflow:hidden}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th{font-size:8px;text-align:left;background:#111827;color:#fff;padding:9px 6px;border-right:1px solid #374151}th:last-child{border-right:0}td{vertical-align:top;padding:8px 5px;border-top:1px solid #e5e7eb;border-right:1px solid #e5e7eb;font-size:8px;min-height:48px}td:last-child{border-right:0}tbody tr:nth-child(even){background:#f9fafb}th:first-child,td:first-child{width:19%}.person b,.person span,.person small{display:block}.person b{font-size:9px;line-height:1.3}.person span,.person small{color:#6b7280;margin-top:4px;font-size:7px}.time-chip{background:#eef2ff;border:1px solid #e0e7ff;color:#1f2937;border-radius:5px;padding:5px 4px;margin:0 0 4px;text-align:center;font-size:8px;font-weight:700;white-space:nowrap}.time-chip .arrow{padding:0 3px;color:#9ca3af}.off{display:inline-block;color:#9ca3af;background:#f3f4f6;border-radius:20px;padding:4px 7px;font-size:7px}.footer{margin-top:9px;padding-top:6px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#9ca3af;font-size:7px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body><header class="brand"><img src="${logoBase}xaadirlogo.png" alt="Xaadir"><span class="cross">×</span><img src="${logoBase}hospitallogo.png" alt="Hospital"></header><div class="heading"><div><div class="eyebrow">Jadwalka toddobaadka</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(weekTitle)}</p></div><div class="summary">${filteredStaff.length} shaqaale&nbsp;&nbsp; · &nbsp;&nbsp;${totalShifts} waqti-shaqo</div></div><table><thead><tr><th>Shaqaalaha</th>${weekdays.map(day => `<th>${day}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table><div class="footer"><span>Xaadir · Jadwalka shaqaalaha</span><span>La sameeyay ${escapeHtml(today())}</span></div><script>window.addEventListener('load',()=>Promise.all(Array.from(document.images).map(image=>image.decode().catch(()=>{}))).then(()=>window.print()));</script></body></html>`);
    printWindow.document.close();
  }

  return <>
    <PageHeading eyebrow="People & planning" title="Weekly schedule" description="Review every department’s shift plan for the week, including each staff member’s day-specific shifts." action={<button type="button" onClick={exportDepartmentPdf} disabled={loading || filteredStaff.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"><span aria-hidden="true">↓</span>Export department PDF</button>} />
    {error && <div className="mb-5"><Notice error>{error}</Notice></div>}
    <Card className="mb-5 p-4 sm:p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-neutral-400">Schedule period</p><h2 className="mt-1 text-lg font-semibold">{weekTitle}</h2></div>
          <div className="flex items-center gap-2"><button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week" className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-lg hover:bg-neutral-50">‹</button><button type="button" onClick={() => setWeekStart(saturdayOf(today()))} className="h-10 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold hover:bg-neutral-50">This week</button><button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week" className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-lg hover:bg-neutral-50">›</button></div>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Schedule departments">
          <button type="button" role="tab" aria-selected={department === "all"} onClick={() => setDepartment("all")} className={`rounded-full px-4 py-2 text-xs font-semibold transition ${department === "all" ? "bg-black text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>All departments <span className="ml-1 opacity-70">{staff.length}</span></button>
          {departments.map(name => <button key={name} type="button" role="tab" aria-selected={department === name} onClick={() => setDepartment(name)} className={`rounded-full px-4 py-2 text-xs font-semibold transition ${department === name ? "bg-black text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>{name} <span className="ml-1 opacity-70">{staff.filter(person => (person.department?.trim() || "Unassigned") === name).length}</span></button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center"><label className="block"><span className="sr-only">Search this schedule</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search staff by name, code, or role" className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black focus:ring-2 focus:ring-black/10" /></label><p className="text-xs text-neutral-500">{filteredStaff.length} staff · {workingStaff} scheduled this week · {totalShifts} shifts</p></div>
      </div>
    </Card>
    {loading ? <Card><Loading text="Loading staff schedules…" /></Card> : filteredStaff.length === 0 ? <Card className="py-14 text-center"><p className="font-semibold">No staff in this view</p><p className="mt-1 text-sm text-neutral-500">Add staff to this department or change your search.</p></Card> : <Card className="min-w-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 p-5"><div><h2 className="font-semibold">{department === "all" ? "Company schedule" : `${department} schedule`}</h2><p className="mt-1 text-xs text-neutral-500">Shifts are displayed under the day they are scheduled. Staff may have several shifts on one day.</p></div><button type="button" onClick={exportDepartmentPdf} className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-semibold hover:bg-neutral-50">Export this view as PDF</button></div>
      <div className="overflow-x-auto">
        <div className="min-w-[1000px]">
          <div className="grid grid-cols-[220px_repeat(7,minmax(110px,1fr))] border-b border-neutral-100 bg-neutral-50/80">
            <div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Staff member</div>
            {weekDates.map((date, index) => <div key={date} className={`border-l border-neutral-100 px-3 py-3 ${date === today() ? "bg-neutral-100/70" : ""}`}><p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{weekdays[index]}</p><p className="mt-1 text-xs font-semibold text-neutral-800">{prettyDate(date)}</p></div>)}
          </div>
          {filteredStaff.map(person => <div key={person.id} className="grid grid-cols-[220px_repeat(7,minmax(110px,1fr))] border-b border-neutral-100 last:border-0">
            <div className="px-4 py-4"><p className="text-sm font-semibold text-neutral-900">{person.full_name}</p><p className="mt-1 text-[10px] text-neutral-500">{person.staff_code} · {person.job_title}</p><p className="mt-1 text-[10px] text-neutral-400">{person.branches?.name ?? "Branch not set"}</p></div>
            {weekDates.map(date => {
              const shifts = shiftsForDate(person, date);
              return <div key={date} className={`min-h-[82px] border-l border-neutral-100 p-2.5 ${date === today() ? "bg-neutral-50/70" : ""}`}>
                {shifts.length ? <div className="space-y-1.5">{shifts.map((shift, shiftIndex) => <div key={`${shift.start}-${shift.end}-${shiftIndex}`} className="rounded-lg border border-neutral-200 bg-white px-2 py-2 shadow-sm"><p className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-neutral-900">{clock(shift.start)} – {clock(shift.end)}</p></div>)}</div> : <span className="inline-flex rounded-full bg-neutral-100 px-2.5 py-1.5 text-[10px] font-medium text-neutral-400">Fasax</span>}
              </div>;
            })}
          </div>)}
        </div>
      </div>
    </Card>}
    <p className="mt-4 text-center text-[10px] text-neutral-400">Schedules reflect each active staff profile. To change a shift, edit the staff member in Team Directory.</p>
  </>;
}
