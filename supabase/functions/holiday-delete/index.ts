import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const schema = z.object({ company_id: z.string().uuid(), actor: z.string().uuid(), holiday_id: z.string().uuid() });
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET"); if (!secret || request.headers.get("x-admin-secret") !== secret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Invalid holiday." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: holiday, error: lookupError } = await supabase.from("holidays").select("id,date,branch_id,company_id,branches!left(company_id)").eq("id", parsed.data.holiday_id).eq("company_id", parsed.data.company_id).maybeSingle();
  if (lookupError) return response({ error: lookupError.message }, 500); if (!holiday) return response({ error: "Holiday not found." }, 404);
  const { data: companyBranches, error: branchError } = await supabase.from("branches").select("id").eq("company_id", parsed.data.company_id);
  if (branchError) return response({ error: branchError.message }, 500);
  const branchIds = (companyBranches ?? []).map(row => row.id);
  if (holiday.branch_id && (!branchIds.includes(holiday.branch_id) || (holiday as any).branches?.company_id !== parsed.data.company_id)) return response({ error: "Holiday not found." }, 404);
  const { data: companyStaff, error: staffError } = await supabase.from("staff").select("id").eq("company_id", parsed.data.company_id);
  if (staffError) return response({ error: staffError.message }, 500);
  let rows: { id: string }[] = [];
  const staffIds = (companyStaff ?? []).map(row => row.id);
  if (staffIds.length) {
    let deleteQuery = supabase.from("attendance").delete().eq("date", holiday.date).eq("source", "holiday").in("staff_id", staffIds);
    if (holiday.branch_id) deleteQuery = deleteQuery.eq("branch_id", holiday.branch_id);
    const { data, error } = await deleteQuery.select("id"); if (error) return response({ error: error.message }, 500); rows = data ?? [];
  }
  const { error: deleteHolidayError } = await supabase.from("holidays").delete().eq("id", holiday.id); if (deleteHolidayError) return response({ error: deleteHolidayError.message }, 500);
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: parsed.data.actor, action: "holiday.deleted", target: holiday.id }); if (auditError) return response({ error: auditError.message }, 500);
  return response({ ok: true, deleted_rows: rows?.length ?? 0 });
});
