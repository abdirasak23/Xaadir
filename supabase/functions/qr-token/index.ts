import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const schema = z.object({ branchId: z.string().uuid(), liveKey: z.string().min(32).max(256) });
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Invalid QR request." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: branch, error } = await supabase.from("branches").select("id,live_qr_secret").eq("id", parsed.data.branchId).maybeSingle();
  if (error) return response({ error: error.message }, 500);
  if (!branch || branch.live_qr_secret !== parsed.data.liveKey) return response({ error: "Invalid branch key." }, 401);
  const secret = Deno.env.get("QR_SIGNING_SECRET");
  if (!secret || secret.length < 32) return response({ error: "QR signing is not configured." }, 500);
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = encode(new TextEncoder().encode(JSON.stringify({ branchId: branch.id, timestamp })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
  return response({ token: `${payload}.${signature}`, timestamp, expires_in: 30 });
});
