import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ branchId: z.string().uuid(), liveKey: z.string().min(32).max(256) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid QR request." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.json({ error: "Supabase configuration is incomplete." }, { status: 500 });
  const response = await fetch(`${url}/functions/v1/qr-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    body: JSON.stringify(parsed.data), cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  return NextResponse.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
}
