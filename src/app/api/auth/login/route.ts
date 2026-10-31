import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { createAdminSession, SESSION_COOKIE } from "@/lib/auth";
import { z } from "zod";

const credentialsSchema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(1024) });

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a username and password." }, { status: 400 });
  const { username, password } = parsed.data;
  const expectedUsername = process.env.ADMIN_USERNAME ?? "";
  const passwordHash = process.env.ADMIN_PASSWORD_HASH ?? "";
  if (!expectedUsername || !passwordHash) {
    return NextResponse.json({
      error: "Admin login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in your hosting environment, then redeploy.",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    return NextResponse.json({
      error: "ADMIN_PASSWORD_HASH is invalid. Generate a bcrypt hash with `npm run hash-password`, save the full value starting with $2b$ (or $2a$/$2y$) in Render, then redeploy.",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  let usernameValid = false;
  let passwordValid = false;
  try {
    usernameValid = constantTimeEqual(username, expectedUsername);
    passwordValid = await bcrypt.compare(password, passwordHash);
  } catch {
    return NextResponse.json({ error: "Admin password hash could not be verified. Generate a fresh bcrypt hash and redeploy." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  if (!usernameValid || !passwordValid) {
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  let token: string;
  try {
    token = await createAdminSession();
  } catch {
    return NextResponse.json({ error: "Admin session configuration is incomplete." }, { status: 500 });
  }
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 8 * 60 * 60,
  });
  return response;
}
