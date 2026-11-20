-- Private HR notes, audit history, attendance links, attachments and report history.
-- Run in the Supabase SQL editor. Safe to run more than once.
create table if not exists public.hr_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  author text not null,
  note_date date not null,
  note_time time,
  type text not null check (type in ('conversation','promise','warning','last_chance','praise','lateness','absence','other')),
  title text,
  body text not null check (length(trim(body)) between 1 and 5000),
  status text not null default 'open' check (status in ('open','resolved')),
  follow_up_date date,
  visibility text not null default 'hr_only' check (visibility in ('hr_only','shared')),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists hr_notes_staff_date_idx on public.hr_notes(staff_id, note_date desc, created_at desc);
create index if not exists hr_notes_company_date_idx on public.hr_notes(company_id, note_date desc);
create index if not exists hr_notes_follow_up_open_idx on public.hr_notes(follow_up_date) where status = 'open' and deleted_at is null;

create table if not exists public.hr_note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.hr_notes(id) on delete cascade,
  body text not null,
  title text,
  type text not null,
  edited_by text not null,
  edited_at timestamptz not null default now()
);
create index if not exists hr_note_versions_note_date_idx on public.hr_note_versions(note_id, edited_at desc);

create table if not exists public.hr_note_links (
  note_id uuid not null references public.hr_notes(id) on delete cascade,
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, attendance_id)
);

create table if not exists public.hr_note_files (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.hr_notes(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now()
);
create index if not exists hr_note_files_note_idx on public.hr_note_files(note_id, created_at);

create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  exported_by text not null,
  scope text not null check (scope in ('staff','day','all')),
  staff_ids uuid[] not null default '{}',
  date_from date not null,
  date_to date not null check (date_to >= date_from),
  include_notes boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists report_exports_company_created_idx on public.report_exports(company_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-notes', 'hr-notes', false, 5242880, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','application/pdf'];

alter table public.hr_notes enable row level security;
alter table public.hr_note_versions enable row level security;
alter table public.hr_note_links enable row level security;
alter table public.hr_note_files enable row level security;
alter table public.report_exports enable row level security;
revoke all on public.hr_notes, public.hr_note_versions, public.hr_note_links, public.hr_note_files, public.report_exports from anon, authenticated;
grant all on public.hr_notes, public.hr_note_versions, public.hr_note_links, public.hr_note_files, public.report_exports to service_role;

create or replace function public.set_hr_note_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.set_hr_note_updated_at() from public, anon, authenticated;
grant execute on function public.set_hr_note_updated_at() to service_role;
drop trigger if exists trg_hr_note_updated_at on public.hr_notes;
create trigger trg_hr_note_updated_at before update on public.hr_notes
for each row execute function public.set_hr_note_updated_at();
