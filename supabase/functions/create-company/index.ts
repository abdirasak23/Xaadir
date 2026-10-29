import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const schema = z.object({
  company_name: z.string().trim().min(1).max(120),
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(30),
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function deriveInitialPassword(phone: string) {
  const lastFour = phone.replace(/\D/g, "").slice(-4);
  if (lastFour.length !== 4) throw new Error("Phone number must contain at least four digits.");
  return `Xd${lastFour}`;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const adminSecret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!adminSecret || request.headers.get("x-admin-secret") !== adminSecret) {
    return response({ error: "Unauthorized." }, 401);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return response({ error: `${issue?.path.join(".")}: ${issue?.message ?? "Invalid company details."}` }, 400);
  }
  let temporaryPassword: string;
  try {
    temporaryPassword = deriveInitialPassword(parsed.data.phone);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Invalid phone number." }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return response({ error: "Supabase function configuration is incomplete." }, 500);
  const supabase = createClient(url, serviceRoleKey);

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: parsed.data.email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name, account_type: "company_admin" },
  });
  if (authError || !authData.user) return response({ error: authError?.message ?? "Could not create HR login." }, 400);

  let companyId: string | null = null;
  try {
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .insert({ name: parsed.data.company_name, status: "active" })
      .select("id,name")
      .single();
    if (companyError || !company) throw new Error(companyError?.message ?? "Could not create company.");
    companyId = company.id;

    const { error: adminError } = await supabase.from("company_admins").insert({
      company_id: company.id,
      auth_user_id: authData.user.id,
      full_name: parsed.data.full_name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      must_change_password: true,
    });
    if (adminError) throw new Error(adminError.message);

    const { error: auditError } = await supabase.from("audit_log").insert({
      actor: "developer_admin",
      action: "company.created",
      target: company.id,
    });
    if (auditError) throw new Error(auditError.message);

    return response({
      company,
      company_admin: {
        full_name: parsed.data.full_name,
        email: parsed.data.email,
        phone: parsed.data.phone,
      },
      temporary_password: temporaryPassword,
    }, 201);
  } catch (error) {
    if (companyId) {
      const { error: rollbackError } = await supabase.from("companies").delete().eq("id", companyId);
      if (rollbackError) console.error("Could not roll back company:", rollbackError.message);
    }
    const { error: authRollbackError } = await supabase.auth.admin.deleteUser(authData.user.id);
    if (authRollbackError) console.error("Could not roll back HR auth account:", authRollbackError.message);
    return response({ error: error instanceof Error ? error.message : "Company setup failed." }, 400);
  }
});
