-- ==============================================================================
-- DropZone: Seed Starter Event & Activate All Features
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/yyrapubbqskewgxinqbj/sql/new)
-- ==============================================================================

begin;

-- 1. Ensure all registered users have a profile row in public.profiles
insert into public.profiles (id, display_name)
select
  id,
  coalesce(nullif(pg_catalog.left(pg_catalog.btrim(raw_user_meta_data ->> 'display_name'), 80), ''), 'DropZone Member')
from auth.users
on conflict (id) do update
set display_name = coalesce(public.profiles.display_name, excluded.display_name);

-- 2. Update get_my_access() to be resilient against missing profiles (never throw 400)
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

  -- Read display name from profile, falling back to auth user metadata
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

grant execute on function public.get_my_access() to authenticated;

-- 3. Automatic user provisioning trigger so any future registered user automatically gets profile and access
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_main_event_id uuid;
begin
  -- Auto-create profile
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(pg_catalog.left(pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name'), 80), ''), 'DropZone Member')
  )
  on conflict (id) do update
  set display_name = coalesce(public.profiles.display_name, excluded.display_name);

  -- Auto-grant Organizer membership to starter event
  select id into v_main_event_id from public.events where slug = 'dropzone-main-event' limit 1;
  if v_main_event_id is not null then
    insert into public.event_memberships (event_id, user_id, role, permissions, status)
    values (
      v_main_event_id,
      new.id,
      'organizer',
      array[
        'view_members', 'manage_members', 'manage_teams', 'manage_zones', 'manage_event',
        'manage_roles', 'grant_organizer', 'grant_moderator', 'review_reports',
        'remove_content', 'review_custom_posts', 'view_audit_log'
      ],
      'active'
    )
    on conflict (event_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- 4. Create starter event, zones, teams, memberships, and posts
do $seed$
declare
  v_first_user_id uuid;
  v_event_id uuid;
  v_zone_arena_id uuid;
  v_zone_courtyard_id uuid;
  v_user record;
begin
  -- Find the first registered user to act as creator
  select id into v_first_user_id from auth.users order by created_at asc limit 1;

  if v_first_user_id is null then
    raise notice 'No users found in auth.users yet. Create an account in the app first, then run this script again.';
    return;
  end if;

  -- Create or retrieve the main starter event
  select id into v_event_id from public.events where slug = 'dropzone-main-event' limit 1;

  if v_event_id is null then
    insert into public.events (name, slug, description, status, created_by)
    values (
      'DropZone Main Event',
      'dropzone-main-event',
      'Welcome to DropZone! Your live interactive event space with active feeds, interactive zone maps, staff coordination, and messaging.',
      'active',
      v_first_user_id
    )
    returning id into v_event_id;
  end if;

  -- 5. Create starter zones
  insert into public.zones (event_id, name, boundary_type, boundary, radius_meters)
  values
    (v_event_id, 'Main Stage & Arena', 'circle', extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326), 250),
    (v_event_id, 'Exhibition Courtyard', 'circle', extensions.st_setsrid(extensions.st_makepoint(77.5960, 12.9725), 4326), 180),
    (v_event_id, 'Workshop Lab', 'circle', extensions.st_setsrid(extensions.st_makepoint(77.5930, 12.9705), 4326), 120)
  on conflict (event_id, name) do nothing;

  -- 6. Create starter teams
  insert into public.teams (event_id, name)
  values
    (v_event_id, 'Operations Team'),
    (v_event_id, 'Safety & First Aid'),
    (v_event_id, 'Logistics & Tech Support')
  on conflict (event_id, name) do nothing;

  -- 7. Grant Organizer role with all permissions to all registered accounts
  for v_user in select id from auth.users loop
    insert into public.event_memberships (event_id, user_id, role, permissions, status, granted_by)
    values (
      v_event_id,
      v_user.id,
      'organizer',
      array[
        'view_members', 'manage_members', 'manage_teams', 'manage_zones', 'manage_event',
        'manage_roles', 'grant_organizer', 'grant_moderator', 'review_reports',
        'remove_content', 'review_custom_posts', 'view_audit_log'
      ],
      'active',
      v_first_user_id
    )
    on conflict (event_id, user_id) do update
    set role = 'organizer',
        permissions = array[
          'view_members', 'manage_members', 'manage_teams', 'manage_zones', 'manage_event',
          'manage_roles', 'grant_organizer', 'grant_moderator', 'review_reports',
          'remove_content', 'review_custom_posts', 'view_audit_log'
        ],
        status = 'active';

    insert into public.audit_events (event_id, actor_user_id, target_user_id, action, metadata)
    values (v_event_id, v_first_user_id, v_user.id, 'event.organizer.granted', jsonb_build_object('source', 'seed_script'));
  end loop;

  -- 8. Add starter sample posts so the feed and map are alive
  select id into v_zone_arena_id from public.zones where event_id = v_event_id and name = 'Main Stage & Arena' limit 1;
  select id into v_zone_courtyard_id from public.zones where event_id = v_event_id and name = 'Exhibition Courtyard' limit 1;

  if not exists (select 1 from public.posts where event_id = v_event_id) then
    insert into public.posts (event_id, author_id, zone_id, category, title, body, fields, status, expires_at, publication_authorized)
    values
      (
        v_event_id,
        v_first_user_id,
        v_zone_arena_id,
        'promotion',
        'Welcome to DropZone 2026!',
        'All features are active! Explore the interactive Zone Map, create lost & found alerts, connect with teammates, and test staff workflows.',
        '{"offer": "All Access Pass", "valid_until": "2026-12-31"}'::jsonb,
        'published',
        pg_catalog.now() + interval '30 days',
        true
      ),
      (
        v_event_id,
        v_first_user_id,
        v_zone_courtyard_id,
        'lost_found',
        'Black backpack found near Studio B',
        'Contains a sketchbook and water bottle. Left at the info desk.',
        '{"kind": "found", "item": "backpack", "place": "Near Studio B info desk"}'::jsonb,
        'published',
        pg_catalog.now() + interval '7 days',
        true
      ),
      (
        v_event_id,
        v_first_user_id,
        v_zone_arena_id,
        'ask_help',
        'Looking for USB-C display adapter',
        'Anyone have a spare USB-C to HDMI adapter near the presentation hall?',
        '{"help_category": "tech_hardware", "context": "Presentation hall"}'::jsonb,
        'published',
        pg_catalog.now() + interval '1 day',
        true
      );
  end if;

end $seed$;

commit;
