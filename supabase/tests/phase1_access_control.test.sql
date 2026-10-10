-- Run only against the disposable local Supabase database: npm run db:test.
-- Fixtures are enclosed in a transaction and rolled back; never run this suite on production.
begin;
select plan(10);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-participant@example.test', '', now(), '{}'::jsonb, '{"display_name":"RLS Participant"}'::jsonb, now(), now()),
  ('30000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-organizer@example.test', '', now(), '{}'::jsonb, '{"display_name":"RLS Organizer"}'::jsonb, now(), now()),
  ('30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rls-unassigned@example.test', '', now(), '{}'::jsonb, '{"display_name":"RLS Unassigned"}'::jsonb, now(), now()),
  ('30000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rls-organizer-two@example.test', '', now(), '{}'::jsonb, '{"display_name":"RLS Organizer Two"}'::jsonb, now(), now()),
  ('30000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'rls-moderator@example.test', '', now(), '{}'::jsonb, '{"display_name":"RLS Moderator"}'::jsonb, now(), now());

insert into public.events (id, name, slug, created_by) values
  ('40000000-0000-4000-8000-000000000001', 'RLS Event One', 'rls-event-one', '30000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000002', 'RLS Event Two', 'rls-event-two', '30000000-0000-4000-8000-000000000002');

insert into public.event_memberships (event_id, user_id, role, permissions, status) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'participant', '{}', 'active'),
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'organizer', array['view_members','manage_members','manage_roles','grant_moderator','review_reports'], 'active'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000004', 'organizer', array['view_members','manage_members','manage_roles','grant_moderator','grant_organizer','view_audit_log'], 'active'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005', 'moderator', array['review_reports'], 'active');

insert into public.teams (id, event_id, name) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'RLS Team');
insert into public.team_memberships (event_id, team_id, user_id) values
  ('40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005');

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select is((select count(*)::int from public.events), 1, 'participant reads only the joined event');
select is((select count(*)::int from public.event_memberships), 1, 'participant reads only their own membership without view_members');
select is((select public.has_event_permission('40000000-0000-4000-8000-000000000001', 'manage_members')), false, 'participant cannot manage event members');
select throws_ok(
  $$update public.event_memberships set role = 'organizer' where event_id = '40000000-0000-4000-8000-000000000001' and user_id = '30000000-0000-4000-8000-000000000001'$$,
  '42501',
  'participant cannot update their own role'
);
select throws_ok(
  $$insert into public.event_memberships (event_id, user_id, role) values ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'organizer')$$,
  '42501',
  'participant cannot self-assign or add another membership'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select is((select count(*)::int from public.events), 0, 'authenticated user without event membership sees no private events');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select is((select public.has_event_permission('40000000-0000-4000-8000-000000000001', 'review_reports')), true, 'organizer receives only an explicitly assigned moderation permission');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000004', true);
select lives_ok(
  $$select public.revoke_event_membership('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005')$$,
  'an authorized organizer can revoke a moderator membership'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000005', true);
select is((select public.has_event_permission('40000000-0000-4000-8000-000000000002', 'review_reports')), false, 'revoked moderator loses assigned permissions');
select is((select count(*)::int from public.teams where event_id = '40000000-0000-4000-8000-000000000002'), 0, 'revoked moderator cannot read private event teams');
reset role;

select * from finish();
rollback;
