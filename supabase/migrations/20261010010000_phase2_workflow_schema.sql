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
