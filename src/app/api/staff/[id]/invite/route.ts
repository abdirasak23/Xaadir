import { NextResponse } from "next/server";
import { callAdminFunction } from "@/lib/edge";
import { uuidSchema } from "@/lib/validation";
import { getCompanyContext } from "@/lib/company-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid staff ID." }, { status: 400 });
  try {
    return NextResponse.json(await callAdminFunction("invite-staff", { staff_id: id, company_id: company.companyId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invite could not be created." }, { status: 400 });
  }
}
