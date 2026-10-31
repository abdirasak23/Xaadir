create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.company_admins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text not null,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null default 100 check (radius_m > 0),
  public_ip inet,
  static_qr_secret text not null unique default encode(gen_random_bytes(24), 'hex'),
  live_qr_secret text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now()
);

alter table public.branches
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

create table if not exists public.branch_wifi (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  ssid text not null,
  bssid text not null check (bssid ~* '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  created_at timestamptz not null default now(),
  unique (branch_id, bssid)
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  staff_code text not null unique,
  phone text not null,
  email text not null unique,
  job_title text not null,
  branch_id uuid not null references public.branches(id),
  shift_start time not null,
  shift_end time not null,
  grace_minutes integer not null default 10 check (grace_minutes >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  must_change_password boolean not null default true,
  invite_code text unique,
  invite_status text not null default 'none' check (invite_status in ('none', 'sent', 'accepted')),
  invite_expires_at timestamptz,
  annual_leave_days integer not null default 21 check (annual_leave_days >= 0 and annual_leave_days <= 365),
  created_at timestamptz not null default now()
);

alter table public.staff
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

create index if not exists branches_company_id_idx on public.branches(company_id);
create index if not exists staff_company_id_full_name_idx on public.staff(company_id, full_name);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  device_id text not null,
  device_name text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (staff_id, device_id)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  branch_id uuid not null references public.branches(id),
  date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status text not null check (status in ('present', 'late', 'absent', 'manual')),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  source text not null check (source in ('qr_static', 'qr_live', 'manual')),
  lat double precision,
  lng double precision,
  distance_m double precision,
  wifi_bssid text,
  ip inet,
  device_id text,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (staff_id, date)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target text,
  created_at timestamptz not null default now()
);

alter table public.branches enable row level security;
alter table public.companies enable row level security;
alter table public.company_admins enable row level security;
alter table public.branch_wifi enable row level security;
alter table public.staff enable row level security;
alter table public.devices enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.companies, public.company_admins, public.branches, public.branch_wifi, public.staff, public.devices, public.attendance, public.audit_log from anon, authenticated;
grant all on public.companies, public.company_admins, public.branches, public.branch_wifi, public.staff, public.devices, public.attendance, public.audit_log to service_role;
