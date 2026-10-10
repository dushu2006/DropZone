-- ==========================================
-- MIGRATION: 20261010000000_phase1_identity_membership_foundation.sql
-- ==========================================

-- DropZone Phase 1: trusted identity, event membership, role permissions and audit foundation.
-- This migration contains no demo/seed records. Event creation and initial organizer assignment
-- are intentionally an operator-only bootstrap operation (see supabase/BOOTSTRAP.md).

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
set search_path = public, extensions, pg_catalog;

create type public.event_role as enum ('participant', 'organizer', 'moderator');
create type public.membership_status as enum ('active', 'suspended', 'revoked');
create type public.event_status as enum ('active', 'archived');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) between 1 and 80)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  status public.event_status not null default 'active',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint events_archive_state check ((status = 'active' and archived_at is null) or (status = 'archived' and archived_at is not null))
);

create table public.event_memberships (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.event_role not null default 'participant',
  permissions text[] not null default '{}',
  status public.membership_status not null default 'active',
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  constraint event_memberships_no_null_permissions check (pg_catalog.array_position(permissions, null) is null),
  constraint event_memberships_known_permissions check (
    permissions <@ array[
      'view_members', 'manage_members', 'manage_teams', 'manage_zones', 'manage_event',
      'manage_roles', 'grant_organizer', 'grant_moderator', 'review_reports',
      'remove_content', 'review_custom_posts', 'view_audit_log'
    ]::text[]
  ),
  constraint participants_have_no_privileged_permissions check (role <> 'participant' or cardinality(permissions) = 0),
  constraint moderators_only_have_moderation_permissions check (
    role <> 'moderator' or (
      cardinality(permissions) > 0 and
      permissions <@ array['review_reports', 'remove_content', 'review_custom_posts', 'view_audit_log']::text[]
    )
  )
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (event_id, id),
  unique (event_id, name)
);

create table public.team_memberships (
  event_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (event_id, team_id, user_id),
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade,
  foreign key (event_id, user_id) references public.event_memberships (event_id, user_id) on delete cascade
);

