import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const schema = z.object({ staff_id: z.string().uuid(), company_id: z.string().uuid() });
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const adminSecret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!adminSecret || request.headers.get("x-admin-secret") !== adminSecret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Invalid staff ID." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: staff, error } = await supabase.from("staff")
    .select("id,staff_code,email,branch_id,branches(name)")
    .eq("id", parsed.data.staff_id)
    .eq("company_id", parsed.data.company_id)
    .maybeSingle();
  if (error) return response({ error: error.message }, 500);
  if (!staff) return response({ error: "Staff member not found." }, 404);
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  const code = Array.from(random, value => alphabet[value % alphabet.length]).join("");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: updated, error: updateError } = await supabase.from("staff").update({
    invite_code: code, invite_status: "sent", invite_expires_at: expiresAt,
  }).eq("id", staff.id).select().single();
  if (updateError) return response({ error: updateError.message }, 400);
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: "admin", action: "staff.invited", target: staff.id });
  if (auditError) return response({ error: auditError.message }, 500);
  return response({ staff: updated, invite_code: code, expires_at: expiresAt, branch_name: staff.branches?.name ?? "" });
});
