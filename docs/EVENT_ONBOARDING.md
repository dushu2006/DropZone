# Event onboarding and event-first workflow

## 1. Sign in first, then choose the event context
DropZone authentication and event authorization are separate concerns:
- authentication proves the user is a valid DropZone account
- event membership proves the user is authorized for a specific event

A valid account alone does not grant access to any event.

## 2. Welcome dashboard
After successful authentication, the user is directed to the authenticated event-selection dashboard. The page title is:
- Welcome to DropZone

It explains the two primary actions:
- Join an Event
- Organize an Event

The page also shows real event sections only when the account has active memberships:
- Events I organize
- Events I've joined

There is no automatic event selection for a single event membership.

## 3. Join an event
Users can join through the event invitation flow. This is the correct place for:
- invitation code
- event invite link or token
- trusted backend validation

The app must verify the invitation and refresh the trusted access list before opening the event workspace.

## 4. Organize an event
The organizer action is available only when the authenticated user already holds a trusted organizer grant with `manage_event` in `public.get_my_access()`.

The create-event workflow contains:
- event name
- unique slug
- description
- organizer-authorized creation via `dz_command` with `p_action = 'event.create'`
- access refresh and redirect into the newly created event when the backend confirms the membership

## 5. Event creation choices
The app supports the event configuration patterns already described by the database schema and Phase 2 operations:
- open event
- protected event with roster validation

These options are not implemented as a fake client-side toggle. The real trust boundary remains in the database and permission-checked RPCs.

## 6. Organizer roster and participant roster
The real backend model separates:
- event definition
- organizer roster
- participant roster
- active membership records

A CSV/XLSX import may validate organizer or participant eligibility, but it never authenticates a person by itself. The event creation operation still needs trusted backend logic to create real memberships and records.

## 7. Safe cleanup and operator workflow
Before removing development data from a database:
- inspect the current events and memberships
- verify the candidates are genuinely disposable development/test data
- confirm the target event IDs explicitly
- preserve real accounts, schema, RLS, migrations, and auth configuration

See the scripts in `supabase/cleanup/` for the safe inspection and explicit cleanup process.

## 8. Local and hosted project setup
- Local Supabase: apply migrations and start the stack in the normal project workflow
- Hosted Supabase: use the trusted project operator to apply migrations and bootstrap the first real event
- Never run `supabase db reset` against a hosted project
- Never place service-role credentials in browser code or `VITE_*` variables