-- A circle stores its center as a PostGIS Point plus a radius in meters. A polygon stores
-- Polygon/MultiPolygon geometry. PostGIS is enabled now; geofence authorization is Phase 2.
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  boundary_type text not null check (boundary_type in ('circle', 'polygon')),
  boundary geometry(Geometry, 4326) not null,
  radius_meters integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name),
  constraint zones_boundary_shape check (
    (boundary_type = 'circle' and geometrytype(boundary) = 'POINT' and radius_meters between 5 and 50000)
    or
    (boundary_type = 'polygon' and geometrytype(boundary) in ('POLYGON', 'MULTIPOLYGON') and radius_meters is null)
  ),
  constraint zones_boundary_srid check (st_srid(boundary) = 4326),
  constraint zones_boundary_valid check (st_isvalid(boundary))
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  event_id uuid references public.events (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

-- Invitation tokens are generated in the browser using Web Crypto, hashed here with PostgreSQL's
-- SHA-256 binary-string function, and never stored in plaintext. Invites can only grant participant
-- membership; elevated roles are assigned through the permission-checked membership RPC below.
create table public.event_invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses between 1 and 100),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= max_uses),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index event_memberships_user_status_idx on public.event_memberships (user_id, status);
create index teams_event_id_idx on public.teams (event_id);
create index team_memberships_user_event_idx on public.team_memberships (user_id, event_id);
create index zones_event_id_idx on public.zones (event_id);
create index zones_boundary_gix on public.zones using gist (boundary);
create index audit_events_event_created_idx on public.audit_events (event_id, created_at desc);
create index audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at desc);
create index audit_events_action_created_idx on public.audit_events (action, created_at desc);
create index event_invitations_event_expiry_idx on public.event_invitations (event_id, expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();

create trigger event_memberships_set_updated_at before update on public.event_memberships
for each row execute function public.set_updated_at();

create trigger zones_set_updated_at before update on public.zones
for each row execute function public.set_updated_at();

-- Auth creates the profile row. Passwords and provider credentials remain exclusively in auth.users.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(pg_catalog.left(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Backfill existing auth.users registered before schema migration
insert into public.profiles (id, display_name)
select
  id,
  nullif(pg_catalog.left(pg_catalog.btrim(coalesce(raw_user_meta_data ->> 'display_name', '')), 80), '')
from auth.users
on conflict (id) do nothing;


-- These SECURITY DEFINER helpers intentionally accept no user-id argument. Callers cannot probe
-- another user's role by supplying a different identity.
create or replace function public.is_active_event_member(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_memberships as membership
    join public.events as event on event.id = membership.event_id
    where membership.event_id = p_event_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and event.status = 'active'
  );
$$;

create or replace function public.has_event_permission(p_event_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_memberships as membership
    join public.events as event on event.id = membership.event_id
    where membership.event_id = p_event_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and event.status = 'active'
      and p_permission = any(membership.permissions)
  );
$$;

create or replace function public.write_audit_event(
  p_event_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (event_id, actor_user_id, target_user_id, action, metadata)
  values (p_event_id, p_actor_user_id, p_target_user_id, p_action, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on function public.is_active_event_member(uuid) from public, anon;
revoke all on function public.has_event_permission(uuid, text) from public, anon;
revoke all on function public.write_audit_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.is_active_event_member(uuid) to authenticated;
grant execute on function public.has_event_permission(uuid, text) to authenticated;

create or replace function public.get_my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_access jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select profile.display_name
  into v_display_name
  from public.profiles as profile
  where profile.id = v_user_id;

  if v_display_name is null then
    select nullif(pg_catalog.left(pg_catalog.btrim(coalesce(raw_user_meta_data ->> 'display_name', 'DropZone Member')), 80), '')
    into v_display_name
    from auth.users
    where id = v_user_id;
  end if;

  select pg_catalog.jsonb_build_object(
    'user_id', v_user_id,
    'display_name', coalesce(v_display_name, 'DropZone Member'),
    'memberships', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'event_id', event.id,
            'event_name', event.name,
            'event_slug', event.slug,
            'role', membership.role,
            'permissions', membership.permissions,
            'status', membership.status
          ) order by event.name
        )
        from public.event_memberships as membership
        join public.events as event on event.id = membership.event_id
        where membership.user_id = v_user_id
          and membership.status = 'active'
          and event.status = 'active'
      ),
      '[]'::jsonb
    )
  )
  into v_access;

  return v_access;
end;
$$;

create or replace function public.create_event_invitation(
  p_event_id uuid,
  p_token text,
  p_expires_at timestamptz default (pg_catalog.now() + interval '7 days'),
  p_max_uses integer default 1
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.has_event_permission(p_event_id, 'manage_members') then
    raise exception 'You do not have permission to invite participants to this event.' using errcode = '42501';
  end if;
  if p_token is null or pg_catalog.length(p_token) not between 40 and 100 or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invitation token is invalid.' using errcode = '22023';
  end if;
  if p_expires_at <= pg_catalog.now() or p_expires_at > pg_catalog.now() + interval '30 days' then
    raise exception 'Invitation expiry must be within the next 30 days.' using errcode = '22023';
  end if;
  if p_max_uses not between 1 and 100 then
    raise exception 'Invitation use limit must be from 1 to 100.' using errcode = '22023';
  end if;

  insert into public.event_invitations (event_id, token_hash, expires_at, max_uses, created_by)
  values (p_event_id, pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), p_expires_at, p_max_uses, auth.uid())
  returning id into v_invitation_id;

  perform public.write_audit_event(
    p_event_id,
    auth.uid(),
    null,
    'event.invitation.created',
    pg_catalog.jsonb_build_object('invitation_id', v_invitation_id, 'expires_at', p_expires_at, 'max_uses', p_max_uses)
  );

  return query select v_invitation_id, p_expires_at;
end;
$$;

create or replace function public.accept_event_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_invitation public.event_invitations%rowtype;
  v_event public.events%rowtype;
  v_membership_status public.membership_status;
begin
  if v_user_id is null then
    raise exception 'Sign in before joining an event.' using errcode = '42501';
  end if;
  if p_token is null or pg_catalog.length(p_token) not between 40 and 100 or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invitation code is invalid or expired.' using errcode = '22023';
  end if;

  select invitation.*
  into v_invitation
  from public.event_invitations as invitation
  where invitation.token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
    and invitation.revoked_at is null
    and invitation.expires_at > pg_catalog.now()
    and invitation.use_count < invitation.max_uses
  for update;

  if not found then
    raise exception 'Invitation code is invalid, expired, revoked, or already used.' using errcode = '22023';
  end if;

  select event.* into v_event
  from public.events as event
  where event.id = v_invitation.event_id and event.status = 'active';
  if not found then
    raise exception 'This event is not accepting invitations.' using errcode = '22023';
  end if;

  select membership.status into v_membership_status
  from public.event_memberships as membership
  where membership.event_id = v_invitation.event_id and membership.user_id = v_user_id;

  if v_membership_status = 'active' then
    raise exception 'This account is already a member of the event.' using errcode = '23505';
  elsif v_membership_status = 'suspended' then
    raise exception 'This account cannot rejoin while its membership is suspended.' using errcode = '42501';
  elsif v_membership_status = 'revoked' then
    update public.event_memberships
    set role = 'participant', permissions = '{}', status = 'active', granted_by = v_invitation.created_by
    where event_id = v_invitation.event_id and user_id = v_user_id;
  else
    insert into public.event_memberships (event_id, user_id, role, permissions, status, granted_by)
    values (v_invitation.event_id, v_user_id, 'participant', '{}', 'active', v_invitation.created_by);
  end if;

  update public.event_invitations
  set use_count = use_count + 1
  where id = v_invitation.id;

  perform public.write_audit_event(
    v_invitation.event_id,
    v_user_id,
    v_user_id,
    'event.invitation.accepted',
    pg_catalog.jsonb_build_object('invitation_id', v_invitation.id)
  );

  return pg_catalog.jsonb_build_object(
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_slug', v_event.slug
  );
end;
$$;

create or replace function public.manage_event_membership(
  p_event_id uuid,
  p_user_id uuid,
  p_role public.event_role,
  p_permissions text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_permissions text[];
  v_previous_role public.event_role;
  v_previous_permissions text[];
begin
  if auth.uid() is null or p_user_id is null then
    raise exception 'Authentication and a target account are required.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot grant or change your own event role.' using errcode = '42501';
  end if;
  if not public.has_event_permission(p_event_id, 'manage_roles') then
    raise exception 'You do not have permission to manage event roles.' using errcode = '42501';
  end if;

  select membership.permissions into v_actor_permissions
  from public.event_memberships as membership
  where membership.event_id = p_event_id and membership.user_id = auth.uid() and membership.status = 'active';

  if p_role = 'participant' then
    if not public.has_event_permission(p_event_id, 'manage_members') or cardinality(coalesce(p_permissions, '{}')) <> 0 then
      raise exception 'Participant membership requires manage_members and no elevated permissions.' using errcode = '42501';
    end if;
  elsif p_role = 'organizer' then
    if not public.has_event_permission(p_event_id, 'grant_organizer') then
      raise exception 'You are not allowed to grant organizer access.' using errcode = '42501';
    end if;
  elsif p_role = 'moderator' then
    if not public.has_event_permission(p_event_id, 'grant_moderator') then
      raise exception 'You are not allowed to grant moderator access.' using errcode = '42501';
    end if;
    if cardinality(coalesce(p_permissions, '{}')) = 0 or not coalesce(p_permissions, '{}') <@ array['review_reports', 'remove_content', 'review_custom_posts', 'view_audit_log']::text[] then
      raise exception 'Moderators must receive explicit moderation permissions only.' using errcode = '22023';
    end if;
  end if;

  if not coalesce(p_permissions, '{}') <@ coalesce(v_actor_permissions, '{}') then
    raise exception 'You cannot grant permissions that you do not hold.' using errcode = '42501';
  end if;

  select membership.role, membership.permissions
  into v_previous_role, v_previous_permissions
  from public.event_memberships as membership
  where membership.event_id = p_event_id and membership.user_id = p_user_id;

  insert into public.event_memberships (event_id, user_id, role, permissions, status, granted_by)
  values (p_event_id, p_user_id, p_role, coalesce(p_permissions, '{}'), 'active', auth.uid())
  on conflict (event_id, user_id) do update
  set role = excluded.role,
      permissions = excluded.permissions,
      status = 'active',
      granted_by = excluded.granted_by;

  perform public.write_audit_event(
    p_event_id,
    auth.uid(),
    p_user_id,
    'event.membership.role_changed',
    pg_catalog.jsonb_build_object(
      'previous_role', v_previous_role,
      'previous_permissions', coalesce(v_previous_permissions, '{}'),
      'role', p_role,
      'permissions', coalesce(p_permissions, '{}')
    )
  );
end;
$$;

create or replace function public.revoke_event_membership(p_event_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role public.event_role;
  v_target_permissions text[];
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid() then
    raise exception 'A different target account and authenticated actor are required.' using errcode = '42501';
  end if;
  if not public.has_event_permission(p_event_id, 'manage_members') then
    raise exception 'You do not have permission to revoke event membership.' using errcode = '42501';
  end if;

  select role, permissions into v_target_role, v_target_permissions
  from public.event_memberships
  where event_id = p_event_id and user_id = p_user_id and status = 'active';
  if not found then
    raise exception 'Active event membership was not found.' using errcode = 'P0002';
  end if;
  if v_target_role = 'organizer' and not public.has_event_permission(p_event_id, 'grant_organizer') then
    raise exception 'You cannot revoke organizer access.' using errcode = '42501';
  end if;
  if v_target_role = 'moderator' and not public.has_event_permission(p_event_id, 'grant_moderator') then
    raise exception 'You cannot revoke moderator access.' using errcode = '42501';
  end if;

  -- Preserve the last assigned role/grants for auditability. Every authorization helper
  -- requires status = 'active', so a revoked row carries no effective access.
  update public.event_memberships
  set status = 'revoked'
  where event_id = p_event_id and user_id = p_user_id;

  perform public.write_audit_event(
    p_event_id,
    auth.uid(),
    p_user_id,
    'event.membership.revoked',
    pg_catalog.jsonb_build_object(
      'previous_role', v_target_role,
      'previous_permissions', coalesce(v_target_permissions, '{}')
    )
  );
end;
$$;

revoke all on function public.get_my_access() from public, anon;
revoke all on function public.create_event_invitation(uuid, text, timestamptz, integer) from public, anon;
revoke all on function public.accept_event_invitation(text) from public, anon;
revoke all on function public.manage_event_membership(uuid, uuid, public.event_role, text[]) from public, anon;
revoke all on function public.revoke_event_membership(uuid, uuid) from public, anon;
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.create_event_invitation(uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.accept_event_invitation(text) to authenticated;
grant execute on function public.manage_event_membership(uuid, uuid, public.event_role, text[]) to authenticated;
grant execute on function public.revoke_event_membership(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_memberships enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.zones enable row level security;
alter table public.audit_events enable row level security;
alter table public.event_invitations enable row level security;

-- Default deny first. Only the specific reads and self-profile update below are granted.
revoke all on table public.profiles, public.events, public.event_memberships, public.teams,
  public.team_memberships, public.zones, public.audit_events, public.event_invitations
from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select on table public.events, public.event_memberships, public.teams,
  public.team_memberships, public.zones, public.audit_events to authenticated;

grant usage on schema extensions to authenticated;

create policy profiles_read_self on public.profiles
for select to authenticated
using (id = auth.uid());

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy events_read_member on public.events
for select to authenticated
using (public.is_active_event_member(id));

create policy memberships_read_self_or_authorized_manager on public.event_memberships
for select to authenticated
using (user_id = auth.uid() or public.has_event_permission(event_id, 'view_members'));

create policy teams_read_event_member on public.teams
for select to authenticated
using (public.is_active_event_member(event_id));

create policy team_memberships_read_self_or_authorized_manager on public.team_memberships
for select to authenticated
using (user_id = auth.uid() or public.has_event_permission(event_id, 'view_members'));

create policy zones_read_event_member on public.zones
for select to authenticated
using (public.is_active_event_member(event_id));

create policy audit_events_read_auditor on public.audit_events
for select to authenticated
using (event_id is not null and public.has_event_permission(event_id, 'view_audit_log'));

-- No authenticated/anon policies or table privileges for role/membership/invitation/audit writes.
-- Trusted security-definer RPCs above are the only application mutation path for those records.
comment on table public.event_memberships is 'Event-scoped authorization source of truth. Writes are restricted to permission-checked RPCs or trusted operator bootstrap.';
comment on column public.event_memberships.permissions is 'Explicit grants only; roles never imply moderator permissions.';
comment on table public.zones is 'PostGIS boundaries are stored here; Phase 2 implements server-side geofence authorization.';
comment on table public.audit_events is 'Append-only security audit. Event deletion nulls event_id; account deletion nulls actor/target identifiers.';
comment on table public.event_invitations is 'Participant-only single-use or limited-use invitations; raw tokens are never persisted.';
comment on table public.events is 'Events are archived rather than hard-deleted during normal operation.';


-- ==========================================
-- MIGRATION: 20261010010000_phase2_workflow_schema.sql
-- ==========================================

-- Additive Phase 2 schema. No demonstration records. Configuration rows are policy, not activity.
set search_path = public, extensions, pg_catalog;
alter table public.events add column starts_at timestamptz, add column ends_at timestamptz,
  add column location_required boolean not null default false,
  add column max_accuracy_meters integer not null default 100 check (max_accuracy_meters between 5 and 500),
  add column downloads_allowed boolean not null default true,
  add constraint event_schedule check (ends_at is null or starts_at is null or ends_at > starts_at);
alter table public.zones add constraint zones_circle_radius_required check (boundary_type<>'circle' or radius_meters is not null);
alter table public.zones add constraint zones_not_empty check (not st_isempty(boundary));
alter table public.zones add constraint zones_coordinate_bounds check (st_xmin(box3d(boundary)) >= -180 and st_xmax(box3d(boundary)) <= 180 and st_ymin(box3d(boundary)) >= -90 and st_ymax(box3d(boundary)) <= 90);
alter table public.zones add constraint zones_area check (boundary_type = 'circle' or st_area(boundary::geography) >= 1);
alter table public.zones add constraint zones_event_identity unique(event_id,id);

create table public.post_rules (
  category text primary key,
  required_fields text[] not null,
  allowed_fields text[] not null,
  lifetime_hours integer not null check (lifetime_hours between 1 and 720),
  review_required boolean not null default false
);
insert into public.post_rules values
 ('lost_found',array['kind','item'],array['kind','item','place','approximate_time','response_preference'],24,false),
 ('find_teammate',array['activity','skills','openings'],array['activity','skills','openings','response_preference'],24,false),
 ('need_resource',array['item','quantity'],array['item','quantity','pickup','response_preference'],6,false),
 ('ask_help',array['help_category'],array['help_category','context','response_preference'],6,false),
 ('offer_resource',array['offering','availability'],array['offering','availability','quantity','response_preference'],6,false),
 ('promotion',array['offer','valid_until'],array['offer','valid_until'],24,true),
 ('community_question',array['topic'],array['topic'],12,false),
 ('custom',array['reason'],array['reason','audience'],24,true);
create table public.posts (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events,
 author_id uuid not null references public.profiles, zone_id uuid,
 category text not null references public.post_rules,
 title text not null check(length(btrim(title)) between 2 and 160),
 body text not null check(length(btrim(body)) between 2 and 5000),
 fields jsonb not null check(jsonb_typeof(fields)='object'),
 status text not null check(status in ('submitted','awaiting_review','changes_requested','published','rejected','cancelled','resolved','expired','deleted','removed')),
 decision_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 expires_at timestamptz not null, deleted_at timestamptz,
 unique(event_id,id), foreign key(event_id,zone_id) references public.zones(event_id,id)
);
create index posts_feed on public.posts(event_id,status,created_at desc,id);
create index posts_category_zone on public.posts(event_id,category,zone_id,expires_at);
create index posts_search on public.posts using gin(to_tsvector('simple', title || ' ' || body));
create table public.replies (
 id uuid primary key default gen_random_uuid(), event_id uuid not null, post_id uuid not null,
 author_id uuid not null references public.profiles, parent_id uuid,
 body text not null check(length(btrim(body)) between 1 and 3000),
 created_at timestamptz not null default now(), removed_at timestamptz,
 unique(post_id,id), foreign key(event_id,post_id) references public.posts(event_id,id),
 foreign key(post_id,parent_id) references public.replies(post_id,id)
);
create index replies_thread on public.replies(post_id,created_at,id);
create table public.user_preferences (
 event_id uuid not null references public.events, user_id uuid not null references public.profiles,
 target_id uuid not null references public.profiles, blocked boolean not null default false, muted boolean not null default false,
 primary key(event_id,user_id,target_id), check(user_id<>target_id)
);
create table public.reports (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events,
 reporter_id uuid not null references public.profiles,
 target_type text not null check(target_type in ('post','reply','user')), target_id uuid not null,
 reason text not null check(reason in ('spam','harassment','privacy','unsafe','other')),
 explanation text not null default '' check(length(explanation)<=2000),
 status text not null default 'open' check(status in ('open','dismissed','removed','escalated','restricted')),
 decision_reason text, decided_by uuid references public.profiles, created_at timestamptz not null default now(), decided_at timestamptz,
 unique(event_id,reporter_id,target_type,target_id)
);
create index reports_queue on public.reports(event_id,status,created_at);
create table public.user_restrictions (
 event_id uuid not null references public.events, user_id uuid not null references public.profiles,
 until_at timestamptz not null, reason text not null, actor_id uuid not null references public.profiles,
 primary key(event_id,user_id)
);
create table public.conversations (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events,
 participant_id uuid not null references public.profiles,
 subject text not null check(length(btrim(subject)) between 2 and 160),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(event_id,id)
);
create index conversations_inbox on public.conversations(event_id,participant_id,updated_at desc);
create table public.messages (
 id uuid primary key default gen_random_uuid(), event_id uuid not null, conversation_id uuid not null,
 sender_id uuid not null references public.profiles, body text not null check(length(btrim(body)) between 1 and 3000),
 created_at timestamptz not null default now(), foreign key(event_id,conversation_id) references public.conversations(event_id,id)
);
create index messages_thread on public.messages(conversation_id,created_at,id);
create table public.conversation_reads (
 conversation_id uuid not null references public.conversations, user_id uuid not null references public.profiles,
 read_at timestamptz not null default now(), primary key(conversation_id,user_id)
);
create table public.communications (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events,
 sender_id uuid not null references public.profiles,
 kind text not null check(kind in ('announcement','schedule_update','contact','official_promotion','community_notice')),
 title text not null check(length(btrim(title)) between 2 and 160), body text not null check(length(btrim(body)) between 1 and 5000),
 scope text not null check(scope in ('event','teams','participant')), targets uuid[] not null default '{}',
 created_at timestamptz not null default now(), state text not null default 'delivered_in_app', unique(event_id,id)
);
create table public.communication_recipients (
 event_id uuid not null, communication_id uuid not null, user_id uuid not null references public.profiles,
 primary key(communication_id,user_id), foreign key(event_id,communication_id) references public.communications(event_id,id)
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events,
 user_id uuid not null references public.profiles, kind text not null,
 resource_id uuid not null, title text not null, created_at timestamptz not null default now(), read_at timestamptz,
 unique(user_id,kind,resource_id)
);
create index notifications_inbox on public.notifications(user_id,event_id,read_at,created_at desc);
create table public.roster_imports (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events,
 actor_id uuid not null references public.profiles, imported integer not null, skipped integer not null,
 created_at timestamptz not null default now()
);
create table public.roster_records (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events,
 email text not null, display_name text not null, team_name text not null default '',
 import_id uuid not null references public.roster_imports, created_at timestamptz not null default now(),
 unique(event_id,email), check(email=lower(btrim(email)))
);
create table public.attachments (
 id uuid primary key default gen_random_uuid(), event_id uuid not null, post_id uuid not null,
 owner_id uuid not null references public.profiles, object_path text not null unique,
 mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 5242880),
 status text not null default 'pending' check(status in ('pending','ready','deleted')),
 created_at timestamptz not null default now(), foreign key(event_id,post_id) references public.posts(event_id,id)
);
create table public.rate_rules (action text primary key, max_requests integer not null check(max_requests>0), window_seconds integer not null check(window_seconds>0));
insert into public.rate_rules values ('post',10,3600),('custom',4,3600),('promotion',2,86400),('reply',30,600),('report',10,3600),('message',30,600),('invitation',20,3600),('staff',60,600),('upload',10,3600);
create table public.rate_counters (user_id uuid not null, event_id uuid not null, action text not null, window_start timestamptz not null, count integer not null, primary key(user_id,event_id,action));
create table public.command_receipts (user_id uuid not null, request_id uuid not null, event_id uuid not null, action text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(user_id,request_id));

create function public.dz_require(p_event uuid, p_permission text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_active_event_member(p_event) then raise exception 'Active event membership required.' using errcode='42501'; end if;
 if p_permission is not null and not public.has_event_permission(p_event,p_permission) then raise exception 'Required event permission is not assigned.' using errcode='42501'; end if;
end $$;
create function public.dz_rate(p_event uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare r public.rate_rules; c public.rate_counters; t timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_event::text||p_action,0));
 select * into strict r from public.rate_rules where action=p_action;
 insert into public.rate_counters values(auth.uid(),p_event,p_action,t,0) on conflict do nothing;
 select * into strict c from public.rate_counters where user_id=auth.uid() and event_id=p_event and action=p_action for update;
 if c.window_start + make_interval(secs=>r.window_seconds)<=t then c.count:=0; c.window_start:=t; end if;
 if c.count>=r.max_requests then raise exception 'Rate limit reached. Retry in % seconds.', greatest(1,ceil(extract(epoch from c.window_start+make_interval(secs=>r.window_seconds)-t))) using errcode='P0001'; end if;
 update public.rate_counters set count=c.count+1,window_start=c.window_start where user_id=auth.uid() and event_id=p_event and action=p_action;
end $$;
create function public.dz_blocked(e uuid,a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_preferences where event_id=e and blocked and ((user_id=a and target_id=b) or (user_id=b and target_id=a)));
$$;
create function public.dz_post_visible(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.posts where id=p and public.is_active_event_member(event_id) and
 (author_id=auth.uid() or public.has_event_permission(event_id,'review_reports') or public.has_event_permission(event_id,'review_custom_posts') or
 (status in ('published','resolved','expired') and not public.dz_blocked(event_id,auth.uid(),author_id))));
$$;
create function public.dz_conversation_visible(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversations where id=c and public.is_active_event_member(event_id) and (participant_id=auth.uid() or public.has_event_permission(event_id,'manage_members')));
$$;
create function public.dz_notify(e uuid,u uuid,k text,r uuid,t text,actor uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if u is null or u=actor then return; end if;
 if exists(select 1 from public.event_memberships where event_id=e and user_id=u and status='active') and
 (actor is null or not exists(select 1 from public.user_preferences where event_id=e and user_id=u and target_id=actor and (muted or blocked))) then
 insert into public.notifications(event_id,user_id,kind,resource_id,title) values(e,u,k,r,t) on conflict(user_id,kind,resource_id) do update set title=excluded.title,read_at=null,created_at=now();
 end if;
end $$;
create function public.dz_writable(e uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.dz_require(e);
 if exists(select 1 from public.user_restrictions where event_id=e and user_id=auth.uid() and until_at>now()) then raise exception 'Posting and messaging are temporarily restricted. Contact the event administrator.' using errcode='42501'; end if;
end $$;
alter table public.post_rules enable row level security;
revoke all on public.post_rules from anon, authenticated;
grant select on public.post_rules to authenticated;
create policy post_rules_read on public.post_rules for select to authenticated using (true);
alter table public.posts enable row level security;
revoke all on public.posts from anon, authenticated;
grant select on public.posts to authenticated;
create policy posts_read on public.posts for select to authenticated using (public.dz_post_visible(id));
alter table public.replies enable row level security;
revoke all on public.replies from anon, authenticated;
grant select on public.replies to authenticated;
create policy replies_read on public.replies for select to authenticated using (public.dz_post_visible(post_id) and (removed_at is null or public.has_event_permission(event_id,'review_reports')) and not public.dz_blocked(event_id,auth.uid(),author_id));
alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
grant select on public.user_preferences to authenticated;
create policy user_preferences_read on public.user_preferences for select to authenticated using (user_id=auth.uid() and public.is_active_event_member(event_id));
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
create policy reports_read on public.reports for select to authenticated using (public.is_active_event_member(event_id) and (reporter_id=auth.uid() or public.has_event_permission(event_id,'review_reports')));
alter table public.user_restrictions enable row level security;
revoke all on public.user_restrictions from anon, authenticated;
grant select on public.user_restrictions to authenticated;
create policy user_restrictions_read on public.user_restrictions for select to authenticated using (public.is_active_event_member(event_id) and (user_id=auth.uid() or public.has_event_permission(event_id,'review_reports')));
alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
create policy conversations_read on public.conversations for select to authenticated using (public.dz_conversation_visible(id));
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
create policy messages_read on public.messages for select to authenticated using (public.dz_conversation_visible(conversation_id));
alter table public.conversation_reads enable row level security;
revoke all on public.conversation_reads from anon, authenticated;
grant select on public.conversation_reads to authenticated;
create policy conversation_reads_read on public.conversation_reads for select to authenticated using (user_id=auth.uid() and public.dz_conversation_visible(conversation_id));
alter table public.communications enable row level security;
revoke all on public.communications from anon, authenticated;
grant select on public.communications to authenticated;
create policy communications_read on public.communications for select to authenticated using (public.is_active_event_member(event_id) and (public.has_event_permission(event_id,'manage_event') or exists(select 1 from public.communication_recipients r where r.communication_id=id and r.user_id=auth.uid())));
alter table public.communication_recipients enable row level security;
revoke all on public.communication_recipients from anon, authenticated;
grant select on public.communication_recipients to authenticated;
create policy communication_recipients_read on public.communication_recipients for select to authenticated using (public.is_active_event_member(event_id) and (user_id=auth.uid() or public.has_event_permission(event_id,'manage_event')));
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated using (user_id=auth.uid() and public.is_active_event_member(event_id));
alter table public.roster_imports enable row level security;
revoke all on public.roster_imports from anon, authenticated;
grant select on public.roster_imports to authenticated;
create policy roster_imports_read on public.roster_imports for select to authenticated using (public.has_event_permission(event_id,'manage_members'));
alter table public.roster_records enable row level security;
revoke all on public.roster_records from anon, authenticated;
grant select on public.roster_records to authenticated;
create policy roster_records_read on public.roster_records for select to authenticated using (public.has_event_permission(event_id,'manage_members'));
alter table public.attachments enable row level security;
revoke all on public.attachments from anon, authenticated;
grant select on public.attachments to authenticated;
create policy attachments_read on public.attachments for select to authenticated using (public.dz_post_visible(post_id) and (status='ready' or owner_id=auth.uid()));
alter table public.rate_rules enable row level security;
revoke all on public.rate_rules from anon, authenticated;
alter table public.rate_counters enable row level security;
revoke all on public.rate_counters from anon, authenticated;
alter table public.command_receipts enable row level security;
revoke all on public.command_receipts from anon, authenticated;
revoke all on function public.dz_require(uuid,text) from public,anon,authenticated;
revoke all on function public.dz_rate(uuid,text) from public,anon,authenticated;
revoke all on function public.dz_blocked(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.dz_post_visible(uuid) from public,anon,authenticated;
revoke all on function public.dz_conversation_visible(uuid) from public,anon,authenticated;
revoke all on function public.dz_notify(uuid,uuid,text,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.dz_writable(uuid) from public,anon,authenticated;
grant execute on function public.dz_blocked(uuid,uuid,uuid) to authenticated;
grant execute on function public.dz_post_visible(uuid) to authenticated;
grant execute on function public.dz_conversation_visible(uuid) to authenticated;


-- ==========================================
-- MIGRATION: 20261010011000_phase2_content_operations.sql
-- ==========================================

set search_path=public,extensions,pg_catalog;
create function public.check_zone_location(p_zone uuid,p_lon double precision,p_lat double precision,p_accuracy double precision) returns boolean
language plpgsql security definer set search_path='' as $$
declare z public.zones; threshold integer; point extensions.geometry;
begin
 select * into z from public.zones where id=p_zone;
 perform public.dz_require(z.event_id);
 select max_accuracy_meters into threshold from public.events where id=z.event_id;
 if p_lon is null or p_lat is null or p_lon not between -180 and 180 or p_lat not between -90 and 90 then raise exception 'Invalid geographic coordinates.'; end if;
 if p_accuracy is null or p_accuracy not between 0 and threshold then raise exception 'Location accuracy is insufficient. Retry outdoors or near a window.'; end if;
 point:=extensions.st_setsrid(extensions.st_makepoint(p_lon,p_lat),4326);
 if z.boundary_type='circle' then return extensions.st_dwithin(z.boundary::extensions.geography,point::extensions.geography,z.radius_meters); end if;
 return extensions.st_covers(z.boundary,point);
end $$;
revoke all on function public.check_zone_location(uuid,double precision,double precision,double precision) from public,anon;
grant execute on function public.check_zone_location(uuid,double precision,double precision,double precision) to authenticated;

create function public.dz_validate_post(category text,fields jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.post_rules; k text; v jsonb;
begin
 select * into r from public.post_rules where post_rules.category=dz_validate_post.category;
 if not found or fields is null or jsonb_typeof(fields)<>'object' then raise exception 'Unknown post template or invalid fields.'; end if;
 for k in select unnest(r.required_fields) loop
 if coalesce(length(btrim(fields->>k)),0)=0 then raise exception 'Required template field: %',k; end if;
 end loop;
 for k,v in select * from jsonb_each(fields) loop
 if not k=any(r.allowed_fields) or jsonb_typeof(v) not in ('string','number') or length(v#>>'{}')>1000 then raise exception 'Invalid template field: %',k; end if;
 end loop;
 if fields ? 'response_preference' and fields->>'response_preference' not in ('thread_reply','organizer_contact') then raise exception 'Invalid response preference.'; end if;
 if category='lost_found' and fields->>'kind' not in ('lost','found') then raise exception 'Choose lost or found.'; end if;
 if fields ? 'quantity' and (fields->>'quantity' !~ '^[0-9]{1,4}$' or (fields->>'quantity')::int not between 1 and 1000) then raise exception 'Quantity must be 1–1000.'; end if;
 if category='find_teammate' and (fields->>'openings' !~ '^[0-9]{1,2}$' or (fields->>'openings')::int not between 1 and 50) then raise exception 'Openings must be 1–50.'; end if;
 if fields ? 'approximate_time' and (fields->>'approximate_time')::timestamptz > now()+interval '1 day' then raise exception 'Approximate time is too far in the future.'; end if;
 if category='promotion' and ((fields->>'valid_until')::timestamptz<=now() or (fields->>'valid_until')::timestamptz>now()+interval '30 days') then raise exception 'Promotion validity must be within 30 days.'; end if;
end $$;

create function public.dz_content(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.posts; r public.post_rules; result_id uuid; target uuid; rep public.reports; v_reason text:=btrim(d->>'reason'); next_status text; old_status text;
begin
 perform public.dz_require(e);
 if a in ('post.create','post.revise') then
 perform public.dz_writable(e);
 perform public.dz_validate_post(d->>'category',d->'fields');
 select * into strict r from public.post_rules where category=d->>'category';
 perform public.dz_rate(e,case when r.category in ('custom','promotion') then r.category else 'post' end);
 if exists(select 1 from public.events where id=e and location_required) then
 if nullif(d->>'zone_id','') is null or public.check_zone_location((d->>'zone_id')::uuid,(d->>'longitude')::float8,(d->>'latitude')::float8,(d->>'accuracy')::float8) is distinct from true then raise exception 'A successful location check inside the selected event zone is required.'; end if;
 end if;
 if a='post.create' then
 insert into public.posts(event_id,author_id,zone_id,category,title,body,fields,status,expires_at)
 values(e,auth.uid(),nullif(d->>'zone_id','')::uuid,r.category,btrim(d->>'title'),btrim(d->>'body'),d->'fields',case when r.review_required then case when d->>'review_mode'='save_submission' then 'submitted' else 'awaiting_review' end else 'published' end,
 least(now()+make_interval(hours=>r.lifetime_hours),coalesce((d->'fields'->>'valid_until')::timestamptz,'infinity')))
 returning * into p;
 else
 select * into p from public.posts where id=(d->>'id')::uuid and event_id=e for update;
 if not found or p.author_id<>auth.uid() or p.status not in ('changes_requested','submitted') or p.category<>r.category or p.expires_at<=now() then raise exception 'This submission cannot be revised.' using errcode='42501'; end if;
 update public.posts set title=btrim(d->>'title'),body=btrim(d->>'body'),fields=d->'fields',zone_id=nullif(d->>'zone_id','')::uuid,status='awaiting_review',decision_reason=null,updated_at=now(),expires_at=least(now()+make_interval(hours=>r.lifetime_hours),coalesce((d->'fields'->>'valid_until')::timestamptz,'infinity')) where id=p.id returning * into p;
 end if;
 perform public.write_audit_event(e,auth.uid(),auth.uid(),a,jsonb_build_object('post_id',p.id,'status',p.status));
 return to_jsonb(p);
 elsif a='reply.create' then
 perform public.dz_writable(e); perform public.dz_rate(e,'reply');
 select * into p from public.posts where id=(d->>'post_id')::uuid and event_id=e;
 if not found or not public.dz_post_visible(p.id) or p.status<>'published' or p.expires_at<=now() or public.dz_blocked(e,auth.uid(),p.author_id) then raise exception 'This thread is not open for replies.' using errcode='42501'; end if;
 insert into public.replies(event_id,post_id,author_id,parent_id,body) values(e,p.id,auth.uid(),nullif(d->>'parent_id','')::uuid,btrim(d->>'body')) returning id into result_id;
 perform public.dz_notify(e,p.author_id,'reply',result_id,'New response to your post',auth.uid());
 return jsonb_build_object('id',result_id);
 elsif a in ('post.resolve','post.delete','post.cancel','post.review','post.enqueue') then
 select * into p from public.posts where id=(d->>'id')::uuid and event_id=e for update;
 if not found then raise exception 'Post not found.'; end if;
 old_status:=p.status;
 if a='post.review' then
 perform public.dz_require(e,'review_custom_posts');
 if p.author_id=auth.uid() or p.status<>'awaiting_review' or p.expires_at<=now() then raise exception 'Submission is not eligible for review.'; end if;
 if coalesce(length(v_reason),0) not between 3 and 2000 or d->>'decision' not in ('published','changes_requested','rejected') then raise exception 'A valid decision and reason are required.'; end if;
 next_status:=d->>'decision';
 else
 if p.author_id<>auth.uid() then raise exception 'Only the author may perform this action. Use moderation for removal.' using errcode='42501'; end if;
 if a='post.enqueue' and (p.status<>'submitted' or p.expires_at<=now()) then raise exception 'Only saved submissions can enter review.'; end if;
 if a='post.resolve' and (p.status<>'published' or p.expires_at<=now()) then raise exception 'Only active published posts can be resolved.'; end if;
 if a='post.cancel' and p.status not in ('submitted','awaiting_review','changes_requested') then raise exception 'Only pending submissions can be cancelled.'; end if;
 next_status:=case a when 'post.enqueue' then 'awaiting_review' when 'post.resolve' then 'resolved' when 'post.cancel' then 'cancelled' else 'deleted' end;
 end if;
 update public.posts set status=next_status,decision_reason=case when a='post.review' then v_reason else decision_reason end,updated_at=now(),deleted_at=case when next_status='deleted' then now() else deleted_at end where id=p.id;
 perform public.write_audit_event(e,auth.uid(),p.author_id,a,jsonb_build_object('post_id',p.id,'previous_status',old_status,'status',next_status,'reason',v_reason));
 perform public.dz_notify(e,p.author_id,'post_decision',p.id,'Your post status changed',null);
 return jsonb_build_object('id',p.id,'status',next_status);
 elsif a='preference.set' then
 target:=(d->>'target_id')::uuid;
 if not exists(select 1 from public.event_memberships where event_id=e and user_id=target and status='active') then raise exception 'Event member not found.'; end if;
 insert into public.user_preferences values(e,auth.uid(),target,coalesce((d->>'blocked')::boolean,false),coalesce((d->>'muted')::boolean,false))
 on conflict(event_id,user_id,target_id) do update set blocked=excluded.blocked,muted=excluded.muted;
 return jsonb_build_object('saved',true);
 elsif a='report.create' then
 perform public.dz_writable(e); perform public.dz_rate(e,'report'); target:=(d->>'target_id')::uuid;
 if not ((d->>'target_type'='post' and exists(select 1 from public.posts where id=target and event_id=e and public.dz_post_visible(id))) or
 (d->>'target_type'='reply' and exists(select 1 from public.replies where id=target and event_id=e and public.dz_post_visible(post_id))) or
 (d->>'target_type'='user' and exists(select 1 from public.event_memberships where event_id=e and user_id=target and status='active'))) then raise exception 'Report target is not accessible.' using errcode='42501'; end if;
 insert into public.reports(event_id,reporter_id,target_type,target_id,reason,explanation) values(e,auth.uid(),d->>'target_type',target,d->>'reason',coalesce(d->>'explanation','')) returning id into result_id;
 return jsonb_build_object('id',result_id,'status','open');
 elsif a='report.decide' then
 perform public.dz_require(e,'review_reports'); perform public.dz_rate(e,'staff');
 select * into rep from public.reports where id=(d->>'id')::uuid and event_id=e for update;
 if not found or rep.status not in ('open','escalated') then raise exception 'Report is not open.'; end if;
 if coalesce(length(v_reason),0) not between 3 and 2000 or d->>'decision' not in ('dismissed','removed','escalated','restricted') then raise exception 'A valid decision and reason are required.'; end if;
 if d->>'decision' in ('removed','restricted') then perform public.dz_require(e,'remove_content'); end if;
 if d->>'decision'='removed' then
 if rep.target_type='post' then update public.posts set status='removed',decision_reason=v_reason,updated_at=now() where event_id=e and id=rep.target_id returning author_id into target;
 elsif rep.target_type='reply' then update public.replies set removed_at=now() where event_id=e and id=rep.target_id returning author_id into target;
 else raise exception 'A user cannot be removed as content; choose a restriction.'; end if;
 elsif d->>'decision'='restricted' then
 if rep.target_type<>'user' then raise exception 'Restrictions require a user report.'; end if;
 target:=rep.target_id;
 if exists(select 1 from public.event_memberships where event_id=e and user_id=target and role<>'participant') then raise exception 'Staff restrictions require a trusted administrator.'; end if;
 insert into public.user_restrictions values(e,target,now()+interval '24 hours',v_reason,auth.uid()) on conflict(event_id,user_id) do update set until_at=excluded.until_at,reason=excluded.reason,actor_id=excluded.actor_id;
 end if;
 update public.reports set status=d->>'decision',decision_reason=v_reason,decided_by=auth.uid(),decided_at=now() where id=rep.id;
 perform public.write_audit_event(e,auth.uid(),target,'moderation.decision',jsonb_build_object('report_id',rep.id,'target_id',rep.target_id,'decision',d->>'decision','reason',v_reason));
 perform public.dz_notify(e,rep.reporter_id,'report_decision',rep.id,'Your report has a decision',null);
 perform public.dz_notify(e,target,'moderation_decision',rep.id,'A moderation decision affects your content or account',null);
 return jsonb_build_object('id',rep.id,'status',d->>'decision');
 end if;
 raise exception 'Unknown content operation.';
end $$;
revoke all on function public.dz_content(uuid,text,jsonb),public.dz_validate_post(text,jsonb) from public,anon,authenticated;

-- Expiry in feed queries is immediate even without a scheduler. This maintenance function also
-- materializes terminal states and redacts deleted bodies after a 30-day recovery period.
create function public.dz_maintenance() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.posts set status='expired',updated_at=now() where status in ('published','submitted','awaiting_review','changes_requested') and expires_at<=now();
 update public.posts set body='[Deleted content]',title='Deleted post',fields='{}' where status='deleted' and deleted_at<now()-interval '30 days' and body<>'[Deleted content]';
 update public.attachments set status='deleted' where status='pending' and created_at<now()-interval '24 hours';
 update public.attachments a set status='deleted' from public.posts p where p.id=a.post_id and p.deleted_at<now()-interval '30 days';
 update public.replies r set body='[Deleted content]' from public.posts p where p.id=r.post_id and p.deleted_at<now()-interval '30 days' and r.body<>'[Deleted content]';
 delete from public.command_receipts where created_at<now()-interval '7 days';
 delete from public.rate_counters where window_start<now()-interval '2 days';
 delete from public.notifications where created_at<now()-interval '90 days';
 delete from public.conversation_reads where conversation_id in (select c.id from public.conversations c join public.events e on e.id=c.event_id where e.archived_at<now()-interval '180 days');
 delete from public.messages where event_id in (select id from public.events where archived_at<now()-interval '180 days');
 delete from public.conversations where event_id in (select id from public.events where archived_at<now()-interval '180 days');
 delete from public.roster_records where event_id in (select id from public.events where archived_at<now()-interval '180 days');
 delete from public.roster_imports where event_id in (select id from public.events where archived_at<now()-interval '180 days');
 update public.attachments set status='deleted' where event_id in (select id from public.events where archived_at<now()-interval '180 days');
 update public.posts set title='Retained post record',body='[Content retention period ended]',fields='{}' where event_id in (select id from public.events where archived_at<now()-interval '180 days');
 update public.replies set body='[Content retention period ended]' where event_id in (select id from public.events where archived_at<now()-interval '180 days');
end $$;
revoke all on function public.dz_maintenance() from public,anon,authenticated;
grant execute on function public.dz_maintenance() to service_role;


-- ==========================================
-- MIGRATION: 20261010012000_phase2_staff_and_messaging.sql
-- ==========================================

set search_path=public,extensions,pg_catalog;
create function public.dz_roster_preview(e uuid,rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare row jsonb; errors jsonb:='[]'; i integer:=1; v_email text;
begin
 perform public.dz_require(e,'manage_members');
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 1000 then raise exception 'Preview requires 1–1000 roster rows.'; end if;
 for row in select value from jsonb_array_elements(rows) loop
 i:=i+1; v_email:=lower(btrim(row->>'email'));
 if exists(select 1 from public.roster_records r where r.event_id=e and r.email=v_email and (r.team_name<>btrim(coalesce(row->>'team_name','')) or r.display_name<>btrim(row->>'display_name'))) then
 errors:=errors||jsonb_build_array('Row '||i||': existing roster name or team conflicts.'); end if;
 if coalesce(btrim(row->>'team_name'),'')<>'' and exists(select 1 from auth.users u join public.team_memberships tm on tm.user_id=u.id join public.teams t on t.id=tm.team_id and t.event_id=tm.event_id where tm.event_id=e and lower(u.email)=v_email and t.name<>btrim(row->>'team_name')) then
 errors:=errors||jsonb_build_array('Row '||i||': confirmed account has a conflicting current team.'); end if;
 end loop;
 return errors;
end $$;
revoke all on function public.dz_roster_preview(uuid,jsonb) from public,anon;
grant execute on function public.dz_roster_preview(uuid,jsonb) to authenticated;

create function public.dz_staff(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result_id uuid; actor public.event_memberships; boundary extensions.geometry; row jsonb; v_imported int:=0; v_skipped int:=0; existing public.roster_records; team uuid; target uuid;
begin
 if a in ('event.create','event.update') and length(coalesce(d->>'description',''))>5000 then raise exception 'Event description exceeds 5000 characters.'; end if;
 if a='event.create' then
 -- A trusted organizer can create another event, with only grants they already hold.
 select * into actor from public.event_memberships where event_id=e and user_id=auth.uid() and status='active' and role='organizer' and 'manage_event'=any(permissions);
 if not found then raise exception 'Existing trusted organizer permission required.' using errcode='42501'; end if;
 perform public.dz_rate(e,'staff');
 insert into public.events(name,slug,description,created_by) values(btrim(d->>'name'),d->>'slug',d->>'description',auth.uid()) returning id into result_id;
 insert into public.event_memberships(event_id,user_id,role,permissions,granted_by) values(result_id,auth.uid(),'organizer',actor.permissions,auth.uid());
 perform public.write_audit_event(result_id,auth.uid(),auth.uid(),a,'{}');
 return jsonb_build_object('id',result_id);
 elsif a='event.update' then
 -- Closed events may be reopened only by the same trusted management grant, not by membership alone.
 if not exists(select 1 from public.event_memberships where event_id=e and user_id=auth.uid() and status='active' and 'manage_event'=any(permissions)) then raise exception 'Event management permission required.' using errcode='42501'; end if;
 perform public.dz_rate(e,'staff');
 update public.events set name=btrim(d->>'name'),description=d->>'description',starts_at=nullif(d->>'starts_at','')::timestamptz,ends_at=nullif(d->>'ends_at','')::timestamptz,
 status=(d->>'status')::public.event_status,archived_at=case when d->>'status'='archived' then now() else null end,
 location_required=coalesce((d->>'location_required')::boolean,false),max_accuracy_meters=coalesce((d->>'max_accuracy_meters')::int,100),downloads_allowed=coalesce((d->>'downloads_allowed')::boolean,true) where id=e;
 result_id:=e;
 elsif a='zone.save' then
 perform public.dz_require(e,'manage_zones'); perform public.dz_rate(e,'staff');
 boundary:=extensions.st_setsrid(extensions.st_geomfromgeojson((d->'geometry')::text),4326);
 if extensions.st_npoints(boundary)>500 then raise exception 'Boundary has too many points (maximum 500).'; end if;
 result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
 if exists(select 1 from public.zones where id=result_id and event_id<>e) then raise exception 'Zone is outside this event.'; end if;
 insert into public.zones(id,event_id,name,boundary_type,boundary,radius_meters) values(result_id,e,btrim(d->>'name'),d->>'boundary_type',boundary,nullif(d->>'radius_meters','')::int)
 on conflict(id) do update set name=excluded.name,boundary_type=excluded.boundary_type,boundary=excluded.boundary,radius_meters=excluded.radius_meters;
 elsif a='team.save' then
 perform public.dz_require(e,'manage_teams'); perform public.dz_rate(e,'staff');
 result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
 if exists(select 1 from public.teams where id=result_id and event_id<>e) then raise exception 'Team is outside this event.'; end if;
 insert into public.teams(id,event_id,name) values(result_id,e,btrim(d->>'name')) on conflict(id) do update set name=excluded.name;
 elsif a='team.assign' then
 perform public.dz_require(e,'manage_teams'); perform public.dz_rate(e,'staff');
 target:=(d->>'user_id')::uuid; team:=nullif(d->>'team_id','')::uuid;
 perform 1 from public.event_memberships where event_id=e and user_id=target and status='active' and role='participant' for update;
 if not found then raise exception 'An active participant in this event is required.'; end if;
 if team is not null and not exists(select 1 from public.teams where id=team and event_id=e) then raise exception 'Team is outside this event.'; end if;
 -- Single team per participant through the mutation path; Phase 1 links are preserved.
 delete from public.team_memberships where event_id=e and user_id=target;
 if team is not null then insert into public.team_memberships(event_id,team_id,user_id) values(e,team,target); end if;
 result_id:=target;
 elsif a='roster.import' then
 perform public.dz_require(e,'manage_members'); perform public.dz_rate(e,'staff');
 if jsonb_typeof(d->'rows') is distinct from 'array' or jsonb_array_length(d->'rows') not between 1 and 1000 then raise exception 'Import must contain 1–1000 rows.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(e::text||'roster',0));
 if jsonb_array_length(public.dz_roster_preview(e,d->'rows'))>0 then raise exception 'Roster conflict. Recheck the server preview; no rows were imported.'; end if;
 if (select count(*)<>count(distinct lower(btrim(value->>'email'))) from jsonb_array_elements(d->'rows')) then raise exception 'Duplicate emails in import.'; end if;
 insert into public.roster_imports(event_id,actor_id,imported,skipped) values(e,auth.uid(),0,0) returning id into result_id;
 for row in select value from jsonb_array_elements(d->'rows') loop
 if jsonb_typeof(row)<>'object' or exists(select 1 from jsonb_object_keys(row) k where k not in ('email','display_name','team_name')) or
 coalesce(row->>'email','') !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$' or length(row->>'email')>254 or
 coalesce(length(btrim(row->>'display_name')),0) not between 1 and 80 or length(coalesce(row->>'team_name',''))>100 then raise exception 'Invalid roster row; check columns, name, email and team.'; end if;
 select * into existing from public.roster_records where event_id=e and email=lower(btrim(row->>'email'));
 if found then
 if existing.team_name<>btrim(coalesce(row->>'team_name','')) or existing.display_name<>btrim(row->>'display_name') then raise exception 'Roster conflict for an existing email. No rows were imported.'; end if;
 v_skipped:=v_skipped+1;
 else
 insert into public.roster_records(event_id,email,display_name,team_name,import_id) values(e,lower(btrim(row->>'email')),btrim(row->>'display_name'),btrim(coalesce(row->>'team_name','')),result_id);
 v_imported:=v_imported+1;
 end if;
 end loop;
 update public.roster_imports set imported=v_imported,skipped=v_skipped where id=result_id;
 perform public.write_audit_event(e,auth.uid(),null,a,jsonb_build_object('import_id',result_id,'imported',v_imported,'skipped',v_skipped));
 return jsonb_build_object('id',result_id,'imported',v_imported,'skipped',v_skipped,'failed',0);
 else raise exception 'Unknown staff operation.';
 end if;
 perform public.write_audit_event(e,auth.uid(),target,a,jsonb_build_object('resource_id',result_id));
 return jsonb_build_object('id',result_id);
end $$;

create function public.dz_messaging(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations; result_id uuid; recipient uuid; targets uuid[]; count_recipients int:=0;
begin
 perform public.dz_require(e);
 if a in ('conversation.create','message.send') then
 perform public.dz_writable(e); perform public.dz_rate(e,'message');
 if a='conversation.create' then
 insert into public.conversations(event_id,participant_id,subject) values(e,auth.uid(),btrim(d->>'subject')) returning * into c;
 else
 select * into c from public.conversations where id=(d->>'conversation_id')::uuid and event_id=e;
 if not found or not public.dz_conversation_visible(c.id) then raise exception 'Private conversation access denied.' using errcode='42501'; end if;
 end if;
 if c.participant_id<>auth.uid() and public.dz_blocked(e,auth.uid(),c.participant_id) then raise exception 'Interaction is blocked. Another authorized organizer may respond.'; end if;
 insert into public.messages(event_id,conversation_id,sender_id,body) values(e,c.id,auth.uid(),btrim(d->>'body')) returning id into result_id;
 update public.conversations set updated_at=now() where id=c.id;
 if c.participant_id<>auth.uid() then perform public.dz_notify(e,c.participant_id,'message',result_id,'New private organizer response',auth.uid());
 else
 for recipient in select user_id from public.event_memberships where event_id=e and status='active' and 'manage_members'=any(permissions) loop
 if not public.dz_blocked(e,auth.uid(),recipient) then perform public.dz_notify(e,recipient,'message',result_id,'New private participant message',auth.uid()); end if;
 end loop;
 end if;
 return jsonb_build_object('id',result_id,'conversation_id',c.id,'state','sent');
 elsif a='conversation.read' then
 if not public.dz_conversation_visible((d->>'id')::uuid) or not exists(select 1 from public.conversations where id=(d->>'id')::uuid and event_id=e) then raise exception 'Conversation access denied.'; end if;
 insert into public.conversation_reads values((d->>'id')::uuid,auth.uid(),now()) on conflict(conversation_id,user_id) do update set read_at=now();
 elsif a='notification.read' then
 update public.notifications set read_at=now() where id=(d->>'id')::uuid and event_id=e and user_id=auth.uid();
 if not found then raise exception 'Notification not found.'; end if;
 elsif a='communication.send' then
 perform public.dz_require(e,'manage_event'); perform public.dz_rate(e,'staff');
 select coalesce(array_agg(value::uuid),'{}') into targets from jsonb_array_elements_text(coalesce(d->'targets','[]'));
 if d->>'scope'='teams' and (cardinality(targets)=0 or exists(select 1 from unnest(targets) t where not exists(select 1 from public.teams where id=t and event_id=e))) then raise exception 'Select teams belonging to this event.'; end if;
 if d->>'scope'='participant' and (cardinality(targets)<>1 or not exists(select 1 from public.event_memberships where event_id=e and user_id=targets[1] and status='active' and role='participant')) then raise exception 'Select an active event participant.'; end if;
 insert into public.communications(event_id,sender_id,kind,title,body,scope,targets) values(e,auth.uid(),d->>'kind',btrim(d->>'title'),btrim(d->>'body'),d->>'scope',targets) returning id into result_id;
 for recipient in select m.user_id from public.event_memberships m where m.event_id=e and m.status='active' and m.role='participant' and
 ((d->>'scope'='event') or (d->>'scope'='participant' and m.user_id=targets[1]) or (d->>'scope'='teams' and exists(select 1 from public.team_memberships tm where tm.event_id=e and tm.user_id=m.user_id and tm.team_id=any(targets)))) loop
 insert into public.communication_recipients values(e,result_id,recipient);
 perform public.dz_notify(e,recipient,'communication',result_id,'New official event communication',auth.uid());
 count_recipients:=count_recipients+1;
 end loop;
 perform public.write_audit_event(e,auth.uid(),null,a,jsonb_build_object('communication_id',result_id,'recipients',count_recipients));
 return jsonb_build_object('id',result_id,'recipients',count_recipients,'state','delivered_in_app');
 else raise exception 'Unknown communication operation.';
 end if;
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.dz_staff(uuid,text,jsonb),public.dz_messaging(uuid,text,jsonb) from public,anon,authenticated;

create function public.dz_command(p_event uuid,p_action text,p_data jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached public.command_receipts; result jsonb;
begin
 if auth.uid() is null or p_request is null or p_event is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Authenticated request, event and object payload required.' using errcode='42501'; end if;
 -- Serialize each user/request pair; replay is safe for seven days, and payload changes are rejected.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
 if p_action in ('event.update','event.create') then
 if not exists(select 1 from public.event_memberships where event_id=p_event and user_id=auth.uid() and status='active' and role='organizer' and 'manage_event'=any(permissions)) then raise exception 'Trusted organizer permission required.' using errcode='42501'; end if;
 else perform public.dz_require(p_event); end if;
 select * into cached from public.command_receipts where user_id=auth.uid() and request_id=p_request;
 if found then
 if cached.event_id<>p_event or cached.action<>p_action or cached.payload<>(p_data-'longitude'-'latitude'-'accuracy') then raise exception 'Retry key already used for different input.'; end if;
 return cached.result;
 end if;
 case split_part(p_action,'.',1)
 when 'post','reply','report','preference' then result:=public.dz_content(p_event,p_action,p_data);
 when 'event','zone','team','roster' then result:=public.dz_staff(p_event,p_action,p_data);
 when 'conversation','message','notification','communication' then result:=public.dz_messaging(p_event,p_action,p_data);
 when 'attachment' then result:=public.dz_attachment(p_event,p_action,p_data);
 else raise exception 'Unknown operation.';
 end case;
 -- Coordinates are transient and are NEVER retained in receipts or audit logs.
 insert into public.command_receipts(user_id,request_id,event_id,action,payload,result) values(auth.uid(),p_request,p_event,p_action,p_data-'longitude'-'latitude'-'accuracy',result);
 return result;
end $$;
revoke all on function public.dz_command(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.dz_command(uuid,text,jsonb,uuid) to authenticated;

-- Preserve Phase 1 invitation RPC; enforce its rate limit independently of the client.
create function public.dz_invitation_limit() returns trigger language plpgsql security definer set search_path='' as $$
begin if auth.uid() is not null then perform public.dz_rate(new.event_id,'invitation'); end if; return new; end $$;
create trigger invitation_rate before insert on public.event_invitations for each row execute function public.dz_invitation_limit();
revoke all on function public.dz_invitation_limit() from public,anon,authenticated;


-- ==========================================
-- MIGRATION: 20261010013000_phase2_reads_and_storage.sql
-- ==========================================

set search_path=public,extensions,pg_catalog;
create function public.dz_author(e uuid,u uuid) returns text language sql stable security definer set search_path='' as $$
 select p.display_name from public.profiles p join public.event_memberships m on m.user_id=p.id where m.event_id=e and p.id=u and public.is_active_event_member(e);
$$;
revoke all on function public.dz_author(uuid,uuid) from public,anon;
grant execute on function public.dz_author(uuid,uuid) to authenticated;
create function public.dz_read(p_event uuid,p_kind text,p_filter jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; off integer:=greatest(0,least(coalesce((p_filter->>'offset')::int,0),100000));
begin
 if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 case p_kind
 when 'overview' then
 select jsonb_build_object('event',(select to_jsonb(e) from public.events e where id=p_event),
 'zones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'boundary_type',boundary_type,'radius_meters',radius_meters,'geometry',extensions.st_asgeojson(boundary)::jsonb)) from public.zones where event_id=p_event),'[]'),
 'teams',coalesce((select jsonb_agg(to_jsonb(t)) from public.teams t where event_id=p_event),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('display_name',public.dz_author(p_event,user_id))) from public.event_memberships m where event_id=p_event),'[]'),
 'team_memberships',coalesce((select jsonb_agg(to_jsonb(t)) from public.team_memberships t where event_id=p_event),'[]'),
 'unread',(select count(*) from public.notifications where event_id=p_event and read_at is null),
 'active_posts',(select count(*) from public.posts where event_id=p_event and status='published' and expires_at>now()),
 'preferences',coalesce((select jsonb_agg(to_jsonb(u)) from public.user_preferences u where event_id=p_event),'[]')) into result;
 when 'feed','activity','review' then
 select coalesce(jsonb_agg(x),'[]') into result from (
 select p.*,public.dz_author(p_event,p.author_id) author_name,
 case when status in ('published','submitted','awaiting_review','changes_requested') and expires_at<=now() then 'expired' else status end effective_status
 from public.posts p where event_id=p_event and
 ((p_kind='feed' and status='published' and expires_at>now() and not exists(select 1 from public.user_preferences where event_id=p_event and user_id=auth.uid() and target_id=p.author_id and muted)) or
 (p_kind='activity' and author_id=auth.uid()) or (p_kind='review' and public.has_event_permission(p_event,'review_custom_posts') and status in ('awaiting_review','changes_requested') and expires_at>now()))
 and (coalesce(p_filter->>'category','')='' or category=p_filter->>'category')
 and (coalesce(p_filter->>'zone_id','')='' or zone_id=(p_filter->>'zone_id')::uuid)
 and (coalesce(p_filter->>'search','')='' or to_tsvector('simple',title||' '||body) @@ plainto_tsquery('simple',p_filter->>'search'))
 order by created_at desc,id limit 30 offset off) x;
 when 'post' then
 select to_jsonb(p)||jsonb_build_object('author_name',public.dz_author(p_event,p.author_id),'effective_status',case when status in ('published','submitted','awaiting_review','changes_requested') and expires_at<=now() then 'expired' else status end) into result from public.posts p where event_id=p_event and id=(p_filter->>'id')::uuid;
 when 'replies' then
 select coalesce(jsonb_agg(x),'[]') into result from (select r.*,public.dz_author(p_event,author_id) author_name from public.replies r where event_id=p_event and post_id=(p_filter->>'id')::uuid order by created_at,id limit 50 offset off) x;
 when 'attachments' then
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into result from public.attachments a where event_id=p_event and post_id=(p_filter->>'id')::uuid;
 when 'reports' then
 select coalesce(jsonb_agg(x),'[]') into result from (
 select r.*,case r.target_type when 'post' then (select title||': '||body from public.posts where id=r.target_id) when 'reply' then (select body from public.replies where id=r.target_id) else public.dz_author(p_event,r.target_id) end context
 from public.reports r where event_id=p_event and (coalesce(p_filter->>'status','')='' or status=p_filter->>'status') order by created_at desc,id limit 30 offset off) x;
 when 'conversations' then
 select coalesce(jsonb_agg(x),'[]') into result from (select c.*,public.dz_author(p_event,participant_id) participant_name,(select read_at from public.conversation_reads where conversation_id=c.id and user_id=auth.uid()) read_at from public.conversations c where event_id=p_event order by updated_at desc,id limit 30 offset off) x;
 when 'messages' then
 select coalesce(jsonb_agg(x),'[]') into result from (select m.*,public.dz_author(p_event,sender_id) sender_name from public.messages m where event_id=p_event and conversation_id=(p_filter->>'id')::uuid order by created_at,id limit 50 offset off) x;
 when 'notifications' then
 select coalesce(jsonb_agg(x),'[]') into result from (select n.*,
 case kind when 'reply' then (select post_id from public.replies where id=n.resource_id) when 'message' then (select conversation_id from public.messages where id=n.resource_id) else resource_id end destination_id
 from public.notifications n where event_id=p_event order by created_at desc,id limit 30 offset off) x;
 when 'communications' then
 select coalesce(jsonb_agg(x),'[]') into result from (select c.*,public.dz_author(p_event,sender_id) sender_name from public.communications c where event_id=p_event order by created_at desc,id limit 30 offset off) x;
 when 'roster' then
 select coalesce(jsonb_agg(x),'[]') into result from (select * from public.roster_records where event_id=p_event order by created_at desc,id limit 100 offset off) x;
 when 'roster_preview' then
 result:=public.dz_roster_preview(p_event,p_filter->'rows');
 when 'imports' then
 select coalesce(jsonb_agg(x),'[]') into result from (select * from public.roster_imports where event_id=p_event order by created_at desc,id limit 30 offset off) x;
 when 'audit' then
 select coalesce(jsonb_agg(x),'[]') into result from (select * from public.audit_events where event_id=p_event order by created_at desc,id limit 50 offset off) x;
 else raise exception 'Unknown query.';
 end case;
 return result;
end $$;
revoke all on function public.dz_read(uuid,text,jsonb) from public,anon;
grant execute on function public.dz_read(uuid,text,jsonb) to authenticated;

-- An exact metadata path, not a guessed prefix, is required for every Storage access.
create function public.dz_file_access(path text,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attachments a join public.posts p on p.id=a.post_id
 where a.object_path=path and public.is_active_event_member(a.event_id) and
 case when writing then a.owner_id=auth.uid() and a.status='pending' and a.created_at>now()-interval '24 hours' and p.author_id=auth.uid() and p.status not in ('deleted','removed','cancelled')
 else a.status='ready' and public.dz_post_visible(a.post_id) and p.status not in ('deleted','removed','cancelled') end);
$$;
revoke all on function public.dz_file_access(text,boolean) from public,anon;
grant execute on function public.dz_file_access(text,boolean) to authenticated;
create function public.dz_attachment(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.posts; att public.attachments; result_id uuid:=gen_random_uuid(); object_metadata jsonb;
begin
 perform public.dz_writable(e);
 if a='attachment.reserve' then
 perform public.dz_rate(e,'upload');
 select * into p from public.posts where event_id=e and id=(d->>'post_id')::uuid and author_id=auth.uid() and status not in ('deleted','removed','cancelled') for update;
 if not found then raise exception 'Only the accessible post author can upload.' using errcode='42501'; end if;
 if (select count(*) from public.attachments where post_id=p.id and status<>'deleted')>=3 then raise exception 'Maximum three attachments per post.'; end if;
 insert into public.attachments(id,event_id,post_id,owner_id,object_path,mime,size_bytes) values(result_id,e,p.id,auth.uid(),e::text||'/'||p.id::text||'/'||result_id::text,d->>'mime',(d->>'size_bytes')::int) returning * into att;
 elsif a='attachment.finalize' then
 select * into att from public.attachments where id=(d->>'id')::uuid and event_id=e and owner_id=auth.uid() and status='pending' for update;
 if not found or not public.dz_file_access(att.object_path,true) then raise exception 'Pending upload not found.'; end if;
 if to_regclass('storage.objects') is null then raise exception 'Supabase Storage is not configured.'; end if;
 execute 'select metadata from storage.objects where bucket_id=$1 and name=$2' into object_metadata using 'event-attachments',att.object_path;
 if object_metadata is null or coalesce((object_metadata->>'size')::bigint,0)<>att.size_bytes or object_metadata->>'mimetype' is distinct from att.mime then raise exception 'Uploaded file is missing or its size/type does not match. Upload did not complete.'; end if;
 update public.attachments set status='ready' where id=att.id returning * into att;
 elsif a='attachment.delete' then
 update public.attachments set status='deleted' where id=(d->>'id')::uuid and event_id=e and owner_id=auth.uid() returning * into att;
 if not found then raise exception 'Attachment ownership required.' using errcode='42501'; end if;
 else raise exception 'Unknown attachment operation.';
 end if;
 return to_jsonb(att);
end $$;
revoke all on function public.dz_attachment(uuid,text,jsonb) from public,anon,authenticated;

-- Storage exists in Supabase, but not bare PostgreSQL/PGlite. The isolated test harness supplies
-- only its schema contract; hosted object API and byte storage remain a separate integration test.
do $$ begin
 if to_regclass('storage.buckets') is not null then
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('event-attachments','event-attachments',false,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
 execute $policy$create policy dropzone_file_read on storage.objects for select to authenticated using(bucket_id='event-attachments' and public.dz_file_access(name,false))$policy$;
 execute $policy$create policy dropzone_file_insert on storage.objects for insert to authenticated with check(bucket_id='event-attachments' and public.dz_file_access(name,true))$policy$;
 -- Immutable objects: no overwrite/upsert. Deletion is tombstoned first, then physically removed by a trusted cleanup worker.
 end if;
end $$;


-- ==========================================
-- MIGRATION: 20261010014000_phase2_management_hardening.sql
-- ==========================================

set search_path=public,extensions,pg_catalog;
create function public.dz_can_manage_closed(e uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.event_memberships where event_id=e and user_id=auth.uid() and status='active' and 'manage_event'=any(permissions));
$$;
revoke all on function public.dz_can_manage_closed(uuid) from public,anon;
grant execute on function public.dz_can_manage_closed(uuid) to authenticated;
create policy events_read_closed_manager on public.events for select to authenticated using(public.dz_can_manage_closed(id));
-- The pair-check helper cannot be used to probe two unrelated users' private preferences.
create or replace function public.dz_blocked(e uuid,a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_preferences where event_id=e and blocked and ((user_id=a and target_id=b) or (user_id=b and target_id=a)))
 and (auth.uid() in (a,b));
$$;
-- A revoked member must not retain private team links through the Phase 1 self-read policy.
drop policy team_memberships_read_self_or_authorized_manager on public.team_memberships;
create policy team_memberships_read_self_or_authorized_manager on public.team_memberships for select to authenticated
 using(public.is_active_event_member(event_id) and (user_id=auth.uid() or public.has_event_permission(event_id,'view_members')));
-- Install the materialization job when pg_cron is already enabled by the project operator.
-- Queries enforce expiry regardless. See PHASE2.md for enabling the job in an existing project.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
 perform cron.schedule('dropzone-maintenance','*/15 * * * *','select public.dz_maintenance()');
 end if;
end $$;

create or replace function public.get_my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_access jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select profile.display_name
  into v_display_name
  from public.profiles as profile
  where profile.id = v_user_id;

  if v_display_name is null then
    select nullif(pg_catalog.left(pg_catalog.btrim(coalesce(raw_user_meta_data ->> 'display_name', 'DropZone Member')), 80), '')
    into v_display_name
    from auth.users
    where id = v_user_id;
  end if;

  select pg_catalog.jsonb_build_object(
    'user_id', v_user_id,
    'display_name', coalesce(v_display_name, 'DropZone Member'),
    'memberships', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'event_id', event.id,
            'event_name', event.name,
            'event_slug', event.slug,
            'role', membership.role,
            'permissions', membership.permissions,
            'status', membership.status
          ) order by event.name
        )
        from public.event_memberships as membership
        join public.events as event on event.id = membership.event_id
        where membership.user_id = v_user_id
          and membership.status = 'active'
          and (event.status = 'active' or 'manage_event'=any(membership.permissions))
      ),
      '[]'::jsonb
    )
  )
  into v_access;

  return v_access;
end;
$$;



-- ==========================================
-- MIGRATION: 20261010015000_phase2_storage_verification.sql
-- ==========================================

alter table public.attachments add column verified_at timestamptz, add column storage_removed_at timestamptz;
-- Called ONLY by the byte-inspecting Supabase Edge Function using its server-side service key.
create function public.dz_verify_attachment(p_id uuid,p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.attachments a set verified_at=now() where id=p_id and owner_id=p_owner and status='pending' and created_at>now()-interval '24 hours'
 and exists(select 1 from public.event_memberships m join public.events e on e.id=m.event_id where m.event_id=a.event_id and m.user_id=p_owner and m.status='active' and e.status='active');
 if not found then raise exception 'Upload is no longer eligible for verification.'; end if;
end $$;
create function public.dz_enforce_verified_file() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='ready' and new.verified_at is null then raise exception 'Server-side image verification is required before publishing an attachment.'; end if;
 return new;
end $$;
create trigger attachment_requires_verification before insert or update on public.attachments for each row execute function public.dz_enforce_verified_file();
create function public.dz_cleanup_batch() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(row_to_json(a)),'[]') from (select id,object_path from public.attachments where status='deleted' and storage_removed_at is null order by created_at limit 100) a;
$$;
create function public.dz_cleanup_ack(p_ids uuid[]) returns void language sql security definer set search_path='' as $$
 update public.attachments set storage_removed_at=now() where id=any(p_ids) and status='deleted';
$$;
revoke all on function public.dz_verify_attachment(uuid,uuid),public.dz_enforce_verified_file(),public.dz_cleanup_batch(),public.dz_cleanup_ack(uuid[]) from public,anon,authenticated;
grant execute on function public.dz_verify_attachment(uuid,uuid),public.dz_cleanup_batch(),public.dz_cleanup_ack(uuid[]) to service_role;
-- Metadata authorization remains RLS-controlled for the browser. Only the Edge verifier needs
-- service-role metadata reads. It verifies ownership using the caller's authenticated read first.
grant select on public.attachments to service_role;


-- ==========================================
-- MIGRATION: 20261010020000_final_workflow_completion.sql
-- ==========================================

-- Final audit fixes. Prior migrations remain unchanged and replayable.
set search_path=public,extensions,pg_catalog;
alter table public.posts add column reviewed_at timestamptz, add column reviewed_by uuid references public.profiles;
create table public.post_revisions (
 id uuid primary key default gen_random_uuid(), event_id uuid not null, post_id uuid not null,
 actor_id uuid references public.profiles, title text not null, body text not null, fields jsonb not null,
 previous_status text not null, created_at timestamptz not null default now(),
 foreign key(event_id,post_id) references public.posts(event_id,id)
);
create index post_revisions_history on public.post_revisions(post_id,created_at desc,id);
alter table public.post_revisions enable row level security;
revoke all on public.post_revisions from public,anon,authenticated;
grant select on public.post_revisions to authenticated;
create policy post_revisions_read on public.post_revisions for select to authenticated using (
 public.is_active_event_member(event_id) and exists(select 1 from public.posts p where p.id=post_id and
 (p.author_id=auth.uid() or public.has_event_permission(event_id,'review_custom_posts') or public.has_event_permission(event_id,'review_reports'))));
create function public.dz_capture_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and (old.title,old.body,old.fields,old.status) is distinct from (new.title,new.body,new.fields,new.status) then
 insert into public.post_revisions(event_id,post_id,actor_id,title,body,fields,previous_status) values(old.event_id,old.id,auth.uid(),old.title,old.body,old.fields,old.status);
 end if;
 return new;
end $$;
create trigger capture_post_revision before update on public.posts for each row execute function public.dz_capture_revision();
revoke all on function public.dz_capture_revision() from public,anon,authenticated;

-- A manager cannot demote a staff role they lack authority to revoke.
alter function public.manage_event_membership(uuid,uuid,public.event_role,text[]) rename to dz_manage_membership_legacy;
revoke all on function public.dz_manage_membership_legacy(uuid,uuid,public.event_role,text[]) from public,anon,authenticated;
create function public.manage_event_membership(p_event_id uuid,p_user_id uuid,p_role public.event_role,p_permissions text[] default '{}') returns void language plpgsql security definer set search_path='' as $$
declare previous public.event_role;
begin
 perform public.dz_require(p_event_id,'manage_roles');
 if p_user_id=auth.uid() then raise exception 'You cannot change your own event role.' using errcode='42501'; end if;
 select role into previous from public.event_memberships where event_id=p_event_id and user_id=p_user_id for update;
 if (previous='organizer' and not public.has_event_permission(p_event_id,'grant_organizer')) or (previous='moderator' and not public.has_event_permission(p_event_id,'grant_moderator')) then
 raise exception 'You cannot change a staff role you are not authorized to grant or revoke.' using errcode='42501'; end if;
 perform public.dz_rate(p_event_id,'staff');
 perform public.dz_manage_membership_legacy(p_event_id,p_user_id,p_role,p_permissions);
end $$;
revoke all on function public.manage_event_membership(uuid,uuid,public.event_role,text[]) from public,anon;
grant execute on function public.manage_event_membership(uuid,uuid,public.event_role,text[]) to authenticated;
create function public.dz_clear_inactive_team() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'active' then delete from public.team_memberships where event_id=new.event_id and user_id=new.user_id; end if;
 return new;
end $$;
create trigger inactive_membership_clears_team after update of status on public.event_memberships for each row execute function public.dz_clear_inactive_team();
revoke all on function public.dz_clear_inactive_team() from public,anon,authenticated;
-- Clean only unauthorized legacy links; no legitimate active assignments are rewritten.
delete from public.team_memberships t using public.event_memberships m where t.event_id=m.event_id and t.user_id=m.user_id and m.status<>'active';

create function public.dz_my_decisions(e uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]') from (select a.created_at,a.metadata->>'decision' decision,a.metadata->>'reason' reason,a.metadata->>'target_id' target_id
 from public.audit_events a where a.event_id=e and a.target_user_id=auth.uid() and a.action='moderation.decision' and public.is_active_event_member(e) order by a.created_at desc,a.id desc limit 100) x;
$$;
revoke all on function public.dz_my_decisions(uuid) from public,anon;
grant execute on function public.dz_my_decisions(uuid) to authenticated;
create or replace function public.dz_content(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.posts; r public.post_rules; result_id uuid; target uuid; rep public.reports; v_reason text:=btrim(d->>'reason'); next_status text; old_status text;
begin
 perform public.dz_require(e);
 if a in ('post.create','post.revise','post.edit') then
 perform public.dz_writable(e);
 perform public.dz_validate_post(d->>'category',d->'fields');
 select * into strict r from public.post_rules where category=d->>'category';
 perform public.dz_rate(e,case when r.category in ('custom','promotion') then r.category else 'post' end);
 if exists(select 1 from public.events where id=e and location_required) then
 if nullif(d->>'zone_id','') is null or public.check_zone_location((d->>'zone_id')::uuid,(d->>'longitude')::float8,(d->>'latitude')::float8,(d->>'accuracy')::float8) is distinct from true then raise exception 'A successful location check inside the selected event zone is required.'; end if;
 end if;
 if a='post.create' then
 insert into public.posts(event_id,author_id,zone_id,category,title,body,fields,status,expires_at)
 values(e,auth.uid(),nullif(d->>'zone_id','')::uuid,r.category,btrim(d->>'title'),btrim(d->>'body'),d->'fields',case when r.review_required then case when d->>'review_mode'='save_submission' then 'submitted' else 'awaiting_review' end else 'published' end,
 least(now()+make_interval(hours=>r.lifetime_hours),coalesce((d->'fields'->>'valid_until')::timestamptz,'infinity')))
 returning * into p;
 else
 select * into p from public.posts where id=(d->>'id')::uuid and event_id=e for update;
 if not found or p.author_id<>auth.uid() or not ((a='post.edit' and p.status='published') or (a='post.revise' and p.status in ('changes_requested','submitted'))) or p.category<>r.category or p.expires_at<=now() then raise exception 'This submission cannot be revised.' using errcode='42501'; end if;
 if a='post.edit' and (d->>'expected_updated_at')::timestamptz is distinct from p.updated_at then raise exception 'This post changed. Reload its latest version before editing.' using errcode='40001'; end if;
 update public.posts set title=btrim(d->>'title'),body=btrim(d->>'body'),fields=d->'fields',zone_id=nullif(d->>'zone_id','')::uuid,status=case when r.review_required then 'awaiting_review' else 'published' end,reviewed_at=null,reviewed_by=null,decision_reason=null,updated_at=clock_timestamp(),expires_at=least(p.expires_at,coalesce((d->'fields'->>'valid_until')::timestamptz,'infinity')) where id=p.id returning * into p;
 end if;
 perform public.write_audit_event(e,auth.uid(),auth.uid(),a,jsonb_build_object('post_id',p.id,'status',p.status));
 return to_jsonb(p);
 elsif a='reply.create' then
 perform public.dz_writable(e); perform public.dz_rate(e,'reply');
 select * into p from public.posts where id=(d->>'post_id')::uuid and event_id=e for share;
 if not found or not public.dz_post_visible(p.id) or p.status<>'published' or p.expires_at<=now() or public.dz_blocked(e,auth.uid(),p.author_id) then raise exception 'This thread is not open for replies.' using errcode='42501'; end if;
 if nullif(d->>'parent_id','') is not null and not exists(select 1 from public.replies where id=(d->>'parent_id')::uuid and post_id=p.id and removed_at is null and not public.dz_blocked(e,auth.uid(),author_id)) then raise exception 'Parent reply is unavailable or interactions are blocked.' using errcode='42501'; end if;
 insert into public.replies(event_id,post_id,author_id,parent_id,body) values(e,p.id,auth.uid(),nullif(d->>'parent_id','')::uuid,btrim(d->>'body')) returning id into result_id;
 perform public.dz_notify(e,p.author_id,'reply',result_id,'New response to your post',auth.uid());
 return jsonb_build_object('id',result_id);
 elsif a in ('post.resolve','post.delete','post.cancel','post.review','post.enqueue') then
 select * into p from public.posts where id=(d->>'id')::uuid and event_id=e for update;
 if not found then raise exception 'Post not found.'; end if;
 old_status:=p.status;
 if a='post.review' then
 perform public.dz_rate(e,'staff');
 perform public.dz_require(e,'review_custom_posts');
 if p.author_id=auth.uid() or p.status<>'awaiting_review' or p.expires_at<=now() then raise exception 'Submission is not eligible for review.'; end if;
 if coalesce(length(v_reason),0) not between 3 and 2000 or d->>'decision' not in ('published','changes_requested','rejected') then raise exception 'A valid decision and reason are required.'; end if;
 next_status:=d->>'decision';
 else
 if p.author_id<>auth.uid() then raise exception 'Only the author may perform this action. Use moderation for removal.' using errcode='42501'; end if;
 if a='post.enqueue' and (p.status<>'submitted' or p.expires_at<=now()) then raise exception 'Only saved submissions can enter review.'; end if;
 if a='post.resolve' and (p.status<>'published' or p.expires_at<=now()) then raise exception 'Only active published posts can be resolved.'; end if;
 if a='post.cancel' and p.status not in ('submitted','awaiting_review','changes_requested') then raise exception 'Only pending submissions can be cancelled.'; end if;
 next_status:=case a when 'post.enqueue' then 'awaiting_review' when 'post.resolve' then 'resolved' when 'post.cancel' then 'cancelled' else 'deleted' end;
 end if;
 update public.posts set status=next_status,reviewed_at=case when a='post.review' then now() else reviewed_at end,reviewed_by=case when a='post.review' then auth.uid() else reviewed_by end,decision_reason=case when a='post.review' then v_reason else decision_reason end,updated_at=now(),deleted_at=case when next_status='deleted' then coalesce(deleted_at,now()) else deleted_at end where id=p.id;
 perform public.write_audit_event(e,auth.uid(),p.author_id,a,jsonb_build_object('post_id',p.id,'previous_status',old_status,'status',next_status,'reason',v_reason));
 perform public.dz_notify(e,p.author_id,'post_decision',p.id,'Your post status changed',null);
 return jsonb_build_object('id',p.id,'status',next_status);
 elsif a='preference.set' then
 target:=(d->>'target_id')::uuid;
 if not exists(select 1 from public.event_memberships where event_id=e and user_id=target) then raise exception 'Event member not found.'; end if;
 insert into public.user_preferences values(e,auth.uid(),target,coalesce((d->>'blocked')::boolean,false),coalesce((d->>'muted')::boolean,false))
 on conflict(event_id,user_id,target_id) do update set blocked=excluded.blocked,muted=excluded.muted;
 return jsonb_build_object('saved',true);
 elsif a='report.create' then
 perform public.dz_writable(e); perform public.dz_rate(e,'report'); target:=(d->>'target_id')::uuid;
 if not ((d->>'target_type'='post' and exists(select 1 from public.posts where id=target and event_id=e and public.dz_post_visible(id))) or
 (d->>'target_type'='reply' and exists(select 1 from public.replies where id=target and event_id=e and public.dz_post_visible(post_id) and removed_at is null and not public.dz_blocked(e,auth.uid(),author_id))) or
 (d->>'target_type'='user' and exists(select 1 from public.event_memberships where event_id=e and user_id=target and status='active'))) then raise exception 'Report target is not accessible.' using errcode='42501'; end if;
 insert into public.reports(event_id,reporter_id,target_type,target_id,reason,explanation) values(e,auth.uid(),d->>'target_type',target,d->>'reason',coalesce(d->>'explanation','')) returning id into result_id;
 return jsonb_build_object('id',result_id,'status','open');
 elsif a='report.decide' then
 perform public.dz_require(e,'review_reports'); perform public.dz_rate(e,'staff');
 select * into rep from public.reports where id=(d->>'id')::uuid and event_id=e for update;
 if not found or rep.status not in ('open','escalated') then raise exception 'Report is not open.'; end if;
 if coalesce(length(v_reason),0) not between 3 and 2000 or d->>'decision' not in ('dismissed','removed','escalated','restricted') then raise exception 'A valid decision and reason are required.'; end if;
 if d->>'decision' in ('removed','restricted') then perform public.dz_require(e,'remove_content'); end if;
 if d->>'decision'='removed' then
 if rep.target_type='post' then update public.posts set status='removed',decision_reason=v_reason,updated_at=now() where event_id=e and id=rep.target_id returning author_id into target;
 elsif rep.target_type='reply' then update public.replies set removed_at=now() where event_id=e and id=rep.target_id returning author_id into target;
 else raise exception 'A user cannot be removed as content; choose a restriction.'; end if;
 elsif d->>'decision'='restricted' then
 if rep.target_type<>'user' then raise exception 'Restrictions require a user report.'; end if;
 target:=rep.target_id;
 if exists(select 1 from public.event_memberships where event_id=e and user_id=target and role<>'participant') then raise exception 'Staff restrictions require a trusted administrator.'; end if;
 insert into public.user_restrictions values(e,target,now()+interval '24 hours',v_reason,auth.uid()) on conflict(event_id,user_id) do update set until_at=excluded.until_at,reason=excluded.reason,actor_id=excluded.actor_id;
 end if;
 update public.reports set status=d->>'decision',decision_reason=v_reason,decided_by=auth.uid(),decided_at=now() where id=rep.id;
 perform public.write_audit_event(e,auth.uid(),target,'moderation.decision',jsonb_build_object('report_id',rep.id,'target_id',rep.target_id,'decision',d->>'decision','reason',v_reason));
 perform public.dz_notify(e,rep.reporter_id,'report_decision',rep.id,'Your report has a decision',null);
 perform public.dz_notify(e,target,'moderation_decision',rep.id,'A moderation decision affects your content or account',null);
 return jsonb_build_object('id',rep.id,'status',d->>'decision');
 end if;
 raise exception 'Unknown content operation.';
end $$;

create or replace function public.dz_read(p_event uuid,p_kind text,p_filter jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; off integer:=greatest(0,least(coalesce((p_filter->>'offset')::int,0),100000));
begin
 if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 case p_kind
 when 'overview' then
 select jsonb_build_object('event',(select to_jsonb(e) from public.events e where id=p_event),
 'zones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'boundary_type',boundary_type,'radius_meters',radius_meters,'geometry',extensions.st_asgeojson(boundary)::jsonb)) from public.zones where event_id=p_event),'[]'),
 'teams',coalesce((select jsonb_agg(to_jsonb(t)) from public.teams t where event_id=p_event),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('display_name',public.dz_author(p_event,user_id))) from public.event_memberships m where event_id=p_event),'[]'),
 'team_memberships',coalesce((select jsonb_agg(to_jsonb(t)) from public.team_memberships t where event_id=p_event),'[]'),
 'unread',(select count(*) from public.notifications where event_id=p_event and read_at is null),
 'active_posts',(select count(*) from public.posts where event_id=p_event and status='published' and expires_at>now()),
 'preferences',coalesce((select jsonb_agg(to_jsonb(u)) from public.user_preferences u where event_id=p_event),'[]')) into result;
 when 'safety' then
 select jsonb_build_object('reports',coalesce((select jsonb_agg(to_jsonb(r)) from public.reports r where event_id=p_event and reporter_id=auth.uid()),'[]'),'restrictions',coalesce((select jsonb_agg(to_jsonb(r)) from public.user_restrictions r where event_id=p_event and user_id=auth.uid()),'[]'),'decisions',public.dz_my_decisions(p_event)) into result;
 when 'revisions' then
 select coalesce(jsonb_agg(x),'[]') into result from (select * from public.post_revisions where event_id=p_event and post_id=(p_filter->>'id')::uuid order by created_at desc,id limit 30 offset off) x;
 when 'feed','activity','review' then
 select coalesce(jsonb_agg(x),'[]') into result from (
 select p.*,public.dz_author(p_event,p.author_id) author_name,
 case when status in ('published','submitted','awaiting_review','changes_requested') and expires_at<=now() then 'expired' else status end effective_status
 from public.posts p where event_id=p_event and
 ((p_kind='feed' and status='published' and expires_at>now() and not exists(select 1 from public.user_preferences where event_id=p_event and user_id=auth.uid() and target_id=p.author_id and muted)) or
 (p_kind='activity' and author_id=auth.uid()) or (p_kind='review' and public.has_event_permission(p_event,'review_custom_posts') and status in ('awaiting_review','changes_requested') and expires_at>now()))
 and (coalesce(p_filter->>'category','')='' or category=p_filter->>'category')
 and (coalesce(p_filter->>'zone_id','')='' or zone_id=(p_filter->>'zone_id')::uuid)
 and (coalesce(p_filter->>'search','')='' or to_tsvector('simple',title||' '||body) @@ plainto_tsquery('simple',p_filter->>'search'))
 and (coalesce(p_filter->>'before_time','')='' or (created_at,id)<((p_filter->>'before_time')::timestamptz,(p_filter->>'before_id')::uuid))
 order by created_at desc,id desc limit 30 offset off) x;
 when 'post' then
 select to_jsonb(p)||jsonb_build_object('author_name',public.dz_author(p_event,p.author_id),'effective_status',case when status in ('published','submitted','awaiting_review','changes_requested') and expires_at<=now() then 'expired' else status end) into result from public.posts p where event_id=p_event and id=(p_filter->>'id')::uuid;
 when 'replies' then
 select coalesce(jsonb_agg(x),'[]') into result from (select r.*,public.dz_author(p_event,author_id) author_name from public.replies r where event_id=p_event and post_id=(p_filter->>'id')::uuid order by created_at,id limit 50 offset off) x;
 when 'attachments' then
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into result from public.attachments a where event_id=p_event and post_id=(p_filter->>'id')::uuid;
 when 'reports' then
 select coalesce(jsonb_agg(x),'[]') into result from (
 select r.*,case r.target_type when 'post' then (select title||': '||body from public.posts where id=r.target_id) when 'reply' then (select body from public.replies where id=r.target_id) else public.dz_author(p_event,r.target_id) end context
 from public.reports r where event_id=p_event and (coalesce(p_filter->>'status','')='' or status=p_filter->>'status') order by created_at desc,id limit 30 offset off) x;
 when 'conversations' then
 select coalesce(jsonb_agg(x),'[]') into result from (select c.*,public.dz_author(p_event,participant_id) participant_name,(select read_at from public.conversation_reads where conversation_id=c.id and user_id=auth.uid()) read_at from public.conversations c where event_id=p_event order by updated_at desc,id limit 30 offset off) x;
 when 'messages' then
 select coalesce(jsonb_agg(x),'[]') into result from (select m.*,public.dz_author(p_event,sender_id) sender_name from public.messages m where event_id=p_event and conversation_id=(p_filter->>'id')::uuid order by created_at,id limit 50 offset off) x;
 when 'notifications' then
 select coalesce(jsonb_agg(x),'[]') into result from (select n.*,
 case kind when 'reply' then (select post_id from public.replies where id=n.resource_id) when 'message' then (select conversation_id from public.messages where id=n.resource_id) else resource_id end destination_id
 from public.notifications n where event_id=p_event order by created_at desc,id limit 30 offset off) x;
 when 'communications' then
 select coalesce(jsonb_agg(x),'[]') into result from (select c.*,public.dz_author(p_event,sender_id) sender_name from public.communications c where event_id=p_event order by created_at desc,id limit 30 offset off) x;
 when 'roster' then
 select coalesce(jsonb_agg(x),'[]') into result from (select * from public.roster_records where event_id=p_event order by created_at desc,id limit 100 offset off) x;
 when 'roster_preview' then
 result:=public.dz_roster_preview(p_event,p_filter->'rows');
 when 'imports' then
 select coalesce(jsonb_agg(x),'[]') into result from (select * from public.roster_imports where event_id=p_event order by created_at desc,id limit 30 offset off) x;
 when 'audit' then
 select coalesce(jsonb_agg(x),'[]') into result from (select * from public.audit_events where event_id=p_event order by created_at desc,id limit 50 offset off) x;
 else raise exception 'Unknown query.';
 end case;
 return result;
end $$;

create or replace function public.dz_attachment(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.posts; att public.attachments; result_id uuid:=gen_random_uuid(); object_metadata jsonb;
begin
 perform public.dz_writable(e);
 if a='attachment.reserve' then
 perform public.dz_rate(e,'upload');
 select * into p from public.posts where event_id=e and id=(d->>'post_id')::uuid and author_id=auth.uid() and status not in ('deleted','removed','cancelled') for update;
 if not found then raise exception 'Only the accessible post author can upload.' using errcode='42501'; end if;
 if (select count(*) from public.attachments where post_id=p.id and status<>'deleted')>=3 then raise exception 'Maximum three attachments per post.'; end if;
 insert into public.attachments(id,event_id,post_id,owner_id,object_path,mime,size_bytes) values(result_id,e,p.id,auth.uid(),e::text||'/'||p.id::text||'/'||result_id::text,d->>'mime',(d->>'size_bytes')::int) returning * into att;
 elsif a='attachment.finalize' then
 select * into att from public.attachments where id=(d->>'id')::uuid and event_id=e and owner_id=auth.uid() and status='ready';
 if found then return to_jsonb(att); end if;
 select * into att from public.attachments where id=(d->>'id')::uuid and event_id=e and owner_id=auth.uid() and status='pending' for update;
 if not found or not public.dz_file_access(att.object_path,true) then raise exception 'Pending upload not found.'; end if;
 if to_regclass('storage.objects') is null then raise exception 'Supabase Storage is not configured.'; end if;
 execute 'select metadata from storage.objects where bucket_id=$1 and name=$2' into object_metadata using 'event-attachments',att.object_path;
 if object_metadata is null or coalesce((object_metadata->>'size')::bigint,0)<>att.size_bytes or object_metadata->>'mimetype' is distinct from att.mime then raise exception 'Uploaded file is missing or its size/type does not match. Upload did not complete.'; end if;
 update public.attachments set status='ready' where id=att.id returning * into att;
 -- Adding new bytes changes reviewed content. It cannot bypass the review queue.
 update public.posts edited_post set status='awaiting_review',reviewed_at=null,reviewed_by=null,updated_at=clock_timestamp()
 where edited_post.id=att.post_id and edited_post.status='published' and exists(select 1 from public.post_rules where category=edited_post.category and review_required);
 perform public.write_audit_event(e,auth.uid(),auth.uid(),'attachment.finalized',jsonb_build_object('attachment_id',att.id,'post_id',att.post_id));

 elsif a='attachment.delete' then
 update public.attachments set status='deleted' where id=(d->>'id')::uuid and event_id=e and owner_id=auth.uid() returning * into att;
 if not found then raise exception 'Attachment ownership required.' using errcode='42501'; end if;
 perform public.write_audit_event(e,auth.uid(),auth.uid(),'attachment.deleted',jsonb_build_object('attachment_id',att.id,'post_id',att.post_id));
 else raise exception 'Unknown attachment operation.';
 end if;
 return to_jsonb(att);
end $$;


-- Retention covers the new history too. The legacy job remains internal to this wrapper.
alter function public.dz_maintenance() rename to dz_maintenance_legacy;
revoke all on function public.dz_maintenance_legacy() from public,anon,authenticated,service_role;
create function public.dz_maintenance() returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.dz_maintenance_legacy();
 update public.post_revisions r set title='Retained revision',body='[Content retention period ended]',fields='{}' from public.posts p join public.events e on e.id=p.event_id
 where r.post_id=p.id and (p.deleted_at<now()-interval '30 days' or e.archived_at<now()-interval '180 days');
end $$;
revoke all on function public.dz_maintenance() from public,anon,authenticated;
grant execute on function public.dz_maintenance() to service_role;
-- Additional indexes support recent activity and private inboxes without full scans.
create index posts_author_history on public.posts(event_id,author_id,created_at desc,id desc);
create index communication_recipient_inbox on public.communication_recipients(user_id,event_id,communication_id);
create index attachment_cleanup on public.attachments(status,storage_removed_at,created_at);
create function public.update_my_profile(p_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 if coalesce(length(btrim(p_name)),0) not between 1 and 80 then raise exception 'Display name must be 1–80 characters.'; end if;
 update public.profiles set display_name=btrim(p_name) where id=auth.uid();
end $$;
revoke all on function public.update_my_profile(text) from public,anon;
grant execute on function public.update_my_profile(text) to authenticated;

-- Authorization is checked before idempotency receipts are returned.
create or replace function public.dz_command(p_event uuid,p_action text,p_data jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached public.command_receipts; result jsonb;
begin
 if auth.uid() is null or p_request is null or p_event is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Authenticated request, event and object payload required.' using errcode='42501'; end if;
 -- Serialize each user/request pair; replay is safe for seven days, and payload changes are rejected.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
 if p_action in ('event.update','event.create') then
 if not exists(select 1 from public.event_memberships where event_id=p_event and user_id=auth.uid() and status='active' and role='organizer' and 'manage_event'=any(permissions)) then raise exception 'Trusted organizer permission required.' using errcode='42501'; end if;
 else perform public.dz_require(p_event); end if;
 -- Replays must not preserve revoked staff authority or private conversation access.
 case p_action
 when 'post.review' then perform public.dz_require(p_event,'review_custom_posts');
 when 'report.decide' then
   perform public.dz_require(p_event,'review_reports');
   if p_data->>'decision' in ('removed','restricted') then perform public.dz_require(p_event,'remove_content'); end if;
 when 'zone.save' then perform public.dz_require(p_event,'manage_zones');
 when 'team.save','team.assign' then perform public.dz_require(p_event,'manage_teams');
 when 'roster.import' then perform public.dz_require(p_event,'manage_members');
 when 'communication.send' then perform public.dz_require(p_event,'manage_event');
 when 'message.send','conversation.read' then
   if not public.dz_conversation_visible(coalesce(p_data->>'conversation_id',p_data->>'id')::uuid) then raise exception 'Private conversation access denied.' using errcode='42501'; end if;
 else null;
 end case;
 select * into cached from public.command_receipts where user_id=auth.uid() and request_id=p_request;
 if found then
 if cached.event_id<>p_event or cached.action<>p_action or cached.payload<>(p_data-'longitude'-'latitude'-'accuracy') then raise exception 'Retry key already used for different input.'; end if;
 return cached.result;
 end if;
 case split_part(p_action,'.',1)
 when 'post','reply','report','preference' then result:=public.dz_content(p_event,p_action,p_data);
 when 'event','zone','team','roster' then result:=public.dz_staff(p_event,p_action,p_data);
 when 'conversation','message','notification','communication' then result:=public.dz_messaging(p_event,p_action,p_data);
 when 'attachment' then result:=public.dz_attachment(p_event,p_action,p_data);
 else raise exception 'Unknown operation.';
 end case;
 -- Coordinates are transient and are NEVER retained in receipts or audit logs.
 insert into public.command_receipts(user_id,request_id,event_id,action,payload,result) values(auth.uid(),p_request,p_event,p_action,p_data-'longitude'-'latitude'-'accuracy',result);
 return result;
end $$;


-- ==========================================
-- MIGRATION: 20261010030000_samartha_acceptance_security.sql
-- ==========================================

-- SAMARTHA acceptance remediation. Additive; do not edit applied migrations.
set search_path = public, extensions, pg_catalog;

-- Expiry is not approval. Record whether the CURRENT version was authorized for
-- the community, retaining that fact through expiry but clearing it on re-review.
alter table public.posts add column publication_authorized boolean not null default false;
update public.posts p set publication_authorized = true
where p.status in ('published','resolved') or
 (p.status='expired' and exists(select 1 from public.post_rules r where r.category=p.category and not r.review_required));
-- Legacy expired review-required posts are deliberately private when approval of
-- their current version cannot be proved. No text/history/audit records are erased.
create function public.dz_publication_state() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('published','resolved') then new.publication_authorized := true;
 elsif new.status='expired' and tg_op='UPDATE' then new.publication_authorized := old.publication_authorized;
 else new.publication_authorized := false;
 end if;
 return new;
end $$;
create trigger publication_state before insert or update on public.posts
 for each row execute function public.dz_publication_state();
revoke all on function public.dz_publication_state() from public,anon,authenticated;
create or replace function public.dz_post_visible(p uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.posts where id=p and public.is_active_event_member(event_id) and
 (author_id=auth.uid() or public.has_event_permission(event_id,'review_reports') or public.has_event_permission(event_id,'review_custom_posts') or
 (publication_authorized and status in ('published','resolved','expired') and not public.dz_blocked(event_id,auth.uid(),author_id))));
$$;

-- Serialize target membership changes, including a target that has no row yet.
-- The same lock is taken by grant/demotion, revocation and invitation acceptance.
create or replace function public.accept_event_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_invitation public.event_invitations%rowtype;
  v_event public.events%rowtype;
  v_membership_status public.membership_status;
begin
  if v_user_id is null then
    raise exception 'Sign in before joining an event.' using errcode = '42501';
  end if;
  if p_token is null or pg_catalog.length(p_token) not between 40 and 100 or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invitation code is invalid or expired.' using errcode = '22023';
  end if;

  select invitation.*
  into v_invitation
  from public.event_invitations as invitation
  where invitation.token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
    and invitation.revoked_at is null
    and invitation.expires_at > pg_catalog.now()
    and invitation.use_count < invitation.max_uses
  for update;

  if not found then
    raise exception 'Invitation code is invalid, expired, revoked, or already used.' using errcode = '22023';
  end if;

  select event.* into v_event
  from public.events as event
  where event.id = v_invitation.event_id and event.status = 'active';
  if not found then
    raise exception 'This event is not accepting invitations.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('membership:'||v_invitation.event_id::text||':'||v_user_id::text,0));

  select membership.status into v_membership_status
  from public.event_memberships as membership
  where membership.event_id = v_invitation.event_id and membership.user_id = v_user_id for update;

  if v_membership_status = 'active' then
    raise exception 'This account is already a member of the event.' using errcode = '23505';
  elsif v_membership_status = 'suspended' then
    raise exception 'This account cannot rejoin while its membership is suspended.' using errcode = '42501';
  elsif v_membership_status = 'revoked' then
    raise exception 'Membership is revoked. An authorized organizer must explicitly restore access.' using errcode = '42501';
  else
    insert into public.event_memberships (event_id, user_id, role, permissions, status, granted_by)
    values (v_invitation.event_id, v_user_id, 'participant', '{}', 'active', v_invitation.created_by);
  end if;

  update public.event_invitations
  set use_count = use_count + 1
  where id = v_invitation.id;

  perform public.write_audit_event(
    v_invitation.event_id,
    v_user_id,
    v_user_id,
    'event.invitation.accepted',
    pg_catalog.jsonb_build_object('invitation_id', v_invitation.id)
  );

  return pg_catalog.jsonb_build_object(
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_slug', v_event.slug
  );
end;
$$;

create or replace function public.revoke_event_membership(p_event_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role public.event_role;
  v_target_permissions text[];
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid() then
    raise exception 'A different target account and authenticated actor are required.' using errcode = '42501';
  end if;
  if not public.has_event_permission(p_event_id, 'manage_members') then
    raise exception 'You do not have permission to revoke event membership.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('membership:'||p_event_id::text||':'||p_user_id::text,0));

  select role, permissions into v_target_role, v_target_permissions
  from public.event_memberships
  where event_id = p_event_id and user_id = p_user_id and status = 'active' for update;
  if not found then
    raise exception 'Active event membership was not found.' using errcode = 'P0002';
  end if;
  if v_target_role = 'organizer' and not public.has_event_permission(p_event_id, 'grant_organizer') then
    raise exception 'You cannot revoke organizer access.' using errcode = '42501';
  end if;
  if v_target_role = 'moderator' and not public.has_event_permission(p_event_id, 'grant_moderator') then
    raise exception 'You cannot revoke moderator access.' using errcode = '42501';
  end if;

  -- Preserve the last assigned role/grants for auditability. Every authorization helper
  -- requires status = 'active', so a revoked row carries no effective access.
  update public.event_memberships
  set status = 'revoked'
  where event_id = p_event_id and user_id = p_user_id;

  perform public.write_audit_event(
    p_event_id,
    auth.uid(),
    p_user_id,
    'event.membership.revoked',
    pg_catalog.jsonb_build_object(
      'previous_role', v_target_role,
      'previous_permissions', coalesce(v_target_permissions, '{}')
    )
  );
end;
$$;

create or replace function public.manage_event_membership(p_event_id uuid,p_user_id uuid,p_role public.event_role,p_permissions text[] default '{}') returns void language plpgsql security definer set search_path='' as $$
declare previous public.event_role;
begin
 perform public.dz_require(p_event_id,'manage_roles');
 if p_user_id=auth.uid() then raise exception 'You cannot change your own event role.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('membership:'||p_event_id::text||':'||p_user_id::text,0));
 select role into previous from public.event_memberships where event_id=p_event_id and user_id=p_user_id for update;
 if (previous='organizer' and not public.has_event_permission(p_event_id,'grant_organizer')) or (previous='moderator' and not public.has_event_permission(p_event_id,'grant_moderator')) then
 raise exception 'You cannot change a staff role you are not authorized to grant or revoke.' using errcode='42501'; end if;
 perform public.dz_rate(p_event_id,'staff');
 perform public.dz_manage_membership_legacy(p_event_id,p_user_id,p_role,p_permissions);
end $$;

-- Rejection is revisable before original expiry, never self-publishable.
alter table public.post_revisions add column decision_reason text;
create or replace function public.dz_capture_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and (old.title,old.body,old.fields,old.status,old.decision_reason) is distinct from (new.title,new.body,new.fields,new.status,new.decision_reason) then
 insert into public.post_revisions(event_id,post_id,actor_id,title,body,fields,previous_status,decision_reason)
 values(old.event_id,old.id,auth.uid(),old.title,old.body,old.fields,old.status,old.decision_reason);
 end if;
 return new;
end $$;
create or replace function public.dz_content(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.posts; r public.post_rules; result_id uuid; target uuid; rep public.reports; v_reason text:=btrim(d->>'reason'); next_status text; old_status text;
begin
 perform public.dz_require(e);
 if a in ('post.create','post.revise','post.edit') then
 perform public.dz_writable(e);
 perform public.dz_validate_post(d->>'category',d->'fields');
 select * into strict r from public.post_rules where category=d->>'category';
 perform public.dz_rate(e,case when r.category in ('custom','promotion') then r.category else 'post' end);
 if exists(select 1 from public.events where id=e and location_required) then
 if nullif(d->>'zone_id','') is null or public.check_zone_location((d->>'zone_id')::uuid,(d->>'longitude')::float8,(d->>'latitude')::float8,(d->>'accuracy')::float8) is distinct from true then raise exception 'A successful location check inside the selected event zone is required.'; end if;
 end if;
 if a='post.create' then
 insert into public.posts(event_id,author_id,zone_id,category,title,body,fields,status,expires_at)
 values(e,auth.uid(),nullif(d->>'zone_id','')::uuid,r.category,btrim(d->>'title'),btrim(d->>'body'),d->'fields',case when r.review_required then case when d->>'review_mode'='save_submission' then 'submitted' else 'awaiting_review' end else 'published' end,
 least(now()+make_interval(hours=>r.lifetime_hours),coalesce((d->'fields'->>'valid_until')::timestamptz,'infinity')))
 returning * into p;
 else
 select * into p from public.posts where id=(d->>'id')::uuid and event_id=e for update;
 if not found or p.author_id<>auth.uid() or not ((a='post.edit' and p.status='published') or (a='post.revise' and p.status in ('changes_requested','submitted','rejected'))) or p.category<>r.category or p.expires_at<=now() then raise exception 'This submission cannot be revised.' using errcode='42501'; end if;
 if a='post.edit' and (d->>'expected_updated_at')::timestamptz is distinct from p.updated_at then raise exception 'This post changed. Reload its latest version before editing.' using errcode='40001'; end if;
 update public.posts set title=btrim(d->>'title'),body=btrim(d->>'body'),fields=d->'fields',zone_id=nullif(d->>'zone_id','')::uuid,status=case when r.review_required then 'awaiting_review' else 'published' end,reviewed_at=null,reviewed_by=null,decision_reason=null,updated_at=clock_timestamp(),expires_at=least(p.expires_at,coalesce((d->'fields'->>'valid_until')::timestamptz,'infinity')) where id=p.id returning * into p;
 end if;
 perform public.write_audit_event(e,auth.uid(),auth.uid(),a,jsonb_build_object('post_id',p.id,'status',p.status));
 return to_jsonb(p);
 elsif a='reply.create' then
 perform public.dz_writable(e); perform public.dz_rate(e,'reply');
 select * into p from public.posts where id=(d->>'post_id')::uuid and event_id=e for share;
 if not found or not public.dz_post_visible(p.id) or p.status<>'published' or p.expires_at<=now() or public.dz_blocked(e,auth.uid(),p.author_id) then raise exception 'This thread is not open for replies.' using errcode='42501'; end if;
 if nullif(d->>'parent_id','') is not null and not exists(select 1 from public.replies where id=(d->>'parent_id')::uuid and post_id=p.id and removed_at is null and not public.dz_blocked(e,auth.uid(),author_id)) then raise exception 'Parent reply is unavailable or interactions are blocked.' using errcode='42501'; end if;
 insert into public.replies(event_id,post_id,author_id,parent_id,body) values(e,p.id,auth.uid(),nullif(d->>'parent_id','')::uuid,btrim(d->>'body')) returning id into result_id;
 perform public.dz_notify(e,p.author_id,'reply',result_id,'New response to your post',auth.uid());
 return jsonb_build_object('id',result_id);
 elsif a in ('post.resolve','post.delete','post.cancel','post.review','post.enqueue') then
 select * into p from public.posts where id=(d->>'id')::uuid and event_id=e for update;
 if not found then raise exception 'Post not found.'; end if;
 old_status:=p.status;
 if a='post.review' then
 perform public.dz_rate(e,'staff');
 perform public.dz_require(e,'review_custom_posts');
 if p.author_id=auth.uid() or p.status<>'awaiting_review' or p.expires_at<=now() then raise exception 'Submission is not eligible for review.'; end if;
 if coalesce(length(v_reason),0) not between 3 and 2000 or d->>'decision' not in ('published','changes_requested','rejected') then raise exception 'A valid decision and reason are required.'; end if;
 next_status:=d->>'decision';
 else
 if p.author_id<>auth.uid() then raise exception 'Only the author may perform this action. Use moderation for removal.' using errcode='42501'; end if;
 if a='post.enqueue' and (p.status<>'submitted' or p.expires_at<=now()) then raise exception 'Only saved submissions can enter review.'; end if;
 if a='post.resolve' and (p.status<>'published' or p.expires_at<=now()) then raise exception 'Only active published posts can be resolved.'; end if;
 if a='post.cancel' and p.status not in ('submitted','awaiting_review','changes_requested') then raise exception 'Only pending submissions can be cancelled.'; end if;
 next_status:=case a when 'post.enqueue' then 'awaiting_review' when 'post.resolve' then 'resolved' when 'post.cancel' then 'cancelled' else 'deleted' end;
 end if;
 update public.posts set status=next_status,reviewed_at=case when a='post.review' then now() else reviewed_at end,reviewed_by=case when a='post.review' then auth.uid() else reviewed_by end,decision_reason=case when a='post.review' then v_reason else decision_reason end,updated_at=now(),deleted_at=case when next_status='deleted' then coalesce(deleted_at,now()) else deleted_at end where id=p.id;
 perform public.write_audit_event(e,auth.uid(),p.author_id,a,jsonb_build_object('post_id',p.id,'previous_status',old_status,'status',next_status,'reason',v_reason));
 perform public.dz_notify(e,p.author_id,'post_decision',p.id,'Your post status changed',null);
 return jsonb_build_object('id',p.id,'status',next_status);
 elsif a='preference.set' then
 target:=(d->>'target_id')::uuid;
 if not exists(select 1 from public.event_memberships where event_id=e and user_id=target) then raise exception 'Event member not found.'; end if;
 insert into public.user_preferences values(e,auth.uid(),target,coalesce((d->>'blocked')::boolean,false),coalesce((d->>'muted')::boolean,false))
 on conflict(event_id,user_id,target_id) do update set blocked=excluded.blocked,muted=excluded.muted;
 return jsonb_build_object('saved',true);
 elsif a='report.create' then
 perform public.dz_writable(e); perform public.dz_rate(e,'report'); target:=(d->>'target_id')::uuid;
 if not ((d->>'target_type'='post' and exists(select 1 from public.posts where id=target and event_id=e and public.dz_post_visible(id))) or
 (d->>'target_type'='reply' and exists(select 1 from public.replies where id=target and event_id=e and public.dz_post_visible(post_id) and removed_at is null and not public.dz_blocked(e,auth.uid(),author_id))) or
 (d->>'target_type'='user' and exists(select 1 from public.event_memberships where event_id=e and user_id=target and status='active'))) then raise exception 'Report target is not accessible.' using errcode='42501'; end if;
 insert into public.reports(event_id,reporter_id,target_type,target_id,reason,explanation) values(e,auth.uid(),d->>'target_type',target,d->>'reason',coalesce(d->>'explanation','')) returning id into result_id;
 return jsonb_build_object('id',result_id,'status','open');
 elsif a='report.decide' then
 perform public.dz_require(e,'review_reports'); perform public.dz_rate(e,'staff');
 select * into rep from public.reports where id=(d->>'id')::uuid and event_id=e for update;
 if not found or rep.status not in ('open','escalated') then raise exception 'Report is not open.'; end if;
 if coalesce(length(v_reason),0) not between 3 and 2000 or d->>'decision' not in ('dismissed','removed','escalated','restricted') then raise exception 'A valid decision and reason are required.'; end if;
 if d->>'decision' in ('removed','restricted') then perform public.dz_require(e,'remove_content'); end if;
 if d->>'decision'='removed' then
 if rep.target_type='post' then update public.posts set status='removed',decision_reason=v_reason,updated_at=now() where event_id=e and id=rep.target_id returning author_id into target;
 elsif rep.target_type='reply' then update public.replies set removed_at=now() where event_id=e and id=rep.target_id returning author_id into target;
 else raise exception 'A user cannot be removed as content; choose a restriction.'; end if;
 elsif d->>'decision'='restricted' then
 if rep.target_type<>'user' then raise exception 'Restrictions require a user report.'; end if;
 target:=rep.target_id;
 if exists(select 1 from public.event_memberships where event_id=e and user_id=target and role<>'participant') then raise exception 'Staff restrictions require a trusted administrator.'; end if;
 insert into public.user_restrictions values(e,target,now()+interval '24 hours',v_reason,auth.uid()) on conflict(event_id,user_id) do update set until_at=excluded.until_at,reason=excluded.reason,actor_id=excluded.actor_id;
 end if;
 update public.reports set status=d->>'decision',decision_reason=v_reason,decided_by=auth.uid(),decided_at=now() where id=rep.id;
 perform public.write_audit_event(e,auth.uid(),target,'moderation.decision',jsonb_build_object('report_id',rep.id,'target_id',rep.target_id,'decision',d->>'decision','reason',v_reason));
 perform public.dz_notify(e,rep.reporter_id,'report_decision',rep.id,'Your report has a decision',null);
 perform public.dz_notify(e,target,'moderation_decision',rep.id,'A moderation decision affects your content or account',null);
 return jsonb_build_object('id',rep.id,'status',d->>'decision');
 end if;
 raise exception 'Unknown content operation.';
end $$;

-- Review reasons are content too; follow existing 30-day deletion / 180-day
-- archived-event redaction. Restricted audit evidence follows its separate policy.
create or replace function public.dz_maintenance() returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.dz_maintenance_legacy();
 update public.posts p set decision_reason=null from public.events e
 where p.event_id=e.id and p.decision_reason is not null
 and (p.deleted_at<now()-interval '30 days' or e.archived_at<now()-interval '180 days');
 -- Run after post updates so any trigger-captured snapshots are redacted too.
 update public.post_revisions r set title='Retained revision',body='[Content retention period ended]',fields='{}',decision_reason=null
 from public.posts p join public.events e on e.id=p.event_id
 where r.post_id=p.id and (p.deleted_at<now()-interval '30 days' or e.archived_at<now()-interval '180 days');
end $$;
revoke all on function public.dz_maintenance() from public,anon,authenticated;
grant execute on function public.dz_maintenance() to service_role;
