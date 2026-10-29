import "server-only";

export async function callAdminFunction<T>(name: string, payload: unknown): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.EDGE_FUNCTION_SECRET;
  if (!url || !anonKey || !secret) throw new Error("Edge Function configuration is incomplete.");
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "x-admin-secret": secret,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as { error?: string; message?: string } & T;
  if (!response.ok) throw new Error(result.error ?? result.message ?? `Edge Function ${name} failed.`);
  return result;
}
