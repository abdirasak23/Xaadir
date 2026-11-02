import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyContext } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

const approveSchema = z.object({ action: z.literal("approve"), request_id: z.string().uuid() });

export async function GET() {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("device_requests")
    .select("id,staff_id,device_id,device_name,status,requested_at,decided_at,staff!inner(id,company_id,full_name,staff_code,branch_id,branches(name))")
    .eq("staff.company_id", company.companyId)
    .order("requested_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load device requests." }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });
  const parsed = approveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid device approval request." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: deviceRequest, error: lookupError } = await supabase
    .from("device_requests")
    .select("id,status,staff!inner(company_id)")
    .eq("id", parsed.data.request_id)
    .eq("staff.company_id", company.companyId)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Could not verify this device request." }, { status: 500 });
  if (!deviceRequest) return NextResponse.json({ error: "Device request not found for this company." }, { status: 404 });
  if (deviceRequest.status !== "pending") return NextResponse.json({ error: "This request has already been reviewed." }, { status: 409 });

  const { data: updated, error: updateError } = await supabase
    .from("device_requests")
    .update({ status: "approved", decided_at: new Date().toISOString(), decided_by: company.userId })
    .eq("id", deviceRequest.id)
    .eq("status", "pending")
    .select("id,status,decided_at")
    .maybeSingle();
  if (updateError) return NextResponse.json({ error: "Could not approve this device." }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "This request was already reviewed. Refresh the list." }, { status: 409 });
  return NextResponse.json({ ok: true, request: updated }, { headers: { "Cache-Control": "no-store" } });
}
