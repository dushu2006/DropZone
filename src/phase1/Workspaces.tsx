import { useState } from 'react'
import { Workbench } from '../phase2/Workbench'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Copy, KeyRound, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from './AccessProvider'
import type { EventMembershipAccess } from '../lib/database.types'

const MODERATION_PERMISSIONS = ['review_reports', 'remove_content', 'review_custom_posts', 'view_audit_log']

export function workspaceForMembership(membership: EventMembershipAccess): 'participant' | 'organizer' | 'moderator' {
  if (membership.role === 'organizer') return 'organizer'
  if (membership.role === 'moderator' && membership.permissions.some((permission) => MODERATION_PERMISSIONS.includes(permission))) return 'moderator'
  return 'participant'
}

function eventPath(membership: EventMembershipAccess) {
  return `/app/events/${encodeURIComponent(membership.event_id)}/${workspaceForMembership(membership)}`
}

export function AccessHome() {
  const { access, loading, error, refreshAccess } = useAccess()
  if (loading) return <PrivateLoading message="Checking your event membership…" />
  if (error) return <AccessError error={error} onRetry={() => void refreshAccess()} />
  if (!access?.memberships.length) return <JoinEventPage />
  if (access.memberships.length === 1) return <Navigate to={eventPath(access.memberships[0])} replace />

  return <WorkspaceFrame title="Choose an event" subtitle="Only events with an active membership are listed.">
    <div className="membership-list">
      {access.memberships.map((membership) => <Link className="membership-card" key={membership.event_id} to={eventPath(membership)}>
        <span className="membership-card-icon"><Users size={18} /></span><span><strong>{membership.event_name}</strong><small>{membership.role} · {membership.event_slug}</small></span><ArrowRight size={17} />
      </Link>)}
    </div>
    <Link className="auth-help-link" to="/app/join">Join another event with an invitation code</Link>
  </WorkspaceFrame>
}

export function JoinEventPage() {
  const { client } = useAuth()
  const { access, refreshAccess } = useAccess()
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data: joinedEvent, error: joinError } = await client.rpc('accept_event_invitation', { p_token: token.trim() })
      if (joinError) throw joinError
      const nextAccess = await refreshAccess()
      const joined = nextAccess?.memberships.find((membership) => membership.event_id === joinedEvent.event_id)
      if (!joined) throw new Error('The invitation was accepted but event access did not refresh. Try loading your workspace again.')
      navigate(eventPath(joined), { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invitation could not be accepted. Check the code and try again.')
    } finally {
      setBusy(false)
    }
  }

  return <WorkspaceFrame title="Join an event" subtitle="An authenticated account still needs a valid invitation to enter a private event.">
    {access?.memberships.length ? <p className="auth-inline-note">Your existing event memberships are unchanged.</p> : null}
    <form className="auth-form join-event-form" onSubmit={submit}>
      <label className="auth-field"><span>Invitation code</span><input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required minLength={40} maxLength={100} pattern="[A-Za-z0-9_-]{40,100}" aria-describedby="invite-code-help" /></label>
      <small id="invite-code-help" className="auth-field-help">Codes are case-sensitive, one-time or limited-use, and expire.</small>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" disabled={busy || token.trim().length < 40} type="submit">{busy ? 'Verifying invitation…' : 'Join event'} <ArrowRight size={16} /></button>
    </form>
    <Link className="auth-help-link" to="/app">Back to my workspace</Link>
  </WorkspaceFrame>
}

