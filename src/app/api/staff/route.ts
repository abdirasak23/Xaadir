import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { callAdminFunction } from "@/lib/edge";
import { staffSchema } from "@/lib/validation";
import { z } from "zod";
import { getCompanyContext } from "@/lib/company-auth";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  branch: z.preprocess(value => value === "" ? undefined : value, z.string().uuid().optional()),
});

export async function GET(request: NextRequest) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? undefined,
    branch: request.nextUrl.searchParams.get("branch") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid staff filter." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const search = parsed.data.q;
  const branch = parsed.data.branch;
  let query = supabase.from("staff").select("*, branches(name)").eq("company_id", company.companyId).order("full_name");
  if (branch) query = query.eq("branch_id", branch);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const normalizedSearch = search?.toLocaleLowerCase();
  return NextResponse.json(normalizedSearch ? data.filter(person =>
    [person.full_name, person.staff_code, person.email].some(value => value.toLocaleLowerCase().includes(normalizedSearch)),
  ) : data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const parsed = staffSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return NextResponse.json({ error: `${field}${issue?.message ?? "Invalid staff details."}` }, { status: 400 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .select("id")
      .eq("id", parsed.data.branch_id)
      .eq("company_id", company.companyId)
      .maybeSingle();
    if (branchError) return NextResponse.json({ error: branchError.message }, { status: 500 });
    if (!branch) return NextResponse.json({ error: "Choose a branch belonging to your company." }, { status: 400 });
    const staff = await callAdminFunction("create-staff", { ...parsed.data, company_id: company.companyId });
    return NextResponse.json(staff, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Staff creation failed." }, { status: 400 });
  }
}
