-- Xaadir leave, sick leave, and holiday support. Safe to run more than once.
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  leave_type text not null check (leave_type in ('annual','sick','emergency','unpaid','maternity','other')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'approved' check (status in ('approved','cancelled')),
  created_by text not null default 'admin',
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists leave_requests_staff_dates_idx on public.leave_requests(staff_id, start_date, end_date);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  date date not null,
  name text not null check (length(trim(name)) > 0),
  branch_id uuid references public.branches(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists holidays_company_date_all_branches_unique on public.holidays(company_id, date) where branch_id is null;
create unique index if not exists holidays_company_date_branch_unique on public.holidays(company_id, date, branch_id) where branch_id is not null;

alter table public.staff add column if not exists annual_leave_days integer not null default 21 check (annual_leave_days >= 0 and annual_leave_days <= 365);
alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance add constraint attendance_status_check check (status in ('present','late','absent','manual','leave','sick','holiday'));
alter table public.attendance drop constraint if exists attendance_source_check;
alter table public.attendance add constraint attendance_source_check check (source in ('qr_static','qr_live','manual','leave','holiday'));

alter table public.leave_requests enable row level security;
alter table public.holidays enable row level security;
revoke all on public.leave_requests, public.holidays from anon, authenticated;
grant all on public.leave_requests, public.holidays to service_role;
