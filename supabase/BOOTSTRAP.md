# Bootstrap the first real event organizer

The application intentionally has no seeded event, demo account, or public event-creation path. A fresh database contains schema and policy configuration only, with no fabricated activity. Phase 2 allows an existing trusted organizer with `manage_event` to create subsequent events; it does not replace this initial trust bootstrap. An operator must create the first event and assign its first organizer from the trusted Supabase SQL Editor (or another trusted server-side administrative connection).

**Acceptance prerequisite (2026-10-10):** apply the complete migration chain through `20261010030000_samartha_acceptance_security.sql` from [the deployment runbook](../docs/DEPLOYMENT.md) on an explicitly authorized target. Verify the linked project and back up existing data. This SQL is an operator procedure, not a command executed by this audit. Use a real consenting confirmed identity; never manufacture an Auth user or import a fabricated roster to satisfy acceptance. Revoked membership must be explicitly restored by appropriately authorized staff; invitation redemption intentionally cannot restore it.

1. Create the real user's account through the public registration flow and complete email confirmation.
2. In **Authentication → Users**, copy that account's UUID.
3. Open the Supabase SQL Editor as a trusted project administrator. Replace the event name/slug and the account UUID below. The UUID setting is an identity, not a password or secret.
4. Run the transaction once. It creates one real event and assigns the organizer's initial explicit permissions. Do not expose a service-role key in the browser.

```sql
begin;

select set_config('dropzone.bootstrap_user_id', 'PASTE_REAL_AUTH_USER_UUID_HERE', true);

do $bootstrap$
declare
  v_user_id uuid := nullif(current_setting('dropzone.bootstrap_user_id', true), '')::uuid;
  v_event_id uuid;
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise exception 'The bootstrap account must already exist in Supabase Auth.';
  end if;

  insert into public.events (name, slug, created_by)
  values ('Your event name', 'your-event-slug', v_user_id)
  returning id into v_event_id;

  insert into public.event_memberships (event_id, user_id, role, permissions, status, granted_by)
  values (
    v_event_id,
    v_user_id,
    'organizer',
    array[
      'view_members', 'manage_members', 'manage_teams', 'manage_zones', 'manage_event',
      'manage_roles', 'grant_organizer', 'grant_moderator', 'review_reports',
      'remove_content', 'review_custom_posts', 'view_audit_log'
    ],
    'active',
    v_user_id
  );

  insert into public.audit_events (event_id, actor_user_id, target_user_id, action, metadata)
  values (v_event_id, v_user_id, v_user_id, 'event.bootstrap.created', jsonb_build_object('source', 'trusted_operator'));
end;
$bootstrap$;

commit;
```

Use the event slug format `lowercase-words-with-hyphens`. The first organizer's grants are explicit; later organizers/moderators must be assigned with the permission-checked `manage_event_membership` RPC or a trusted operator path. An organizer can create participant-only invitation codes only when `manage_members` is explicitly assigned. Invitation codes are hashed in the database, expire within 30 days, and are never used to grant elevated roles.
