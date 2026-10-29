import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const schema = z.object({
  staff_id: z.string().uuid(), company_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsedDate = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
  }),
  check_in_at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
  check_out_at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
  reason: z.string().trim().min(1).max(500),
});
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const adminSecret = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!adminSecret || request.headers.get("x-admin-secret") !== adminSecret) return response({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Invalid attendance details." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: staff, error: staffError } = await supabase.from("staff").select("id,company_id,branch_id,shift_start,grace_minutes,status").eq("id", parsed.data.staff_id).eq("company_id", parsed.data.company_id).maybeSingle();
  if (staffError) return response({ error: staffError.message }, 500);
  if (!staff || staff.status !== "active") return response({ error: "Active staff member not found." }, 404);
  const checkIn = parsed.data.check_in_at ? new Date(`${parsed.data.date}T${parsed.data.check_in_at}:00Z`) : null;
  const checkOut = parsed.data.check_out_at ? new Date(`${parsed.data.date}T${parsed.data.check_out_at}:00Z`) : null;
  if (!checkIn && checkOut) return response({ error: "Check-in time is required when check-out is provided." }, 400);
  if (checkIn && checkOut && checkOut < checkIn) return response({ error: "Check-out must be after check-in." }, 400);
  const [shiftHour, shiftMinute] = staff.shift_start.split(":").map(Number);
  const shift = new Date(`${parsed.data.date}T${String(shiftHour).padStart(2, "0")}:${String(shiftMinute).padStart(2, "0")}:00Z`);
  const lateMinutes = checkIn ? Math.max(0, Math.floor((checkIn.getTime() - shift.getTime()) / 60000) - staff.grace_minutes) : 0;
  const record = {
    staff_id: staff.id, branch_id: staff.branch_id, date: parsed.data.date,
    check_in_at: checkIn?.toISOString() ?? null, check_out_at: checkOut?.toISOString() ?? null,
    status: !checkIn ? "absent" : lateMinutes > 0 ? "late" : "present",
    late_minutes: lateMinutes, source: "manual", created_by: "admin", note: parsed.data.reason,
  };
  const { data, error } = await supabase.from("attendance").upsert(record, { onConflict: "staff_id,date" }).select().single();
  if (error) return response({ error: error.message }, 400);
  const { error: auditError } = await supabase.from("audit_log").insert({ actor: "admin", action: "attendance.manual", target: data.id });
  if (auditError) return response({ error: auditError.message }, 500);
  return response(data);
});
