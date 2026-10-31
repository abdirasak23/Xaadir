import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; }, "Enter a valid calendar date.");
const schema = z.object({ company_id: z.string().uuid(), actor: z.string().uuid(), date, name: z.string().trim().min(1).max(120), branch_id: z.string().uuid().nullable() });
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET"); if (!secret || request.headers.get("x-admin-secret") !== secret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Invalid holiday details." }, 400);
  const input = parsed.data, supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (input.branch_id) { const { data, error } = await supabase.from("branches").select("id").eq("id", input.branch_id).eq("company_id", input.company_id).maybeSingle(); if (error) return response({ error: error.message }, 500); if (!data) return response({ error: "Branch not found in this company." }, 404); }
  const { data: holiday, error: holidayError } = await supabase.from("holidays").insert({ company_id: input.company_id, date: input.date, name: input.name, branch_id: input.branch_id }).select("id").single();
  if (holidayError) return response({ error: holidayError.code === "23505" ? "A holiday is already registered for this date and scope." : holidayError.message }, 400);
  let query = supabase.from("staff").select("id,branch_id").eq("company_id", input.company_id).eq("status", "active"); if (input.branch_id) query = query.eq("branch_id", input.branch_id);
  const { data: staff, error: staffError } = await query; if (staffError) { await supabase.from("holidays").delete().eq("id", holiday.id); return response({ error: staffError.message }, 500); }
  const staffIds = (staff ?? []).map(person => person.id); let created = 0, skipped = 0;
  if (staffIds.length) {
    const { data: existing, error } = await supabase.from("attendance").select("staff_id,status").eq("date", input.date).in("staff_id", staffIds);
    if (error) { await supabase.from("holidays").delete().eq("id", holiday.id); return response({ error: error.message }, 500); }
    const real = new Set((existing ?? []).filter(row => ["present","late","manual"].includes(row.status)).map(row => row.staff_id));
    const rows = (staff ?? []).filter(person => !real.has(person.id)).map(person => ({ staff_id: person.id, branch_id: person.branch_id, date: input.date, status: "holiday", source: "holiday", note: input.name, created_by: "admin" }));
    skipped = (staff?.length ?? 0) - rows.length;
    if (rows.length) { const { error: upsertError } = await supabase.from("attendance").upsert(rows, { onConflict: "staff_id,date" }); if (upsertError) { await supabase.from("holidays").delete().eq("id", holiday.id); return response({ error: upsertError.message }, 400); } created = rows.length; }
  }
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: input.actor, action: "holiday.created", target: holiday.id }); if (auditError) return response({ error: auditError.message }, 500);
  return response({ ok: true, holiday_id: holiday.id, days_created: created, days_skipped: skipped });
});
