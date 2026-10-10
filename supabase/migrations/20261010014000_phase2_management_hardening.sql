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
          and (event.status = 'active' or 'manage_event'=any(membership.permissions))
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

