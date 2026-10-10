> HISTORICAL: snapshot before this SAMARTHA audit; superseded by the current root checklist and docs/FINAL_VERIFICATION.md. These results do not establish current acceptance.

# DropZone — final acceptance checklist

**As of 2026-10-10 · Decision: NOT READY for a live pilot.**

236 individually evidenced items: **215 PASS · 20 BLOCKED · 1 NOT APPLICABLE · 0 FAIL**. PASS counts include explicitly scoped local evidence, not hosted release approval.

Implementation and locally available verification are complete; the external integration/release gates below are not. **Nothing was deployed or live-tested.** There are no known remaining implementable FAIL items after fixing and rerunning the local regressions. This document must not be read as production approval.

Statuses are exactly **PASS**, **FAIL**, **BLOCKED**, or **NOT APPLICABLE**. Each PASS is limited to the evidence stated. In particular, a SQL PASS means isolated SQL execution, not hosted JWT/PostgREST; a UI PASS means component/browser behavior, not a real remote operation. Live requirements have separate BLOCKED rows. No screenshot, build, mock or code inspection is substituted for live-service evidence.

## Evidence references

- **AUTH** — `tests/auth-and-routes.test.tsx`: 20 adapter-boundary Auth/route tests.
- **CONFIG** — `tests/supabase-config.test.ts`: 5 configuration validation tests.
- **UI** — `tests/phase2-ui.test.tsx`: 15 form/template/parser/location/signature/retry tests.
- **FINAL-UI** — `tests/final-ui.test.tsx`: 4 regressions for map config, focus revocation, account query isolation and failed uploads.
- **DB0** — `tests/database-foundation.test.ts`: 10 isolated PGlite/PostGIS foundation tests, actual migrations, test Auth schema.
- **DB1** — `tests/phase2-database.test.ts`: 39 isolated workflow/PostGIS/RLS tests, actual migrations, metadata-only Storage shim.
- **PG** — `tests/concurrency.test.ts`: actual native PostgreSQL 17, production rate function, 12 independent sessions; 3 allowed, 9 rejected at limit 3.
- **BROWSER** — `tests/browser/workflows.browser.ts`: 9 real-Chromium UI tests using a labeled Supabase adapter; all 15 workflow pages, 390/768/1440px, axe on 20 workspace/public pages.
- **BUILD-BROWSER** — `tests/browser/production.browser.ts`: 1 actual production-bundle local fallback/refresh/no-demo test. Not hosted routing.
- **BUILD** — TypeScript, Vite production build and `scripts/verify-build.mjs`; manifest and chunk sizes in `docs/FINAL_VERIFICATION.md`.
- **EDGE** — Deno 2.9.6 checked both Edge Functions; source review, not deployed integration.
- **SOURCE** — named source/migration inspected; implementation evidence only where explicitly indicated.
- **RUNBOOK** — `docs/DEPLOYMENT.md`, `.env.example`, `supabase/BOOTSTRAP.md`.

Exact executed commands, totals and limitations: [`docs/FINAL_VERIFICATION.md`](docs/FINAL_VERIFICATION.md).

## External dependencies (precise blockers)

- **X1 — Staging Supabase + authorized operator + network:** no project URL/public key, project link/credentials, real test identities or authorized target supplied. Workspace outbound access excludes Supabase endpoints. A configured authorized staging project/network is required for hosted Auth, SQL deployment and independent-JWT REST/workflow checks.
- **X2 — Auth/email settings:** real staging Auth configuration, trusted HTTPS callback/recovery origins, configured SMTP and accessible confirmation/reset inboxes; depends on X1.
- **X3 — Storage/Edge/scheduler:** actual private bucket and migrations, deployed verifier/maintenance functions, server-only secrets and authorized scheduler; depends on X1. Requires real byte and physical-cleanup tests.
- **X4 — Maps/device:** approved licensed tile provider/configuration, allowed tile endpoint network, and an HTTPS-capable real device/browser with controllable location permission/accuracy. No approved provider or physical device exists here.
- **X5 — Hosting:** no selected authorized hosting account/target/domain/deployment credentials. Requires build variables, HTTPS deployment and actual host rewrite/header/redirect verification.
- **X6 — Local Supabase runtime:** no Docker/Podman; `npm run db:test` attempted and failed with local port 54322 connection refused. pgTAP has not executed.
- **X7 — Operator policy:** authorized event/privacy operator must approve retention/backups/audit policy and verify actual account anonymization/deletion and production maintenance/alerting in the configured project. Code/docs cannot establish that operational evidence.

