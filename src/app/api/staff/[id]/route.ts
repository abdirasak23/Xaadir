import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { staffSchema } from "@/lib/validation";
import { uuidSchema } from "@/lib/validation";
import { getCompanyContext } from "@/lib/company-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid staff ID." }, { status: 400 });
  const parsed = staffSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid staff details." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: branch, error: branchError } = await supabase
    .from("branches")
    .select("id")
    .eq("id", parsed.data.branch_id)
    .eq("company_id", company.companyId)
    .maybeSingle();
  if (branchError) return NextResponse.json({ error: branchError.message }, { status: 500 });
  if (!branch) return NextResponse.json({ error: "Choose a branch belonging to your company." }, { status: 400 });
  const { data: current, error: currentError } = await supabase.from("staff").select("id,email,auth_user_id").eq("id", id).eq("company_id", company.companyId).maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  const emailChanged = current.email.toLowerCase() !== parsed.data.email.toLowerCase();
  if (emailChanged && current.auth_user_id) {
    const { error: authError } = await supabase.auth.admin.updateUserById(current.auth_user_id, { email: parsed.data.email, email_confirm: true });
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });
  }
  const { data, error } = await supabase.from("staff").update(parsed.data).eq("id", id).eq("company_id", company.companyId).select().single();
  if (error && emailChanged && current.auth_user_id) {
    const { error: rollbackError } = await supabase.auth.admin.updateUserById(current.auth_user_id, { email: current.email, email_confirm: true });
    if (rollbackError) return NextResponse.json({ error: `${error.message} Email rollback failed: ${rollbackError.message}` }, { status: 500 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: company.userId, action: "staff.updated", target: id });
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid staff ID." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("staff").update({ status: "inactive" }).eq("id", id).eq("company_id", company.companyId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: company.userId, action: "staff.deactivated", target: id });
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });
  return NextResponse.json(data);
}
