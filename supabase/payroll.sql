-- Multi-shift schedules and payroll support. Run once in Supabase SQL Editor.
alter table public.staff
  add column if not exists scheduled_shifts jsonb not null default '[]'::jsonb,
  add column if not exists monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0);

-- Preserve legacy single-shift staff by copying their existing schedule.
update public.staff
set scheduled_shifts = jsonb_build_array(jsonb_build_object('start', to_char(shift_start, 'HH24:MI'), 'end', to_char(shift_end, 'HH24:MI')))
where scheduled_shifts = '[]'::jsonb;

-- Payroll policy: lateness is counted only after five minutes.
alter table public.staff alter column grace_minutes set default 5;
update public.staff set grace_minutes = 5;

-- One attendance row per scheduled shift, rather than one row per day.
alter table public.attendance add column if not exists shift_number integer not null default 1 check (shift_number between 1 and 8);
alter table public.attendance drop constraint if exists attendance_staff_id_date_key;
drop index if exists public.attendance_staff_date_unique;
create unique index if not exists attendance_staff_date_shift_unique on public.attendance(staff_id, date, shift_number);
create index if not exists attendance_staff_date_idx on public.attendance(staff_id, date, shift_number);

comment on column public.staff.scheduled_shifts is 'Ordered daily shifts, e.g. [{"start":"08:00","end":"12:00"},{"start":"15:00","end":"21:00"}].';
comment on column public.staff.monthly_salary is 'Monthly base salary in the company payroll currency.';
comment on column public.attendance.shift_number is '1-based index into staff.scheduled_shifts for the recorded work session.';