## A. Project preservation and configuration

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| A01 | Existing repository and modified/untracked work preserved | PASS | Checkpoint `e3f77a3`; same repository and working branch; no reset/rebuild of architecture. |
| A02 | React/Vite/Supabase architecture retained | PASS | SOURCE: existing `src`, Vite, Supabase client/RPC/Storage paths. Native PG is test-only. |
| A03 | Supabase remains the single application backend | PASS | SOURCE/package review; no separate Auth/database/file service introduced. |
| A04 | Existing useful routes and visual design preserved | PASS | AUTH and BROWSER; existing workspace URLs and sage layout retained. |
| A05 | Dependency installation reproducible | PASS | `npm ci` executed; dependencies locked; Node >=22 declared. |
| A06 | Public project URL and publishable-key validation | PASS | CONFIG: missing, placeholder, malformed and insecure values rejected. |
| A07 | Privileged browser keys rejected | PASS | CONFIG; no service-role/secret key introduced in `VITE_*` or source. BUILD includes pattern spot checks. |
| A08 | Configuration absence fails closed without fake login | PASS | CONFIG/AUTH; App shows public landing/privacy, private configuration guidance. |
| A09 | Environment template and setup guidance complete | PASS | `.env.example`, README and RUNBOOK separate browser/server settings. |
| A10 | Demo preview opt-in, labeled and development-only | PASS | App compile-time gate; BUILD/BUILD-BROWSER exclude production demo/fixture. |
| A11 | No seeded production accounts/activity/counts | PASS | `db.seed.enabled=false`; SOURCE counts use authorized DB queries. Fixture remains test-only. |
| A12 | Initial organizer requires trusted bootstrap | PASS | DB0 denies public escalation; `supabase/BOOTSTRAP.md` operator transaction. |

## B. Authentication, session and trusted roles

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| B01 | Public landing does not auto-login | PASS | AUTH public-entry test; BROWSER landing. |
| B02 | Registration calls Supabase Auth with validated input | PASS | AUTH registration adapter test; no alternate credential database. |
| B03 | Confirmation-required registration state | PASS | AUTH no-session signup state; no false logged-in success. |
| B04 | Login success routes from returned session | PASS | AUTH login/session tests. |
| B05 | Invalid credentials remain on login with an error | PASS | AUTH and keyboard BROWSER test. |
| B06 | Session restored after fresh app mount | PASS | AUTH restore test; Supabase session API. |
| B07 | Late restore cannot resurrect a signed-out session | PASS | AUTH event-version regression. |
| B08 | Auth refresh events update session state | PASS | SOURCE `AuthProvider` subscription; AUTH event handling. Live token refresh remains B25. |
| B09 | Session initialization errors expose retry | PASS | AUTH network/error test. |
| B10 | Logout clears protected routing | PASS | AUTH logout test. |
| B11 | Direct private URLs require a session | PASS | AUTH and BROWSER direct-route denial. |
| B12 | Recovery requests use Supabase and trusted callback URL | PASS | AUTH recovery request test; `AuthPages.tsx`. |
| B13 | Password update requires a recovery session | PASS | AUTH valid/missing/expired recovery tests. |
| B14 | Expired recovery immediately locks password update | PASS | AUTH expiry regression. |
| B15 | Callback/session bootstrap errors are honest | PASS | SOURCE `AuthCallbackPage`/bootstrap states; no fabricated session. Live callback B24. |
| B16 | Account switching cannot reuse old event grants | PASS | AUTH cached-permissions regression. |
| B17 | Account switching cannot display old query data | PASS | FINAL-UI same-event identity-change regression. |
| B18 | Browser role/localStorage/URL are not authority | PASS | AUTH forged organizer-route/storage tests; DB0 permission checks. |
| B19 | Participant/organizer/moderator use trusted memberships | PASS | AUTH per-role routes; DB0 grants; BROWSER limited moderator navigation. |
| B20 | Staff permissions are explicit, not inferred from role | PASS | DB0 and BROWSER limited-grant checks. |
| B21 | Revocation refreshes visible workspace | PASS | FINAL-UI focus-revocation test; 60s/focus/error refresh and role/grant remount. Not instant erasure. |
| B22 | Account settings update only own display name | PASS | DB1 profile-only RPC test; SOURCE account form; never updates roles. |
| B23 | Real registration, confirmation and email delivery | BLOCKED | X1 + X2. Only adapter states have been exercised. |
| B24 | Real recovery email, callback and password-reset flow | BLOCKED | X1 + X2 + trusted hosted redirect origin (X5). |
| B25 | Real refresh-token lifecycle, reload, expiry, logout and cross-account sessions | BLOCKED | X1 + X2. Requires independent real browser sessions/Auth tokens. |

