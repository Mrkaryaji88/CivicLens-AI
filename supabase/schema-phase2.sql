-- CivicLens AI initial Supabase schema. Review and apply in a fresh project.
-- Admin/staff provisioning is deliberately manual and trusted-server only.
create extension if not exists pgcrypto;
create type public.app_role as enum ('citizen', 'admin', 'staff');
create type public.complaint_status as enum ('submitted', 'verified', 'assigned', 'in_progress', 'resolved', 'rejected');
create type public.complaint_category as enum ('garbage', 'dustbin_overflow', 'water_leakage', 'drainage', 'road_damage', 'other');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  role public.app_role not null default 'citizen',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.departments (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  created_at timestamptz not null default now()
);
create table public.wards (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  created_at timestamptz not null default now()
);
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null default ('CL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  reporter_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  category public.complaint_category not null, location_text text not null check (char_length(location_text) between 3 and 300),
  ward text check (ward is null or char_length(ward) <= 100),
  ward_id uuid references public.wards(id), latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  status public.complaint_status not null default 'submitted',
  priority_score integer check (priority_score between 0 and 100), priority_override_reason text,
  assigned_to uuid references public.profiles(id), department_id uuid references public.departments(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.complaint_evidence (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id), storage_path text not null,
  evidence_type text not null check (evidence_type in ('initial', 'progress', 'resolution')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at timestamptz not null default now(), unique(storage_path)
);
create table public.complaint_assignments (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id) on delete cascade,
  staff_id uuid not null references public.profiles(id), assigned_by uuid not null references public.profiles(id),
  response text, accepted_at timestamptz, created_at timestamptz not null default now()
);
create table public.complaint_status_history (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id) on delete cascade,
  changed_by uuid not null references public.profiles(id), old_status public.complaint_status,
  new_status public.complaint_status not null, note text check (char_length(note) <= 2000), created_at timestamptz not null default now()
);
create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id) on delete cascade,
  provider text not null, result jsonb not null, confidence numeric(5,4) check (confidence between 0 and 1),
  requires_human_review boolean not null default true, created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  complaint_id uuid references public.complaints(id) on delete cascade, message text not null check (char_length(message) <= 1000),
  read_at timestamptz, created_at timestamptz not null default now()
);
create table public.feedback (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id) on delete cascade,
  citizen_id uuid not null references public.profiles(id), rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 2000), created_at timestamptz not null default now(), unique(complaint_id, citizen_id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id),
  action text not null, target_table text not null, target_id text, details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index complaints_status_created_idx on public.complaints(status, created_at desc);
create index complaints_assigned_idx on public.complaints(assigned_to, status);
create index complaints_ward_idx on public.complaints(ward_id, created_at desc);
create index evidence_complaint_idx on public.complaint_evidence(complaint_id, created_at);
create index assignments_staff_idx on public.complaint_assignments(staff_id, created_at desc);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- Role lookup cannot be changed by clients; never accept role claims from user metadata.
create function public.has_role(required public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = required)
$$;
revoke all on function public.has_role(public.app_role) from public;
grant execute on function public.has_role(public.app_role) to authenticated;

-- Keep status history in the same transaction as every authorized status update.
create function public.log_complaint_status_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null then
    insert into public.complaint_status_history(complaint_id, changed_by, old_status, new_status)
    values (new.id, auth.uid(), old.status, new.status);
  end if;
  return new;
end
$$;
create trigger complaint_status_history_trigger after update on public.complaints
for each row execute function public.log_complaint_status_change();

create function public.log_new_complaint_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    insert into public.complaint_status_history(complaint_id, changed_by, old_status, new_status)
    values (new.id, auth.uid(), null, new.status);
  end if;
  return new;
end
$$;
create trigger complaint_initial_status_history_trigger after insert on public.complaints
for each row execute function public.log_new_complaint_status();

-- Admin assignment is a single server-side transaction; clients cannot forge the actor role.
create function public.assign_complaint(p_public_id text, p_staff_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_complaint public.complaints%rowtype;
begin
  if not public.has_role('admin') then raise exception 'Admin role required'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_staff_id and p.role = 'staff') then
    raise exception 'Selected account is not staff';
  end if;
  select * into v_complaint from public.complaints where public_id = p_public_id for update;
  if not found then raise exception 'Complaint not found'; end if;
  if v_complaint.status in ('resolved', 'rejected') then raise exception 'Closed complaints cannot be assigned'; end if;
  update public.complaints set assigned_to = p_staff_id, status = 'assigned', updated_at = now()
  where id = v_complaint.id;
  insert into public.complaint_assignments(complaint_id, staff_id, assigned_by)
  values (v_complaint.id, p_staff_id, auth.uid());
  return v_complaint.id;
