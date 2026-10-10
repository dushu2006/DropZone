alter table public.attachments add column verified_at timestamptz, add column storage_removed_at timestamptz;
-- Called ONLY by the byte-inspecting Supabase Edge Function using its server-side service key.
create function public.dz_verify_attachment(p_id uuid,p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.attachments a set verified_at=now() where id=p_id and owner_id=p_owner and status='pending' and created_at>now()-interval '24 hours'
 and exists(select 1 from public.event_memberships m join public.events e on e.id=m.event_id where m.event_id=a.event_id and m.user_id=p_owner and m.status='active' and e.status='active');
 if not found then raise exception 'Upload is no longer eligible for verification.'; end if;
end $$;
create function public.dz_enforce_verified_file() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='ready' and new.verified_at is null then raise exception 'Server-side image verification is required before publishing an attachment.'; end if;
 return new;
end $$;
create trigger attachment_requires_verification before insert or update on public.attachments for each row execute function public.dz_enforce_verified_file();
create function public.dz_cleanup_batch() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(row_to_json(a)),'[]') from (select id,object_path from public.attachments where status='deleted' and storage_removed_at is null order by created_at limit 100) a;
$$;
create function public.dz_cleanup_ack(p_ids uuid[]) returns void language sql security definer set search_path='' as $$
 update public.attachments set storage_removed_at=now() where id=any(p_ids) and status='deleted';
$$;
revoke all on function public.dz_verify_attachment(uuid,uuid),public.dz_enforce_verified_file(),public.dz_cleanup_batch(),public.dz_cleanup_ack(uuid[]) from public,anon,authenticated;
grant execute on function public.dz_verify_attachment(uuid,uuid),public.dz_cleanup_batch(),public.dz_cleanup_ack(uuid[]) to service_role;
-- Metadata authorization remains RLS-controlled for the browser. Only the Edge verifier needs
-- service-role metadata reads. It verifies ownership using the caller's authenticated read first.
grant select on public.attachments to service_role;
