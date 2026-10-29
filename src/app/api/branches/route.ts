import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { branchCreateSchema, branchSchema, uuidSchema } from "@/lib/validation";
import { getCompanyContext } from "@/lib/company-auth";

export async function GET() {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("branches").select("id,name,lat,lng,radius_m,public_ip,static_qr_secret,live_qr_secret").eq("company_id", company.companyId).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const withWifi = await Promise.all((data ?? []).map(async branch => {
    const { data: wifi, error: wifiError } = await supabase.from("branch_wifi").select("id,ssid,bssid").eq("branch_id", branch.id);
    if (wifiError) return { error: wifiError.message };
    return { ...branch, wifi: wifi ?? [] };
  }));
  const failed = withWifi.find(item => "error" in item);
  if (failed && "error" in failed) return NextResponse.json({ error: failed.error }, { status: 500 });
  return NextResponse.json(withWifi, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const parsed = branchCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid branch name." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("branches").insert({
    company_id: company.companyId, name: parsed.data.name, lat: 0, lng: 0, radius_m: 100,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: company.userId, action: "branch.created", target: data.id });
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });
  return NextResponse.json(data, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; name?: string; lat?: number; lng?: number; radius_m?: number; public_ip?: string; wifi?: { ssid: string; bssid: string }[] } | null;
  if (!body?.id || !Array.isArray(body.wifi) || !body.name || typeof body.lat !== "number" || typeof body.lng !== "number") {
    return NextResponse.json({ error: "Invalid branch settings." }, { status: 400 });
  }
  if (!uuidSchema.safeParse(body.id).success) return NextResponse.json({ error: "Invalid branch ID." }, { status: 400 });
  const parsed = branchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: branch, error } = await supabase.from("branches").update({
    name: parsed.data.name, lat: parsed.data.lat, lng: parsed.data.lng,
    radius_m: parsed.data.radius_m, public_ip: parsed.data.public_ip || null,
  }).eq("id", body.id).eq("company_id", company.companyId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!branch) return NextResponse.json({ error: "Branch not found in your company." }, { status: 404 });
  const { data: currentWifi, error: currentWifiError } = await supabase.from("branch_wifi").select("id,bssid").eq("branch_id", body.id);
  if (currentWifiError) return NextResponse.json({ error: currentWifiError.message }, { status: 500 });
  if (parsed.data.wifi.length) {
    const { error: upsertError } = await supabase.from("branch_wifi").upsert(
      parsed.data.wifi.map(item => ({ ...item, branch_id: body.id })),
      { onConflict: "branch_id,bssid" },
    );
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }
  const keep = new Set(parsed.data.wifi.map(item => item.bssid.toLowerCase()));
  const removeIds = (currentWifi ?? []).filter(item => !keep.has(item.bssid.toLowerCase())).map(item => item.id);
  if (removeIds.length) {
    const { error: deleteError } = await supabase.from("branch_wifi").delete().in("id", removeIds);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: company.userId, action: "branch.environment.updated", target: body.id });
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });
  return NextResponse.json(branch, { headers: { "Cache-Control": "no-store" } });
}
