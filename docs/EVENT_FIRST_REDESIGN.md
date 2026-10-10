# Event-first redesign and root-cause audit

## Root cause of the automatic event behavior
The application was implicitly assuming a valid event existed in two places:

1. The authenticated home route in `src/phase1/Workspaces.tsx` redirected to the first event membership whenever `access.memberships.length === 1`.
2. The starter database bootstrap script in `supabase/seed_event.sql` auto-created a `dropzone-main-event` event and inserted organizer memberships for all Auth users.

This meant the app could appear to have a current event even when the user had not intentionally selected one, and the database could seed a default event into the account lifecycle.

The intended event-first model is: authenticate to DropZone, then explicitly choose to join an event, create one, or open a trusted existing membership. A user without valid membership does not enter a private event automatically.

## Actual repository findings
- Authentication and protected routing are handled in `src/App.tsx`, `src/auth/AuthProvider.tsx`, and `src/phase1/AccessProvider.tsx`.
- Event access resolution is derived from `public.get_my_access()` and is trusted only when it comes from the backend.
- Event creation is allowed through the permission-checked `dz_command` RPC.
- The app shell in `src/phase1/Workspaces.tsx` is the correct place to enforce explicit event selection rather than silent redirecting.
- `supabase/seed_event.sql` is a bootstrap script, not a production event generator; it was a source of implicit event assumptions in local setups.

## Correct behavior implemented
- After authentication, the app shows the event-selection dashboard instead of forcing the first event.
- The dashboard explicitly offers:
  - Join an Event
  - Organize an Event
- Event lists are shown only when there are real event memberships.
- Opening an event still requires the user to select it explicitly.
- Event creation is only shown for an organizer with a valid trusted `manage_event` grant.

## Required follow-up for hosted or local database cleanup
A production or hosted project must not rely on developer-only bootstrap scripts to establish an active event. The trusted operator path is still the correct approach:
- create the real account
- confirm the Auth user
- create the event via a trusted server-side SQL editor or RPC
- assign the first organizer membership through the permission-checked backend path
- do not auto-grant organizer permissions from browser code or seed scripts

## Safe cleanup guidance
Use the inspection and cleanup scripts under `supabase/cleanup/` to review candidate development/test records before any destructive delete. These scripts are intentionally read-only first and require explicit target IDs before any delete operations are allowed.
