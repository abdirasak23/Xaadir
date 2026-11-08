import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const schema = z.object({
  company_id: z.string().uuid(),
  created_by: z.string().uuid(),
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(30),
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function createTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const body = Array.from(random, byte => alphabet[byte % alphabet.length]).join("");
  return `Xa-${body}7!`;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!secret || request.headers.get("x-admin-secret") !== secret) return reply({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: parsed.error.issues[0]?.message ?? "Invalid HR account details." }, 400);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply({ error: "HR account service is not configured." }, 500);
  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const input = parsed.data;

  const { data: issuer, error: issuerError } = await supabase.from("company_admins")
    .select("id,companies!inner(status)").eq("company_id", input.company_id).eq("auth_user_id", input.created_by).maybeSingle();
  const issuerCompany = issuer ? (Array.isArray(issuer.companies) ? issuer.companies[0] : issuer.companies) : null;
  if (issuerError || !issuer || issuerCompany?.status !== "active") {
    return reply({ error: "Only an active HR member of this company can create HR logins." }, 403);
  }

  const email = input.email.toLowerCase();
  const temporaryPassword = createTemporaryPassword();
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: input.full_name, account_type: "company_admin", company_id: input.company_id },
  });
  if (authError || !authData.user) return reply({ error: authError?.message ?? "Could not create the HR login." }, 400);

  const { data: membership, error: insertError } = await supabase.from("company_admins").insert({
    company_id: input.company_id,
    auth_user_id: authData.user.id,
    full_name: input.full_name,
    email,
    phone: input.phone,
    must_change_password: true,
  }).select("id,full_name,email,phone").single();
  if (insertError || !membership) {
    await supabase.auth.admin.deleteUser(authData.user.id);
    return reply({ error: insertError?.message ?? "Could not add this HR login to the company." }, 400);
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    actor: `hr:${input.created_by}`,
    action: "company.hr_account_created",
    target: membership.id,
  });
  if (auditError) {
    await supabase.auth.admin.deleteUser(authData.user.id);
    return reply({ error: "Could not record the HR account audit." }, 500);
  }

  return reply({ hr: membership, temporary_password: temporaryPassword }, 201);
});
