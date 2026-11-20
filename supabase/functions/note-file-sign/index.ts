import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("upload"), company_id: z.string().uuid(), actor: z.string().trim().min(1).max(120), note_id: z.string().uuid(), file_name: z.string().trim().min(1).max(180), mime_type: z.enum(["image/jpeg","image/png","application/pdf"]), size_bytes: z.number().int().min(1).max(5 * 1024 * 1024) }),
  z.object({ action: z.literal("download"), company_id: z.string().uuid(), actor: z.string().trim().min(1).max(120), file_id: z.string().uuid() }),
]);
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!secret || request.headers.get("x-admin-secret") !== secret) return respond({ error: "Unauthorized." }, 401);
  const p = schema.safeParse(await request.json().catch(() => null));
  if (!p.success) return respond({ error: "Invalid file request." }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  if (p.data.action === "upload") {
    const { data: note } = await db.from("hr_notes").select("id,staff_id").eq("id", p.data.note_id).eq("company_id", p.data.company_id).is("deleted_at", null).maybeSingle();
    if (!note) return respond({ error: "Note not found." }, 404);
    const ext = p.data.mime_type === "image/jpeg" ? "jpg" : p.data.mime_type === "image/png" ? "png" : "pdf";
    const path = `${p.data.company_id}/${note.id}/${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await db.storage.from("hr-notes").createSignedUploadUrl(path, { upsert: false });
    if (error || !signed) return respond({ error: "Could not prepare private upload." }, 500);
    const { data: file, error: fileError } = await db.from("hr_note_files").insert({ note_id: note.id, storage_path: path, file_name: p.data.file_name, size_bytes: p.data.size_bytes }).select("id,file_name,size_bytes,created_at,storage_path").single();
    if (fileError) return respond({ error: "Could not register attachment." }, 500);
    const { error: auditError } = await db.from("audit_log").insert({ actor: `hr:${p.data.actor}`, action: "note.file_upload_prepared", target: note.staff_id });
    if (auditError) return respond({ error: "Upload prepared, but its audit event could not be recorded." }, 500);
    return respond({ file, path: signed.path, token: signed.token });
  }
  const { data: file } = await db.from("hr_note_files").select("id,note_id,file_name,storage_path,hr_notes!inner(company_id,staff_id)").eq("id", p.data.file_id).eq("hr_notes.company_id", p.data.company_id).maybeSingle();
  if (!file) return respond({ error: "Attachment not found." }, 404);
  const { data: signed, error } = await db.storage.from("hr-notes").createSignedUrl(file.storage_path, 300);
  if (error || !signed) return respond({ error: "Could not sign attachment." }, 500);
  const relation = Array.isArray(file.hr_notes) ? file.hr_notes[0] : file.hr_notes;
  const { error: auditError } = await db.from("audit_log").insert({ actor: `hr:${p.data.actor}`, action: "note.file_download", target: relation?.staff_id ?? file.note_id });
  if (auditError) return respond({ error: "Could not record attachment access." }, 500);
  return respond({ url: signed.signedUrl, file_name: file.file_name, expires_in: 300 });
});
