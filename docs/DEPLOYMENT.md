# DropZone deployment and live-verification runbook

## Current release gate

No hosted deployment, project migration, production bootstrap, live roster import or participant onboarding was performed. There is no configured Supabase project, Auth/email service or authorized hosting target in this workspace. No Docker/Podman runtime is installed. The outbound allowlist also excludes Supabase and tile/hosting endpoints. **Do not approve a live pilot on isolated test results.** The implementation is retained on the existing working branch; this runbook supplies the exact configuration/operations that require an authorized operator.

No existing hosting provider configuration was found. `netlify.toml` plus generated `_headers` and `public/_redirects` provide a static Netlify-compatible deployment direction. Cloudflare Pages can also consume `dist`, `_headers` and `_redirects`. `deploy/nginx.conf` is an alternative SPA routing template, not an additional application backend. Supabase remains the only backend.

## 1. Reproduce local evidence

Use Node 22+, npm and a Linux/macOS/Windows platform supported by the native PostgreSQL test dependency. Do not run native PostgreSQL as root. In a fresh checkout:

```sh
npm ci
npm test -- --run
npx tsc --noEmit -p tsconfig.json
npm run build
npm run verify:build
npm run test:browser
npm exec --yes --package=deno@2.9.6 -- deno check supabase/functions/verify-attachment/index.ts supabase/functions/maintenance/index.ts
git diff --check
npm audit --json
```

To capture all of these checks plus the pgTAP attempt in durable logs, run `node scripts/run-local-audit.mjs`. It continues after failures to record every exit, but itself returns nonzero if any command fails (currently pgTAP requires X6). Output: `docs/evidence/samartha-audit/commands.json` and `.txt` logs; no deployment, reset or hosted smoke occurs.

Playwright starts Vite on `0.0.0.0:5173` and the built-bundle preview on port 4173 when they are not already running; build first. On Linux x64 it uses the packaged Chromium. On other platforms run `npx playwright install chromium` on a machine with browser-download access, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed compatible Chromium. Chromium's NSS/NSPR dependencies are bundled in the pinned npm package; test output goes under ignored `.cache/`. UI tests use a prominently labeled, isolated test-only Supabase adapter, **not** real identities or Storage. The default Vite build never includes the browser fixture HTML or sample preview data. Native PostgreSQL starts/stops only for the finite concurrency test and is not an app service.

On a separate machine with Docker/Podman, run `npm run db:start`, `npm run db:reset` **locally only**, then `npm run db:test`. Do not aim a reset at a hosted project. This additionally exercises pgTAP inside the Supabase stack, not merely PGlite.

## 2. Configure a dedicated staging Supabase project

Use a non-production project you are authorized to modify. Review the full versioned migration chain, back up any existing data and confirm the linked reference before applying anything:

```sh
npm exec supabase -- login
npm exec supabase -- link --project-ref YOUR_STAGING_PROJECT_REF
npm exec supabase -- migration list
npm exec supabase -- db push --dry-run
npm run db:push
```

Enter credentials only through the operator's secure local CLI flow; never in chat or a `VITE_*` variable. Apply the exact migration order (CLI sorts version prefixes):