## C. Database, authorization and isolation

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| C01 | Earlier migrations remain unchanged | PASS | Git diff; only new versioned `20261010020000_final_workflow_completion.sql`. |
| C02 | Complete migration chain replays on clean isolated DB | PASS | DB0/DB1 replay all SQL with PostGIS. Not a hosted migration run. |
| C03 | Private application tables have RLS enabled | PASS | DB1 catalog enumeration/assertions. |
| C04 | Anonymous private reads/writes denied | PASS | DB0/DB1 role-switched negative tests. |
| C05 | Event isolation enforced on direct tables and RPC reads | PASS | DB0/DB1 outsider-event tests. |
| C06 | Team links cannot cross event boundaries | PASS | DB0 composite constraints; DB1 assignment/recipient tests. |
| C07 | Users cannot directly change membership/role/grants | PASS | DB0 restricted table writes and helper execution tests. |
| C08 | Signup metadata cannot self-assign staff | PASS | DB0 auth-user trigger ignores role metadata. |
| C09 | Self-role change and staff-demotion escalation denied | PASS | DB0 self-change; DB1 limited manager cannot demote organizer. |
| C10 | Invitation redemption grants participant only | PASS | DB0 invitation security; AUTH invitation route. |
| C11 | Ownership enforced for content/file mutations | PASS | DB1 peer edit/resolve/file-finalization denial. |
| C12 | Security-definer internal helpers inaccessible to clients | PASS | DB0/DB1 grants checks; SOURCE explicit revoke/fixed search paths. |
| C13 | Read RPC remains security invoker | PASS | DB1 role-switch/RLS results; SOURCE `dz_read SECURITY INVOKER`. |
| C14 | Reports, rosters, private messages and notifications isolated | PASS | DB1 feature-specific negative visibility tests. |
| C15 | Revoked membership loses backend access immediately | PASS | DB1 content/conversation/team/Storage-metadata revocation checks. Actual REST/bytes C18/I19. |
| C16 | Retry receipts recheck revoked staff authority | PASS | DB1 successful team-save receipt replay denied after grant removal. |
| C17 | No service-role browser bypass or RLS weakening | PASS | CONFIG/DB0/DB1; no disabled RLS or client privileged writes. |
| C18 | Independent real JWT/PostgREST isolation and privilege checks | BLOCKED | X1. SQL-role shims are not JWT, API gateway or PostgREST evidence. |

## D. Participant templates, posts and activity

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| D01 | Lost/found structured template | PASS | UI + DB1 dedicated template tests validate/persist fields. |
| D02 | Find-teammate structured template | PASS | UI + DB1 dedicated template tests, including quantity limits. |
| D03 | Need-resource structured template | PASS | UI + DB1 dedicated template tests. |
| D04 | Ask-for-help structured template | PASS | UI + DB1 dedicated template tests. |
| D05 | Offer-help/resources structured template | PASS | UI + DB1 dedicated template tests. |
| D06 | Promotional structured template and review policy | PASS | UI + DB1 promotion tests; server review-required rule. |
| D07 | Community-question structured template | PASS | UI + DB1 dedicated template tests. |
| D08 | Custom submission template persists separately from publication | PASS | UI + DB1 custom/review tests. |
| D09 | Required fields and category/quantity values validated server-side | PASS | UI validation and DB1 rejection tests; not just HTML required attributes. |
| D10 | Create success only after backend response | PASS | UI deferred/failure handling; SOURCE PostComposer uses real RPC. |
| D11 | Event-scoped feed and post details | PASS | DB1 authorized feed/detail and outsider filtering. |
| D12 | Search, category and zone filtering | PASS | DB1 search/category checks; SOURCE zone predicate and UI filter. |
| D13 | Stable keyset feed pagination | PASS | DB1 32-post fixture/new insertion: no duplicate/omitted older second-page posts. |
| D14 | Published own-post editing with concurrency conflict | PASS | DB1 owner/peer/stale-timestamp tests; BROWSER populated edit form. |
| D15 | Editing cannot extend original expiry | PASS | DB1 edit expiry equality assertion. |
| D16 | Protected revision history | PASS | DB1 snapshots, author access and peer denial; SOURCE RevisionHistory. |
| D17 | Replies persist with correct post and author | PASS | DB1 reply/notification test. |
| D18 | Reply-parent references must be visible in same post | PASS | DB1 blocked/guessed-parent rejection; SOURCE validated parent. |
| D19 | Resolve differs from expiry | PASS | DB1 lifecycle test; UI effective status. |
| D20 | Delete differs from resolve/expiry and preserves eligible author history | PASS | DB1 lifecycle/tombstone/retention tests. |
| D21 | Pending custom post cancellation | PASS | DB1 review lifecycle; owner-only cancellation guard. |
| D22 | My activity uses actual author records | PASS | DB1 activity filtering; BROWSER activity screen. |
| D23 | Review/edit history redacted with deleted-content retention | PASS | DB1 aged-deletion maintenance test redacts revision bodies. |
| D24 | No success/sample-content fallback on failure | PASS | UI/FINAL-UI failures; SOURCE QueryState/error boundary. |
| D25 | Actual multi-user persisted lifecycle after browser refresh | BLOCKED | X1. Isolated SQL persistence is proven, hosted browser-to-DB persistence is not. |

