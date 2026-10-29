import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { setCompanySessionCookie } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.json({ error: "Company sign-in is not configured." }, { status: 500 });

  const authClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: login, error: loginError } = await authClient.auth.signInWithPassword(parsed.data);
  if (loginError || !login.user || !login.session) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: membership, error: membershipError } = await admin
    .from("company_admins")
    .select("company_id,must_change_password")
    .eq("auth_user_id", login.user.id)
    .maybeSingle();
  if (membershipError) return NextResponse.json({ error: `Could not verify company account: ${membershipError.message}` }, { status: 500 });
  if (!membership) return NextResponse.json({ error: "This account does not have company administrator access." }, { status: 403 });

  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("status")
    .eq("id", membership.company_id)
    .maybeSingle();
  if (companyError) return NextResponse.json({ error: `Could not verify company status: ${companyError.message}` }, { status: 500 });
  if (!company || company.status !== "active") return NextResponse.json({ error: "This company account is inactive." }, { status: 403 });

  await setCompanySessionCookie(
    login.user.id,
    login.session.access_token,
    login.session.refresh_token,
    membership.must_change_password,
  );
  return NextResponse.json({
    ok: true,
    must_change_password: membership.must_change_password,
  }, { headers: { "Cache-Control": "no-store" } });
}
