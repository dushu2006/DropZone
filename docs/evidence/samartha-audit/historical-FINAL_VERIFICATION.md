> HISTORICAL: snapshot before this SAMARTHA audit; superseded by the current root checklist and docs/FINAL_VERIFICATION.md. These results do not establish current acceptance.

# Final implementation and verification — 2026-10-10

## Decision

**NOT READY for a live pilot.** Locally implementable changes and verification are complete, with no known remaining local test failure. Hosted Auth/email, independent-JWT REST/RLS, actual Storage/Edge/scheduler integration, an approved live tile provider and final HTTPS hosting still require configuration and real verification. Nothing was deployed. This is not a production-readiness claim.

The authoritative itemized record is [`FINAL_ACCEPTANCE_CHECKLIST.md`](../FINAL_ACCEPTANCE_CHECKLIST.md). The exact operator runbook is [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Preserved architecture and completed fixes

React/Vite, existing routes, sage styling, Supabase-only backend, prior migrations and working features were preserved. The checkpoint `e3f77a3` retained the prior work; final changes remain on the same session branch. No destructive database reset or branch replacement was used.

- Additive final migration: protected revision history; optimistic published editing; persistent review state/reasons; re-review for changed approved text **and newly attached bytes**; unchanged expiry on edits; self-role/staff-demotion checks; cleared team links on revocation; sanitized decisions affecting the user; authorized profile-name updates; keyset feed pagination; revision retention; permission rechecks **before returning retry receipts**.
- Auth/read isolation: account-scoped query data, late-result protection, focus/60-second access refresh, permission-error refresh, keyed event/role/grant workspace remount, account and privacy routes. Server denial is immediate; the browser cannot unsee already received bytes.
- Workflows: preserved all structured templates, custom submissions, staff reports/decisions, private conversations, trusted communications, roster preview/import, PostGIS zones and private attachments. Fixed blocked-parent reply/report checks, notification decision destinations and conversation-specific retry scope.
- Attachments: stable reserve/finalize IDs, ambiguity-safe verification before success, retry of already completed uploads, failed-image recovery, refresh of post review state after upload, explicit EXIF/copying limitations. A filename is never accepted as proof of bytes.
- UI: lazy workbench/staff/messaging/maps/parser, error boundary, heading focus/aria-current, missing-provider state, responsive workflow navigation, improved text contrast and underlined attribution links. Self-hosted fonts remove third-party font requests.
- Deployment: static SPA redirect, Netlify-compatible build config, generated environment-specific security headers, Nginx route template, build checks, real-service staging smoke script and operator acceptance instructions.

## Executed checks

| Command | Result and scope |
|---|---|
| `npm ci` | Dependency installation completed in this task; later dependency additions are locked in `package-lock.json`. |
| `npm test -- --run` | **94 passed / 7 files.** 20 Auth/route adapter tests, 5 config tests, 15 workflow UI/parser tests, 4 final UI regressions, 10 foundation DB tests, 39 workflow DB tests and 1 native concurrency test. |
| `npx tsc --noEmit -p tsconfig.json` | Passed. |
| `npm run build` | Passed; TypeScript project build and production Vite bundle. |
| `npm run verify:build` | Passed; entry-size budget, lazy workbench/map, sample-fixture/privileged-key spot checks, local fonts, SPA redirect and security-header output. This is not a comprehensive secret scanner or deployed CSP test. |
| `npm run test:browser` | **10 passed.** Chromium, 390/768/1440px, all 15 workspace pages, participant/moderator route/grant handling, keyboard login/focus, cancel-before-roster-write, edit/upload states. Axe WCAG A/AA checks on 15 workspace pages and five public/Auth/privacy pages. One separate built-bundle test checks local SPA direct-path fallback, refresh and absence of the sample preview. |
| `npm exec --yes --package=deno@2.9.6 -- deno check supabase/functions/verify-attachment/index.ts supabase/functions/maintenance/index.ts` | Both Edge Functions type-checked. Not deployed or exercised with actual Supabase requests. |
| `git diff --check` | Passed. |
| `npm audit` | Zero reported vulnerabilities at verification time; not a guarantee of vulnerability-free dependencies. |
| `npm run db:test` | **BLOCKED.** Local PostgreSQL `127.0.0.1:54322` refused the connection; no Docker/Podman Supabase stack exists. pgTAP did not run. |
| `node --check scripts/verify-hosted.mjs` | Passed syntax check. |
| `node scripts/verify-hosted.mjs` | **BLOCKED, exit 2.** Correctly refused to run without explicit staging consent, project settings and three independent real user tokens. No hosted request or mutation occurred. |

## What the database evidence does and does not prove

`database-foundation.test.ts` and `phase2-database.test.ts` apply the actual migration chain to isolated PGlite/PostGIS and switch to `anon`/`authenticated` SQL roles with a test `auth.uid()` shim. They exercise constraints, RLS, private function grants, event isolation, ownership, review/lifecycle, reports/restrictions, private messages, recipient snapshots, imports, actual PostGIS containment, Storage metadata policies, retention and role revocation. `storage.objects` in that harness is metadata only, not an object server. There is no hosted Auth, JWT gateway, PostgREST, SMTP or physical Storage in those tests.

`concurrency.test.ts` starts an isolated **native PostgreSQL 17** cluster, extracts the exact production `rate_rules`, `rate_counters` and `dz_rate` implementation, and opens **12 independent TCP sessions**. With a limit of three, exactly **3 commit and 9 rate-limit/rollback**; persisted counter = 3. This is genuine database concurrency evidence, unlike concurrent calls queued by a single PGlite connection. It does not prove full hosted RPC/JWT/PostgREST concurrency.

The browser fixture renders the actual application components with explicit sample identities at the Supabase boundary. It is labeled and separate from the production entry. Its PASS results establish UI/layout/accessibility behavior, not backend security or real operation success. Axe checks are a baseline, not full WCAG certification, screen-reader certification or physical-device testing.

## Bundle evidence

Latest Vite output (decimal kB):

| JavaScript chunk | Raw | Gzip | Loading |
|---|---:|---:|---|
| Main entry | 457.70 | 132.45 | Initial |
| Workbench | 26.16 | 8.62 | Authenticated workspace, lazy |
| Staff tools | 12.61 | 4.46 | Staff workflow, lazy |
| Messaging | 6.61 | 2.20 | Messaging workflow, lazy |
| Leaflet map | 155.88 | 45.96 | Map page, lazy |
| XLSX parser | 500.05 | 163.12 | Roster file parsing, lazy |

`dist/.vite/manifest.json` is generated reproducibly. The main-entry budget is 500 kB; the separately loaded parser is not initial page weight. This is bundle analysis, not measured mobile-network latency or a hosted load test. Fonts are local and only used weights are requested by the browser.

## Known operating limits, not hidden promises

In-app communications do not mean email/SMS/push delivery. Feed uses keyset pagination; other bounded lists use offsets. Access refresh is periodic/focus-triggered, not instant visual erasure. Image verification inspects type signatures and size, not full decode/reencode, malware or metadata stripping. GPS can be spoofed. Downloads hidden in the UI cannot stop screenshots or copying fetched bytes. Account deletion/anonymization requires a trusted operator; audit/backups can retain information. Retention only executes with the maintenance scheduler configured and verified. For higher-risk deployments, assess these limitations before approving scope.
