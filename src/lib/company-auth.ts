import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  COMPANY_SESSION_COOKIE,
  createCompanySession,
  readCompanySession,
} from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function setCompanySessionCookie(
  userId: string,
  accessToken: string,
  refreshToken: string,
  mustChangePassword: boolean,
) {
  const cookieStore = await cookies();
  const token = await createCompanySession(userId, accessToken, refreshToken, mustChangePassword);
  cookieStore.set(COMPANY_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
}

export async function getCompanyContext() {
  const cookieStore = await cookies();
  const session = await readCompanySession(cookieStore.get(COMPANY_SESSION_COOKIE)?.value);
  if (!session) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase authentication configuration is incomplete.");
  const authClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  let accessToken = session.accessToken;
  let refreshToken = session.refreshToken;
  const initialAuth = await authClient.auth.getUser(accessToken);
  let user = initialAuth.data.user;

  if (initialAuth.error || !user) {
    const refreshed = await authClient.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshed.error || !refreshed.data.session || !refreshed.data.user) return null;
    accessToken = refreshed.data.session.access_token;
    refreshToken = refreshed.data.session.refresh_token;
    user = refreshed.data.user;
    await setCompanySessionCookie(
      session.userId,
      accessToken,
      refreshToken,
      session.mustChangePassword,
    );
  }
  if (user.id !== session.userId) return null;

  const admin = getSupabaseAdmin();
  const { data: membership, error: membershipError } = await admin
    .from("company_admins")
    .select("company_id,full_name,email,must_change_password")
    .eq("auth_user_id", session.userId)
    .maybeSingle();
  if (membershipError) throw new Error(`Could not load company account: ${membershipError.message}`);
  if (!membership) return null;

  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("id,name,status")
    .eq("id", membership.company_id)
    .maybeSingle();
  if (companyError) throw new Error(`Could not load company: ${companyError.message}`);
  if (!company || company.status !== "active") return null;

  return {
    userId: session.userId,
    accessToken,
    refreshToken,
    companyId: company.id,
    companyName: company.name,
    fullName: membership.full_name,
    email: membership.email,
    mustChangePassword: membership.must_change_password,
  };
}