1. `20261010000000_phase1_identity_membership_foundation.sql`
2. `20261010010000_phase2_workflow_schema.sql`
3. `20261010011000_phase2_content_operations.sql`
4. `20261010012000_phase2_staff_and_messaging.sql`
5. `20261010013000_phase2_reads_and_storage.sql`
6. `20261010014000_phase2_management_hardening.sql`
7. `20261010015000_phase2_storage_verification.sql`
8. `20261010020000_final_workflow_completion.sql`
9. **`20261010030000_samartha_acceptance_security.sql`** (this audit's only new migration).

The first eight files are unchanged from this audit's start. Migration 20000 is the earlier workflow completion, not a new change in this audit. Migration 30000 prevents expiry from granting publication, rejects revoked invitation rejoin, serializes membership target changes, permits eligible rejected-author resubmission and retains historical review reasons within the existing 30-day deletion / 180-day archived-event content-redaction periods. Audit evidence follows its separate restricted retention policy.

**Upgrade/backfill behavior:** published/resolved versions are marked authorized; expired non-review-required categories retain prior ordinary-publication semantics. Legacy expired review-required versions are deliberately hidden from peers because approval of their current version cannot reliably be proved. Authors/authorized reviewers retain access; no text or audit is deleted. Historical `decision_reason` values not captured before this migration cannot be reconstructed. On an authorized staging copy, compare row counts and owner/reviewer/peer visibility before/after, including already-expired custom/promotion posts. Review any exceptions individually; never blanket-authorize legacy private content. Clean isolated replay is tested; populated hosted upgrade/lock duration is **not**. The operator must assess event size and a maintenance window.

Confirm the migration-created **`event-attachments`** bucket is private, 5,242,880-byte maximum and limited to JPEG/PNG/WebP. Inspect Storage object policies and function grants after migration; do not use public URLs or weaken RLS to bypass errors. Use §7 if rollout fails.

Set Auth **Site URL** to the real HTTPS staging frontend origin. Allow exact `<APP_ORIGIN>/auth/callback` and `<APP_ORIGIN>/auth/reset-password` redirects. Enable email/password signup.

**Email confirmation configuration:**
- **Local development:** Configured in `supabase/config.toml` with `enable_confirmations = false`. Registration returns an active session immediately without confirmation emails.
- **Hosted development/staging:** In the Supabase Project Dashboard under **Authentication → Providers → Email**, toggle **"Confirm email"** to **OFF** and save. For existing accounts created while confirmation was enabled, run `update auth.users set email_confirmed_at = now() where email_confirmed_at is null;` in the Supabase SQL Editor to activate them.
- **Production (if confirmations enabled by policy):** If production requires confirmed emails, keep **"Confirm email"** enabled, configure custom SMTP delivery/rate limits, verify sender identity, and ensure allowed redirect URLs include `<APP_ORIGIN>/auth/callback`. The application explicitly displays email confirmation instructions when no session is returned on registration.

Create the first real operator account through the application, then follow `supabase/BOOTSTRAP.md` in the trusted SQL Editor. Public signup and roster import must never grant staff. Other real test users should join through participant-only invitations; assign staff and team grants explicitly. Use two authorized staging events, two teams and independent real consenting participant/peer/outsider, limited-moderator and organizer identities. Do not manufacture Auth accounts, import fabricated participants, send communications to real attendees, or represent test records as production activity. Obtain explicit authorization for all staging mutations and use only privacy-safe records.

## 3. Deploy and schedule Supabase Edge Functions

```sh
npm exec supabase -- functions deploy verify-attachment
npm exec supabase -- functions deploy maintenance
```

`supabase/config.toml` deliberately disables the legacy gateway JWT check for these two functions. The verifier independently validates the supplied user token with `Auth.getUser`, reads eligible owned attachments through caller RLS, then accesses bytes using its server-only key. Maintenance independently requires `X-Maintenance-Secret`. Never deploy either with its application-level checks removed.

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in the Edge environment. Generate a high-entropy maintenance secret using your password manager/secure operator terminal. Put **only** `DROPZONE_MAINTENANCE_SECRET=<secret>` in an ignored `.env.edge.local`, then:

```sh
npm exec supabase -- secrets set --env-file .env.edge.local
```

Configure Supabase Cron + Vault + pg_net (or the project's approved server-side scheduler) to POST hourly to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/maintenance` with the secret header. Store the endpoint/secret in Vault, not a browser, public SQL file, source code or logs. Inspect the JSON response; if `more_may_remain` is true, process another batch. Retry non-2xx results and alert the operator; success is reported only after actual Storage removal and DB acknowledgement. Function/request logs may contain metadata; configure restricted access and retention.

Before launch, explicitly invoke the deployed verifier with missing/expired tokens, another user's pending ID, mismatched bytes and a valid private upload. Invoke maintenance without and with its server secret. Verify that physical objects disappear before cleanup acknowledgement. Merely deploying or scheduling is not verification.

## 4. Build and publish the frontend

Set only these public **build-time** variables in the chosen frontend host:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Real staging HTTPS project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser publishable key or legacy anon key; never service-role/secret |
| `VITE_MAP_TILE_URL` | Licensed HTTPS Web Mercator raster URL containing `{z}`, `{x}`, `{y}`; use one hostname, no `{s}` subdomain template |
| `VITE_MAP_ATTRIBUTION` | Provider-required plain text attribution including any mandated credits |
| `VITE_ENABLE_DEMO_PREVIEW` | `false` (also hard-disabled by production mode) |

Choose a provider whose required attribution can be fulfilled by the supported plain-text attribution, or add its required attribution links before deployment. Review usage, traffic, caching and privacy terms. Public OpenStreetMap development tiles are **not** an unlimited production service. The map sends viewed tile coordinates/IP to that provider; do not put private user coordinates or privileged tokens in tile configuration. User location remains opt-in, transient and spoofable.

Build command: `npm ci && npm run build && npm run verify:build`. Publish directory: **`dist` only**, never the repository root. Runtime: static HTTPS hosting, no server-side app or alternate backend required. Fonts are bundled locally. Secrets are unnecessary in the frontend runtime. The build rejects recognized private-name `VITE_*` variables, `sb_secret_` values and JWTs with `service_role` or `authenticated` roles before Vite transformation. Its error reports only the variable name. This is bounded defense in depth, not a universal secret scanner; manually review public build-variable names/values in the secure host UI. Never paste any privileged key or user session JWT into build settings. Missing/public-placeholder configuration intentionally builds an honest setup screen, not a working pilot.

The build emits `_headers` with CSP origins derived from the public Supabase/tile URLs, `nosniff`, referrer policy, geolocation permission policy and cache policies. Styles require inline styles for Leaflet; scripts do not allow inline code. Rebuild after changing environment settings. Netlify/Cloudflare honor these files; other hosts must copy equivalent headers from `dist/_headers` into their settings. Nginx ignores `_headers`: deploy `deploy/nginx.conf` and the generated `dist/nginx-security-headers.conf` together at the paths in that template. The snippet is included at the server and both cache-header locations, because a location-level `add_header Cache-Control` otherwise suppresses inherited security headers. The snippet URL is denied. Run `nginx -t` on the target, then verify actual HTML, assets, deep links and errors have the intended headers. This workspace has not executed nginx or final HTTPS termination. Configure HTTPS/HTTP-to-HTTPS redirect at the selected host/proxy and enable HSTS only after validating the domain/TLS policy. Permit embedding only if intentionally required by the chosen preview host; otherwise keep `frame-ancestors 'self'`.

Test direct navigation **and refresh** for `/login`, `/register`, `/privacy`, `/auth/callback`, `/auth/reset-password`, `/app/account` and all three event workspace URLs. Deep links must serve index.html, not a host 404; private routes must still require authentication. Test the final site's TLS, CSP, Auth redirects and map requests in a real browser. Vite's local fallback is not proof of the host's rewrite behavior.

## 5. Optional actual-service smoke command

`scripts/verify-hosted.mjs` performs **mutating staging-only** checks with three independent real user tokens. It never bootstraps accounts or uses a service role. Supply these through an ignored `.env.hosted.local` on an authorized network; never paste tokens into chat:

- `DZ_ALLOW_STAGING_WRITES=YES`
- `DZ_STAGING_URL` and `DZ_STAGING_PUBLISHABLE_KEY`
- `DZ_STAGING_EVENT_ID`: an active disposable staging event, location checks disabled for this smoke
- `DZ_PARTICIPANT_TOKEN`: confirmed active participant's short-lived access token
- `DZ_PEER_TOKEN`: a different confirmed member of the same event
- `DZ_OUTSIDER_TOKEN`: a third confirmed user with no membership of that event

```sh
node --env-file=.env.hosted.local scripts/verify-hosted.mjs
```

The command checks actual Auth identity, post persistence, idempotency, RPC/direct REST cross-event denial, private PNG upload, deployed verification, authorized byte-for-byte download, outsider denial and tombstone denial. It tombstones its own test post in `finally`; inspect maintenance afterwards for physical cleanup. If cleanup fails, use My activity as the test author and inspect the clearly labeled staging verification posts. Never reset the project to clean up. Rotate/revoke test tokens after use. This script is syntax-checked locally but **has not been executed against a project**. It is a focused smoke, not the full release gate below.

## 6. Required operator acceptance before a live pilot

Record real evidence, request results and timestamps—without tokens, private bodies or roster exports—in the acceptance checklist:

1. Actual registration/confirmation, invalid credentials, login, reload/session refresh/expiry, cross-account switching, recovery emails/callback/reset and logout in separate browser profiles.
2. Participant/organizer/moderator and limited-grant users; direct URL and forged RPC attempts; self-role escalation, grant/demotion/revocation; immediately repeat direct REST and Storage reads after revocation.
3. Specifically retest expired **unapproved** custom/promotional submissions (including edited or changes-requested versions): peers must not see text or files. Reject invitation rejoin after revocation without consuming the invitation. Race organizer grant against limited revocation; the newly elevated target must remain protected. Then test all eight post categories (seven structured + custom), structured validation, edits/concurrency conflict, review/rejection/reason/resubmission/cancellation, attachment-triggered rereview, resolve/expiry/delete and author history. Verify refresh persistence and a second user's view.
4. Reports on posts/replies/users, permissions for dismissal/removal/restriction/escalation, private reason visibility, audit, distinct block/mute effects and no hidden-author reply or file leaks.
5. Private conversation sender/staff/outsider isolation, unread behavior, all recipient scopes, team membership resolution, duplicate/retry handling, notifications and independent JWT rate-limit attempts through PostgREST (not just direct SQL).
6. Actual CSV/XLSX preview/cancel/commit, skips/conflicts/all-or-nothing rollback, team links, no invented Auth users, formula-safe exports; delete test roster data per approved retention.
7. Licensed live tiles at mobile/desktop sizes; explicit GPS permission denial, timeout and inaccurate reading; circle and polygon creation/edit/persistence; inside/outside checks using the saved geometry. Device GPS does not prove attendance.
8. Private bytes, allowed types/sizes, wrong-owner/missing/mismatched bytes, retry after ambiguous failure, view versus offered-download settings, revoked access and cleanup. Images are signature-checked, **not malware-scanned, decoded/re-encoded or EXIF-stripped**; choose only low-sensitivity pilot imagery or implement stronger processing before a higher-risk deployment.
9. Retention scheduler execution, retry/alerting, deleted/revision/conversation/roster/object purge, backups/audit policy and operator-mediated account deletion/anonymization procedure. Screenshots and previously fetched bytes cannot be revoked.
10. Final HTTPS SPA routes/refresh, CSP, browser console, keyboard and actual phone accessibility, loading/error/empty states, realistic bounded dataset/performance, rollback of frontend release and safe DB forward-fix process.

Only then change the decision from **NOT READY** to **READY FOR LIVE PILOT**. Do not turn unresolved service tests into implementation PASS rows merely because a page renders.


## 7. Safe rollout failure, rollback and cleanup

1. Stop rollout/onboarding if any migration, header, Auth, permission, Storage or retention check fails. Record command exit, time, release/migration version and sanitized error only. Do not log tokens, bodies, file URLs or roster rows.
2. Before first deployment, preserve a tested database backup/restore procedure and the previous static artifact plus public environment configuration. Obtain operator approval for retention and backup access. A backup existing is not a verified restore.
3. Static rollback: restore the last compatible known-good `dist` artifact **including its matching headers/snippet**, then recheck cached HTML/assets, SPA fallback and Auth callback origins. Do not serve an artifact with known embedded credentials; revoke/rotate any actually exposed credential and rebuild. No such real exposure was observed in this workspace.
4. Database rollback: **no hosted reset, down-migration, schema drop, RLS disable or replacement with the vulnerable legacy functions.** Keep migration 30000's confidentiality and revocation defenses. Inspect `supabase migration list` and actual schema state after failure; do not blindly rerun/repair history. Produce a new reviewed versioned forward-fix, replay on an authorized backup-derived staging copy and retest security gates before applying. Restore backups only through a separately approved recovery plan that accounts for subsequent writes.
5. Function/scheduler rollback: preserve application token/secret checks. If necessary pause a failing scheduled job to avoid repeated failures, alert the privacy operator that cleanup is delayed, and replay pending batches after a compatible function release is deployed. Do not acknowledge objects before actual Storage deletion; test retry with the same batch.
6. The staging smoke tombstones only its own post; confirm pending/deleted byte cleanup via authorized maintenance. Operators must separately remove approved roster/message test records under the retention policy. Never reset a shared project or delete real user records as test cleanup.
7. If these defects could have existed in an already-used deployment, review access/audit logs under the privacy operator's control. The migration cannot erase content previously fetched by peers or determine historical exposure. Investigate and notify under the approved incident policy; do not claim retroactive confidentiality.

## 8. Owners and exact unblock order

| Gate | Owner | Required input/action and evidence |
|---|---|---|
| X1 | Project owner + security operator | Explicit authorized staging target, permitted network, secure operator access, real consenting independent identities. Apply reviewed migrations; run direct REST/RPC/RLS, multi-account workflows and races. No fabricated Auth users or roster imports. |
| X2 | Auth/email operator | Configure SMTP/sender and trusted Site URL/redirects; accessible real inboxes; registration, confirmation, reset, refresh/expiry/logout evidence. Depends on X1/X5. |
| X3 | Storage/Edge operator | Private bucket/policies, both deployed functions, server-only secrets, scheduler access. Valid/invalid/other-owner/revoked byte tests plus removal-failure/retry/physical cleanup. Depends on X1. |
| X4 | Map/device owner | Licensed provider/credits/public config and network; real HTTPS device with controllable location permission/accuracy; physical-device and assistive-tech checks. |
| X5 | Hosting operator | Explicit deployment authorization/account/domain, correct build variables, TLS/fallback/headers/cache/redirect configuration; actual host browser and response-header evidence. |
| X6 | Test infrastructure owner | Docker/Podman-capable isolated machine, local Supabase stack and extensions. Run local start/reset-with-no-seed/pgTAP; retain real test output. Never target hosted reset. |
| X7 | Event/privacy operator | Written retention, audit/backup/deletion/anonymization policy; verified restore/maintenance alerts and deletion procedure on approved staging data. |

**Sequence:** authorize X1/X5 and configure X2–X4/X7; execute X6 independently; rehearse migration/backfill and rollout; deploy only to authorized staging; execute §5 focused smoke and **all** §6 checks with independent identities; test §7 rollback/cleanup; attach sanitized time-stamped evidence to each blocked ID; recalculate checklist totals. The event owner/security/privacy operators may approve pilot onboarding only when every mandatory gate passes. The current decision remains **NOT READY FOR LIVE PILOT**.
