# SAMARTHA — final acceptance and live-pilot readiness audit

**Decision: NOT READY FOR LIVE PILOT.**

Audit date: **2026-10-10**. Final broad execution began **12:31:40 UTC / 18:01:40 IST**. This is a verification/remediation audit of the existing checkout, not a rewrite or new development phase.

## Acceptance result

| Status | Items |
|---|---:|
| PASS | **196** |
| FAIL | **0** |
| BLOCKED | **39** |
| NOT APPLICABLE | **1** |
| Total original IDs, unchanged requirements | **236** |

The authoritative [itemized checklist](../FINAL_ACCEPTANCE_CHECKLIST.md) preserves every original ID and requirement. Each row records current evidence/scope, defect/remediation and exact blocked dependency/action. **19 previous service-level PASS claims were downgraded to BLOCKED**: B02–B06, B08, B10, B12–B15, B19, B21, B22, F04, I01, I06, I10 and I14. Adapter/source evidence is insufficient for their actual Auth, delivery or byte-storage requirements. The other 20 external blockers remain. External SMS/push/marketing delivery (F19) is outside scope; Auth email is not.

PASS is limited to the stated local invariant, actual isolated SQL execution, rendered UI behavior or reviewed configuration/document requirement. A local database or adapter-backed browser result is not hosted acceptance. Zero FAIL means **no currently reproduced locally implementable failure remains**, not proof that no undiscovered defect exists. Counts are not a readiness percentage.

**Nothing was deployed, no live database was mutated, no participants were onboarded, no real communications were sent, and no roster or fabricated Auth accounts were imported into a real environment. No hosted integration was verified.**

## Environment and preservation

- Repository `/home/user/DropZone`, branch `arena/d64443d1-dropzone`, audit-start checkpoint `e3f77a3`. Existing modified/untracked work was inspected and preserved; no reset, branch switch, architecture replacement, commit or push was needed for this audit.
- Node **22.22.3**, npm **10.9.8**, Linux x64. Dependencies installed with `npm ci`, exit **0**, 222 packages added; locked dependency inputs unchanged by this audit.
- Native PostgreSQL **17** is a finite isolated test dependency, not an application backend. Supabase remains the sole application backend.
- No Docker/Podman Supabase stack, authorized hosted target/settings/identities, SMTP/inboxes, production map provider/device or deployment credentials were available. Workspace network access cannot reach the required Supabase/tile/hosting services. No secret disclosure was requested or attempted.
- All eight pre-audit migration files remain byte-for-byte unchanged against the audit-start hash inventory. Only `20261010030000_samartha_acceptance_security.sql` was added by this audit. The preceding `20261010020000_final_workflow_completion.sql` and other extensive working-tree improvements were already present and retained.
- [Before hashes](evidence/samartha-audit/before-source-hashes.json), [executed-source hashes and command exits](evidence/samartha-audit/commands.json), and [audit-only changed-file inventory](evidence/samartha-audit/changed-files.json) distinguish this audit from earlier uncommitted work.

## Commands actually executed on the current runtime source

Logs and start timestamps are durable in [`docs/evidence/samartha-audit/`](evidence/samartha-audit/), outside ignored caches. `commands.json` records each actual exit, signal and command; empty stdout files are legitimate successful checks. Later report/checklist edits are documentation-only.

