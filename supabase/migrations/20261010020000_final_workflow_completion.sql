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
