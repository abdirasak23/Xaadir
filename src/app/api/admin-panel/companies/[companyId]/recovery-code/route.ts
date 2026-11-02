import { NextResponse } from "next/server";
import { callAdminFunction } from "@/lib/edge";
import { requireAdminSession } from "@/lib/admin-auth";
import { uuidSchema } from "@/lib/validation";

export async function POST(_request: Request, context: { params: Promise<{ companyId: string }> }) {
  if (!await requireAdminSession()) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  const { companyId } = await context.params;
  const parsedId = uuidSchema.safeParse(companyId);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid company ID." }, { status: 400 });
  try {
    const result = await callAdminFunction<{ code: string; expires_at: string; email: string; full_name: string }>("password-recovery", {
      action: "issue-hr-code", company_id: parsedId.data,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not issue recovery code." }, { status: 502 });
  }
}