| Command | Actual exit | Meaningful result and limitation |
|---|---:|---|
| `npm ci` | **0** | Installed successfully; `install.txt`. Initial 94-test baseline also passed, but missed defects below; it is not final evidence. |
| `npm test -- --run` | **0** | **115/115, 9 files, 36.42s**. See suite breakdown below. |
| `npx tsc --noEmit -p tsconfig.json` | **0** | Requested TypeScript command passed; production build also runs `tsc -b`. |
| `npm run build` | **0** | TypeScript project build and Vite production bundle completed; Vite 7.08s. Missing real configuration renders setup guidance, not a functioning hosted pilot. |
| `npm run verify:build` | **0** | Entry budget, lazy chunks, fixture/secret-pattern spot checks, local fonts, SPA redirect and generated headers passed. Not a comprehensive secret scan or actual-host header test. |
| `npm run test:browser` | **0** | **12/12, 25.8s** in actual Chromium: 11 adapter-backed workflow/UI tests plus one built-bundle local SPA test. |
| `npm exec --yes --package=deno@2.9.6 -- deno check supabase/functions/verify-attachment/index.ts supabase/functions/maintenance/index.ts` | **0** | Both Edge sources type-checked; neither deployed nor executed against real Supabase. |
| `npm audit --json` | **0** | **0 reported vulnerabilities**; no assurance against unknown vulnerabilities or configuration defects. |
| `npm run db:test` | **1** | **BLOCKED:** connection refused at local port 54322; no local Supabase container runtime. **pgTAP did not execute.** |
| `node --check scripts/verify-hosted.mjs` | **0** | Syntax check only. |
| `git diff --check` | **0** | No tracked-diff whitespace errors; final document consistency and untracked audit-file checks also recorded separately. |
| `VITE_SUPABASE_PUBLISHABLE_KEY=sb_secret_ISOLATED_AUDIT_SENTINEL_NOT_A_KEY npm run build` | **1, expected** | Actual build refuses the dummy privileged value before Vite transformation. Error names variable only; sentinel absent from output. Not a real key. `guard-checks.json` / `secret-build-guard.txt`. Normal build was subsequently rerun successfully. |
| `VITE_AUDIT_UNUSED_SETTING=ISOLATED_UNUSED_ENV_SENTINEL npm run build` | **0** | Unused benign setting not serialized; all generated files byte-identical to the final browser-tested build. `unused-env-build.txt` / `guard-checks.json`. |
| `DZ_ALLOW_STAGING_WRITES=NO node scripts/verify-hosted.mjs` | **2, expected** | Explicitly disabled hosted smoke refuses before network/mutation. `hosted-guard.txt`; this is a guard test, not hosted verification. |

`node scripts/run-local-audit.mjs` is the reproducible finite local command runner. It records all commands even after failure and returns **1 here because pgTAP is blocked**, rather than hiding the failed command behind an overall success. It never starts a hosted smoke, deploys, resets or bootstraps anything.

### Final suite breakdown

| File | Passed | Evidence scope |
|---|---:|---|
| `auth-and-routes.test.tsx` | 20 | Auth/session/routing adapters and client-state invariants; not real Auth/email/token lifecycle. |
| `supabase-config.test.ts` | 5 | Public configuration validation and fail-closed states. |
| `phase2-ui.test.tsx` | 15 | Templates, file parsers, location/signature helpers, form failures and retry identity. |
| `final-ui.test.tsx` | 4 | Account-query isolation, focus revocation, map configuration and failed-byte upload behavior. |
| `acceptance-ui.test.tsx` | 8 | Five notification destination mappings, rendering-error recovery, image fetch/decode retries and enabled/disabled download control. |
| `database-foundation.test.ts` | 10 | Actual migration/constraint/permission SQL in isolated PGlite/PostGIS. |
| `phase2-database.test.ts` | 46 | Actual workflow/RLS/retention SQL, all nine migrations, test Auth and Storage-metadata schemas. |
| `concurrency.test.ts` | 3 | Native PostgreSQL independent sessions: limiter, event RLS/committed revocation, concurrent target role changes. |
| `hosting.test.ts` | 4 | Build secret rejection/public-config acceptance, exact CSP origins and nginx header inheritance. |

The intentional rendering-error test emits `ISOLATED_PRIVATE_EXCEPTION` diagnostics from React/jsdom on stderr; this is the synthetic exception under test, not a failed assertion or real private data. All eight acceptance-UI assertions pass.

