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
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

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
  v_access jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select pg_catalog.jsonb_build_object(
    'user_id', v_user_id,
    'display_name', profile.display_name,
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
  into v_access
  from public.profiles as profile
  where profile.id = v_user_id;

  if v_access is null then
    raise exception 'Account profile is not initialized. Contact an administrator.' using errcode = 'P0001';
  end if;

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
