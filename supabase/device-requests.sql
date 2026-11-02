-- Staff phone approval requests. Run once in the Supabase SQL Editor.
create table if not exists public.device_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  device_id text not null,
  device_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  unique (staff_id, device_id)
);

create index if not exists device_requests_status_requested_idx
  on public.device_requests(status, requested_at desc);
create index if not exists device_requests_staff_idx
  on public.device_requests(staff_id, requested_at desc);

alter table public.device_requests enable row level security;
revoke all on public.device_requests from anon, authenticated;
grant all on public.device_requests to service_role;

-- HR approves the request in the authenticated server route. Keep the attendance
-- device allowlist in sync so the staff member can retry immediately.
create or replace function public.apply_device_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.devices as current_device (staff_id, device_id, device_name, approved)
    values (new.staff_id, new.device_id, new.device_name, true)
    on conflict (staff_id, device_id) do update
      set approved = true,
          device_name = coalesce(excluded.device_name, current_device.device_name);
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.apply_device_request() from public, anon, authenticated;
drop trigger if exists trg_apply_device_request on public.device_requests;
create trigger trg_apply_device_request
  before update of status on public.device_requests
  for each row execute function public.apply_device_request();