Browser checks cover all 15 workflow destinations at 390/768/1440 px, role-aware navigation, keyboard/focus and axe on workspace/public pages, roster cancel-before-write, edit/upload states, rejected-author revision, and aborted-tile failure without GPS prompting. The production test runs the actual built SPA's local deep-link/refresh/no-fixture behavior. It does **not** verify nginx, a selected hosting provider, real service sessions, live tiles or physical devices. Axe is a baseline, not full WCAG/assistive-tech certification.

## Reproduced findings and remediation

Severity is this audit's qualitative impact assessment, not a CVSS score or claim of observed exploitation. **Four high-impact and three medium-impact findings were corrected locally.** No real secret leak or live incident was observed.

| Ref / severity | Defect and reproduced behavior | Fix and current regression evidence |
|---|---|---|
| **S1 HIGH — publication/expiry** | Maintenance could change an unapproved custom submission to `expired`, making private text/attachments peer-visible because visibility treated expiry as publication. Initial new SQL regression failed. | New current-version `publication_authorized` marker; visibility requires authorization, and rereview clears it. DB1 exercises custom/promotion × submitted/changes-requested/edited states, author/reviewer access, peer/file denial, approved-expired positive behavior and direct-write denial. |
| **S2 HIGH — revoked invitation rejoin** | A revoked member could redeem an old valid invitation and regain participant access. Initial negative regression failed. | Revoked status cannot redeem invitations; explicit authorized staff restoration required. DB1 proves rejection, unchanged invitation use count on failure, restoration and audit behavior. |
| **S3 HIGH — membership mutation race** | A limited revoker could inspect a participant, wait behind a concurrent organizer grant, then revoke the now-organizer without `grant_organizer`. Independent-session replay of the legacy revoke function reproduced success when denial was required. | Common target advisory lock and locked role read across grant/demotion/revoke/invitation. Native PG regression denies the limited revoker after concurrent grant and preserves elevated membership. Legacy test substitution was restored; no vulnerable downgrade remains. |
| **S4 MEDIUM — rejected resubmission/history** | Checklist claimed rejected-author resubmission, but server/UI excluded `rejected`; rejection reasons could disappear from revision history. Rejected revision test failed before correction. | Eligible rejected content can be revised before original expiry, returns to `awaiting_review`, remains peer-private and retains previous reason. SQL regression and actual Chromium populated-revision-form test pass. Older uncaptured reasons cannot be reconstructed. |
| **S5 MEDIUM — nginx header inheritance** | Cache-header directives inside nginx locations suppressed server-level security headers. New config regression failed. | Build emits `nginx-security-headers.conf`; nginx includes it at server and both cache-header locations and denies snippet download. Config generation/inheritance tests pass. Actual nginx/TLS responses remain blocked. |
| **S6 HIGH — privileged browser build config** | Runtime browser-key rejection occurs too late if Vite embeds the value first; The Supabase configuration loader and ZoneMap passed the entire environment object. New build guard regression initially did not throw. | Reject recognized private-name `VITE_*`, `sb_secret_`, and service-role/authenticated JWT values before transformation; error omits values. Both the Supabase loader and ZoneMap now explicitly select only their required public variables. A benign unused build setting is absent from every JS chunk and the resulting artifact is byte-identical to the broadly tested build (`guard-checks.json`). Positive public/missing/anon tests and actual dummy CLI rejection pass. Bounded checks do not detect every possible secret. |
| **S7 MEDIUM — review-reason retention** | Aged deleted-post review reason remained after content redaction; newly captured historical reasons also needed the same retention boundary. Added assertion failed with `Second private reason` instead of null. | Service-only maintenance now clears post and revision decision reasons after the existing 30-day deletion / 180-day archived-event periods, after processing legacy maintenance. Revision snapshots are redacted after post updates. DB1 proves rejection history exists before deletion and is removed by aged-content cleanup; restricted audit is intentionally retained under separate policy. |

