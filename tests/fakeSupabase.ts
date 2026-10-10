import { vi } from 'vitest'
import type { Session, User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TrustedAccess } from '../src/lib/database.types'

export const TEST_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const TEST_EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

export function makeSession(email = 'member@example.test'): Session {
  const user: User = {
    id: TEST_USER_ID,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { display_name: 'Test Member' },
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
    email,
    identities: [],
    role: 'authenticated',
  }
  return {
    access_token: 'test-only-access-token',
    refresh_token: 'test-only-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  }
}

export function makeAccess(role: 'participant' | 'organizer' | 'moderator' = 'participant', permissions: string[] = []): TrustedAccess {
  return {
    user_id: TEST_USER_ID,
    display_name: 'Test Member',
    memberships: [{
      event_id: TEST_EVENT_ID,
      event_name: 'Test Event',
      event_slug: 'test-event',
      role,
      permissions,
      status: 'active',
    }],
  }
}

export function createFakeSupabase(options: {
  initialSession?: Session | null
  access?: TrustedAccess | null
  sessionError?: Error | null
  deferSessionRead?: boolean
  signInError?: Error | null
  signUpError?: Error | null
  signUpSession?: boolean
  signOutError?: Error | null
  exchangeCodeError?: Error | null
} = {}) {
  let currentSession = options.initialSession ?? null
  const pendingGetSessionReads: Array<() => void> = []
  let authCallback: ((event: string, session: Session | null) => void) | null = null
  let access = options.access ?? { user_id: TEST_USER_ID, display_name: 'Test Member', memberships: [] }
  const session = () => currentSession
  const emit = (event: string, nextSession: Session | null) => {
    currentSession = nextSession
    authCallback?.(event, nextSession)
  }
  const client = {
    auth: {
      getSession: vi.fn(async () => {
        const sessionAtRequest = currentSession
        if (options.deferSessionRead) {
          return await new Promise<{ data: { session: Session | null }; error: Error | null }>((resolve) => {
            pendingGetSessionReads.push(() => resolve(options.sessionError
              ? { data: { session: null }, error: options.sessionError }
              : { data: { session: sessionAtRequest }, error: null }))
          })
        }
        if (options.sessionError) return { data: { session: null }, error: options.sessionError }
        return { data: { session: sessionAtRequest }, error: null }
      }),
      onAuthStateChange: vi.fn((callback: (event: string, session: Session | null) => void) => {
        authCallback = callback
        queueMicrotask(() => callback('INITIAL_SESSION', currentSession))
        return { data: { subscription: { unsubscribe: vi.fn(() => { authCallback = null }) } } }
      }),
      signInWithPassword: vi.fn(async () => {
        if (options.signInError) return { data: { user: null, session: null }, error: options.signInError }
        const nextSession = makeSession()
        emit('SIGNED_IN', nextSession)
        return { data: { user: nextSession.user, session: nextSession }, error: null }
      }),
      signUp: vi.fn(async () => {
        if (options.signUpError) return { data: { user: null, session: null }, error: options.signUpError }
        const nextSession = options.signUpSession ? makeSession() : null
        if (nextSession) emit('SIGNED_IN', nextSession)
        return { data: { user: nextSession?.user ?? makeSession().user, session: nextSession }, error: null }
      }),
      exchangeCodeForSession: vi.fn(async (code: string) => {
        if (options.exchangeCodeError) return { data: { user: null, session: null }, error: options.exchangeCodeError }
        const nextSession = makeSession()
        emit('SIGNED_IN', nextSession)
        return { data: { user: nextSession.user, session: nextSession }, error: null }
      }),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      updateUser: vi.fn(async () => {
        if (!currentSession) return { data: { user: null }, error: new Error('Recovery session is missing') }
        emit('USER_UPDATED', currentSession)
        return { data: { user: currentSession.user }, error: null }
      }),
      signOut: vi.fn(async () => {
        if (options.signOutError) return { error: options.signOutError }
        emit('SIGNED_OUT', null)
        return { error: null }
      }),
    },
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'get_my_access') return { data: access, error: null }
      if (name === 'accept_event_invitation') {
        access = makeAccess('participant')
        return { data: { event_id: TEST_EVENT_ID, event_name: 'Test Event', event_slug: 'test-event' }, error: null }
      }
      if (name === 'create_event_invitation') return { data: [{ invitation_id: 'invite-test', expires_at: new Date().toISOString() }], error: null }
      if (name === 'dz_command') {
        if (args?.p_action === 'event.create') {
          const payload = args.p_data as Record<string, unknown>
          const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
          const nextMembership = {
            event_id: eventId,
            event_name: String(payload.name ?? 'New Event'),
            event_slug: String(payload.slug ?? 'new-event'),
            role: 'organizer' as const,
            permissions: ['manage_event'],
            status: 'active' as const,
          }
          access = {
            user_id: TEST_USER_ID,
            display_name: 'Test Member',
            memberships: [nextMembership, ...((access?.memberships ?? []) as TrustedAccess['memberships'])],
          }
          return { data: { id: eventId }, error: null }
        }
        if (args?.p_action === 'event.update' || args?.p_action === 'zone.save') {
          return { data: { success: true }, error: null }
        }
      }
      return { data: null, error: new Error(`Unknown RPC ${name}`) }
    }),
  }
  return {
    client: client as unknown as SupabaseClient<Database>,
    auth: client.auth,
    rpc: client.rpc,
    emit,
    session,
    resolvePendingGetSession: () => { pendingGetSessionReads.splice(0).forEach((resolve) => resolve()) },
    setAccess: (next: TrustedAccess | null) => { access = next },
  }
}