export function EventWorkspace() {
  const { eventId = '', workspace = '' } = useParams()
  const { access, loading, error, refreshAccess } = useAccess()
  if (loading) return <PrivateLoading message="Verifying event permissions…" />
  if (error) return <AccessError error={error} onRetry={() => void refreshAccess()} />
  const membership = access?.memberships.find((item) => item.event_id === eventId)
  if (!membership) return <WorkspaceFrame title="Event access not found" subtitle="Your account has no active membership for this event."><Link className="primary-button auth-link-button" to="/app">Return to your memberships <ArrowRight size={16} /></Link></WorkspaceFrame>

  const allowed = (workspace === 'participant' && membership.role === 'participant')
    || (workspace === 'organizer' && membership.role === 'organizer')
    || (workspace === 'moderator' && canOpenModeratorWorkspace(membership))
  if (!allowed) return <WorkspaceFrame title="This workspace is not assigned to your account" subtitle="Workspace access is read from your trusted event membership; changing a URL or browser setting does not grant a role."><Link className="primary-button auth-link-button" to={eventPath(membership)}>Open your assigned workspace <ArrowRight size={16} /></Link></WorkspaceFrame>

  if (workspace === 'organizer') return <OrganizerWorkspace membership={membership} />
  if (workspace === 'moderator') return <ModeratorWorkspace membership={membership} />
  return <ParticipantWorkspace membership={membership} />
}

function canOpenModeratorWorkspace(membership: EventMembershipAccess) {
  return (membership.role === 'moderator' || membership.role === 'organizer')
    && membership.permissions.some((permission) => MODERATION_PERMISSIONS.includes(permission))
}

function ParticipantWorkspace({ membership }: { membership: EventMembershipAccess }) {
  return <WorkspaceFrame title={membership.event_name} subtitle="Participant workspace">
    <section className="phase1-notice"><span className="phase1-notice-icon"><Users size={18} /></span><div><strong>Your event membership is verified.</strong><p>Your community workflows use authorized Supabase records. No sample activity is shown.</p></div></section>
    <Workbench key={membership.event_id} membership={membership} /><AccessSummary membership={membership} />
  </WorkspaceFrame>
}

function OrganizerWorkspace({ membership }: { membership: EventMembershipAccess }) {
  const moderatorPermissions = membership.permissions.filter((permission) => MODERATION_PERMISSIONS.includes(permission))
  return <WorkspaceFrame title={membership.event_name} subtitle="Organizer workspace">
    <section className="phase1-notice"><span className="phase1-notice-icon"><ShieldCheck size={18} /></span><div><strong>Organizer membership verified for this event.</strong><p>Manage real event workflows below. Counts reflect only records your account is authorized to read.</p></div></section>
    <Workbench key={membership.event_id} membership={membership} /><AccessSummary membership={membership} />
    <ParticipantInvitationForm membership={membership} />
    {moderatorPermissions.length > 0 && <section className="workspace-panel"><div className="workspace-panel-heading"><h2>Additional moderation grants</h2><p>These are explicit grants shown above, not permissions inherited from the organizer role.</p></div><Link className="auth-help-link" to={`/app/events/${encodeURIComponent(membership.event_id)}/moderator`}>Open assigned moderator workspace <ArrowRight size={14} /></Link></section>}
  </WorkspaceFrame>
}

function ModeratorWorkspace({ membership }: { membership: EventMembershipAccess }) {
  return <WorkspaceFrame title={membership.event_name} subtitle="Moderator workspace">
    <section className="phase1-notice"><span className="phase1-notice-icon"><ShieldCheck size={18} /></span><div><strong>Moderator access is limited to assigned permissions.</strong><p>Review queues and actions below are limited to your explicit trusted grants.</p></div></section>
    <Workbench key={membership.event_id} membership={membership} /><AccessSummary membership={membership} />
  </WorkspaceFrame>
}

function AccessSummary({ membership }: { membership: EventMembershipAccess }) {
  return <section className="workspace-panel access-summary"><div className="workspace-panel-heading"><h2>Verified membership</h2><p>Loaded from the authenticated account's server-side event membership.</p></div><dl><div><dt>Event</dt><dd>{membership.event_name}</dd></div><div><dt>Role</dt><dd>{membership.role}</dd></div><div><dt>Event ID</dt><dd className="mono-value">{membership.event_id}</dd></div></dl><div className="workspace-panel-heading permissions-heading"><h3>Explicit permissions</h3></div><PermissionList permissions={membership.permissions} /></section>
}

function PermissionList({ permissions }: { permissions: string[] }) {
  if (!permissions.length) return <p className="empty-permissions">No additional permissions are assigned.</p>
  return <ul className="permission-list">{permissions.map((permission) => <li key={permission}><CheckCircle2 size={14} />{permission.replaceAll('_', ' ')}</li>)}</ul>
}