S1/S2 red evidence: `reproduced-defects.txt` (**39 pass / 2 fail**, exit 1). S3: `reproduced-revocation-race.txt` (limited-revoker test failed against the legacy function). S7: `reproduced-reason-retention.txt` and `reason-retention-red.json` (one focused failure, exit 1). S4/S5/S6 were reproduced during the audit before correction; current deterministic regressions and the actual negative-build log are retained. Final broad-suite green output is `tests.txt` / `browser.txt`.

Additional coverage added without feature expansion: invitation/upload/staff limiter scopes; private message pagination (52 messages → disjoint 50/2 pages, outsider denial); archived retention of conversations/rosters/stale receipts/counters/notifications; attachment tombstoning with audit preservation; and UI recovery/routing checks that previously had only source evidence.

## Database proof boundaries and deployment impact

PGlite applies **all nine actual migration files** and executes SQL, constraints, RLS, PostGIS geometry and transactional workflows. Auth identity is a test `auth.uid()` shim; `storage.objects` is metadata only. These are not hosted JWT, PostgREST, SMTP, Edge or object-byte tests. No user-facing success can be inferred from isolated SQL alone.

Native PostgreSQL uses independent TCP sessions and exact extracted production SQL, with the same explicit Auth-shim limitation. At limiter capacity three, 12 concurrent clients yield **3 commits / 9 denials** and counter 3. Additional sessions exercise event isolation, reads after committed revocation and target-role serialization. Full hosted RPC/side-effect concurrency still requires X1/J17.

The additive migration conservatively hides **legacy expired review-required versions** when current-version approval cannot be established; ordinary expired content and published/resolved versions retain their applicable authorization. It neither deletes historical posts nor fabricates approval. Clean isolated replay is proven; a populated hosted upgrade/backfill, migration locking duration and operator review of legacy content remain unverified. Rehearse these on an authorized staging copy before rollout. Do not remove the confidentiality guard to restore broad visibility.

The [runbook](DEPLOYMENT.md) now includes all nine migration filenames in order, real-identity bootstrap constraints, Auth/SMTP, both Edge functions/secrets, private bucket/policies, scheduler, map-provider configuration, generated nginx headers, HTTPS/SPA tests, authorized staging acceptance and a forward-fix-only database recovery procedure. Earlier applied migrations were not edited. No bootstrap SQL, deployment or live operation in that runbook was executed here.

## Build evidence and known operating limits

Latest decimal kB from `build.txt`:

| JavaScript chunk | Raw | Gzip | Loading |
|---|---:|---:|---|
| Main entry | 457.70 | 132.45 | Initial, below 500 kB budget |
| Workbench | 26.31 | 8.66 | Lazy |
| Staff | 12.61 | 4.46 | Lazy |
| Messaging | 6.61 | 2.19 | Lazy |
| Leaflet map | 155.38 | 45.73 | Lazy |
| XLSX parser | 500.05 | 163.12 | Lazy, only for roster parsing |

This is bundle analysis, not a final-host/phone latency benchmark. Fonts are local. Default builds contain no browser fixture or opt-in development preview.

In-app communications do not imply SMS/push/email delivery. Browser access refresh is periodic/focus-triggered, not instant visual erasure. Signature checking is **not** full image decoding/reencoding, malware scanning or EXIF stripping. Prefer low-sensitivity pilot imagery and obtain privacy approval. Device GPS can be spoofed and does not prove attendance. Hiding a download button does not prevent copying, screenshots or already fetched bytes. Account deletion/anonymization needs the authorized operator; audit/backups have separate retention. Physical retention requires a configured, tested scheduler and verified Storage removal, not just SQL tombstones.

## Remaining blockers, owners and actions

