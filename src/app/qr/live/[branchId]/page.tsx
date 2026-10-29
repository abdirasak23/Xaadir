import { notFound } from "next/navigation";
import { LiveQr } from "@/components/qr-codes";
import { getSupabaseAdmin } from "@/lib/supabase";
import { uuidSchema } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

export default async function LiveQrPage({ params, searchParams }: { params: Promise<{ branchId: string }>; searchParams: Promise<{ k?: string }> }) {
  const [routeParams, query] = await Promise.all([params, searchParams]);
  const parsed = z.object({ branchId: uuidSchema, key: z.string().min(32).max(256) }).safeParse({ branchId: routeParams.branchId, key: query.k });
  if (!parsed.success) notFound();
  const { branchId, key } = parsed.data;
  const supabase = getSupabaseAdmin();
  const { data: branch, error } = await supabase.from("branches").select("id,name,live_qr_secret").eq("id", branchId).maybeSingle();
  if (error || !branch || branch.live_qr_secret !== key) notFound();
  return <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f8f6] p-6 text-center">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-forest">Xaadir check-in</p>
    <h1 className="mt-3 text-3xl font-bold tracking-tight">{branch.name}</h1>
    <p className="mt-2 text-sm text-slate-500">Scan the current code from your staff app</p>
    <div className="mt-8 rounded-3xl bg-white p-5 shadow-card"><LiveQr branchId={branch.id} liveKey={key} /></div>
    <p className="mt-5 text-xs text-slate-400">This screen refreshes automatically every 30 seconds.</p>
  </main>;
}
