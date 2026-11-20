import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { getCompanyContext } from "@/lib/company-auth";
import { callAdminFunction } from "@/lib/edge";

export const runtime = "nodejs";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({ scope: z.enum(["staff","day","all"]), staff_ids: z.array(z.string().uuid()).max(1000).default([]), date_from: date, date_to: date, include_notes: z.boolean().default(true), include_attendance: z.boolean().default(true), note_type: z.enum(["conversation","promise","warning","last_chance","praise","lateness","absence","other"]).optional() });
type ReportStaff = { id: string; full_name: string; staff_code: string; job_title: string | null; branches: { name: string } | null };
type AttendanceSummary = { days_present: number; late_count: number; late_minutes: number; absent_days: number; leave_days: number; sick_days: number; early_leave_minutes: number; missing_checkouts: number };
type ReportStaffItem = { staff: ReportStaff; attendance_summary: AttendanceSummary | null; note_count: number };
type ReportNote = { id: string; staff_id: string; note_date: string; note_time: string | null; type: string; title: string | null; body: string; status: string; locked: boolean };
type Report = { scope: string; date_from: string; date_to: string; total_staff: number; has_more: boolean; staff: ReportStaffItem[]; notes: ReportNote[]; notes_total: number; notes_has_more: boolean };
const safe = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[–—]/g, "-").replace(/·/g, "-").replace(/[’‘]/g, "'").replace(/…/g, "...").replace(/[^\x20-\x7e]/g, "?");
const wrap = (value: unknown, max = 88) => { const words = String(value ?? "").split(/\s+/); const lines: string[] = []; let line = ""; for (const word of words) { if (line && `${line} ${word}`.length > max) { lines.push(line); line = word.slice(0, max); } else line = line ? `${line} ${word}` : word.slice(0, max); } if (line || !lines.length) lines.push(line); return lines; };
async function makePdf(pageLines: string[][]) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const total = pageLines.length;
  for (const [index, lines] of pageLines.entries()) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText("XAADIR  /  HR NOTES & REPORTS", { x: 42, y: 805, size: 9, font: bold, color: rgb(0.16, 0.25, 0.34) });
    page.drawLine({ start: { x: 42, y: 792 }, end: { x: 553, y: 792 }, thickness: 0.7, color: rgb(0.86, 0.89, 0.92) });
    const content = lines.slice(0, 55);
    content.forEach((line, lineIndex) => {
      page.drawText(safe(line), { x: 42, y: 773 - lineIndex * 13, size: lineIndex < 6 ? 9 : 8.5, font: lineIndex < 6 ? bold : regular, color: rgb(0.16, 0.18, 0.21), maxWidth: 510 });
    });
    page.drawLine({ start: { x: 42, y: 36 }, end: { x: 553, y: 36 }, thickness: 0.7, color: rgb(0.86, 0.89, 0.92) });
    page.drawText("Confidential - HR use only", { x: 42, y: 22, size: 8, font: regular, color: rgb(0.42, 0.46, 0.5) });
    page.drawText(`Page ${index + 1} of ${total}`, { x: 480, y: 22, size: 8, font: regular, color: rgb(0.42, 0.46, 0.5) });
  }
  return pdf.save();
}