function ParticipantInvitationForm({ membership }: { membership: EventMembershipAccess }) {
  const { client } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!membership.permissions.includes('manage_members')) return null

  const createInvitation = async () => {
    setBusy(true)
    setError('')
    setCopied(false)
    try {
      const inviteCode = makeSecureInvitationCode()
      const { error: inviteError } = await client.rpc('create_event_invitation', {
        p_event_id: membership.event_id,
        p_token: inviteCode,
      })
      if (inviteError) throw inviteError
      setToken(inviteCode)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invitation could not be created. Verify your event permission and try again.')
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setError('')
    } catch {
      setError('Clipboard access was denied. Select and copy the invitation code manually.')
    }
  }

  return <section className="workspace-panel invite-panel"><div className="workspace-panel-heading"><h2>Invite a participant</h2><p>Creates a real, participant-only invitation through a permission-checked database operation. The raw code is shown once and is not saved by the app.</p></div>
    <button type="button" className="secondary-button" onClick={() => void createInvitation()} disabled={busy}>{busy ? 'Creating invitation…' : 'Create 7-day participant code'} <KeyRound size={15} /></button>
    {token && <div className="invite-code-result"><label htmlFor="invite-code">One-time invitation code</label><div><input id="invite-code" readOnly value={token} onFocus={(event) => event.currentTarget.select()} /><button className="secondary-button" type="button" onClick={() => void copyCode()}><Copy size={14} />{copied ? 'Copied' : 'Copy'}</button></div><small>Share securely. Anyone who has this valid code can join as a participant until it expires or is used.</small></div>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </section>
}

function makeSecureInvitationCode() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('A secure browser context is required to generate an invitation code.')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function WorkspaceFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { client, session } = useAuth()
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const navigate = useNavigate()

  const logout = async () => {
    setLoggingOut(true)
    setLogoutError('')
    try {
      const { error } = await client.auth.signOut()
      if (error) throw error
      navigate('/', { replace: true })
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'Sign out could not be completed. Try again.')
    } finally {
      setLoggingOut(false)
    }
  }

  return <div className="phase1-app-shell">
    <aside className="phase1-sidebar"><Link className="auth-brand" to="/app"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>DropZone<span className="brand-period">.</span></span></Link><div className="phase1-sidebar-status"><LockKeyhole size={15} /><span>Authenticated workspace</span></div><div className="phase1-sidebar-bottom"><span className="phase1-avatar">{(session?.user.email ?? 'U').slice(0, 1).toUpperCase()}</span><span className="phase1-account-email">{session?.user.email ?? 'Signed-in account'}</span><button type="button" className="icon-button" onClick={() => void logout()} disabled={loggingOut} aria-label="Log out" title="Log out"><LogOut size={16} /></button></div></aside>
    <div className="phase1-workspace"><header className="phase1-topbar"><div><span className="auth-eyebrow">PRIVATE EVENT WORKSPACE</span><strong>{title}</strong></div><div className="phase1-top-actions"><Link to="/app">My events</Link><Link to="/app/join">Join event</Link><button type="button" className="secondary-button" onClick={() => void logout()} disabled={loggingOut}><LogOut size={14} />{loggingOut ? 'Logging out…' : 'Log out'}</button></div></header><main className="phase1-main"><div className="phase1-page-heading"><h1>{title}</h1><p>{subtitle}</p></div>{logoutError && <p className="auth-error" role="alert">{logoutError}</p>}{children}</main></div>
  </div>
}

function PrivateLoading({ message }: { message: string }) {
  return <main className="auth-page auth-status-page"><section className="auth-card" aria-live="polite"><span className="auth-spinner" /><p>{message}</p></section></main>
}

function AccessError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <WorkspaceFrame title="Access check required" subtitle="Private event content remains unavailable until access can be verified."><p className="auth-error" role="alert">{error}</p><button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={14} />Retry access check</button></WorkspaceFrame>
}

