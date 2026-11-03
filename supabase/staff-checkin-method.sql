-- Per-staff mobile attendance verification preference. Safe to run more than once.
alter table public.staff
  add column if not exists check_in_method text not null default 'biometric';

alter table public.staff
  drop constraint if exists staff_check_in_method_check;

alter table public.staff
  add constraint staff_check_in_method_check
  check (check_in_method in ('biometric', 'selfie'));

comment on column public.staff.check_in_method is
  'Mobile attendance verification preference: biometric (device fingerprint/face) or selfie.';