end
$$;
revoke all on function public.assign_complaint(text, uuid) from public;
grant execute on function public.assign_complaint(text, uuid) to authenticated;

-- New signups always receive the citizen role. Privileged roles require trusted provisioning.
create function public.create_citizen_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name, role)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Citizen'), 100), 'citizen');
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_citizen_profile();

-- Assigned staff can progress only their assigned report's status; admins manage operational fields.
create function public.guard_complaint_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.has_role('admin') then return new; end if;
  if not public.has_role('staff') or old.assigned_to is distinct from (select auth.uid()) then
    raise exception 'Not authorized to update this complaint';
  end if;
  if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'Staff may only update complaint status';
  end if;
  if not ((old.status = 'assigned' and new.status in ('in_progress', 'rejected')) or
          (old.status = 'in_progress' and new.status = 'resolved')) then
    raise exception 'Invalid staff status transition';
  end if;
  new.updated_at := now();
  return new;
end
$$;
create trigger guard_complaint_update before update on public.complaints
for each row execute function public.guard_complaint_update();

alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.wards enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_evidence enable row level security;
alter table public.complaint_assignments enable row level security;
alter table public.complaint_status_history enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.notifications enable row level security;
alter table public.feedback enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles visible to self or operations" on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.has_role('admin') or (public.has_role('staff') and role = 'staff'));
create policy "profile owner edits own display name only" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()) and role = 'citizen');
create policy "authenticated read departments" on public.departments for select to authenticated using (true);
create policy "authenticated read wards" on public.wards for select to authenticated using (true);
create policy "admin manages departments" on public.departments for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "admin manages wards" on public.wards for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "citizens submit own reports" on public.complaints for insert to authenticated
with check (reporter_id = (select auth.uid()) and status = 'submitted' and assigned_to is null and priority_score is null);
create policy "complaint visibility" on public.complaints for select to authenticated
using (reporter_id = (select auth.uid()) or assigned_to = (select auth.uid()) or public.has_role('admin'));
create policy "operations update complaints" on public.complaints for update to authenticated
using (public.has_role('admin') or assigned_to = (select auth.uid()))
with check (public.has_role('admin') or (assigned_to = (select auth.uid()) and public.has_role('staff')));
create policy "evidence visibility" on public.complaint_evidence for select to authenticated
using (exists (select 1 from public.complaints c where c.id = complaint_id and (c.reporter_id = (select auth.uid()) or c.assigned_to = (select auth.uid()) or public.has_role('admin'))));
create policy "evidence upload by reporter or assigned staff" on public.complaint_evidence for insert to authenticated
with check (uploaded_by = (select auth.uid()) and exists (select 1 from public.complaints c where c.id = complaint_id and (c.reporter_id = (select auth.uid()) or c.assigned_to = (select auth.uid()))));
create policy "assignment visibility" on public.complaint_assignments for select to authenticated
using (staff_id = (select auth.uid()) or public.has_role('admin'));
create policy "admins create assignments" on public.complaint_assignments for insert to authenticated
with check (public.has_role('admin') and assigned_by = (select auth.uid()) and
  exists (select 1 from public.profiles p where p.id = staff_id and p.role = 'staff'));
create policy "status history visibility" on public.complaint_status_history for select to authenticated
using (exists (select 1 from public.complaints c where c.id = complaint_id and (c.reporter_id = (select auth.uid()) or c.assigned_to = (select auth.uid()) or public.has_role('admin'))));
create policy "operations append status history" on public.complaint_status_history for insert to authenticated
with check (changed_by = (select auth.uid()) and (public.has_role('admin') or exists (select 1 from public.complaints c where c.id = complaint_id and c.assigned_to = (select auth.uid()))));
create policy "analysis visible to report parties" on public.ai_analyses for select to authenticated
using (exists (select 1 from public.complaints c where c.id = complaint_id and (c.reporter_id = (select auth.uid()) or c.assigned_to = (select auth.uid()) or public.has_role('admin'))));
create policy "admin stores analysis" on public.ai_analyses for insert to authenticated with check (public.has_role('admin'));
create policy "user reads own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "user marks own notifications read" on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "citizen feedback on own resolved report" on public.feedback for insert to authenticated
with check (citizen_id = (select auth.uid()) and exists (select 1 from public.complaints c where c.id = complaint_id and c.reporter_id = (select auth.uid()) and c.status = 'resolved'));
create policy "feedback visible to citizen or admin" on public.feedback for select to authenticated
using (citizen_id = (select auth.uid()) or public.has_role('admin'));
create policy "admin reads audit logs" on public.audit_logs for select to authenticated using (public.has_role('admin'));

-- Storage bucket and policies should be applied separately after creating `complaint-evidence`.
-- Keep the bucket private. Enforce image MIME and size limits in Storage settings/server functions.
