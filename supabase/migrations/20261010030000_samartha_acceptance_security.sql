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
