import { NextResponse } from "next/server";
import { z } from "zod";
import { callAdminFunction } from "@/lib/edge";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/admin-auth";

const companySchema = z.object({
  company_name: z.string().trim().min(1).max(120),
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(30),
});

export async function GET() {
  if (!await requireAdminSession()) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("companies")
    .select("id,name,status,created_at,company_admins(id,full_name,email,phone,created_at)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!await requireAdminSession()) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  const parsed = companySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `${issue?.path.join(".")}: ${issue?.message ?? "Invalid company details."}` }, { status: 400 });
  }
  try {
    const result = await callAdminFunction<{
      company: { id: string; name: string };
      company_admin: { full_name: string; email: string; phone: string };
      temporary_password: string;
    }>("create-company", parsed.data);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Company creation failed." }, { status: 400 });
  }
}
