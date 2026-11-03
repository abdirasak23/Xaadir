import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const inputSchema = z.object({
  full_name: z.string().trim().min(1).max(120), staff_code: z.string().trim().min(1).max(40),
  email: z.string().email().max(254), phone: z.string().trim().min(6).max(30),
  job_title: z.string().trim().min(1).max(100), branch_id: z.string().uuid(), company_id: z.string().uuid(),
  shift_start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), shift_end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  scheduled_shifts: z.array(z.object({ start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), day: z.number().int().min(0).max(6).optional() }).refine(shift => shift.start !== shift.end, "Shift start and end cannot be the same.")).min(1).max(56).optional(),
  monthly_salary: z.number().min(0).max(1000000000).default(0),
  annual_leave_days: z.number().int().min(0).max(365).default(21),
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function deriveInitialPassword(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const lastFour = digits.slice(-4);
  if (lastFour.length !== 4) throw new Error("Phone number must contain at least four digits.");
  // Use "Xd" plus four digits to meet Supabase's default minimum password length; last-4-only requires lowering it in Supabase Auth settings.
  return `Xd${lastFour}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const adminSecret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!adminSecret || request.headers.get("x-admin-secret") !== adminSecret) return response({ error: "Unauthorized." }, 401);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return response({ error: `${field}${issue?.message ?? "Invalid staff details."}` }, 400);
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: branch, error: branchError } = await supabase.from("branches")
    .select("id")
    .eq("id", parsed.data.branch_id)
    .eq("company_id", parsed.data.company_id)
    .maybeSingle();
  if (branchError) return response({ error: branchError.message }, 500);
  if (!branch) return response({ error: "Branch not found." }, 404);
  let createdUserId: string | null = null;
  let createdStaffId: string | null = null;
  try {
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: parsed.data.email, password: deriveInitialPassword(parsed.data.phone), email_confirm: true,
      user_metadata: { full_name: parsed.data.full_name },
    });
    if (userError || !userData.user) throw new Error(userError?.message ?? "Could not create auth account.");
    createdUserId = userData.user.id;
    const { data: staff, error: staffError } = await supabase.from("staff").insert({
      ...parsed.data, auth_user_id: createdUserId, must_change_password: true, grace_minutes: 5,
    }).select().single();
    if (staffError) throw new Error(staffError.message);
    createdStaffId = staff.id;
    const { error: auditError } = await supabase.from("audit_log").insert({ actor: "admin", action: "staff.created", target: staff.id });
    if (auditError) throw new Error(auditError.message);
    return response(staff, 201);
  } catch (error) {
    if (createdStaffId) {
      const { error: rollbackError } = await supabase.from("staff").delete().eq("id", createdStaffId);
      if (rollbackError) console.error("Could not roll back staff record:", rollbackError.message);
    }
    if (createdUserId) {
      const { error: rollbackError } = await supabase.auth.admin.deleteUser(createdUserId);
      if (rollbackError) console.error("Could not roll back auth user:", rollbackError.message);
    }
    return response({ error: error instanceof Error ? error.message : "Staff creation failed." }, 400);
  }
});