## E. Review, moderation and user safety

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| E01 | Submitted/awaiting-review/changes-requested states persist | PASS | DB1 custom revision/review test; post status constraint. |
| E02 | Review queue restricted by explicit permission | PASS | DB1 self-publish/staff checks; BROWSER permission-aware navigation. |
| E03 | Self-approval forbidden | PASS | DB1 custom self-review denial. |
| E04 | Approve/reject/request-changes reasons recorded | PASS | DB1 review/rejection reason persistence; audit writes. |
| E05 | Author can revise and resubmit eligible rejected/returned content | PASS | DB1 revision state checks; SOURCE composer/revise operation. |
| E06 | Approved text edits require another review | PASS | DB1 reviewed edit returns to queue and hides from peer. |
| E07 | New attachments cannot bypass prior approval | PASS | DB1 finalized image requeues approved custom post; reviewed state cleared. |
| E08 | Posts can be reported | PASS | DB1 report persistence/decision tests. |
| E09 | Replies can be reported only if accessible | PASS | DB1 inaccessible blocked-reply report denial; SOURCE report target guard. |
| E10 | Users can be reported within the event | PASS | DB1 participant restriction scenario. |
| E11 | Reporting does not itself punish or remove content | PASS | DB1 open report remains separate from explicit decision. |
| E12 | Dismissal/escalation require review grant | PASS | DB1 unauthorized decision denial and moderator escalation. |
| E13 | Removal/restriction require additional removal grant | PASS | DB1 permission tests; SOURCE `report.decide` dual checks. |
| E14 | Restrictions prevent new writes while active | PASS | DB1 restricted participant post denial; 24-hour rule. |
| E15 | Decision reasons visible to affected user without reporter identity | PASS | DB1 sanitized safety result test; SOURCE Safety UI. |
| E16 | Moderation actions auditable | PASS | DB1 audit decision assertions; RLS audit grants. |
| E17 | Block stops peer visibility/interactions | PASS | DB1 block feed/reply/conversation checks; distinct user preference. |
| E18 | Mute suppresses feed/notifications without becoming a ban | PASS | DB1 mute retains direct detail access while suppressing delivery. |
| E19 | Block/mute/report have distinct UI controls | PASS | SOURCE Feed/Preferences; BROWSER privacy/safety navigation. |
| E20 | Hosted moderation visibility/revocation across real accounts | BLOCKED | X1; run separate participant/moderator/organizer browser profiles. |

