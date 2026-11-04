-- One-time staff password recovery codes. Run once in Supabase SQL Editor.
create table if not exists public.staff_password_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists staff_password_recovery_staff_expiry_idx
  on public.staff_password_recovery_codes(staff_id, expires_at desc)
  where used_at is null;

alter table public.staff_password_recovery_codes enable row level security;
revoke all on public.staff_password_recovery_codes from anon, authenticated;
grant all on public.staff_password_recovery_codes to service_role;

create or replace function public.consume_staff_password_recovery_code(
  p_staff_id uuid,
  p_auth_user_id uuid,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare consumed_id uuid;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  update public.staff_password_recovery_codes
    set used_at = now()
    where id = (
      select id from public.staff_password_recovery_codes
      where staff_id = p_staff_id
        and auth_user_id = p_auth_user_id
        and code_hash = p_code_hash
        and used_at is null
        and expires_at > now()
      order by created_at desc
      limit 1
      for update skip locked
    )
    and used_at is null
    and expires_at > now()
  returning id into consumed_id;
  return consumed_id is not null;
end;
$$;

revoke all on function public.consume_staff_password_recovery_code(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.consume_staff_password_recovery_code(uuid, uuid, text) to service_role;
