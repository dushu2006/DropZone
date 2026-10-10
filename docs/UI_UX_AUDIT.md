# DropZone UI/UX Audit

## 1. Scope and method
This audit records the current application structure and the redesign decisions made to improve the user journey without weakening backend security or permission checks.

The audit was built from the live code paths in:
- src/App.tsx
- src/auth/AuthPages.tsx
- src/auth/AuthProvider.tsx
- src/phase1/AccessProvider.tsx
- src/phase1/Workspaces.tsx
- src/phase2/Workbench.tsx
- src/phase2/Staff.tsx
- src/phase2/Feed.tsx
- src/phase2/Messaging.tsx
- src/phase2/Safety.tsx
- src/styles.css
- supabase/migrations/...

## 2. Current application inventory

### Public routes
| Route | Role | Current purpose | Status |
| --- | --- | --- | --- |
| / | Everyone | Landing page and marketing shell | Functional |
| /login | Authenticated or anonymous | Sign in | Functional |
| /register | Anonymous | Registration | Functional |
| /recovery | Anonymous | Password recovery | Functional |
| /auth/reset-password | Authenticated via recovery state | Password reset | Functional |
| /auth/callback | OAuth callback | Auth completion flow | Functional |
| /privacy | Everyone | Privacy policy | Functional |

### Private authenticated routes
| Route | Role | Current purpose | Status |
| --- | --- | --- | --- |
| /app | Authenticated | My events home and membership hub | Functional |
| /app/join | Authenticated | Invitation acceptance | Functional |
| /app/events/:eventId/:workspace | Authenticated + trusted membership | Event workspace routing | Functional |
| /app/account | Authenticated | Account settings | Functional |

### Event-workspace roles
| Workspace | Role gate | Purpose |
| --- | --- | --- |
| participant | participant | Content creation and participation |
| organizer | organizer | Event management and trusted operations |
| moderator | moderator with review permissions | Limited moderation workflows |

## 3. Feature inventory and redesign mapping

### 3.1 Authentication, auth flow and routing
- Feature: Signup, login, password recovery, callback handling, session restore
- Roles: everyone
- Current location: src/auth/AuthPages.tsx and AuthProvider.tsx
- Requirements: keep Supabase-authenticated session lifecycle intact, prevent infinite redirects, preserve recovery session rules
- Correct destination: public landing/login/register/recovery pattern, with protected app routes behind AuthProvider and AccessProvider
- Result: preserved and reorganized with the correct route hierarchy

### 3.2 Trusted access and role resolution
- Feature: Event membership verification, route guard, role-based workspace access
- Roles: authenticated users
- Current location: src/phase1/AccessProvider.tsx and Workspaces.tsx
- Requirements: never trust browser-side role state; derive from server-side event membership
- Correct destination: protected access layer before all event screens
- Result: retained as the trust boundary; routing is enforced from server-supplied trusted access

### 3.3 My events and event membership list
- Feature: View all active memberships and enter event workspaces
- Roles: authenticated users with memberships
- Current location: AccessHome in Workspaces.tsx
- Old issue: empty membership state was not clear and no creation flow was surfaced;
  onboarding was confusing for organizers
- Correct destination: My events hub with membership cards and organizer create-event action when authorized
- Result: create-event flow added and the workspace is clear

### 3.4 Event creation
- Feature: Create a new event using an organizer's trusted grant
- Roles: organizers with manage_event
- Current location: EventSettings in src/phase2/Staff.tsx and the new organizer creation panel in Workspaces.tsx
- Old issue: backend had the operation, but the UI never exposed or used it
- Correct destination: My events home as a compact organizer action block
- Result: implemented and route-aware

### 3.5 Participant workflows
- Feature: feed, replies, personal activity, contact organizers, announcements
- Roles: participants and above
- Current location: src/phase2/Feed.tsx, Messaging.tsx, Workbench.tsx, Safety.tsx
- Correct destination: event workspace, with content views grouped by user goals and permission checks
- Result: preserved under the phase2 workbench architecture

### 3.6 Organizer workflows
- Feature: event settings, roster import, announcements, safety review, teams, permissions, zone config
- Roles: organizers and specific delegated roles
- Current location: phase2 components and Workbench.tsx
- Correct destination: event organizer workspace sectioned by management concern
- Result: preserved and surfaced behind permission checks instead of hidden behind unclear routes

### 3.7 Moderator and safety workflows
- Feature: review reports, moderation actions, explicit grant review
- Roles: moderators or organizers with matching permissions
- Current location: Safety.tsx and Workspaces.tsx moderator route
- Correct destination: dedicated moderator workspace with only assigned permissions shown
- Result: allowed only from actual granted permissions and displayed explicitly

### 3.8 Messaging and announcements
- Feature: private organizer conversation, official event communications, notifications
- Roles: event members with corresponding access
- Current location: Messaging.tsx, Workbench.tsx
- Correct destination: dedicated message/announcement surfaces inside the workspace
- Result: kept in the event shell and separated from public posting

### 3.9 Teams, roster import and event settings
- Feature: team editing, roster import validation, event configuration
- Roles: organizers with manage_teams/manage_members/manage_event
- Current location: Staff.tsx
- Correct destination: organizer management area, not buried in generic settings
- Result: preserved in the actual database-backed UI

### 3.10 Zone configuration and privacy constraints
- Feature: geolocation and zone validation checks
- Roles: authorized event managers
- Current location: ZoneMap.tsx and related phase2 utilities
- Correct destination: event settings and relevant content creation validation flow
- Result: security-first; geolocation is treated as validation input, not identity proof

## 4. Old location vs new location summary

| Feature area | Old location | New design destination |
| --- | --- | --- |
| Event access | Mixed and confusing | My events hub + trusted access provider |
| Event creation | Hidden in staff settings | My events organizer panel |
| Event joining | Access home + join route | Dedicated join page |
| Role routing | URL-based and implicit | Server-trusted workspace resolution |
| Feed and community posts | Mixed in Workbench | Event workspace main feed area |
| Messages | Embedded in workbench | Clear conversations area |
| Safety review | Unsafe or muted by route confusion | Dedicated moderator/safety route |
| Event settings | Staff component | Organizer management tray |
| Notifications | Mixed feed state | Notification surface within workspace |

## 5. Verified completion checklist
- Authentication lifecycle verified
- Access trust boundary preserved
- Organizer create-event flow added
- My events route behavior corrected
- Route/security assertions covered by tests
- Build/test verification executed

## 6. Known limitations
This redesign is focused on the live application architecture and the core deliverables required to make the product understandable and usable. The app still contains deeper phase2 feature surfaces that are intentionally kept behind the existing secure architecture rather than being simulated or mocked.
