import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const TIMEZONE = "Africa/Mogadishu";
const schema = z.object({
  staff_jwt: z.string().min(20), qr_type: z.enum(["static", "live"]), token: z.string().min(8),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  wifi_bssid: z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/).nullable().optional(),
  device_id: z.string().trim().min(1).max(200), device_name: z.string().trim().max(100).optional(),
});
const deviceRequestSchema = z.object({
  action: z.literal("request_device"),
  device_id: z.string().trim().min(16).max(128),
  device_name: z.string().trim().max(100).optional(),
});
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
function decode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), character => character.charCodeAt(0));
}
async function validateLiveToken(token: string, branchId: string) {
  const pieces = token.split(".");
  if (pieces.length !== 2) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decode(pieces[0]))) as { branchId?: string; timestamp?: number };
    const now = Math.floor(Date.now() / 1000);
    if (payload.branchId !== branchId || typeof payload.timestamp !== "number" || payload.timestamp > now + 5 || now - payload.timestamp > 40) return false;
    const secret = Deno.env.get("QR_SIGNING_SECRET");
    if (!secret) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, decode(pieces[1]), new TextEncoder().encode(pieces[0]));
  } catch { return false; }
}
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1), deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const raw = await request.json().catch(() => null);
  if (raw && typeof raw === "object" && (raw as { action?: unknown }).action === "request_device") {
    const parsedRequest = deviceRequestSchema.safeParse(raw);
    if (!parsedRequest.success) return response({ reason: "INVALID_INPUT", message: parsedRequest.error.issues[0]?.message ?? "Invalid device request." }, 400);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return response({ reason: "UNAUTHORIZED", message: "Please sign in before requesting device approval." }, 401);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return response({ reason: "UNAUTHORIZED", message: "Your session expired. Please sign in again." }, 401);
    const { data: staff, error: staffError } = await supabase.from("staff").select("id,status,must_change_password").eq("auth_user_id", authData.user.id).maybeSingle();
    if (staffError) return response({ reason: "LOOKUP_FAILED", message: "Could not verify your staff account." }, 500);
    if (!staff || staff.status !== "active") return response({ reason: "STAFF_INACTIVE", message: "This staff account is not active." }, 403);
    if (staff.must_change_password) return response({ reason: "PASSWORD_CHANGE_REQUIRED", message: "Change your password first." }, 403);

    const { data: approvedDevice, error: deviceError } = await supabase.from("devices").select("id").eq("staff_id", staff.id).eq("device_id", parsedRequest.data.device_id).eq("approved", true).maybeSingle();
    if (deviceError) return response({ reason: "DEVICE_CHECK_FAILED", message: "Could not check this phone's approval." }, 500);
    if (approvedDevice) return response({ ok: true, status: "approved", message: "This phone is already approved." });

    const { data: savedRequest, error: requestError } = await supabase.from("device_requests").upsert({
      staff_id: staff.id,
      device_id: parsedRequest.data.device_id,
      device_name: parsedRequest.data.device_name ?? null,
      status: "pending",
      requested_at: new Date().toISOString(),
      decided_at: null,
      decided_by: null,
    }, { onConflict: "staff_id,device_id" }).select("id").single();
    if (requestError) return response({ reason: "DEVICE_REQUEST_FAILED", message: "Could not send your request to HR." }, 500);
    return response({ ok: true, status: "pending", request_id: savedRequest.id, message: "Request sent. HR will review it." });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return response({ reason: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid check-in details." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: authData, error: authError } = await supabase.auth.getUser(parsed.data.staff_jwt);
  if (authError || !authData.user) return response({ reason: "INVALID_SESSION", message: "Sign in again before checking in." }, 401);
  const { data: staff, error: staffError } = await supabase.from("staff").select("id,company_id,branch_id,status,shift_start,shift_end,scheduled_shifts,grace_minutes").eq("auth_user_id", authData.user.id).maybeSingle();
  if (staffError) return response({ reason: "LOOKUP_FAILED", message: staffError.message }, 500);
  if (!staff || staff.status !== "active") return response({ reason: "STAFF_INACTIVE", message: "This staff account is not active." }, 403);
  if (!staff.company_id) return response({ reason: "COMPANY_NOT_CONFIGURED", message: "This staff account is not linked to a company." }, 403);
  const { data: company, error: companyError } = await supabase.from("companies").select("status").eq("id", staff.company_id).maybeSingle();
  if (companyError) return response({ reason: "COMPANY_LOOKUP_FAILED", message: companyError.message }, 500);
  if (!company || company.status !== "active") return response({ reason: "COMPANY_INACTIVE", message: "This company account is inactive." }, 403);
  const { data: branch, error: branchError } = await supabase.from("branches").select("id,lat,lng,radius_m,public_ip,static_qr_secret").eq("id", staff.branch_id).eq("company_id", staff.company_id).maybeSingle();
  if (branchError) return response({ reason: "BRANCH_LOOKUP_FAILED", message: branchError.message }, 500);
  if (!branch) return response({ reason: "BRANCH_NOT_FOUND", message: "Assigned branch was not found." }, 404);
  if (parsed.data.qr_type === "static" && parsed.data.token !== branch.static_qr_secret) return response({ reason: "INVALID_QR", message: "This QR code is not valid for your branch." }, 401);
  if (parsed.data.qr_type === "live" && !await validateLiveToken(parsed.data.token, branch.id)) return response({ reason: "EXPIRED_QR", message: "Live QR code expired. Scan the current code." }, 401);
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const date = `${dateParts.find(item => item.type === "year")?.value}-${dateParts.find(item => item.type === "month")?.value}-${dateParts.find(item => item.type === "day")?.value}`;
  const distance = distanceMeters(parsed.data.lat, parsed.data.lng, branch.lat, branch.lng);
  if (distance > branch.radius_m) return response({ reason: "OUTSIDE_GEOFENCE", message: `You are outside the allowed ${branch.radius_m}m check-in area.` }, 403);
  const { data: allowedWifi, error: wifiError } = await supabase.from("branch_wifi").select("bssid").eq("branch_id", branch.id);
  if (wifiError) return response({ reason: "WIFI_CHECK_FAILED", message: wifiError.message }, 500);
  if ((allowedWifi?.length ?? 0) > 0 && !allowedWifi?.some(item => item.bssid.toLowerCase() === parsed.data.wifi_bssid?.toLowerCase())) {
    return response({ reason: "WIFI_NOT_ALLOWED", message: "Connect to an approved office Wi-Fi network." }, 403);
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (branch.public_ip && ip !== branch.public_ip) return response({ reason: "IP_NOT_ALLOWED", message: "Check-in must use the office public network." }, 403);
  const { data: existingRows, error: existingError } = await supabase.from("attendance").select("id,status,note,shift_number,check_in_at,check_out_at").eq("staff_id", staff.id).eq("date", date).order("shift_number");
  if (existingError) return response({ reason: "ATTENDANCE_LOOKUP_FAILED", message: existingError.message }, 500);
  const dayRows = existingRows ?? [];
  const leave = dayRows.find(row => row.status === "leave" || row.status === "sick");
  if (leave) return response({ code: "ON_LEAVE", reason: "ON_LEAVE", leave_type: leave.status === "sick" ? "sick" : leave.note?.split(":")[0] ?? "leave", message: "You are recorded as on leave today. Contact HR if this needs to be changed." }, 403);
  if (dayRows.some(row => row.status === "holiday")) return response({ code: "ON_HOLIDAY", reason: "ON_HOLIDAY", message: "This date is recorded as a holiday." }, 403);
  const { data: device, error: deviceError } = await supabase.from("devices").select("id,approved").eq("staff_id", staff.id).eq("device_id", parsed.data.device_id).maybeSingle();
  if (deviceError) return response({ reason: "DEVICE_CHECK_FAILED", message: deviceError.message }, 500);
  if (!device) {
    const { error } = await supabase.from("devices").insert({ staff_id: staff.id, device_id: parsed.data.device_id, device_name: parsed.data.device_name ?? null, approved: false });
    if (error?.code === "23505") return response({ reason: "DEVICE_NOT_APPROVED", message: "This phone is waiting for HR approval. Try again after your HR team approves it." }, 403);
    if (error) return response({ reason: "DEVICE_BIND_FAILED", message: "Could not bind this device." }, 400);
    return response({ reason: "DEVICE_PENDING_APPROVAL", message: "This phone has been sent to HR for approval. Try again after they approve it." }, 403);
  } else if (!device.approved) return response({ reason: "DEVICE_NOT_APPROVED", message: "This device has not been approved." }, 403);
  const now = new Date();
  const openShift = dayRows.find(row => row.check_in_at && !row.check_out_at && ["present", "late", "manual"].includes(row.status));
  if (openShift) {
    const { data, error } = await supabase.from("attendance").update({ check_out_at: now.toISOString() }).eq("id", openShift.id).is("check_out_at", null).select().single();
    if (error) return response({ reason: "ATTENDANCE_SAVE_FAILED", message: error.message }, 400);
    return response({ ok: true, action: "check_out", attendance: data });
  }
  const shifts = Array.isArray(staff.scheduled_shifts) && staff.scheduled_shifts.length
    ? staff.scheduled_shifts as { start: string; end: string }[]
    : [{ start: staff.shift_start.slice(0, 5), end: staff.shift_end.slice(0, 5) }];
  const nextIndex = shifts.findIndex((_, index) => !dayRows.some(row => row.shift_number === index + 1 && row.status !== "absent"));
  if (nextIndex < 0) return response({ reason: "ATTENDANCE_COMPLETE", message: "All scheduled shifts are already recorded for today." }, 409);
  const shiftNumber = nextIndex + 1;
  const existingAbsence = dayRows.find(row => row.shift_number === shiftNumber && row.status === "absent");
  const [hour, minute] = shifts[nextIndex].start.split(":").map(Number);
  const shiftStart = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`);
  const lateMinutes = Math.max(0, Math.floor((now.getTime() - shiftStart.getTime()) / 60000) - staff.grace_minutes);
  const entry = {
    staff_id: staff.id, branch_id: branch.id, date, shift_number: shiftNumber, check_in_at: now.toISOString(), check_out_at: null,
    status: lateMinutes > 0 ? "late" : "present", late_minutes: lateMinutes,
    source: parsed.data.qr_type === "static" ? "qr_static" : "qr_live",
    lat: parsed.data.lat, lng: parsed.data.lng, distance_m: Math.round(distance),
    wifi_bssid: parsed.data.wifi_bssid ?? null, ip, device_id: parsed.data.device_id,
  };
  const save = existingAbsence
    ? supabase.from("attendance").update(entry).eq("id", existingAbsence.id).select().single()
    : supabase.from("attendance").insert(entry).select().single();
  const { data, error } = await save;
  if (error) {
    if (error.code === "23505") return response({ reason: "ALREADY_CHECKED_IN", message: "Attendance is already recorded for today." }, 409);
    return response({ reason: "ATTENDANCE_SAVE_FAILED", message: error.message }, 400);
  }
  return response({ ok: true, attendance: data });
});
