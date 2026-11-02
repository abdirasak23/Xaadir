import "server-only";
import { cookies } from "next/headers";
import { isValidAdminSession, SESSION_COOKIE } from "@/lib/auth";

export async function requireAdminSession() {
  const cookieStore = await cookies();
  return isValidAdminSession(cookieStore.get(SESSION_COOKIE)?.value);
}