## F. Private communications and notifications

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| F01 | Participant can start a persistent organizer conversation | PASS | DB1 conversation create/message test. |
| F02 | Only sender and explicitly authorized staff can read it | PASS | DB1 peer/outsider/moderator denial versus management grant. |
| F03 | Replies reference an accessible conversation | PASS | DB1 private messages; SOURCE conversation visibility check before mutation/replay. |
| F04 | Message states never claim unperformed delivery | PASS | SOURCE state `sent`/DB-backed return; UI errors retain input. |
| F05 | Conversation history paginated | PASS | DB1 bounded conversation/messages reads; SOURCE PageButtons. |
| F06 | Conversation read state changes only explicitly | PASS | DB1 read timestamp test; UI read control. |
| F07 | Read action retry scope follows selected conversation | PASS | SOURCE `Messaging.tsx` scope includes selected ID; UI changed-scope regression. |
| F08 | Official participant-targeted communication | PASS | DB1 one-recipient snapshot and peer invisibility. |
| F09 | Official single-team communication | PASS | DB1 team targeting excludes unrelated members. |
| F10 | Official multi-team communication | PASS | DB1 two-team union yields two unique recipients. |
| F11 | Official event-wide communication | PASS | DB1 event-scope snapshot test. |
| F12 | Recipients resolved server-side from trusted membership | PASS | DB1 wrong-event participant rejection; SQL target/team checks. |
| F13 | No duplicates from repeated targets or safe retries | PASS | DB1 unique recipient snapshots/command receipts. |
| F14 | Notifications belong only to recipient | PASS | DB1 RLS recipient visibility. |
| F15 | Read/unread state persists | PASS | DB1 notification read test; real unread query counts. |
| F16 | Failed writes do not create misleading notifications | PASS | DB1 rate-rejected reply leaves notification count unchanged. |
| F17 | Notification links route to the correct workflow | PASS | SOURCE messaging/reply/communication/decision destination mapping; safety route added. |
| F18 | In-app delivery distinguished from email/push | PASS | SOURCE communications/privacy notice; RUNBOOK limitations. |
| F19 | External SMS/push/marketing-email delivery | NOT APPLICABLE | Scope is in-app official communications. Actual Auth confirmation/recovery email remains required at B23/B24. |
| F20 | Real private message and notification multi-account integration | BLOCKED | X1. Adapter and SQL tests are not hosted message delivery evidence. |

## G. Organizer, teams and roster import

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| G01 | Event configuration persists under explicit grant | PASS | DB1 event update/reopen tests; SOURCE EventSettings. |
| G02 | New event creation requires an existing trusted organizer | PASS | DB1 create test and participant denial. |
| G03 | Event creation does not add permissions the actor lacks | PASS | DB1 grant-subset assertion. |
| G04 | Event archive/reopen controlled | PASS | DB1 lifecycle/role checks; no destructive UI event deletion. |
| G05 | Team creation/rename requires permission | PASS | DB1 team-save operation; explicit backend grant. |
| G06 | Team assignment requires trusted staff, not self-assertion | PASS | DB1 participant self-assignment denial and staff assignment. |
| G07 | Revoking membership clears stale team links | PASS | DB1 revocation assertion; final membership trigger. |
| G08 | CSV parsing uses actual file bytes | PASS | UI genuine CSV buffer test. |
| G09 | XLSX parsing uses actual workbook bytes | PASS | UI generated XLSX workbook test; lazy parser. |
| G10 | Import validates emails, names, columns, duplicates and team conflicts | PASS | UI invalid-row tests; DB1 server validation. |
| G11 | Formulas rejected and exports neutralized | PASS | UI formula-cell rejection and `safeCsvCell` injection test. |
| G12 | Preview before explicit confirmation | PASS | BROWSER preview states no writes; SOURCE RosterImport server conflict preview. |
| G13 | Cancel import performs no mutation | PASS | BROWSER asserts no `roster.import` command. |
| G14 | Import transaction rolls back invalid/conflicting input | PASS | DB1 transactional import/no partial records. |
| G15 | Real imported/skipped/failed counts and retry result | PASS | DB1 first/repeat/conflicting imports; SOURCE result/failure display. |
| G16 | Roster records are not fake Auth users or confirmed memberships | PASS | DB1 auth-user count and pre-registration roster checks. |
| G17 | Confirmed existing identity/team linking uses trusted backend records | PASS | DB1 email/member link tests; no client-created identity claims. |
| G18 | Roster emails not exposed to participants | PASS | DB1 restricted roster reads. |
| G19 | Hosted CSV/XLSX commit, conflicts and resulting team access | BLOCKED | X1 and real authorized staging roster/test users; no real roster was imported here. |