| Dependency | Owner / exact next action |
|---|---|
| **X1 — authorized staging and real identities** | Project/security owner supplies an authorized non-production target, permitted network and secure access. Confirm real consenting independent accounts, two events/teams and explicit staff grants. Rehearse migrations/backfill; execute actual JWT/PostgREST/RLS/workflow/race tests. Never fabricate Auth accounts or import invented participants. |
| **X2 — Auth and email** | Auth/email operator configures SMTP/sender, exact HTTPS Site URL/redirects and accessible inboxes. Execute confirmation, recovery, callback, token refresh/expiry, reload/logout and cross-account sessions. |
| **X3 — private Storage, Edge and scheduler** | Storage operator deploys both functions with server-only secrets and private policies; tests real valid/invalid/missing/wrong-owner/revoked bytes, retry, scheduled cleanup, removal failure and acknowledgement order. |
| **X4 — licensed maps and devices** | Map/device owner supplies approved provider configuration/credits/network and real HTTPS devices; validates tile delivery, permissions/accuracy/geofencing, physical-device and assistive-tech behavior. |
| **X5 — hosting** | Hosting operator authorizes target/domain/deployment, configures public build values/TLS/fallback/headers and proves deep-link refresh, assets/errors, CSP, cache behavior and Auth redirects on that actual host. |
| **X6 — local Supabase pgTAP** | Test infrastructure owner runs the local stack on a Docker/Podman-capable machine, local no-seed reset and `npm run db:test`, retaining real output. Never reset a hosted project. |
| **X7 — privacy/operational sign-off** | Event/privacy operator approves retention/backup/audit/deletion policy; verifies restore, alerts, account anonymization/deletion and staging-data cleanup. |

### Exact path to pilot approval

1. Obtain explicit staging and hosting authorization plus the X1–X7 inputs. Store secrets only in approved secure operator/host settings, never chat or `VITE_*`.
2. Reproduce local checks and execute the currently blocked pgTAP suite on supported infrastructure.
3. Follow runbook migration/backfill, Auth/SMTP, functions/secrets/bucket/scheduler, provider and frontend configuration; deploy **only** to the authorized staging target.
4. Run the safely gated focused hosted smoke and **every** runbook §6 acceptance check with independent real consenting identities and privacy-safe records. Include the S1–S3 exploit regressions, real bytes/cleanup and all service states downgraded in this checklist.
5. Rehearse rollback/forward-fix and cleanup; capture sanitized timestamps, expected/actual denials, versions and request outcomes per blocked ID. Do not include tokens, private bodies or roster exports.
6. Replace BLOCKED only with that item's actual evidence, reconcile totals, and obtain event/security/privacy operator approval before onboarding. A configured deployment alone is not acceptance.

## Reproduction and changed files

```sh
npm ci
node scripts/run-local-audit.mjs
# Inspect every exit in docs/evidence/samartha-audit/commands.json.
# Expected here: runner exit 1 because Supabase pgTAP cannot connect.

# Focused remediation regressions:
npm test -- tests/phase2-database.test.ts tests/concurrency.test.ts tests/hosting.test.ts tests/acceptance-ui.test.tsx --run
npm run build && npm run verify:build && npm run test:browser
```

Audit-only runtime/config changes: the new `20261010030000_samartha_acceptance_security.sql`; `src/lib/supabase.ts`; `src/phase2/Feed.tsx`, `Safety.tsx`, `ZoneMap.tsx`; `scripts/hosting.mjs`; `deploy/nginx.conf`. Audit-only tests/tooling: `tests/phase2-database.test.ts`, `concurrency.test.ts`, new `hosting.test.ts` / `acceptance-ui.test.tsx`, browser fixture/workflows, and `scripts/run-local-audit.mjs`. Documentation: root checklist, this report, deployment runbook, bootstrap prerequisites, historical Phase 2 label, `.env.example` comments and durable evidence. The full precise audit-start comparison is `changed-files.json`; broader `git status` also includes preserved earlier work.

Prior 94-test/10-browser-test and 215-PASS checklist claims are retained solely in explicitly labeled `historical-*` snapshots and the baseline log. They do not establish current readiness.

NOT READY FOR LIVE PILOT