export async function POST(request: NextRequest) {
  const company = await getCompanyContext(); if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid report options." }, { status: 400 });
  const input = parsed.data;
  if (input.date_to < input.date_from || (new Date(`${input.date_to}T00:00:00Z`).getTime() - new Date(`${input.date_from}T00:00:00Z`).getTime()) / 86400000 > 365) return NextResponse.json({ error: "Choose a valid date range of no more than 366 days." }, { status: 400 });
  if (input.scope === "day" && input.date_from !== input.date_to) return NextResponse.json({ error: "A single-day report must use one date." }, { status: 400 });
  if (input.scope === "staff" && input.staff_ids.length === 0) return NextResponse.json({ error: "Select staff for this report." }, { status: 400 });
  const allStaff: ReportStaffItem[] = [], allNotes: ReportNote[] = [];
  try {
    for (let page = 1; page <= 100; page++) {
      const result = await callAdminFunction<Report>("report-data", { ...input, company_id: company.companyId, actor: company.fullName || company.email, page, notes_page: 1, record_export: false });
      allStaff.push(...result.staff);
      allNotes.push(...result.notes);
      for (let notesPage = 2; input.include_notes && result.notes_has_more && notesPage <= 1000; notesPage++) {
        const notePage = await callAdminFunction<Report>("report-data", { ...input, company_id: company.companyId, actor: company.fullName || company.email, page, notes_page: notesPage, record_export: false });
        allNotes.push(...notePage.notes);
        if (!notePage.notes_has_more) break;
        if (notesPage === 1000) throw new Error("This report contains too many notes to export at once. Narrow the date range.");
      }
      if (!result.has_more) break;
      if (page === 100) throw new Error("This report is too large to export at once. Narrow the staff or date selection.");
    }
    // Record one export only after the report data is assembled successfully.
    await callAdminFunction("report-data", { ...input, company_id: company.companyId, actor: company.fullName || company.email, page: 1, notes_page: 1, record_export: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare report." }, { status: 400 }); }
  const staffById = new Map(allStaff.map(item => [item.staff.id, item.staff]));
  const notesByStaff = new Map<string, ReportNote[]>(); for (const note of allNotes) notesByStaff.set(note.staff_id, [...(notesByStaff.get(note.staff_id) ?? []), note]);
  const dateParts = new Intl.DateTimeFormat("en", { timeZone: "Africa/Mogadishu", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${dateParts.find(part => part.type === "year")?.value}-${dateParts.find(part => part.type === "month")?.value}-${dateParts.find(part => part.type === "day")?.value}`;
  const heading = (title: string) => [`Company: ${company.companyName}`, `Report: ${title}`, `Date range: ${input.date_from} to ${input.date_to}`, `Generated: ${today}`, `Generated by: ${company.fullName || company.email}`, "------------------------------------------------------------------------"];
  const pages: string[][] = [];
  if (input.scope === "day") {
    const notes = allNotes.slice().sort((a,b) => (staffById.get(a.staff_id)?.full_name ?? "").localeCompare(staffById.get(b.staff_id)?.full_name ?? "") || a.note_date.localeCompare(b.note_date));
    const lines = [...heading("Single day HR report"), `Notes on ${input.date_from}: ${notes.length}`, ""];
    let previousStaff = "";
    for (const note of notes) { const person = staffById.get(note.staff_id); if (person?.id !== previousStaff) { previousStaff = person?.id ?? ""; lines.push(`${person?.full_name ?? "Staff"} (${person?.staff_code ?? ""})`); } lines.push(`${note.type.toUpperCase()} - ${note.note_time ?? ""}${note.title ? ` - ${note.title}` : ""}`); lines.push(...wrap(note.body), ""); }
    for (let i=0;i<lines.length;i+=53) pages.push(lines.slice(i,i+53));
    if (!pages.length) pages.push(heading("Single day HR report").concat("No notes for this date."));
  } else if (input.scope === "all" || allStaff.length > 1) {
    const cover = [...heading(input.scope === "all" ? "All staff HR report" : "Selected staff HR report"), `Staff included: ${allStaff.length}`, "", "STAFF SUMMARY", "STAFF                         PRESENT LATE ABSENT LEAVE SICK WARNINGS LAST CHANCES"];
    for (const item of allStaff) { const s=item.staff,a=item.attendance_summary; const count=(id:string,type:string)=>notesByStaff.get(id)?.filter(n=>n.type===type).length??0; cover.push(`${`${s.full_name} / ${s.staff_code}`.slice(0,28).padEnd(29)} ${String(a?.days_present??"-").padStart(7)} ${String(a?.late_count??"-").padStart(4)} ${String(a?.absent_days??"-").padStart(6)} ${String(a?.leave_days??"-").padStart(5)} ${String(a?.sick_days??"-").padStart(4)} ${String(count(s.id,"warning")).padStart(8)} ${String(count(s.id,"last_chance")).padStart(12)}`); }
    for (let i=0;i<cover.length;i+=53) pages.push(cover.slice(i,i+53));
    for (const item of allStaff) { const s=item.staff, lines=[...heading("Staff report"), `${s.full_name} (${s.staff_code})`, `${s.job_title ?? ""} · ${s.branches?.name ?? "No branch"}`, ""];
      if (input.include_attendance && item.attendance_summary) { const a=item.attendance_summary; lines.push("ATTENDANCE SUMMARY", `Present days: ${a.days_present}   Late shifts: ${a.late_count}   Late minutes: ${a.late_minutes}`, `Absent days: ${a.absent_days}   Leave days: ${a.leave_days}   Sick days: ${a.sick_days}`, `Early leave minutes: ${a.early_leave_minutes}   Missing checkouts: ${a.missing_checkouts}`, ""); }
      const notes=(notesByStaff.get(s.id)??[]).slice().sort((a,b)=>a.note_date.localeCompare(b.note_date)); lines.push(`HR NOTES (${notes.length})`); for(const note of notes){lines.push(`${note.note_date}${note.note_time?` ${note.note_time}`:""} · ${note.type.toUpperCase()} · ${note.status.toUpperCase()}${note.locked?" · LOCKED":""}`); if(note.title)lines.push(`Title: ${note.title}`);lines.push(...wrap(note.body),"");}
      for(let i=0;i<lines.length;i+=53) pages.push(lines.slice(i,i+53)); if(!lines.length)pages.push(heading("Staff report"));
    }
  } else {
    const item=allStaff[0], s=item?.staff;
    const lines=[...heading("Staff HR report"), `${s?.full_name??"Staff"} (${s?.staff_code??""})`, `${s?.job_title??""} · ${s?.branches?.name??"No branch"}`, ""];
    if(input.include_attendance&&item?.attendance_summary){const a=item.attendance_summary;lines.push("ATTENDANCE SUMMARY",`Present days: ${a.days_present}   Late shifts: ${a.late_count}   Late minutes: ${a.late_minutes}`,`Absent days: ${a.absent_days}   Leave days: ${a.leave_days}   Sick days: ${a.sick_days}`,`Early leave minutes: ${a.early_leave_minutes}   Missing checkouts: ${a.missing_checkouts}`,"");}
    const notes=(notesByStaff.get(s?.id)??[]).slice().sort((a,b)=>a.note_date.localeCompare(b.note_date));lines.push(`HR NOTES (${notes.length})`);for(const note of notes){lines.push(`${note.note_date}${note.note_time?` ${note.note_time}`:""} · ${note.type.toUpperCase()} · ${note.status.toUpperCase()}${note.locked?" · LOCKED":""}`);if(note.title)lines.push(`Title: ${note.title}`);lines.push(...wrap(note.body),"");}
    for(let i=0;i<lines.length;i+=53)pages.push(lines.slice(i,i+53));
  }
  const bytes=await makePdf(pages.length?pages:[heading("HR report")]);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const filename=`xaadir-hr-${input.scope}-${input.date_from}-${input.date_to}.pdf`;
  return new NextResponse(body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