## H. Maps and geofencing

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| H01 | Actual interactive map implementation, not illustrated SVG geography | PASS | SOURCE/BROWSER Leaflet map, pan/zoom and raster layer. Live tile delivery H15. |
| H02 | Production requires explicit approved-provider config | PASS | FINAL-UI missing/invalid/valid configuration tests; no production OSM fallback. |
| H03 | Tile failures display honest guidance | PASS | SOURCE tile-error state; coordinate controls remain usable. |
| H04 | Location requested only after user action | PASS | UI geolocation spy initially untouched; explicit map/posting control. |
| H05 | Permission denial handled distinctly | PASS | UI geolocation denied test. |
| H06 | Timeout/unavailable/inaccurate readings handled | PASS | UI timeout/accuracy tests; SOURCE unavailable guidance. |
| H07 | Circle creation with center/radius | PASS | DB1 saved circle/geometry constraints; SOURCE coordinate/map controls. |
| H08 | Circle edit persists new geometry/radius | PASS | DB1 update radius assertion. |
| H09 | Polygon creation with ordered coordinates | PASS | DB1 valid PostGIS polygon; UI keyboard coordinate entry. |
| H10 | Polygon editing persists geometry/name | PASS | DB1 editable polygon update assertion. |
| H11 | Malformed/out-of-range/null-radius geometry rejected | PASS | DB1 dedicated geometry rejection tests. |
| H12 | Circle containment evaluated server-side | PASS | DB1 inside/outside/accuracy PostGIS checks. |
| H13 | Polygon containment evaluated server-side | PASS | DB1 inside accepted/outside rejected with saved geometry. |
| H14 | Posting GPS coordinates not retained as history | PASS | DB1 no longitude/latitude in saved post; SOURCE receipts strip coordinates; privacy notice. |
| H15 | Licensed real tile delivery and provider policy compliance | BLOCKED | X4. Leaflet rendering is not actual approved-provider verification. |
| H16 | Real-device GPS permission/accuracy and live geofence workflow | BLOCKED | X1 + X4 + HTTPS frontend. No physical location verification performed. |
| H17 | GPS does not claim proof of physical attendance | PASS | Map/privacy text and RUNBOOK explicitly describe spoofing/inaccuracy. |

## I. Private files and privacy/retention

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| I01 | Upload path sends actual file bytes to private Storage | PASS | SOURCE `.storage.upload(file)` and FINAL-UI failed-byte response test. Actual service test I19. |
| I02 | Private bucket and exact object path policy | PASS | DB1 metadata policies; migration bucket is non-public. |
| I03 | File ownership and post/event authorization | PASS | DB1 wrong-owner/path/outsider tests. |
| I04 | Allowed types and maximum size enforced | PASS | SQL constraints/private bucket rules; UI signature tests; 5 MB, JPEG/PNG/WebP only. |
| I05 | Filename-only metadata cannot finalize | PASS | DB1 missing object/verification denial. |
| I06 | Trusted verifier inspects actual private bytes | PASS | EDGE/source; validates user/ownership/size/signature before server-only ack. Actual Edge execution I20. |
| I07 | Reservation/finalization retry identity remains stable | PASS | SOURCE per-file reserve/finalize IDs; DB1 ready-finalization idempotence. |
| I08 | Ambiguous upload errors do not produce false success | PASS | FINAL-UI failure never finalizes; SOURCE requires trusted verification. |
| I09 | Image loading/decoding failures offer retry | PASS | SOURCE ImageView error/retry, object URL cleanup. |
| I10 | Authorized viewing uses authenticated byte fetch, not public URL | PASS | SOURCE `.storage.download` and blob display; DB1 read policies. |
| I11 | Download preference controls offered download action | PASS | SOURCE event `downloads_allowed`/ImageView control; explicitly not DRM. |
| I12 | File delete tombstones metadata and denies further eligible fetch | PASS | DB1 deletion policy checks; SOURCE deletion audit. Physical byte cleanup I21. |
| I13 | Revoked membership cannot query file metadata | PASS | DB1 revoked Storage-object visibility test. Actual bytes I19. |
| I14 | Orphan/pending/deleted object cleanup is server-only and acknowledged after removal | PASS | EDGE/source maintenance ordering; DB1 cleanup batch/ack denial to ordinary callers. Actual deletion I21. |
| I15 | Deleted post/revision content retention implemented | PASS | DB1 aged-deletion redaction; final maintenance wrapper. |
| I16 | Notification/receipt/counter/archive retention policies specified | PASS | SOURCE maintenance intervals and privacy/RUNBOOK documentation. Actual scheduled execution I21. |
| I17 | EXIF, copying, screenshots and retained backups limitations disclosed | PASS | Account/privacy/attachment UI and RUNBOOK; no impossible erasure promise. |
| I18 | Account deletion/anonymization request path documented | PASS | Account settings directs to trusted event operator; no browser service-role mechanism. Operational proof I22. |
| I19 | Actual private upload/download/outsider/revocation denial | BLOCKED | X1 + X3. No physical Supabase object server or independent live user JWTs exercised. |
| I20 | Deployed verifier valid/invalid/missing/other-owner-byte tests | BLOCKED | X1 + X3. Type checking does not establish Edge behavior in deployment. |
| I21 | Actual scheduled retention and physical object cleanup/retry | BLOCKED | X3. Must deploy, configure secret/scheduler, execute and verify real deletion/acknowledgement. |
| I22 | Real account anonymization/deletion, backup/audit policy sign-off | BLOCKED | X1 + X7. Trusted operator and actual project policy/evidence required. |

