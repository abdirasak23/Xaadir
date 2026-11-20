import { NextRequest, NextResponse } from "next/server";
import { getCompanyContext } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { callAdminFunction } from "@/lib/edge";
import { localDateInTimezone, TIMEZONE } from "../../../../shared/attendance-rules";

const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
function pageValue(value: string | null) { const page = Number(value ?? 1); return Number.isInteger(page) && page > 0 ? Math.min(page, 10000) : 1; }
type ScheduledShift = { start: string; end: string; day?: number };
function isScheduledShift(value: unknown): value is ScheduledShift {
  if (!value || typeof value !== "object") return false;
  const shift = value as Record<string, unknown>;
  return typeof shift.start === "string" && typeof shift.end === "string" && (shift.day === undefined || Number.isInteger(shift.day));
}

export async function GET(request: NextRequest) {
  const company = await getCompanyContext(); if (!company) return jsonError("Company login required.", 401);
  const db = getSupabaseAdmin(), params = request.nextUrl.searchParams, mode = params.get("mode") ?? "home", page = pageValue(params.get("page")), pageSize = mode === "home" ? 20 : 25, from = (page - 1) * pageSize, to = from + pageSize - 1;
  const followPage = pageValue(params.get("followup_page")), followFrom = (followPage - 1) * 25;
  if (mode === "picker") {
    const selectedId = params.get("staff_id");
    if (selectedId) {
      const { data, error } = await db.from("staff").select("id,full_name,staff_code,job_title,branch_id,branches(name)").eq("company_id", company.companyId).eq("id", selectedId).maybeSingle();
      if (error) return jsonError("Could not load selected staff member.", 500);
      return NextResponse.json({ staff: data ? [data] : [], page: 1, page_size: pageSize, total: data ? 1 : 0, has_more: false }, { headers: { "Cache-Control": "no-store" } });
    }
    const search = (params.get("q") ?? "").replace(/[%_,().*]/g, " ").trim().slice(0, 80);
    let q = db.from("staff").select("id,full_name,staff_code,job_title,branch_id,branches(name)", { count: "exact" }).eq("company_id", company.companyId).eq("status", "active").order("full_name");
    if (search) q = q.or(`full_name.ilike.%${search}%,staff_code.ilike.%${search}%`);
    const { data, error, count } = await q.range(from, to);
    if (error) return jsonError("Could not load staff list.", 500);
    return NextResponse.json({ staff: data ?? [], page, page_size: pageSize, total: count ?? 0, has_more: (count ?? 0) > to + 1 }, { headers: { "Cache-Control": "no-store" } });
  }
  if (mode === "history") {
    const noteId = params.get("note_id"); if (!noteId) return jsonError("Note ID is required.");
    const { data: note } = await db.from("hr_notes").select("id").eq("id", noteId).eq("company_id", company.companyId).maybeSingle();
    if (!note) return jsonError("Note not found.", 404);
    const { data, error } = await db.from("hr_note_versions").select("id,title,type,body,edited_by,edited_at").eq("note_id", note.id).order("edited_at", { ascending: false }).range(from, to);
    if (error) return jsonError("Could not load note history.", 500);
    return NextResponse.json({ versions: data ?? [], page, has_more: (data ?? []).length === 25 }, { headers: { "Cache-Control": "no-store" } });
  }
  if (mode === "note") {
    const noteId = params.get("note_id"); if (!noteId) return jsonError("Note ID is required.");
    const { data, error } = await db.from("hr_notes").select("id,staff_id,note_date,note_time,type,title,body,status,follow_up_date,visibility,locked,author,updated_at,created_at,hr_note_files(id,file_name,size_bytes,created_at),hr_note_links(attendance_id,attendance(id,date,shift_number,status,check_in_at,check_out_at,late_minutes))").eq("id", noteId).eq("company_id", company.companyId).is("deleted_at", null).maybeSingle();
    if (error || !data) return jsonError("Note not found.", 404);
    return NextResponse.json({ note: data }, { headers: { "Cache-Control": "no-store" } });
  }
  if (mode === "attendance") {
    const staffId = params.get("staff_id"); if (!staffId) return jsonError("Staff ID is required.");
    const { data: person } = await db.from("staff").select("id,shift_start,shift_end,scheduled_shifts").eq("id", staffId).eq("company_id", company.companyId).maybeSingle();
    if (!person) return jsonError("Staff member not found.", 404);
    const end = params.get("to") ?? localDateInTimezone(new Date(), TIMEZONE), startDate = new Date(`${end}T00:00:00Z`); startDate.setUTCDate(startDate.getUTCDate() - 30); const start = params.get("from") ?? startDate.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start || (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000 > 366) return jsonError("Choose a valid attendance range.");
    const { data, error } = await db.from("attendance").select("id,date,shift_number,status,check_in_at,check_out_at,late_minutes,note").eq("staff_id", staffId).gte("date", start).lte("date", end).order("date", { ascending: false }).order("shift_number");
    if (error) return jsonError("Could not load attendance entries.", 500);
    const configured: ScheduledShift[] = Array.isArray(person.scheduled_shifts) ? person.scheduled_shifts.filter(isScheduledShift) : [];
    const weekly = configured.some(shift => Number.isInteger(shift.day));
    const attendance = (data ?? []).map(row => {
      const day = new Date(`${row.date}T00:00:00Z`).getUTCDay();
      const shifts = configured.filter(shift => !weekly || shift.day === day);
      const schedule = shifts[(row.shift_number ?? 1) - 1] ?? (!configured.length ? { start: person.shift_start, end: person.shift_end } : null);
      const endMinute = schedule?.end ? Number(schedule.end.slice(0, 2)) * 60 + Number(schedule.end.slice(3, 5)) : null;
      const stamp = row.check_out_at ? Date.parse(row.check_out_at) : NaN;
      const local = Number.isNaN(stamp) ? null : new Date(stamp + 180 * 60_000);
      const checkOutMinute = local ? local.getUTCHours() * 60 + local.getUTCMinutes() : null;
      return { ...row, early_checkout: endMinute !== null && checkOutMinute !== null && checkOutMinute < endMinute };
    });
    return NextResponse.json({ attendance }, { headers: { "Cache-Control": "no-store" } });
  }
  if (mode === "reports") {
    const { data, error } = await db.from("report_exports").select("id,exported_by,scope,staff_ids,date_from,date_to,include_notes,created_at").eq("company_id", company.companyId).order("created_at", { ascending: false }).range(from, to);
    if (error) return jsonError("Could not load export history.", 500);
    return NextResponse.json({ exports: data ?? [], page, has_more: (data ?? []).length === 25 }, { headers: { "Cache-Control": "no-store" } });
  }
  if (mode === "staff") {
    const staffId = params.get("staff_id"); if (!staffId) return jsonError("Staff ID is required.");
    const { data: staff, error: staffError } = await db.from("staff").select("id,full_name,staff_code,job_title,branch_id,shift_start,shift_end,scheduled_shifts,branches(name)").eq("company_id", company.companyId).eq("id", staffId).maybeSingle();
    if (staffError || !staff) return jsonError("Staff member not found.", 404);
    const start = params.get("from") ?? "1900-01-01", end = params.get("to") ?? localDateInTimezone(new Date(), TIMEZONE);
    let q = db.from("hr_notes").select("id,note_date,note_time,type,title,body,status,follow_up_date,visibility,locked,author,updated_at,created_at,hr_note_files(id,file_name,size_bytes,created_at),hr_note_links(attendance_id,attendance(id,date,shift_number,status,check_in_at,check_out_at,late_minutes))", { count: "exact" }).eq("company_id", company.companyId).eq("staff_id", staff.id).is("deleted_at", null).gte("note_date", start).lte("note_date", end).order("note_date", { ascending: false }).order("created_at", { ascending: false });
    const type = params.get("type"), status = params.get("status"); if (type) q = q.eq("type", type); if (status) q = q.eq("status", status);
    const [notesRes, statsRes] = await Promise.all([q.range(from, to), db.from("hr_notes").select("id,type,status,follow_up_date").eq("company_id", company.companyId).eq("staff_id", staff.id).is("deleted_at", null).gte("note_date", start).lte("note_date", end)]);
    if (notesRes.error || statsRes.error) return jsonError("Could not load staff timeline.", 500);
    const stats = statsRes.data ?? [], today = localDateInTimezone(new Date(), TIMEZONE);
    return NextResponse.json({ staff, notes: notesRes.data ?? [], total: notesRes.count ?? 0, page, has_more: (notesRes.count ?? 0) > to + 1, summary: { warnings: stats.filter(x => x.type === "warning").length, last_chances: stats.filter(x => x.type === "last_chance").length, follow_ups: stats.filter(x => x.status === "open" && x.follow_up_date && x.follow_up_date <= today).length } }, { headers: { "Cache-Control": "no-store" } });
  }
  if (mode !== "home") return jsonError("Unknown HR Notes view.");
  const today = localDateInTimezone(new Date(), TIMEZONE);
  const staffSearch = (params.get("q") ?? "").replace(/[%_,().*]/g, " ").trim().slice(0, 80), type = params.get("type"), status = params.get("status"), branchId = params.get("branch_id"), dateFrom = params.get("from"), dateTo = params.get("to");
  let notesQuery = db.from("hr_notes").select("id,staff_id,note_date,note_time,type,title,body,status,follow_up_date,visibility,locked,author,updated_at,created_at,staff!inner(id,full_name,staff_code,job_title,branch_id,branches(name))", { count: "exact" }).eq("company_id", company.companyId).is("deleted_at", null).order("note_date", { ascending: false }).order("created_at", { ascending: false });
  if (type) notesQuery = notesQuery.eq("type", type); if (status) notesQuery = notesQuery.eq("status", status); if (dateFrom) notesQuery = notesQuery.gte("note_date", dateFrom); if (dateTo) notesQuery = notesQuery.lte("note_date", dateTo);
  if (branchId) notesQuery = notesQuery.eq("staff.branch_id", branchId);
  if (staffSearch) {
    const { data: matched } = await db.from("staff").select("id").eq("company_id", company.companyId).or(`full_name.ilike.%${staffSearch}%,staff_code.ilike.%${staffSearch}%`).limit(100);
    const ids = (matched ?? []).map(item => item.id);
    if (!ids.length) {
      const { data: branches } = await db.from("branches").select("id,name").eq("company_id", company.companyId).order("name");
      return NextResponse.json({ today, notes: [], total: 0, followups: [], followups_total: 0, followups_has_more: false, branches: branches ?? [], page, page_size: pageSize, has_more: false }, { headers: { "Cache-Control": "no-store" } });
    }
    notesQuery = notesQuery.in("staff_id", ids);
  }
  const [{ data: notes, error, count }, { data: followups, error: followError, count: followCount }, { data: branches, error: branchError }] = await Promise.all([
    notesQuery.range(from, to),
    db.from("hr_notes").select("id,staff_id,note_date,type,title,body,status,follow_up_date,author,locked,staff!inner(id,full_name,staff_code,branch_id,branches(name))", { count: "exact" }).eq("company_id", company.companyId).eq("status", "open").is("deleted_at", null).not("follow_up_date", "is", null).lte("follow_up_date", today).order("follow_up_date").range(followFrom, followFrom + 24),
    db.from("branches").select("id,name").eq("company_id", company.companyId).order("name"),
  ]);
  if (error || followError || branchError) return jsonError("Could not load HR notes.", 500);
  return NextResponse.json({ today, notes: notes ?? [], total: count ?? 0, followups: followups ?? [], followups_total: followCount ?? 0, followups_has_more: (followCount ?? 0) > followFrom + 25, branches: branches ?? [], page, page_size: pageSize, has_more: (count ?? 0) > to + 1 }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const company = await getCompanyContext(); if (!company) return jsonError("Company login required.", 401);
  const body = await request.json().catch(() => null); if (!body || typeof body !== "object" || typeof body.action !== "string") return jsonError("Invalid request.");
  const actor = company.email?.trim().toLowerCase() || company.fullName;
  try {
    if (body.action === "report") {
      const reportBody = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "action"));
      const result = await callAdminFunction("report-data", { ...reportBody, company_id: company.companyId, actor, record_export: false });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "save") { const noteBody = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "action")); return NextResponse.json(await callAdminFunction("note-save", { ...noteBody, company_id: company.companyId, actor }), { status: body.id ? 200 : 201 }); }
    if (body.action === "delete") return NextResponse.json(await callAdminFunction("note-delete", { note_id: body.note_id, company_id: company.companyId, actor }));
    if (body.action === "lock") return NextResponse.json(await callAdminFunction("note-lock", { note_id: body.note_id, company_id: company.companyId, actor }));
    if (body.action === "link") return NextResponse.json(await callAdminFunction("note-link", { company_id: company.companyId, actor, note_id: body.note_id, attendance_id: body.attendance_id, action: body.operation }));
    if (body.action === "file-sign") {
      if (body.operation === "upload") return NextResponse.json(await callAdminFunction("note-file-sign", { company_id: company.companyId, actor, action: "upload", note_id: body.note_id, file_name: body.file_name, mime_type: body.mime_type, size_bytes: body.size_bytes }));
      if (body.operation === "download") return NextResponse.json(await callAdminFunction("note-file-sign", { company_id: company.companyId, actor, action: "download", file_id: body.file_id }));
      return jsonError("Choose upload or download.");
    }
    if (body.action === "resolve") {
      const { data: note } = await getSupabaseAdmin().from("hr_notes").select("id,staff_id,author,note_date,note_time,type,title,body,follow_up_date,visibility,locked").eq("id", body.note_id).eq("company_id", company.companyId).is("deleted_at", null).maybeSingle();
      if (!note) return jsonError("Note not found.", 404);
      return NextResponse.json(await callAdminFunction("note-save", { ...note, status: "resolved", company_id: company.companyId, actor, override_owner: note.locked && body.override_owner === true && note.author === actor }));
    }
    return jsonError("Unknown HR Notes action.");
  } catch (error) { return jsonError(error instanceof Error ? error.message : "HR Notes request failed."); }
}
