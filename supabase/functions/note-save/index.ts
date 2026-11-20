import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const schema = z.object({ company_id: z.string().uuid(), actor: z.string().trim().min(1).max(120), id: z.string().uuid().optional(), staff_id: z.string().uuid(), note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), type: z.enum(["conversation","promise","warning","last_chance","praise","lateness","absence","other"]), title: z.string().trim().max(200).nullable().optional(), body: z.string().trim().min(1).max(5000), status: z.enum(["open","resolved"]).default("open"), follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), visibility: z.enum(["hr_only","shared"]).default("hr_only"), locked: z.boolean().default(false), override_owner: z.boolean().default(false) });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!secret || request.headers.get("x-admin-secret") !== secret) return respond({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ error: parsed.error.issues[0]?.message ?? "Invalid note." }, 400);
  const input = parsed.data, url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return respond({ error: "Notes service is not configured." }, 500);
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: staff, error: staffError } = await db.from("staff").select("id").eq("id", input.staff_id).eq("company_id", input.company_id).maybeSingle();
  if (staffError || !staff) return respond({ error: "Staff member was not found in this company." }, 404);
  if (input.id) {
    const { data: note, error } = await db.from("hr_notes").select("id,staff_id,author,locked,deleted_at").eq("id", input.id).eq("company_id", input.company_id).maybeSingle();
    if (error || !note || note.deleted_at) return respond({ error: "Note not found." }, 404);
    if (note.staff_id !== input.staff_id) return respond({ error: "A note cannot be moved to another staff member." }, 400);
    if (note.locked && !(input.override_owner && note.author === input.actor)) return respond({ error: "This note is locked. Only its author can explicitly override the lock." }, 409);
    const { data: prior, error: priorError } = await db.from("hr_notes").select("body,title,type").eq("id", note.id).single();
    if (priorError || !prior) return respond({ error: "Could not load the previous note version." }, 500);
    const { error: versionError } = await db.from("hr_note_versions").insert({ note_id: note.id, body: prior.body, title: prior.title, type: prior.type, edited_by: input.actor });
    if (versionError) return respond({ error: "Could not save the prior note version." }, 500);
    const { data, error: updateError } = await db.from("hr_notes").update({ note_date: input.note_date, note_time: input.note_time ?? null, type: input.type, title: input.title ?? null, body: input.body, status: input.status, follow_up_date: input.follow_up_date ?? null, visibility: input.visibility, locked: input.locked }).eq("id", note.id).select().single();
    if (updateError) return respond({ error: "Could not update note." }, 500);
    const { error: auditError } = await db.from("audit_log").insert({ actor: `hr:${input.actor}`, action: input.override_owner && note.locked ? "note.edit_locked_override" : "note.edit", target: note.staff_id });
    if (auditError) return respond({ error: "Note updated, but its audit event could not be recorded. Contact support before retrying." }, 500);
    return respond({ note: data });
  }
  const { data, error } = await db.from("hr_notes").insert({ company_id: input.company_id, staff_id: input.staff_id, author: input.actor, note_date: input.note_date, note_time: input.note_time ?? null, type: input.type, title: input.title ?? null, body: input.body, status: input.status, follow_up_date: input.follow_up_date ?? null, visibility: input.visibility, locked: input.locked }).select().single();
  if (error) return respond({ error: "Could not create note." }, 500);
  const { error: auditError } = await db.from("audit_log").insert({ actor: `hr:${input.actor}`, action: "note.create", target: input.staff_id });
  if (auditError) return respond({ error: "Note saved, but its audit event could not be recorded. Contact support before retrying." }, 500);
  return respond({ note: data }, 201);
});