## J. Reliability, concurrency and abuse resistance

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| J01 | Abuse controls enforced in database, not just disabled buttons | PASS | DB1 direct command rate tests. |
| J02 | Post submission/edit rate limits | PASS | DB1 post-rule regression. |
| J03 | Promotion rate limit separate from ordinary posts | PASS | DB1 category-specific rule test. |
| J04 | Custom-submission rate limit | PASS | DB1 category-specific rule test. |
| J05 | Reply rate limit and rollback | PASS | DB1 rejected reply/no notification test. |
| J06 | Report rate limit | PASS | DB1 distinct-target report-limit test. |
| J07 | Private-message rate limit | PASS | DB1 conversation creation rate test. |
| J08 | Invitation/upload/staff operations call protected limiter | PASS | SOURCE trigger/operation calls; DB1 protected rate-rule tables. Shared algorithm PG. |
| J09 | Exact limiter concurrency with independent PostgreSQL sessions | PASS | PG: 12 connections, limit 3, exactly 3 persisted successes. |
| J10 | Duplicate request IDs cannot repeat mutation or notification | PASS | DB1 idempotent post/reply/notification tests. |
| J11 | Changed payload cannot reuse an old request key | PASS | DB1 retry receipt checks; UI changed-context key regression. |
| J12 | Multi-step DB mutations and notifications atomic | PASS | DB1 failed operation/import rollback assertions. |
| J13 | Failed form preserves input and supports explicit retry | PASS | UI failure-input/reused-key test. |
| J14 | Stale queries cannot expose previous identity data | PASS | FINAL-UI identity mask; SOURCE canceled-effect/version guards. |
| J15 | Read errors include retry and empty/permission outcomes are honest | PASS | QueryState SOURCE/BROWSER; no simulated successes. |
| J16 | Unexpected rendering failures expose safe recovery | PASS | SOURCE global ErrorBoundary, no private provider/component logging. |
| J17 | Hosted concurrent full-RPC/JWT/PostgREST abuse tests | BLOCKED | X1. Native SQL limiter test does not replace actual API-level races and side-effect checks. |

## K. UI, navigation, accessibility and maintainability

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| K01 | All 15 workflow navigation destinations render | PASS | BROWSER visits each actual component with adapter data. |
| K02 | Direct invalid/unauthorized workflow page rejected visibly | PASS | BROWSER participant settings route; SOURCE permission-aware page handling. |
| K03 | Participant interface does not expose organizer tools | PASS | AUTH route tests; BROWSER restricted page. |
| K04 | Moderator interface shows only assigned staff actions | PASS | BROWSER limited moderator Reports/no settings/no roster assertions. |
| K05 | Page changes have accessible current state and heading focus | PASS | BROWSER focused heading; SOURCE `aria-current` and focus management. |
| K06 | Keyboard login interaction works | PASS | BROWSER Enter submission/error test. |
| K07 | Labels and basic WCAG A/AA automation checked on workflow pages | PASS | BROWSER axe zero violations on all 15 tested pages; not full certification. |
| K08 | Public/Auth/privacy accessibility baseline | PASS | BROWSER axe on home/login/register/recovery/privacy. |
| K09 | Text contrast and text-link distinctions corrected | PASS | BROWSER caught/rechecked contrast and Leaflet link issues; CSS fixes. |
| K10 | Small-screen viewport layout | PASS | BROWSER 390px overflow checks on 15 pages. |
| K11 | Tablet viewport layout | PASS | BROWSER 768px overflow checks on 15 pages. |
| K12 | Desktop viewport layout | PASS | BROWSER 1440px overflow checks on 15 pages. |
| K13 | Loading/error/empty/unavailable states retained | PASS | AUTH/UI/FINAL-UI and SOURCE QueryState/map/image/error boundary. |
| K14 | Public privacy and protected account settings routes | PASS | BUILD-BROWSER privacy refresh; DB1 own-profile mutation; SOURCE protected Account route. |
| K15 | Route/workflow code splitting | PASS | BUILD manifest lazy Workbench/Staff/Messaging. |
| K16 | Heavy map and XLSX parser lazy-loaded | PASS | BUILD chunk manifest; no eager worksheet parser. |
| K17 | Initial JavaScript budget checked | PASS | BUILD main 457.70 kB raw / 132.45 kB gzip; under 500 kB entry budget. Not a network-load benchmark. |
| K18 | Fonts no longer require external Google requests | PASS | BUILD local font assets/index check. |
| K19 | Reusable API/query/forms boundaries retained | PASS | SOURCE `api.ts`, `forms.tsx`, typed models and modular workflow files; new files formatted. |
| K20 | Rendered strings/tooltips avoid untrusted HTML injection | PASS | SOURCE React text rendering and map `textContent`; no arbitrary attribution HTML. |
| K21 | Actual-phone/assistive-tech and final-host performance sign-off | BLOCKED | X4 + X5; emulated widths/axe and bundle sizes do not prove physical-device/screen-reader/host latency behavior. |

