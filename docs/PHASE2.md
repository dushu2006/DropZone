# Phase 2 implementation and verification

## Scope and current decision

Implemented in the existing React/Vite + Supabase architecture, without modifying the Phase 1 migration or deploying anything. No production domain, participant onboarding, actual roster import, or pilot was performed. **Live verification is still pending. Do not treat this change as production approval or Phase 3 completion.**

The browser now uses real Supabase RPCs and Storage calls. Without configuration it fails closed; it never falls back to demonstration activity. The original prototype remains isolated behind the development-only opt-in switch.

## Code map

- `src/lib/`: restored missing Supabase client validation and TypeScript contracts; `.gitignore` now preserves this source directory.
- `src/phase2/api.ts`, `forms.tsx`: authenticated RPC boundary, cancellable reads, explicit error states, retry IDs and reusable accessible fields.
- `Feed.tsx`, `templates.ts`: seven structured templates plus custom submissions, filters/search/pagination, details, replies, reports, author lifecycle and review.
- `ZoneMap.tsx`, `location.ts`: lazy-loaded Leaflet map, circular/polygon boundary editing, keyboard coordinate entry, permission-based geolocation.
- `Staff.tsx`, `roster.ts`: event configuration/creation, teams, explicit staff grants/revocation, transactional roster preview/import, reports and audit trail.
- `Messaging.tsx`: private organizer conversations, targeted official communications and individual notification read state.
- `Attachments.tsx`: private byte upload, signature validation, server verification, authenticated viewing and tombstoning.
- `Workbench.tsx`, `phase2.css`: integration with existing authenticated workspaces and visual styling. Existing URLs remain valid; `page`/`id` query parameters select views, never authorize them.
- Six additive migrations `20261010010000` through `20261010015000`: schema, operations, invoker reads/RLS, management hardening, private Storage and trusted verifier/cleanup RPCs.
- `supabase/functions/verify-attachment`: verifies user identity and attachment ownership, inspects actual private object bytes, acknowledges verification using its server-only service credential.
- `supabase/functions/maintenance`: operator/scheduler-only retention and Storage-object cleanup.

## Authorization and privilege boundaries

All new private tables have RLS. Clients get SELECT privileges only where a read policy exists. Writes go through `dz_command`, which resolves `auth.uid()`, checks active membership, and dispatches to narrowly scoped feature functions. Internal mutators, audit writers, counters, retry receipts, verifier acknowledgements and cleanup functions are not executable by ordinary clients. Every definer function fixes its search path. Anonymous commands are denied.

`dz_read` is **SECURITY INVOKER**, so its joins, lists and counts remain subject to table RLS. Author display names are exposed only within a shared authorized event; private profile/email fields are not exposed through author labels. Roster email addresses are restricted to the explicit `manage_members` grant.

| Operation | Required authority |
|---|---|
| Feed, post, reply, report, own preferences | Active event membership; restricted users cannot create content/messages/reports |
| Own resolve/delete/cancel/revise/queue | Authenticated author + eligible lifecycle state |
| Review custom/promotional submission | `review_custom_posts`; self-approval forbidden |
| Report review/dismiss/escalation | `review_reports` |
| Removal or 24-hour participant restriction | Both `review_reports` and `remove_content`; staff restrictions require a trusted administrator |
| Event create/edit/close/reopen, announcements | `manage_event`; creation also requires an existing organizer record; creation copies only existing grants |
| Zone save | `manage_zones` |
| Team save/assignment | `manage_teams`; active participant and same-event team required |
| Roster import and organizer inbox | `manage_members` |
| Staff assignments/revocation | Existing Phase 1 grant-subset and role-grant checks |
| Audit read | `view_audit_log`; client mutation always denied |
| File access | Exact reserved object path, active membership, post visibility, ready status; uploads require ownership and an unexpired pending reservation |

Closing maps to the preserved Phase 1 `archived` status. Ordinary event activity stops. Active managers retain access to event settings so they can reopen the event; their content access does not bypass the closed-event restriction.

## Content and lifecycle policy

Structured JSON fields are validated against database template definitions: required keys, allowed keys, value shape/length, lost/found discriminator, quantities/openings, response preference and validity constraints. Unknown template fields are rejected, not silently dropped. Profile identity is reused.

