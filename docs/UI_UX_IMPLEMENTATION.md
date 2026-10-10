# DropZone UI/UX Implementation Notes

## 1. Design principles applied
The redesign implements the following product goals:
- keep the user experience consistent across public and private flows
- preserve trusted server-side permission checks
- make key workflows discoverable and obvious
- separate participant, organizer, and moderator tasks clearly
- remove confusing hidden actions and misleading empty states

## 2. Information architecture

### Public area
- Landing and auth separation remains in src/auth/AuthPages.tsx
- Sign-in, registration, password recovery, and callback flows are public and consistent
- Privacy info remains available without a logged-in session

### Authenticated shared area
- /app is the private home and membership hub
- My events is the anchor for event selection and organizer actions
- Join event remains a distinct path from My events
- Account settings remains available from the app shell

### Event workspace model
The application keeps a distinct event workspace per membership:
- participant
- organizer
- moderator

This is resolved from the trusted event membership object in AccessProvider and enforced in Workspaces.tsx.

## 3. Route and navigation structure

### Route model
- / → public landing
- /login → public login
- /register → public registration
- /recovery → password recovery
- /auth/reset-password → reset password flow
- /privacy → public privacy page
- /app → authenticated home / My events
- /app/join → invitation join flow
- /app/account → account settings
- /app/events/:eventId/:workspace → role-aware event workspace
- /development-preview → optional preview route when enabled

### Navigation rules applied
- Reused one global app-shell pattern in Workspaces.tsx
- Consistent top bar across the private workspace
- Event identity and current workspace remain visible
- My events, Join event, and Account remain explicit in the shell
- Organizer-only actions are shown only when a trusted organizer grant exists

## 4. Component and workflow changes

### 4.1 My events redesign
The My events screen is now the canonical route for event membership management. It includes:
- active membership cards
- explicit join-event path
- organizer-only create-event form when permitted

### 4.2 Create event flow
The new create-event form:
- appears only when the user has a trusted organizer membership with manage_event
- accepts name, slug, and description
- submits via dz_command with p_action = event.create
- refreshes access and routes into the new workspace when available
- provides clear loading and error states

### 4.3 Security and trust boundary
The redesign continues to rely on:
- AuthProvider for session state
- AccessProvider for server-backed role verification
- dz_command and dz_read for backend authorization
- event membership route checks before exposing a workspace

## 5. Design system
The interface keeps a calm, premium aesthetic aligned to the brief:
- neutral surfaces, restrained accent color, clear hierarchy
- strong labels, readable spacing, predictable surfaces
- consistent buttons, forms, empty states, and page headings
- light shadow and border usage instead of visual overload

## 6. Test and validation strategy
The app continues to use the project’s real automated checks:
- Vitest routing/auth tests
- browser verification for key user journeys
- TypeScript + Vite build verification

## 7. Route-by-route checklist

### Public routes
- [x] Landing page
- [x] Login
- [x] Registration
- [x] Recovery
- [x] Reset password
- [x] Callback flow
- [x] Privacy page

### Authenticated routes
- [x] My events hub
- [x] Join event flow
- [x] Account settings
- [x] Participant workspace route
- [x] Organizer workspace route
- [x] Moderator workspace route

### Organizer actions
- [x] Create event from My events
- [x] Trusted permission gating
- [x] Refresh after creation
- [x] Redirect into new event workspace when available

## 8. Remaining limitations
Because this is a real product with secure database-backed workflows, the deeper moderator and rich post-management surfaces remain implemented through the existing backend architecture rather than mock content. The current UI work focuses on making those features understandable, discoverable, and permission-aware while preserving the real product behavior.
