import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; }, "Enter a valid calendar date.");
const schema = z.object({ company_id: z.string().uuid(), actor: z.string().uuid(), leave_id: z.string().uuid(), from_date: date.optional() });
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
function today() { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Mogadishu", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); return `${p.find(x=>x.type==="year")?.value}-${p.find(x=>x.type==="month")?.value}-${p.find(x=>x.type==="day")?.value}`; }
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET"); if (!secret || request.headers.get("x-admin-secret") !== secret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Invalid leave cancellation." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: leave, error: lookupError } = await supabase.from("leave_requests").select("id,staff_id,start_date,end_date,status,staff!inner(company_id)").eq("id", parsed.data.leave_id).eq("staff.company_id", parsed.data.company_id).maybeSingle();
  if (lookupError) return response({ error: lookupError.message }, 500); if (!leave) return response({ error: "Leave request not found." }, 404);
  if (leave.status === "cancelled") return response({ ok: true, deleted_rows: 0 });
  const from = parsed.data.from_date ?? today();
  const { error: updateError } = await supabase.from("leave_requests").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", leave.id);
  if (updateError) return response({ error: updateError.message }, 400);
  const lower = from < leave.start_date ? leave.start_date : from;
  const upper = leave.end_date;
  let deleted = 0;
  if (lower <= upper) {
    const { data, error } = await supabase.from("attendance").delete().eq("staff_id", leave.staff_id).eq("source", "leave").gte("date", lower).lte("date", upper).select("id");
    if (error) return response({ error: error.message }, 500); deleted = data?.length ?? 0;
  }
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: parsed.data.actor, action: "leave.cancelled", target: leave.id });
  if (auditError) return response({ error: auditError.message }, 500);
  return response({ ok: true, deleted_rows: deleted });
});
