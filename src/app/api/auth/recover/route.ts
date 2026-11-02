import { NextResponse } from "next/server";
import { z } from "zod";
import { callAdminFunction } from "@/lib/edge";

const schema = z.object({
  account_type: z.enum(["hr", "staff"]),
  email: z.string().trim().email().max(254),
  code: z.string().trim().min(6).max(128),
  password: z.string().min(12).max(128),
  password_confirm: z.string().min(12).max(128),
}).refine(value => value.password === value.password_confirm, { path: ["password_confirm"], message: "Passwords do not match." })
  .refine(value => /[a-z]/.test(value.password) && /[A-Z]/.test(value.password) && /\d/.test(value.password), {
    path: ["password"], message: "Use at least one uppercase letter, lowercase letter, and number.",
  });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the recovery details." }, { status: 400 });
  try {
    await callAdminFunction("password-recovery", { action: "reset", ...parsed.data });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "We could not verify that recovery code. Check the email and code, or ask an administrator for a new code." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
