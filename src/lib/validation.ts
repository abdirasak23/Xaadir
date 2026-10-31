import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");
export const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const branchCreateSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const branchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_m: z.number().int().min(25).max(2000),
  public_ip: z.union([z.ipv4(), z.ipv6(), z.literal("")]).nullable().optional(),
  wifi: z.array(z.object({
    ssid: z.string().trim().min(1).max(100),
    bssid: z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
  })).max(50).refine(items => new Set(items.map(item => item.bssid.toLowerCase())).size === items.length, "Wi-Fi BSSIDs must be unique."),
});
const shiftSchema = z.object({ start: timeSchema, end: timeSchema }).refine(shift => shift.end > shift.start, "Shift end must be after its start.");
export const staffSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  staff_code: z.string().trim().min(1).max(40),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(30),
  job_title: z.string().trim().min(1).max(100),
  branch_id: uuidSchema,
  shift_start: timeSchema,
  shift_end: timeSchema,
  scheduled_shifts: z.array(shiftSchema).min(1).max(8).optional(),
  monthly_salary: z.number().finite().min(0).max(1_000_000_000).default(0),
  annual_leave_days: z.number().int().min(0).max(365).default(21),
}).superRefine((staff, context) => {
  const shifts = staff.scheduled_shifts?.length ? staff.scheduled_shifts : [{ start: staff.shift_start, end: staff.shift_end }];
  for (let index = 1; index < shifts.length; index++) {
    if (shifts[index].start <= shifts[index - 1].end) context.addIssue({ code: "custom", path: ["scheduled_shifts", index], message: "Shifts must be ordered and cannot overlap." });
  }
}).transform(staff => {
  const scheduled_shifts = staff.scheduled_shifts?.length ? staff.scheduled_shifts : [{ start: staff.shift_start, end: staff.shift_end }];
  return { ...staff, scheduled_shifts, shift_start: scheduled_shifts[0].start, shift_end: scheduled_shifts[scheduled_shifts.length - 1].end };
});
export const manualAttendanceSchema = z.object({
  staff_id: uuidSchema,
  date: dateSchema,
  shift_number: z.number().int().min(1).max(8).default(1),
  check_in_at: timeSchema.or(z.literal("")),
  check_out_at: timeSchema.or(z.literal("")),
  reason: z.string().trim().min(1).max(500),
});
