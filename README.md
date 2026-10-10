# DropZone

**A calmer way to get things done, right where you are.**

DropZone is an event-scoped React/Vite application backed solely by Supabase Auth, PostgreSQL/PostGIS and private Storage. The existing identity, authorization and UI architecture is preserved. Community content, staff workflows, private conversations, notifications, imports, zones and attachments use backend-enforced operations. **Hosted integration remains unverified; nothing has been deployed.**

## Implemented workflows

The authenticated workspaces now include all seven structured post templates plus custom review, feeds/search/threads/lifecycle, reports/block/mute, private organizer conversations, targeted announcements, event/team/staff management, transactional CSV/XLSX roster imports, in-app notifications, interactive Leaflet zones and private image uploads. Counts derive from authorized records. No demo data is seeded.

See [Phase 2 implementation, policies, exact configuration and verification limits](docs/PHASE2.md). In particular, image publication requires the included Supabase verification Edge Function, and physical file cleanup requires the maintenance function and scheduling. A successful frontend build alone does not verify these services.

The preserved prototype uses sample activity only at the explicitly labelled development preview, opt-in with `VITE_ENABLE_DEMO_PREVIEW=true`; it is disabled in production. Never enter real event data there.

## Final delivery and release gate

- [FINAL_ACCEPTANCE_CHECKLIST.md](FINAL_ACCEPTANCE_CHECKLIST.md): item-by-item implementation evidence and external blockers.
- [Deployment and live verification runbook](docs/DEPLOYMENT.md): safe migration/Edge/bootstrap order, static SPA hosting, security headers, real-service smoke test and operator acceptance.
- [Final changes and test evidence](docs/FINAL_VERIFICATION.md): reproducible commands, isolated-test limitations and bundle evidence.

Public fonts are self-hosted. Production maps require `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` for an approved HTTPS raster tile provider. Missing map configuration is explicit, not replaced with fabricated geography.

## Local setup

Requirements: Node.js 22+ and npm. For the full local Supabase Auth/Postgres stack, install Docker Desktop/a compatible Docker Engine or a supported Podman setup.

```bash
npm ci
cp .env.example .env.local
```

Edit `.env.local` and set the two required browser values:

- `VITE_SUPABASE_URL`: copy **Project URL** from Supabase **Project Settings → API / API Keys** (the section label varies by dashboard version). With local Supabase, use the API URL printed by `npm run db:start` (normally `http://127.0.0.1:54321`).
- `VITE_SUPABASE_PUBLISHABLE_KEY`: copy the browser-safe **Publishable key** (`sb_publishable_…`) from **Project Settings → API / API Keys** (the section label varies by dashboard version). A legacy `anon` JWT is also accepted. This key is meant to be public; the database must enforce RLS. Never use a `service_role` or `sb_secret_…` key.
- `VITE_ENABLE_DEMO_PREVIEW`: optional local-only prototype preview switch; default is `false`.

Those are the only Supabase values the browser app needs. Vite inlines `VITE_*` settings into the frontend bundle, so set these same two values in the deployment provider's **build-time environment settings** before building a hosted app. For local development, edit `.env.local` and restart Vite. Do not place a database password, Supabase CLI access token, service-role key, or any other privileged secret in a `VITE_*` variable. Database credentials used by an operator/CLI are separate from browser configuration.

The application validates the project URL and key format at startup. Missing values, example placeholders, malformed keys, non-local HTTP URLs, and privileged service-role/secret keys produce an actionable configuration page; there is no fake-login or demo-data fallback.

### Run with local Supabase

```bash
npm run db:start
npm run db:reset
npm run dev
```

`npm run db:start` starts the local Supabase stack (Docker or Podman required). `npm run db:reset` recreates the **local** database from `supabase/migrations` with seeding disabled. Local Supabase prints the API URL and browser-safe key; use those in `.env.local`. Local confirmation and password-reset emails are captured by the Supabase CLI's local mail-testing service (Mailpit), normally at `http://127.0.0.1:54324`.

Create the first real account through the registration page and confirm its email. An operator must then create a real event and assign its first organizer through the trusted Supabase SQL Editor. Follow [`supabase/BOOTSTRAP.md`](supabase/BOOTSTRAP.md). No event or organizer is created automatically.

### Apply migrations to a hosted Supabase project

1. Create the Supabase project and obtain the two browser values above. In **Authentication → URL Configuration**, set the **Site URL** to the deployed app origin and add exact redirect URLs for `<APP_ORIGIN>/auth/callback` and `<APP_ORIGIN>/auth/reset-password` (use the real HTTPS origin, not the angle-bracket text). In **Authentication → Providers → Email**, enable email/password sign-up and confirmation; configure recovery email delivery as required by the project.
2. Authenticate the Supabase CLI locally and link the project. Find the project reference in **Project Settings → General** or in the project URL.

   ```bash
   npm exec supabase -- login
   npm exec supabase -- link --project-ref your-project-ref
   npm run db:push
   ```

   The CLI may ask for the project's database password while linking. Enter it only in the local CLI prompt; do not add it to `.env.local`, frontend variables, Git, or chat. `npm run db:push` applies the versioned files under `supabase/migrations` to the linked project. Review/test the migration in a separate staging project first. **Never run `npm run db:reset` against a hosted/production project.**