Normal templates publish immediately. Custom and promotional forms can save a **Submitted** record or enter **Awaiting Review**. The author can queue a saved submission, cancel a pending one, or revise a changes-requested submission. Authorized staff can request changes, reject or publish; each decision is audited. Promotional content has separate approval and a two-per-day limit.

Active feed queries enforce `status = published AND expires_at > now()` on the server. Resolved/expired/deleted/removed records have distinct meanings. Resolution is author-only under this initial policy. History remains available to the author while event membership is active; moderators can see context according to explicit grants. A notification for the latest decision on a post is refreshed as unread when another actual decision occurs, rather than accumulating duplicate status notifications.

Posts paginate 30 at a time; threads/messages paginate 50. Search uses a PostgreSQL full-text index. Offset pagination is bounded and deterministic by timestamp/ID; on a busy changing feed, refresh may shift page boundaries.

## Reports, block and mute

- **Report:** persists a private review request. One report per reporter/target/event; nothing is automatically declared guilty or removed.
- **Block:** two-way community post/reply visibility filtering and denial of new replies/direct organizer responses between the pair. Existing authorized organizer conversation history remains available; blocking an individual cannot remove the event organizer team's record access or prevent official communications.
- **Mute:** hides the selected author's posts from the muter's feed and suppresses notifications generated by that author. It does not deny direct resource access or replies. Official communication records remain available in the communications inbox.

Notification text for private messages is generic. The destination is resolved from authorized records and the destination page performs another RLS-controlled read. No external email/push delivery is implemented or claimed.

## Teams, rosters and recipients

One current team assignment per participant is enforced by the authorized assignment operation, which locks the membership row and replaces links transactionally. Legacy Phase 1 links are not destructively migrated. Composite foreign keys prevent cross-event links, and self-assignment has no direct table-write path.

Roster files accept CSV/XLSX with one worksheet, 1–1,000 rows and a 2 MB limit. Columns are `email`, `display_name`, optional `team_name`. Unknown/duplicate columns, formulas, invalid email/name/lengths and duplicate emails are rejected. The browser previews without writes and requests a permission-checked server preflight for existing roster/confirmed-team conflicts. Confirm performs another server-side validation in a serialized transaction. An existing identical record is skipped; conflicting data aborts the entire import. Result/audit records contain real counts. CSV error exports neutralize spreadsheet formula prefixes.

**A roster record is not an Auth account, invitation, or confirmed team membership.** Planned team names do not silently create people. Organizers use invitation codes and explicit team assignment after accounts join. Roster entries and import history have explicit pagination controls.

Communications snapshot recipients from active participant memberships at send time. Team selectors are validated against the event; the database—not the browser—resolves recipients. Later team changes do not retroactively modify delivered communications. Revoking event membership still removes access.

## Rate limits and retries

Operator-configurable `rate_rules`: posts 10/hour; custom 4/hour; promotion 2/day; replies 30/10 minutes; reports 10/hour; private messages 30/10 minutes; invitation creation 20/hour; staff actions 60/10 minutes; upload reservations 10/hour. These are configuration, not seeded activity. Changes require a trusted database operator.

Counter operations use a transaction advisory lock plus a locked counter row, preventing read/increment races. Errors include remaining retry seconds. Failed transactions roll back their records and notifications. `command_receipts` binds a user/request UUID to an event/action/payload for seven days; altered payloads cannot reuse a key. Coordinates are removed from retry receipts. Persistent receipt replay beyond seven days is not promised. Legacy Phase 1 role/invitation forms retain their original operation semantics.

## Geography and map policy

PostGIS uses SRID 4326, **longitude then latitude**, circle distance in **meters**, and valid nonempty polygons of at least 1 m² with bounded coordinates and at most 500 vertices. Boundary membership uses `ST_DWithin` on geography for circles and `ST_Covers` for polygons (edge points included). No client `insideZone` flag is accepted as authority.

An event can require a fresh browser reading when posting. Default accuracy threshold is 100 m, configurable 5–500 m. Poor accuracy, denial, timeout, outside-boundary and success remain different outcomes. The reported center must be inside; accuracy is an uncertainty threshold, not an expansion of the boundary or proof of presence. Coordinates are not persisted in posts, audits or retry receipts. Browser GPS can be spoofed. This is not an anti-cheat or identity-proof mechanism.

