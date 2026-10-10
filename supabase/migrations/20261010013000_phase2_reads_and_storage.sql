set search_path=public,extensions,pg_catalog;
create function public.dz_author(e uuid,u uuid) returns text language sql stable security definer set search_path='' as $$
 select p.display_name from public.profiles p join public.event_memberships m on m.user_id=p.id where m.event_id=e and p.id=u and public.is_active_event_member(e);
$$;
revoke all on function public.dz_author(uuid,uuid) from public,anon;
grant execute on function public.dz_author(uuid,uuid) to authenticated;
create function public.dz_read(p_event uuid,p_kind text,p_filter jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
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
 order by created_at desc,id limit 30 offset off) x;
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
revoke all on function public.dz_read(uuid,text,jsonb) from public,anon;
grant execute on function public.dz_read(uuid,text,jsonb) to authenticated;

-- An exact metadata path, not a guessed prefix, is required for every Storage access.
create function public.dz_file_access(path text,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attachments a join public.posts p on p.id=a.post_id
 where a.object_path=path and public.is_active_event_member(a.event_id) and
 case when writing then a.owner_id=auth.uid() and a.status='pending' and a.created_at>now()-interval '24 hours' and p.author_id=auth.uid() and p.status not in ('deleted','removed','cancelled')
 else a.status='ready' and public.dz_post_visible(a.post_id) and p.status not in ('deleted','removed','cancelled') end);
$$;
revoke all on function public.dz_file_access(text,boolean) from public,anon;
grant execute on function public.dz_file_access(text,boolean) to authenticated;
create function public.dz_attachment(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 select * into att from public.attachments where id=(d->>'id')::uuid and event_id=e and owner_id=auth.uid() and status='pending' for update;
 if not found or not public.dz_file_access(att.object_path,true) then raise exception 'Pending upload not found.'; end if;
 if to_regclass('storage.objects') is null then raise exception 'Supabase Storage is not configured.'; end if;
 execute 'select metadata from storage.objects where bucket_id=$1 and name=$2' into object_metadata using 'event-attachments',att.object_path;
 if object_metadata is null or coalesce((object_metadata->>'size')::bigint,0)<>att.size_bytes or object_metadata->>'mimetype' is distinct from att.mime then raise exception 'Uploaded file is missing or its size/type does not match. Upload did not complete.'; end if;
 update public.attachments set status='ready' where id=att.id returning * into att;
 elsif a='attachment.delete' then
 update public.attachments set status='deleted' where id=(d->>'id')::uuid and event_id=e and owner_id=auth.uid() returning * into att;
 if not found then raise exception 'Attachment ownership required.' using errcode='42501'; end if;
 else raise exception 'Unknown attachment operation.';
 end if;
 return to_jsonb(att);
end $$;
revoke all on function public.dz_attachment(uuid,text,jsonb) from public,anon,authenticated;

-- Storage exists in Supabase, but not bare PostgreSQL/PGlite. The isolated test harness supplies
-- only its schema contract; hosted object API and byte storage remain a separate integration test.
do $$ begin
 if to_regclass('storage.buckets') is not null then
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('event-attachments','event-attachments',false,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
 execute $policy$create policy dropzone_file_read on storage.objects for select to authenticated using(bucket_id='event-attachments' and public.dz_file_access(name,false))$policy$;
 execute $policy$create policy dropzone_file_insert on storage.objects for insert to authenticated with check(bucket_id='event-attachments' and public.dz_file_access(name,true))$policy$;
 -- Immutable objects: no overwrite/upsert. Deletion is tombstoned first, then physically removed by a trusted cleanup worker.
 end if;
end $$;