3. Create and confirm the real first account through the registration page. Then use the hosted Supabase **SQL Editor** as a trusted project administrator to run the transaction in [`supabase/BOOTSTRAP.md`](supabase/BOOTSTRAP.md). It creates the first event and explicit organizer membership; public signup cannot create events or grant elevated roles. An existing trusted organizer with `manage_event` can create subsequent events through the Phase 2 operation.

### Run without Supabase

The UI build and isolated automated tests do not require external Supabase credentials:

```bash
npm test
npm run build
```

The public landing and privacy pages remain accessible without configuration; authentication and private pages fail closed with configuration guidance until the two required Supabase browser variables are set. `npm run db:test` runs the pgTAP suite against the local Supabase database and therefore requires `npm run db:start` first. The main `npm test` suite also applies the real migration in an isolated PGlite/PostGIS database and tests RLS without production data.

## Authentication and authorization model

- Supabase Auth owns passwords, confirmation and recovery. DropZone does not store passwords in application tables.
- Public registration creates only an Auth account and a profile. The auth-user trigger copies `display_name` only; caller-supplied role/permission metadata is ignored. There is no untrusted public event-creation or organizer/moderator-grant path, and invitation acceptance can grant only participant membership.
- Supabase's browser client persists/restores its own PKCE session. The application never uses browser storage, a URL role, or a user-editable field as authority for a role.
- `public.get_my_access()` returns the authenticated user's active event memberships, event roles and explicit permissions. The client uses this response for routing only; the database independently checks RLS on every table request.
- RLS defaults to deny. Private event rows require active membership. Users can read only their own profile and memberships unless an explicit `view_members` grant applies. No authenticated client can directly insert/update/delete roles, invitations, team membership or audit rows.
- Elevated membership changes and participant-invite operations use `SECURITY DEFINER` RPCs that check `auth.uid()` and assigned event permissions and append audit events. Invitation tokens are generated with Web Crypto, hashed with SHA-256 in Postgres, and participant-only.
- The PostGIS `zones` table stores a circle as a Point plus meters or a valid Polygon/MultiPolygon. Phase 2 validates and saves boundaries and calculates geographic eligibility server-side; see the documented accuracy/privacy policy.
- Initial event bootstrap is an operator action. The browser never receives a service-role key. See [`supabase/BOOTSTRAP.md`](supabase/BOOTSTRAP.md).

## Database relationships

`auth.users` is the identity provider's source of truth. `profiles.id` references it one-to-one. `events` own `event_memberships`, `teams`, `zones`, invitations and event-scoped audit references. A membership is unique per `(event_id, user_id)` and holds one base role plus a constrained list of explicit permissions. `team_memberships` has composite foreign keys to both the event's team and the user's membership, preventing cross-event team links. Event/team deletion cascades to their live membership data; auth-user deletion removes profile/membership rows and anonymizes audit actor/target references. Events should be archived rather than hard-deleted. Confirm any legal retention requirements before production use.

## Commands

```bash
npm run dev          # Vite dev server (0.0.0.0:5173)
npm run build        # TypeScript project build and production bundle
npm run preview      # Serve the production bundle
npm test             # React/Auth boundaries, PGlite/PostGIS RLS, native PG concurrency
npm run test:browser # Chromium UI/axe tests; Supabase boundary is a labeled fixture
npm run verify:build # Check lazy chunks, bundle budget, SPA fallback and header output
npm run test:watch   # Vitest watch mode
npm run db:start     # Start local Supabase; Docker or Podman required
npm run db:reset     # Rebuild local DB from migrations; no seeds
npm run db:test      # Run Supabase pgTAP tests against the local DB
npm run db:stop      # Stop local Supabase
```

## Security and deployment notes

- Never put `SUPABASE_SERVICE_ROLE_KEY`, database passwords, direct database URLs or other privileged secrets in `VITE_*` variables, frontend code or browser bundles. Server-only Edge Function credentials are never browser variables. See the Phase 2 setup guide.
- Keep RLS enabled when deploying, apply migrations before releasing the frontend, and use separate development/staging/production Supabase projects. Add redirect URLs only for trusted origins.
- A successful frontend build is not a live-auth integration test. Live registration, email delivery, session refresh and password recovery require a configured Supabase project and its email settings.
- Do not enable the sample-data preview for production. It is compile-time gated by Vite development mode and is not a real event workspace.

## Preserved prototype

The previous interactive UI is retained in `src/PrototypePreview.tsx` with its original sample data in `src/data.ts`. It can be opened locally at `/development-preview` only when `VITE_ENABLE_DEMO_PREVIEW=true` and Vite is serving in development mode. The page is labelled as simulated. It is not part of authentication, access resolution, database writes or production routing.
