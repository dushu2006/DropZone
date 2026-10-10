-- Cleanup target script for confirmed disposable development/test events.
-- IMPORTANT:
--   - This script is intentionally conservative.
--   - It requires explicit event IDs, not a wildcard or all-events sweep.
--   - It is designed to abort if a target appears ambiguous.
--   - It must be reviewed and executed only by an authorized operator.
--   - It must not be run on a hosted project without explicit approval.

begin;

-- Replace the placeholders below with the confirmed disposable event IDs before running.
-- Keep this list short and explicit.
-- Example: ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid]
do $$
declare
  v_target_ids uuid[] := array[
    '00000000-0000-0000-0000-000000000000'::uuid
  ];
  v_target_count integer;
  v_dangerous_count integer;
begin
  if array_length(v_target_ids, 1) is null then
    raise exception 'No explicit cleanup target IDs were provided. Set the event IDs before executing this script.';
  end if;

  select count(*) into v_target_count
  from public.events e
  where e.id = any(v_target_ids);

  if v_target_count <> array_length(v_target_ids, 1) then
    raise exception 'One or more target event IDs do not exist. Cleanup must use verified IDs only.';
  end if;

  select count(*) into v_dangerous_count
  from public.events e
  where e.id = any(v_target_ids)
    and not (
      lower(e.slug) = 'dropzone-main-event'
      or lower(e.name) like '%demo%'
      or lower(e.name) like '%test%'
      or lower(e.slug) like '%demo%'
      or lower(e.slug) like '%test%'
    );

  if v_dangerous_count > 0 then
    raise exception 'The target set includes events that are not explicitly confirmed as disposable data. Abort cleanup.';
  end if;

  raise notice 'Cleanup target count: %', v_target_count;
end $$;

-- Review before deletion: list the exact events being removed.
select
  e.id,
  e.name,
  e.slug,
  e.status,
  e.created_at
from public.events e
where e.id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

-- Delete related data in foreign-key-safe order.
-- This script intentionally targets only the specified event IDs.
-- It does not delete auth.users, profiles, migrations, schema, functions, or required configuration.

delete from public.notifications n
where n.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.communication_recipients cr
where cr.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.communications c
where c.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.conversation_reads cr
where cr.conversation_id in (
  select c.id from public.conversations c where c.event_id = any(array[
    '00000000-0000-0000-0000-000000000000'::uuid
  ])
);

delete from public.messages m
where m.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.conversations c
where c.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.attachments a
where a.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.replies r
where r.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.posts p
where p.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.user_restrictions ur
where ur.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.reports rep
where rep.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.roster_records rr
where rr.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.roster_imports ri
where ri.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.team_memberships tm
where tm.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.teams t
where t.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.zones z
where z.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.audit_events ae
where ae.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.event_invitations ei
where ei.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.event_memberships em
where em.event_id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

delete from public.events e
where e.id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

-- Post-cleanup verification.
select
  'public.events' as table_name,
  count(*) as remaining_rows
from public.events
where id = any(array[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

-- Recovery note:
-- Before executing this delete, export or back up the affected rows and keep the original event IDs.
-- If a target is not explicitly known to be disposable development/test data, stop and ask for confirmation.

commit;
