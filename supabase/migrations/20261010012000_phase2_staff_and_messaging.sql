set search_path=public,extensions,pg_catalog;
create function public.dz_roster_preview(e uuid,rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare row jsonb; errors jsonb:='[]'; i integer:=1; v_email text;
begin
 perform public.dz_require(e,'manage_members');
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 1000 then raise exception 'Preview requires 1–1000 roster rows.'; end if;
 for row in select value from jsonb_array_elements(rows) loop
 i:=i+1; v_email:=lower(btrim(row->>'email'));
 if exists(select 1 from public.roster_records r where r.event_id=e and r.email=v_email and (r.team_name<>btrim(coalesce(row->>'team_name','')) or r.display_name<>btrim(row->>'display_name'))) then
 errors:=errors||jsonb_build_array('Row '||i||': existing roster name or team conflicts.'); end if;
 if coalesce(btrim(row->>'team_name'),'')<>'' and exists(select 1 from auth.users u join public.team_memberships tm on tm.user_id=u.id join public.teams t on t.id=tm.team_id and t.event_id=tm.event_id where tm.event_id=e and lower(u.email)=v_email and t.name<>btrim(row->>'team_name')) then
 errors:=errors||jsonb_build_array('Row '||i||': confirmed account has a conflicting current team.'); end if;
 end loop;
 return errors;
end $$;
revoke all on function public.dz_roster_preview(uuid,jsonb) from public,anon;
grant execute on function public.dz_roster_preview(uuid,jsonb) to authenticated;

create function public.dz_staff(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result_id uuid; actor public.event_memberships; boundary extensions.geometry; row jsonb; v_imported int:=0; v_skipped int:=0; existing public.roster_records; team uuid; target uuid;
begin
 if a in ('event.create','event.update') and length(coalesce(d->>'description',''))>5000 then raise exception 'Event description exceeds 5000 characters.'; end if;
 if a='event.create' then
 -- A trusted organizer can create another event, with only grants they already hold.
 select * into actor from public.event_memberships where event_id=e and user_id=auth.uid() and status='active' and role='organizer' and 'manage_event'=any(permissions);
 if not found then raise exception 'Existing trusted organizer permission required.' using errcode='42501'; end if;
 perform public.dz_rate(e,'staff');
 insert into public.events(name,slug,description,created_by) values(btrim(d->>'name'),d->>'slug',d->>'description',auth.uid()) returning id into result_id;
 insert into public.event_memberships(event_id,user_id,role,permissions,granted_by) values(result_id,auth.uid(),'organizer',actor.permissions,auth.uid());
 perform public.write_audit_event(result_id,auth.uid(),auth.uid(),a,'{}');
 return jsonb_build_object('id',result_id);
 elsif a='event.update' then
 -- Closed events may be reopened only by the same trusted management grant, not by membership alone.
 if not exists(select 1 from public.event_memberships where event_id=e and user_id=auth.uid() and status='active' and 'manage_event'=any(permissions)) then raise exception 'Event management permission required.' using errcode='42501'; end if;
 perform public.dz_rate(e,'staff');
 update public.events set name=btrim(d->>'name'),description=d->>'description',starts_at=nullif(d->>'starts_at','')::timestamptz,ends_at=nullif(d->>'ends_at','')::timestamptz,
 status=(d->>'status')::public.event_status,archived_at=case when d->>'status'='archived' then now() else null end,
 location_required=coalesce((d->>'location_required')::boolean,false),max_accuracy_meters=coalesce((d->>'max_accuracy_meters')::int,100),downloads_allowed=coalesce((d->>'downloads_allowed')::boolean,true) where id=e;
 result_id:=e;
 elsif a='zone.save' then
 perform public.dz_require(e,'manage_zones'); perform public.dz_rate(e,'staff');
 boundary:=extensions.st_setsrid(extensions.st_geomfromgeojson((d->'geometry')::text),4326);
 if extensions.st_npoints(boundary)>500 then raise exception 'Boundary has too many points (maximum 500).'; end if;
 result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
 if exists(select 1 from public.zones where id=result_id and event_id<>e) then raise exception 'Zone is outside this event.'; end if;
 insert into public.zones(id,event_id,name,boundary_type,boundary,radius_meters) values(result_id,e,btrim(d->>'name'),d->>'boundary_type',boundary,nullif(d->>'radius_meters','')::int)
 on conflict(id) do update set name=excluded.name,boundary_type=excluded.boundary_type,boundary=excluded.boundary,radius_meters=excluded.radius_meters;
 elsif a='team.save' then
 perform public.dz_require(e,'manage_teams'); perform public.dz_rate(e,'staff');
 result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
 if exists(select 1 from public.teams where id=result_id and event_id<>e) then raise exception 'Team is outside this event.'; end if;
 insert into public.teams(id,event_id,name) values(result_id,e,btrim(d->>'name')) on conflict(id) do update set name=excluded.name;
 elsif a='team.assign' then
 perform public.dz_require(e,'manage_teams'); perform public.dz_rate(e,'staff');
 target:=(d->>'user_id')::uuid; team:=nullif(d->>'team_id','')::uuid;
 perform 1 from public.event_memberships where event_id=e and user_id=target and status='active' and role='participant' for update;
 if not found then raise exception 'An active participant in this event is required.'; end if;
 if team is not null and not exists(select 1 from public.teams where id=team and event_id=e) then raise exception 'Team is outside this event.'; end if;
 -- Single team per participant through the mutation path; Phase 1 links are preserved.
 delete from public.team_memberships where event_id=e and user_id=target;
 if team is not null then insert into public.team_memberships(event_id,team_id,user_id) values(e,team,target); end if;
 result_id:=target;
 elsif a='roster.import' then
 perform public.dz_require(e,'manage_members'); perform public.dz_rate(e,'staff');
 if jsonb_typeof(d->'rows') is distinct from 'array' or jsonb_array_length(d->'rows') not between 1 and 1000 then raise exception 'Import must contain 1–1000 rows.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(e::text||'roster',0));
 if jsonb_array_length(public.dz_roster_preview(e,d->'rows'))>0 then raise exception 'Roster conflict. Recheck the server preview; no rows were imported.'; end if;
 if (select count(*)<>count(distinct lower(btrim(value->>'email'))) from jsonb_array_elements(d->'rows')) then raise exception 'Duplicate emails in import.'; end if;
 insert into public.roster_imports(event_id,actor_id,imported,skipped) values(e,auth.uid(),0,0) returning id into result_id;
 for row in select value from jsonb_array_elements(d->'rows') loop
 if jsonb_typeof(row)<>'object' or exists(select 1 from jsonb_object_keys(row) k where k not in ('email','display_name','team_name')) or
 coalesce(row->>'email','') !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$' or length(row->>'email')>254 or
 coalesce(length(btrim(row->>'display_name')),0) not between 1 and 80 or length(coalesce(row->>'team_name',''))>100 then raise exception 'Invalid roster row; check columns, name, email and team.'; end if;
 select * into existing from public.roster_records where event_id=e and email=lower(btrim(row->>'email'));
 if found then
 if existing.team_name<>btrim(coalesce(row->>'team_name','')) or existing.display_name<>btrim(row->>'display_name') then raise exception 'Roster conflict for an existing email. No rows were imported.'; end if;
 v_skipped:=v_skipped+1;
 else
 insert into public.roster_records(event_id,email,display_name,team_name,import_id) values(e,lower(btrim(row->>'email')),btrim(row->>'display_name'),btrim(coalesce(row->>'team_name','')),result_id);
 v_imported:=v_imported+1;
 end if;
 end loop;
 update public.roster_imports set imported=v_imported,skipped=v_skipped where id=result_id;
 perform public.write_audit_event(e,auth.uid(),null,a,jsonb_build_object('import_id',result_id,'imported',v_imported,'skipped',v_skipped));
 return jsonb_build_object('id',result_id,'imported',v_imported,'skipped',v_skipped,'failed',0);
 else raise exception 'Unknown staff operation.';
 end if;
 perform public.write_audit_event(e,auth.uid(),target,a,jsonb_build_object('resource_id',result_id));
 return jsonb_build_object('id',result_id);
end $$;

create function public.dz_messaging(e uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations; result_id uuid; recipient uuid; targets uuid[]; count_recipients int:=0;
begin
 perform public.dz_require(e);
 if a in ('conversation.create','message.send') then
 perform public.dz_writable(e); perform public.dz_rate(e,'message');
 if a='conversation.create' then
 insert into public.conversations(event_id,participant_id,subject) values(e,auth.uid(),btrim(d->>'subject')) returning * into c;
 else
 select * into c from public.conversations where id=(d->>'conversation_id')::uuid and event_id=e;
 if not found or not public.dz_conversation_visible(c.id) then raise exception 'Private conversation access denied.' using errcode='42501'; end if;
 end if;
 if c.participant_id<>auth.uid() and public.dz_blocked(e,auth.uid(),c.participant_id) then raise exception 'Interaction is blocked. Another authorized organizer may respond.'; end if;
 insert into public.messages(event_id,conversation_id,sender_id,body) values(e,c.id,auth.uid(),btrim(d->>'body')) returning id into result_id;
 update public.conversations set updated_at=now() where id=c.id;
 if c.participant_id<>auth.uid() then perform public.dz_notify(e,c.participant_id,'message',result_id,'New private organizer response',auth.uid());
 else
 for recipient in select user_id from public.event_memberships where event_id=e and status='active' and 'manage_members'=any(permissions) loop
 if not public.dz_blocked(e,auth.uid(),recipient) then perform public.dz_notify(e,recipient,'message',result_id,'New private participant message',auth.uid()); end if;
 end loop;
 end if;
 return jsonb_build_object('id',result_id,'conversation_id',c.id,'state','sent');
 elsif a='conversation.read' then
 if not public.dz_conversation_visible((d->>'id')::uuid) or not exists(select 1 from public.conversations where id=(d->>'id')::uuid and event_id=e) then raise exception 'Conversation access denied.'; end if;
 insert into public.conversation_reads values((d->>'id')::uuid,auth.uid(),now()) on conflict(conversation_id,user_id) do update set read_at=now();
 elsif a='notification.read' then
 update public.notifications set read_at=now() where id=(d->>'id')::uuid and event_id=e and user_id=auth.uid();
 if not found then raise exception 'Notification not found.'; end if;
 elsif a='communication.send' then
 perform public.dz_require(e,'manage_event'); perform public.dz_rate(e,'staff');
 select coalesce(array_agg(value::uuid),'{}') into targets from jsonb_array_elements_text(coalesce(d->'targets','[]'));
 if d->>'scope'='teams' and (cardinality(targets)=0 or exists(select 1 from unnest(targets) t where not exists(select 1 from public.teams where id=t and event_id=e))) then raise exception 'Select teams belonging to this event.'; end if;
 if d->>'scope'='participant' and (cardinality(targets)<>1 or not exists(select 1 from public.event_memberships where event_id=e and user_id=targets[1] and status='active' and role='participant')) then raise exception 'Select an active event participant.'; end if;
 insert into public.communications(event_id,sender_id,kind,title,body,scope,targets) values(e,auth.uid(),d->>'kind',btrim(d->>'title'),btrim(d->>'body'),d->>'scope',targets) returning id into result_id;
 for recipient in select m.user_id from public.event_memberships m where m.event_id=e and m.status='active' and m.role='participant' and
 ((d->>'scope'='event') or (d->>'scope'='participant' and m.user_id=targets[1]) or (d->>'scope'='teams' and exists(select 1 from public.team_memberships tm where tm.event_id=e and tm.user_id=m.user_id and tm.team_id=any(targets)))) loop
 insert into public.communication_recipients values(e,result_id,recipient);
 perform public.dz_notify(e,recipient,'communication',result_id,'New official event communication',auth.uid());
 count_recipients:=count_recipients+1;
 end loop;
 perform public.write_audit_event(e,auth.uid(),null,a,jsonb_build_object('communication_id',result_id,'recipients',count_recipients));
 return jsonb_build_object('id',result_id,'recipients',count_recipients,'state','delivered_in_app');
 else raise exception 'Unknown communication operation.';
 end if;
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.dz_staff(uuid,text,jsonb),public.dz_messaging(uuid,text,jsonb) from public,anon,authenticated;

create function public.dz_command(p_event uuid,p_action text,p_data jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached public.command_receipts; result jsonb;
begin
 if auth.uid() is null or p_request is null or p_event is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Authenticated request, event and object payload required.' using errcode='42501'; end if;
 -- Serialize each user/request pair; replay is safe for seven days, and payload changes are rejected.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
 if p_action in ('event.update','event.create') then
 if not exists(select 1 from public.event_memberships where event_id=p_event and user_id=auth.uid() and status='active' and role='organizer' and 'manage_event'=any(permissions)) then raise exception 'Trusted organizer permission required.' using errcode='42501'; end if;
 else perform public.dz_require(p_event); end if;
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
revoke all on function public.dz_command(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.dz_command(uuid,text,jsonb,uuid) to authenticated;

-- Preserve Phase 1 invitation RPC; enforce its rate limit independently of the client.
create function public.dz_invitation_limit() returns trigger language plpgsql security definer set search_path='' as $$
begin if auth.uid() is not null then perform public.dz_rate(new.event_id,'invitation'); end if; return new; end $$;
create trigger invitation_rate before insert on public.event_invitations for each row execute function public.dz_invitation_limit();
revoke all on function public.dz_invitation_limit() from public,anon,authenticated;
