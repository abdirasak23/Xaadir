import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const issueSchema = z.object({ action: z.literal("issue-hr-code"), company_id: z.string().uuid(), admin_id: z.string().uuid() });
const issueStaffSchema = z.object({
  action: z.literal("issue-staff-code"),
  company_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  issued_by: z.string().uuid(),
});
const resetSchema = z.object({
  action: z.literal("reset"), account_type: z.enum(["hr", "staff"]),
  email: z.string().trim().email().max(254), code: z.string().trim().min(6).max(128),
  password: z.string().min(12).max(128), password_confirm: z.string().min(12).max(128),
});
const schema = z.discriminatedUnion("action", [issueSchema, issueStaffSchema, resetSchema]);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomCode() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomStaffCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Invalid recovery request." }, 400);
  // Staff recovery is safe for the mobile client to call directly: it is gated
  // by a short-lived, single-use code and rate limiting. Admin issuance and HR
  // recovery stay behind the server-only x-admin-secret.
  const publicStaffReset = parsed.data.action === "reset" && parsed.data.account_type === "staff";
  if (!publicStaffReset && (!secret || request.headers.get("x-admin-secret") !== secret)) {
    return response({ error: "Unauthorized." }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return response({ error: "Recovery service is not configured." }, 500);
  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  if (parsed.data.action === "issue-hr-code") {
    const { data: membership, error } = await supabase.from("company_admins")
      .select("id,auth_user_id,email,full_name,companies!inner(status)")
      .eq("company_id", parsed.data.company_id).eq("id", parsed.data.admin_id).maybeSingle();
    if (error || !membership || !membership.auth_user_id) return response({ error: "Company HR account not found." }, 404);
    const company = Array.isArray(membership.companies) ? membership.companies[0] : membership.companies;
    if (!company || company.status !== "active") return response({ error: "Company is inactive." }, 400);
    const code = randomCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error: invalidateError } = await supabase.from("password_recovery_codes")
      .update({ used_at: new Date().toISOString() }).eq("auth_user_id", membership.auth_user_id).is("used_at", null);
    if (invalidateError) return response({ error: "Could not issue recovery code." }, 500);
    const { error: insertError } = await supabase.from("password_recovery_codes").insert({
      auth_user_id: membership.auth_user_id, code_hash: await sha256(code), expires_at: expiresAt, created_by: "developer_admin",
    });
    if (insertError) return response({ error: "Could not create recovery code." }, 500);
    const { error: auditError } = await supabase.from("audit_log").insert({
      actor: "developer_admin", action: "hr.password_recovery_issued", target: parsed.data.company_id,
    });
    if (auditError) return response({ error: "Could not record recovery audit." }, 500);
    return response({ code, expires_at: expiresAt, email: membership.email, full_name: membership.full_name });
  }

  if (parsed.data.action === "issue-staff-code") {
    const input = parsed.data;
    const { data: issuer, error: issuerError } = await supabase.from("company_admins")
      .select("auth_user_id,companies!inner(status)")
      .eq("company_id", input.company_id).eq("auth_user_id", input.issued_by).maybeSingle();
    const issuerCompany = issuer ? (Array.isArray(issuer.companies) ? issuer.companies[0] : issuer.companies) : null;
    if (issuerError || !issuer || issuerCompany?.status !== "active") {
      return response({ error: "Only an active HR account for this company can issue staff reset codes." }, 403);
    }
    const { data: staff, error: staffError } = await supabase.from("staff")
      .select("id,auth_user_id,email,full_name,status,invite_status")
      .eq("id", input.staff_id).eq("company_id", input.company_id).maybeSingle();
    if (staffError) return response({ error: "Could not load staff account." }, 500);
    if (!staff || !staff.auth_user_id || staff.status !== "active" || staff.invite_status !== "accepted") {
      return response({ error: "An active staff account with an accepted invite is required." }, 400);
    }
    const code = randomStaffCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error: invalidateError } = await supabase.from("staff_password_recovery_codes")
      .update({ used_at: new Date().toISOString() }).eq("staff_id", staff.id).is("used_at", null);
    if (invalidateError) return response({ error: "Could not issue recovery code." }, 500);
    const { error: insertError } = await supabase.from("staff_password_recovery_codes").insert({
      staff_id: staff.id,
      auth_user_id: staff.auth_user_id,
      code_hash: await sha256(code.toUpperCase()),
      expires_at: expiresAt,
      created_by: input.issued_by,
    });
    if (insertError) return response({ error: "Could not create recovery code." }, 500);
    const { error: auditError } = await supabase.from("audit_log").insert({
      actor: `hr:${input.issued_by}`, action: "staff.password_recovery_issued", target: staff.id,
    });
    if (auditError) return response({ error: "Could not record recovery audit." }, 500);
    return response({ code, expires_at: expiresAt, email: staff.email, full_name: staff.full_name });
  }

  const input = parsed.data;
  if (input.password !== input.password_confirm || !/[a-z]/.test(input.password) || !/[A-Z]/.test(input.password) || !/\d/.test(input.password)) {
    return response({ error: "Password confirmation or password requirements are not met." }, 400);
  }
  const email = input.email.toLowerCase();
  const keyHash = await sha256(`${input.account_type}:${email}:${secret ?? serviceKey}`);
  const { data: withinLimit, error: rateError } = await supabase.rpc("take_password_recovery_attempt", { p_key_hash: keyHash });
  if (rateError) return response({ error: "Recovery service is not configured." }, 503);
  if (!withinLimit) return response({ error: "Recovery is temporarily unavailable." }, 429);

  let userId: string | null = null;
  let staffId: string | null = null;
  if (input.account_type === "hr") {
    const { data: hr } = await supabase.from("company_admins").select("auth_user_id,company_id,companies!inner(status)")
      .ilike("email", email).maybeSingle();
    const company = hr ? (Array.isArray(hr.companies) ? hr.companies[0] : hr.companies) : null;
    if (hr?.auth_user_id && company?.status === "active") {
      userId = hr.auth_user_id;
      const codeHash = await sha256(input.code);
      const { data: consumed, error } = await supabase.rpc("consume_password_recovery_code", { p_user_id: userId, p_code_hash: codeHash });
      if (error) return response({ error: "Recovery service is not configured." }, 503);
      if (!consumed) userId = null;
    }
  } else {
    const { data: staff } = await supabase.from("staff").select("id,auth_user_id")
      .ilike("email", email).eq("status", "active").eq("invite_status", "accepted").maybeSingle();
    if (staff?.auth_user_id) {
      const { data: consumed, error } = await supabase.rpc("consume_staff_password_recovery_code", {
        p_staff_id: staff.id,
        p_auth_user_id: staff.auth_user_id,
        p_code_hash: await sha256(input.code.toUpperCase()),
      });
      if (error) return response({ error: "Recovery service is not configured." }, 503);
      if (consumed) {
        userId = staff.auth_user_id;
        staffId = staff.id;
      }
    }
  }
  if (!userId) return response({ error: "Invalid recovery request." }, 400);

  const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userId, { password: input.password });
  if (updateAuthError) return response({ error: "Could not update password." }, 500);
  if (input.account_type === "hr") {
    const { error } = await supabase.from("company_admins").update({ must_change_password: false }).eq("auth_user_id", userId);
    if (error) return response({ error: "Could not update account status." }, 500);
  } else if (staffId) {
    const { error } = await supabase.from("staff").update({ must_change_password: false }).eq("id", staffId);
    if (error) return response({ error: "Could not finish staff recovery." }, 500);
  }
  const { error: auditError } = await supabase.from("audit_log").insert({
    actor: input.account_type === "hr" ? "hr_password_recovery" : `staff:${staffId}`,
    action: `${input.account_type}.password_reset`, target: userId,
  });
  if (auditError) console.error("Password recovery audit insert failed:", auditError.message);
  return response({ ok: true });
});
