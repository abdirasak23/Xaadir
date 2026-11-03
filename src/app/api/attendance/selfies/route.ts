import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyContext } from "@/lib/company-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { uuidSchema } from "@/lib/validation";

const querySchema = z.object({ staff_id: uuidSchema });

export async function GET(request: NextRequest) {
  const company = await getCompanyContext();
  if (!company) return NextResponse.json({ error: "Company login required." }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid selfie request." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { staff_id } = parsed.data;
  const attendance: Array<{ id: string; [key: string]: unknown }> = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("attendance")
      .select("id,staff_id,branch_id,date,shift_number,check_in_at,check_out_at,status,late_minutes,source,note,lat,lng,distance_m,wifi_bssid,ip,device_id,created_by,created_at,staff!inner(full_name,staff_code,branch_id,company_id,check_in_method,branches(name))")
      .eq("staff_id", staff_id).eq("staff.company_id", company.companyId)
      .order("date", { ascending: false }).order("shift_number", { ascending: false })
      .range(offset, offset + 499);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    attendance.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }

  const byAttendance = new Map<string, AttendanceSelfie[]>();
  for (let offset = 0; offset < attendance.length; offset += 50) {
    const ids = attendance.slice(offset, offset + 50).map(row => row.id);
    const { data: selfies, error } = await supabase.from("attendance_selfies")
      .select("id,attendance_id,kind,storage_path,review_status,review_note,created_at")
      .in("attendance_id", ids).order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const signed = await Promise.all((selfies ?? []).map(async selfie => {
      const fileName = `xaadir-selfie-${selfie.kind}-${selfie.attendance_id}.jpg`;
      const [{ data: preview }, { data: download }] = await Promise.all([
        supabase.storage.from("staff-attendance").createSignedUrl(selfie.storage_path, 60 * 60),
        supabase.storage.from("staff-attendance").createSignedUrl(selfie.storage_path, 60 * 60, { download: fileName }),
      ]);
      return { id: selfie.id, attendance_id: selfie.attendance_id, kind: selfie.kind, review_status: selfie.review_status, review_note: selfie.review_note, created_at: selfie.created_at, preview_url: preview?.signedUrl ?? null, download_url: download?.signedUrl ?? null } as AttendanceSelfie;
    }));
    for (const selfie of signed) byAttendance.set(selfie.attendance_id, [...(byAttendance.get(selfie.attendance_id) ?? []), selfie]);
  }
  return NextResponse.json({ records: attendance.map(row => ({ ...row, selfies: byAttendance.get(row.id) ?? [] })) }, { headers: { "Cache-Control": "no-store" } });
}

type AttendanceSelfie = { id: string; attendance_id: string; kind: string; review_status: string; review_note: string | null; created_at: string; preview_url: string | null; download_url: string | null };