Leaflet defaults to `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, with attribution. Optional public build variables:

```dotenv
VITE_MAP_TILE_URL=https://your-authorized-provider/{z}/{x}/{y}.png
VITE_MAP_ATTRIBUTION=Your provider attribution
```

Use an HTTPS raster tile provider whose terms permit your traffic. Any browser key is public and should be domain-restricted. Standard OSM tiles have no SLA: retain attribution, obey provider usage/caching policies, and do not bulk-download/prefetch/offline-cache them. Select a suitable provider for event-scale usage. Tile requests disclose the viewed map extent and browser IP to the provider; only explicitly requested geolocation centers the map on the user. Live map tile access was not verified in Arena's restricted network.

## Attachments, retention and cleanup

Private bucket: `event-attachments`. Paths: `<event UUID>/<post UUID>/<attachment UUID>`; no user names/emails/filenames. Maximum three images per post, 5 MB each, JPEG/PNG/WebP only. SVG, HTML, PDF and arbitrary executables are excluded.

Flow: reserve metadata → upload actual bytes (immutable/no upsert) → invoke authenticated Edge verifier → finalize after both byte verification and Storage metadata checks. Filename-only records never become ready. A failed verifier leaves a retryable pending upload, not a false-success state. Signature inspection is an allowlist, **not a malware scanner or guarantee of valid image decoding**. Metadata such as camera EXIF is not stripped; warn participants not to upload sensitive images and consider server-side re-encoding before broader use.

Viewing uses authenticated Storage download into a temporary browser blob rather than public URLs. New requests re-evaluate authorization. Download buttons can be disabled by organizers, but any image displayed in a browser can be copied, screenshotted or recorded; cached/downloaded bytes cannot be revoked. No absolute copy-protection claim is made.

| Record | Implemented retention |
|---|---|
| Precise location | Not stored by the application |
| Pending file reservation | Tombstoned after 24 hours |
| Deleted post/reply text | Redacted after 30 days; audit/identity/status references retained |
| Deleted/tombstoned files | Access denied immediately; Edge maintenance removes Storage bytes in batches of 100 |
| Notifications | 90 days |
| Retry receipts | 7 days (contain submitted content, never coordinates) |
| Rate counters | 2 days |
| Archived event content, messages and roster PII | Posts/replies redacted, files tombstoned, private conversations/rosters removed after 180 days archived |
| Audit and moderation records | Retained for trusted review; no automatic purge. Confirm legal retention policy before launch |

`dz_maintenance()` enforces transitions/redaction without a browser. It installs a 15-minute pg_cron job if pg_cron already exists; otherwise the operator must enable scheduling below. Physical file deletion **must use the Storage API**, never direct deletes from `storage.objects`. The supplied maintenance Edge Function does this and acknowledges only successful batches. It is safe to retry. Backups and prior downloads may retain information; no complete/instant-erasure promise. Account deletion needs an operator-reviewed anonymization/purge process where content foreign keys still reference the account; an end-user account-deletion workflow is not included.

## Exact later setup (staging first; not executed here)

1. `npm ci`. Copy `.env.example` to `.env.local`.
2. From Supabase **Project Settings → API / API Keys**, configure only `VITE_SUPABASE_URL` (Project URL) and `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable or legacy anon key). Never put service-role/secret keys, CLI tokens or DB passwords in `VITE_*`, the frontend or Git.
3. In **Authentication → Providers → Email**, enable password signup and confirmations. In **URL Configuration**, set the trusted Site URL and exact `/auth/callback` and `/auth/reset-password` redirects. Configure Auth email delivery. These are Auth messages, not DropZone in-app notification emails.
4. Link a **staging** project and apply migrations:
   ```sh
   npm exec supabase -- login
   npm exec supabase -- link --project-ref YOUR_STAGING_PROJECT_REF
   npm run db:push
   ```
   Enter a requested database password only in the local CLI prompt. Never reset a hosted database. The first event/organizer still uses `supabase/BOOTSTRAP.md`; subsequent authorized organizers can create events in the app.
