-- One-time HR recovery codes and shared brute-force protection.
create table if not exists public.password_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by text not null default 'developer_admin',
  created_at timestamptz not null default now()
);
create index if not exists password_recovery_user_expiry_idx on public.password_recovery_codes(auth_user_id, expires_at desc) where used_at is null;

create table if not exists public.password_recovery_attempts (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0,
  window_started_at timestamptz not null default now()
);

alter table public.password_recovery_codes enable row level security;
alter table public.password_recovery_attempts enable row level security;
revoke all on public.password_recovery_codes, public.password_recovery_attempts from anon, authenticated;
grant all on public.password_recovery_codes, public.password_recovery_attempts to service_role;

create or replace function public.take_password_recovery_attempt(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_attempts integer;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  insert into public.password_recovery_attempts as current_row(key_hash, attempts, window_started_at)
  values (p_key_hash, 1, now())
  on conflict (key_hash) do update set
    attempts = case when current_row.window_started_at <= now() - interval '15 minutes' then 1 else current_row.attempts + 1 end,
    window_started_at = case when current_row.window_started_at <= now() - interval '15 minutes' then now() else current_row.window_started_at end
  returning attempts into current_attempts;
  return current_attempts <= 5;
end;
$$;

create or replace function public.consume_password_recovery_code(p_user_id uuid, p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare consumed_id uuid;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  update public.password_recovery_codes
    set used_at = now()
    where id = (
      select id from public.password_recovery_codes
      where auth_user_id = p_user_id and code_hash = p_code_hash and used_at is null and expires_at > now()
      order by created_at desc limit 1
      for update skip locked
    )
    and used_at is null and expires_at > now()
  returning id into consumed_id;
  return consumed_id is not null;
end;
$$;

revoke all on function public.take_password_recovery_attempt(text) from public, anon, authenticated;
revoke all on function public.consume_password_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function public.take_password_recovery_attempt(text) to service_role;
grant execute on function public.consume_password_recovery_code(uuid, text) to service_role;
