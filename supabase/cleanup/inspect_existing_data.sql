-- Read-only inspection script for event-first cleanup review.
-- This file must not modify any data. It is meant to identify candidate development/test records
-- and confirm that only verified event IDs are targeted for cleanup.

-- 1. Record counts by major table.
select 'public.events' as table_name, count(*) as row_count from public.events
union all
select 'public.event_memberships', count(*) from public.event_memberships
union all
select 'public.teams', count(*) from public.teams
union all
select 'public.team_memberships', count(*) from public.team_memberships
union all
select 'public.zones', count(*) from public.zones
union all
select 'public.posts', count(*) from public.posts
union all
select 'public.replies', count(*) from public.replies
union all
select 'public.conversations', count(*) from public.conversations
union all
select 'public.messages', count(*) from public.messages
union all
select 'public.notifications', count(*) from public.notifications
union all
select 'public.communications', count(*) from public.communications
union all
select 'public.communication_recipients', count(*) from public.communication_recipients
union all
select 'public.reports', count(*) from public.reports
union all
select 'public.roster_imports', count(*) from public.roster_imports
union all
select 'public.roster_records', count(*) from public.roster_records
union all
select 'public.audit_events', count(*) from public.audit_events
union all
select 'public.event_invitations', count(*) from public.event_invitations
order by table_name;

-- 2. Event inventory: IDs, names, statuses, and effective member counts.
select
  e.id,
  e.name,
  e.slug,
  e.status,
  count(em.user_id) as active_membership_count,
  count(case when em.role = 'organizer' and em.status = 'active' then 1 end) as organizer_count
from public.events e
left join public.event_memberships em
  on em.event_id = e.id and em.status = 'active'
group by e.id, e.name, e.slug, e.status
order by e.created_at desc, e.name asc;

-- 3. Organizer assignments.
select
  e.id as event_id,
  e.name as event_name,
  em.user_id,
  em.role,
  em.permissions,
  em.status
from public.event_memberships em
join public.events e on e.id = em.event_id
where em.role = 'organizer'
order by e.name, em.user_id;

-- 4. Content counts per event.
select
  e.id,
  e.name,
  count(distinct p.id) as posts,
  count(distinct r.id) as replies,
  count(distinct n.id) as notifications,
  count(distinct c.id) as conversations,
  count(distinct rep.id) as reports
from public.events e
left join public.posts p on p.event_id = e.id
left join public.replies r on r.event_id = e.id
left join public.notifications n on n.event_id = e.id
left join public.conversations c on c.event_id = e.id
left join public.reports rep on rep.event_id = e.id
group by e.id, e.name
order by e.name;

-- 5. Candidate development/test records.
-- This intentionally uses evidence derived from the event name/slug and not from private user data.
select
  e.id,
  e.name,
  e.slug,
  case
    when lower(e.slug) = 'dropzone-main-event' then 'likely bootstrap seed or initial demo event'
    when lower(e.name) like '%demo%' or lower(e.slug) like '%demo%' then 'candidate demo/test event'
    when lower(e.name) like '%test%' or lower(e.slug) like '%test%' then 'candidate test event'
    when lower(e.name) like '%dropzone%' or lower(e.slug) like '%dropzone%' then 'likely template or starter event'
    else 'not obviously disposable'
  end as evidence
from public.events e
order by e.name;

-- 6. Review backlog for old cleanup candidates.
-- This query intentionally avoids exposing personal data. It reports only event names and counts.
select
  e.id,
  e.name,
  e.slug,
  count(em.user_id) as membership_count,
  count(p.id) as post_count,
  count(c.id) as conversation_count,
  count(n.id) as notification_count
from public.events e
left join public.event_memberships em on em.event_id = e.id
left join public.posts p on p.event_id = e.id
left join public.conversations c on c.event_id = e.id
left join public.notifications n on n.event_id = e.id
group by e.id, e.name, e.slug
order by coalesce(count(p.id),0) desc, coalesce(count(n.id),0) desc;

-- 7. Optional: explicit target review helper
-- Replace the event IDs below with confirmed disposable IDs before any cleanup run.
-- This query is still read-only and intentionally does not modify data.
select *
from public.events e
where e.id in (
  '00000000-0000-0000-0000-000000000000'::uuid
);