5. Confirm PostGIS is enabled and the private `event-attachments` bucket/policies were created. Apply the full migration sequence before releasing the frontend.
6. Configure the two Supabase Edge Functions in staging:
   ```sh
   npm exec supabase -- functions deploy verify-attachment
   npm exec supabase -- functions deploy maintenance
   ```
   These commands are instructions only; nothing was deployed in this task. The Supabase environment supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` **server-side only**. Add a cryptographically random `DROPZONE_MAINTENANCE_SECRET` through Dashboard **Edge Functions → Secrets**. Never put it in a browser env or chat. The verifier validates the caller with `auth.getUser()`; maintenance requires the separate `X-Maintenance-Secret`. `verify_jwt=false` in config does not make either function unauthenticated.
7. Enable **pg_cron** in Database Extensions if not already enabled. From trusted SQL Editor, schedule materialization (skip if the migration already created this named job):
   ```sql
   select cron.schedule('dropzone-maintenance', '*/15 * * * *',
     'select public.dz_maintenance()');
   ```
   Use Supabase Dashboard **Cron → new HTTP job** every 15 minutes to POST to `<PROJECT_URL>/functions/v1/maintenance`, with `X-Maintenance-Secret` from a protected/Vault-backed scheduler secret. Protect all job configuration from ordinary clients. The endpoint refuses to run if the secret is missing. Test with a disposable tombstoned object and check function/job logs. Schedule more frequent batches if cleanup consistently reports `more_may_remain=true`.
8. Configure an approved public map tile URL/attribution if the default OSM provider is unsuitable. Restart Vite or rebuild after changing any `VITE_*` value.
9. For disposable local testing with Docker/Podman: `npm run db:start`, `npm run db:reset`, `npm run db:test`; serve the Edge Functions with local server-only secrets, set browser values to the printed local API URL/key, then `npm run dev`. When using Arena's proxied preview, the browser cannot reach sandbox `localhost`; use a reachable staging project or a correctly configured same-origin proxy. Do not point a remote browser at sandbox loopback.

## Evidence and remaining verification

Executed evidence is summarized in the final report. Automated coverage includes real migration replay/RLS in PGlite/PostGIS, structured fields, authorized search/feeds, replies and safe retries, lifecycle/retention, review/revision, reports/removal, block/mute, private inboxes, targeted recipients, transactional imports, geography, Storage schema-contract policies, rate limits, role revocation, and browser form/error/parser/location tests. The Storage fixture simulates metadata and verifier acknowledgement; it does **not** upload actual bytes to hosted Supabase.

PGlite serializes transactions on one connection. The overlapping-request test verifies queued callers and counter behavior, **not** a multi-connection PostgreSQL stress test. The production locking design must still be exercised with parallel real JWT requests in staging.

Pending: hosted Auth/refresh/email verification; direct PostgREST requests with real unrelated JWTs; true concurrent database sessions; hosted Storage API/verifier/cleanup; pg_cron execution; live tiles/GPS; mobile and assistive-technology end-to-end review. Supabase containers/project credentials and the map provider were not available for those checks here. No hosted readiness claim is justified until these pass.

### Executed verification record — 2026-10-10

| Check | Result | Evidence / boundary |
|---|---|---|
| Full `npm test` | PASS | 75 tests, 5 files: Phase 1 DB 10; Auth/routes 20; config 5; Phase 2 DB 25; Phase 2 UI/parser/location 15 |
| `npm run build` | PASS | TypeScript + Vite; map and XLSX split into lazy chunks |
| Edge Function typecheck | PASS | `npm exec --yes --package=deno -- deno check --no-config --node-modules-dir=auto supabase/functions/verify-attachment/index.ts supabase/functions/maintenance/index.ts` |
| `git diff --check` | PASS | No reported whitespace errors |
| Production prototype-string spot-check | PASS | Selected known prototype fixture strings absent from built JS; preview also remains compile-time DEV gated |
| Migration replay, RLS, workflow operations | PASS, isolated | PGlite/PostGIS; Storage schema contract is a fixture, not a hosted object service |
| Overlapping rate-limit callers | PASS, isolated | PGlite serialized transactions; independent PostgreSQL-session race not yet tested |
| Local Supabase / pgTAP | BLOCKED | CLI status: Docker and Podman both unavailable; pgTAP was not executed |
| Hosted Auth/PostgREST/Storage/Edge jobs | BLOCKED | No configured project/credentials; only `.env.example` exists |
| Live tiles, GPS, end-to-end accessibility/mobile review | NOT VERIFIED | Integration implemented; no live provider/browser pilot performed |

No failing test or build remains in the executed checks. Known limitations are documented above (signature-only image inspection/EXIF, explicit retention and account-purge policy, offset pagination, browser copy limitations). Remaining Phase 2 sign-off work is the external-service and independent-session verification listed here, plus real-browser responsive/accessibility review. **Do not mark the full Phase 2 definition of done verified from this isolated evidence alone.**