## L. Final tests, configuration and deployment

| ID | Individual acceptance item | Status | Evidence / precise reason |
|---|---|---|---|
| L01 | Full required unit/integration command executed | PASS | `npm test -- --run`: 94/94, seven files. |
| L02 | Required TypeScript command executed | PASS | `npx tsc --noEmit -p tsconfig.json` exit 0. |
| L03 | Required production build executed | PASS | `npm run build` exit 0. |
| L04 | Required diff whitespace check executed | PASS | `git diff --check` exit 0. |
| L05 | Existing isolated DB suites executed | PASS | DB0 10/10 + DB1 39/39; actual migration chain/PostGIS. |
| L06 | Browser tests executed, not just authored | PASS | `npm run test:browser`: 10/10 including actual built-bundle test. |
| L07 | Both Edge Function sources validated | PASS | EDGE Deno check exit 0; not a deployed-function test. |
| L08 | Build outputs checked for lazy chunks and fixture/secret patterns | PASS | `npm run verify:build` exit 0; bounded spot checks, not formal penetration/secret audit. |
| L09 | Dependency audit executed | PASS | `npm audit`: zero reported vulnerabilities at final verification. |
| L10 | Supabase pgTAP execution | BLOCKED | X6. Attempted `npm run db:test`; connection refused, no tests ran. |
| L11 | Exact migration/bootstrap/Edge/secret/scheduler runbook | PASS | RUNBOOK §2–3 with explicit safe staging target, no hosted reset. |
| L12 | Static SPA routing and host security configuration prepared | PASS | `public/_redirects`, `netlify.toml`, `scripts/hosting.mjs`, `deploy/nginx.conf`; BUILD-BROWSER proves local fallback only. |
| L13 | Hosted staging smoke command prepared and safely gated | PASS | `scripts/verify-hosted.mjs` syntax check; missing-config run exits 2 before network/mutation. Real run remains C18/I19. |
| L14 | Production secrets/build-variable separation documented | PASS | `.env.example`, `.gitignore`, RUNBOOK; no credentials included in deliverables. |
| L15 | Actual deployment to authorized HTTPS target | BLOCKED | X5 plus configured backend X1–X3. No deployment credentials/target; no deployment performed. |
| L16 | Actual host deep-link refresh/CSP/Auth redirect verification | BLOCKED | X5 + X2; local Vite fallback and generated headers are not hosted evidence. |
| L17 | All hosted workflow/security/retention acceptance completed | BLOCKED | X1–X5 + X7. Execute RUNBOOK §5–6 and replace only rows with actual evidence. |
| L18 | Evidence limits and every external blocker disclosed | PASS | This checklist and `docs/FINAL_VERIFICATION.md`; no false local-pgTAP/live-Storage/Auth claim. |
| L19 | Safe rollback/forward-fix and cleanup instructions | PASS | RUNBOOK: previous static release, reviewed DB forward fix, no destructive reset; staging script tombstones its own records. |
| L20 | Persistent itemized checklist and final decision | PASS | This repository file. **NOT READY** until the external release gates are verified. |

## Final disposition

All locally discovered implementable failures were fixed and relevant suites rerun: self-role guard order; published edits/history; account-query isolation; role revocation; blocked parent/reply reporting; attachment retry and review bypass; revoked-authority receipt replay; map configuration; conversation retry scope; navigation/focus; public/workspace text contrast and attribution links. Current local failures: **none known**.

Outstanding BLOCKED rows are not another development phase or a request for a new coding prompt. They require the concrete external project, credentials/network, infrastructure, provider/device and operator evidence listed above. The operator runbook is ready; the application must not onboard a live pilot until those checks actually pass.
