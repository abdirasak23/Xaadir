import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getCompanyContext } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { setCompanySessionCookie } from "@/lib/company-auth";

const schema = z.object({
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.json({ error: "Password change is not configured." }, { status: 500 });

  const authClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: sessionData, error: sessionError } = await authClient.auth.setSession({
    access_token: company.accessToken,
    refresh_token: company.refreshToken,
  });
  if (sessionError || !sessionData.user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const { error: passwordError } = await authClient.auth.updateUser({ password: parsed.data.password });
  if (passwordError) return NextResponse.json({ error: passwordError.message }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { error: updateError } = await admin
    .from("company_admins")
    .update({ must_change_password: false })
    .eq("auth_user_id", company.userId)
    .eq("company_id", company.companyId);
  if (updateError) return NextResponse.json({ error: `Password changed, but account setup could not be completed: ${updateError.message}` }, { status: 500 });

  await setCompanySessionCookie(
    company.userId,
    sessionData.session?.access_token ?? company.accessToken,
    sessionData.session?.refresh_token ?? company.refreshToken,
    false,
  );
  return NextResponse.json({ ok: true });
}
