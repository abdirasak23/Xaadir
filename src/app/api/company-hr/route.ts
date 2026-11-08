import { NextResponse } from "next/server";
import { z } from "zod";
import { callAdminFunction } from "@/lib/edge";
import { getCompanyContext } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

const createSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(30),
});

export async function GET() {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().from("company_admins")
    .select("id,full_name,email,phone,must_change_password,created_at")
    .eq("company_id", company.companyId).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load the HR team." }, { status: 500 });
  return NextResponse.json(data ?? [], { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid HR account details." }, { status: 400 });
  try {
    const result = await callAdminFunction("create-company-hr", {
      ...parsed.data,
      company_id: company.companyId,
      created_by: company.userId,
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the HR account." }, { status: 400 });
  }
}
