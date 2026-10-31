import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCompanyContext } from "@/lib/company-auth";
import { uuidSchema } from "@/lib/validation";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid branch ID." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const secret = randomBytes(24).toString("hex");
  const { data: branch, error } = await supabase.from("branches")
    .update({ static_qr_secret: secret })
    .eq("id", id)
    .eq("company_id", company.companyId)
    .select("id,name,static_qr_secret")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not regenerate this branch QR code." }, { status: 500 });
  if (!branch) return NextResponse.json({ error: "Branch not found in your company." }, { status: 404 });

  const { error: auditError } = await supabase.from("audit_log").insert({
    actor: company.userId,
    action: "branch.static_qr.regenerated",
    target: id,
  });
  return NextResponse.json({ ...branch, ...(auditError ? { audit_warning: "The new QR is active, but its audit entry could not be saved." } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
