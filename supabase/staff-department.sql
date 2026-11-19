-- Staff departments for attendance filtering. Safe to run more than once.
alter table public.staff
  add column if not exists department text not null default '';

create index if not exists staff_company_department_idx
  on public.staff(company_id, department);
