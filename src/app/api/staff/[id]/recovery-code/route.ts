import { NextResponse } from "next/server";
import { getCompanyContext } from "@/lib/company-auth";
import { callAdminFunction } from "@/lib/edge";
import { uuidSchema } from "@/lib/validation";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company sign-in required." }, { status: 401 });
  if (company.mustChangePassword) return NextResponse.json({ error: "Change your password before managing staff." }, { status: 403 });

  const { id } = await context.params;
  const staffId = uuidSchema.safeParse(id);
  if (!staffId.success) return NextResponse.json({ error: "Invalid staff ID." }, { status: 400 });

  try {
    const result = await callAdminFunction<{ code: string; expires_at: string; email: string; full_name: string }>("password-recovery", {
      action: "issue-staff-code",
      company_id: company.companyId,
      staff_id: staffId.data,
      issued_by: company.userId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not issue staff recovery code." }, { status: 502 });
  }
}
