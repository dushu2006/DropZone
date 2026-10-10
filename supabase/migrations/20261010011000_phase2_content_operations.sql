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
