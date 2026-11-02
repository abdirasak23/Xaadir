import { NextResponse } from "next/server";
import { z } from "zod";
import { callAdminFunction } from "@/lib/edge";
import { uuidSchema } from "@/lib/validation";
import { requireAdminSession } from "@/lib/admin-auth";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), staff_id: uuidSchema.optional() }),
  z.object({ action: z.literal("approve-reenrollment"), device_row_id: uuidSchema }),
  z.object({ action: z.literal("suspicious"), limit: z.number().int().min(1).max(500).default(100) }),
]);

export async function POST(request: Request) {
  if (!await requireAdminSession()) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid device request." }, { status: 400 });
  try {
    const result = await callAdminFunction("admin-devices", parsed.data);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The device service could not be reached." }, { status: 502 });
  }
}
