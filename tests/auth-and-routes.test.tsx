import { MemoryRouter } from 'react-router-dom'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes } from '../src/App'
import { AuthProvider, useAuth } from '../src/auth/AuthProvider'
import { createFakeSupabase, makeAccess, makeSession, TEST_EVENT_ID, TEST_USER_ID } from './fakeSupabase'

function renderRoutes(path: string, fake = createFakeSupabase()) {
  render(<MemoryRouter initialEntries={[path]}><AppRoutes client={fake.client} /></MemoryRouter>)
  return fake
}

function AuthStatusProbe() {
  const { session, status } = useAuth()
  return <output>{status}:{session?.user.email ?? 'anonymous'}</output>
}

afterEach(() => {
  localStorage.clear()
})

describe('Supabase authentication lifecycle', () => {
  it('opens publicly without creating a session or auto-logging in', async () => {
    const fake = createFakeSupabase()
    renderRoutes('/', fake)
    expect(await screen.findByRole('heading', { name: /find your people/i })).toBeTruthy()
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled()
    expect(fake.auth.signUp).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy()
  })

  it('registers through Supabase Auth and asks the user to confirm email when no session is issued', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase({ signUpSession: false })
    renderRoutes('/register', fake)
    await user.type(await screen.findByLabelText('Name'), 'A Real Member')
    await user.type(screen.getByLabelText('Email'), 'member@example.test')
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/check your email for a confirmation link/i)).toBeTruthy()
    expect(fake.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'member@example.test',
      password: 'correct horse battery staple',
      options: expect.objectContaining({
        data: { display_name: 'A Real Member' },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      }),
    }))
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('registers through Supabase Auth with email confirmation disabled and immediately enters the application', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase({ signUpSession: true })
    renderRoutes('/register', fake)
    await user.type(await screen.findByLabelText('Name'), 'Immediate Member')
    await user.type(screen.getByLabelText('Email'), 'immediate@example.test')
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByRole('heading', { name: 'Welcome to DropZone' })).toBeTruthy()
    expect(screen.queryByText(/check your email for a confirmation link/i)).toBeNull()
    expect(fake.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'immediate@example.test',
      password: 'correct horse battery staple',
    }))
  })

  it('reports a registration error honestly without entering a private route', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase({ signUpError: new Error('User already registered') })
    renderRoutes('/register', fake)
    await user.type(await screen.findByLabelText('Name'), 'Duplicate Member')
    await user.type(screen.getByLabelText('Email'), 'duplicate@example.test')
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('User already registered')
    expect(screen.queryByRole('heading', { name: 'Join an event' })).toBeNull()
  })

  it('logs in through Supabase Auth and restores private routing from the returned session', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase({ access: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: 'Member', memberships: [] } })
    renderRoutes('/login', fake)
    await user.type(await screen.findByLabelText('Email'), 'member@example.test')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: /^log in/i }))
    expect(await screen.findByRole('heading', { name: 'Welcome to DropZone' })).toBeTruthy()
    expect(fake.auth.signInWithPassword).toHaveBeenCalledOnce()
    expect(fake.rpc).toHaveBeenCalledWith('get_my_access')
  })

  it('restores an existing Supabase session after a fresh app mount', async () => {
    const session = makeSession()
    const fake = createFakeSupabase({ initialSession: session })
    render(<AuthProvider client={fake.client}><AuthStatusProbe /></AuthProvider>)
    expect(await screen.findByText(`authenticated:${session.user.email}`)).toBeTruthy()
    expect(fake.auth.getSession).toHaveBeenCalled()
  })

  it('keeps an expired or externally signed-out session locked even if an older restore request finishes later', async () => {
    const fake = createFakeSupabase({ initialSession: makeSession(), access: makeAccess('participant'), deferSessionRead: true })
    renderRoutes(`/app/events/${TEST_EVENT_ID}/participant`, fake)
    expect(await screen.findByText(/your event membership is verified/i)).toBeTruthy()

    act(() => fake.emit('SIGNED_OUT', null))
    expect(await screen.findByRole('heading', { name: /log in to dropzone/i })).toBeTruthy()
    await act(async () => {
      fake.resolvePendingGetSession()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(screen.getByRole('heading', { name: /log in to dropzone/i })).toBeTruthy()
    expect(screen.queryByText(/your event membership is verified/i)).toBeNull()
  })

  it('reports invalid credentials without entering a private route', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase({ signInError: Object.assign(new Error('Invalid login credentials'), { status: 400 }) })
    renderRoutes('/login', fake)
    await user.type(await screen.findByLabelText('Email'), 'member@example.test')
    await user.type(screen.getByLabelText('Password'), 'wrong password')
    await user.click(screen.getByRole('button', { name: /^log in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password was not recognized.')
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('requests password recovery through Supabase Auth', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase()
    renderRoutes('/recovery', fake)
    await user.type(await screen.findByLabelText('Email'), 'member@example.test')
    await user.click(screen.getByRole('button', { name: /send recovery link/i }))
    expect(await screen.findByText(/if an account matches that address/i)).toBeTruthy()
    expect(fake.auth.resetPasswordForEmail).toHaveBeenCalledWith('member@example.test', {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
  })

  it('updates a password only inside a Supabase recovery session', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase()
    renderRoutes('/auth/reset-password', fake)
    await waitFor(() => expect(fake.auth.onAuthStateChange).toHaveBeenCalled())
    fake.emit('PASSWORD_RECOVERY', makeSession())
    await user.type(await screen.findByLabelText('New password'), 'new correct horse battery staple')
    await user.type(screen.getByLabelText('Confirm password'), 'new correct horse battery staple')
    await user.click(screen.getByRole('button', { name: /update password/i }))
    await waitFor(() => expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'new correct horse battery staple' }))
  })

  it('does not expose password update for an expired or missing recovery session', async () => {
    const fake = createFakeSupabase()
    renderRoutes('/auth/reset-password', fake)
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeTruthy()
    expect(screen.queryByLabelText('New password')).toBeNull()
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })

  it('locks password update immediately when the recovery session expires', async () => {
    const fake = createFakeSupabase()
    renderRoutes('/auth/reset-password', fake)
    await waitFor(() => expect(fake.auth.onAuthStateChange).toHaveBeenCalled())
    fake.emit('PASSWORD_RECOVERY', makeSession())
    expect(await screen.findByLabelText('New password')).toBeTruthy()

    act(() => fake.emit('SIGNED_OUT', null))
    expect(screen.queryByLabelText('New password')).toBeNull()
    expect(await screen.findByLabelText('Email')).toBeTruthy()
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })

  it('logs out and clears the protected route using Supabase Auth', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase({ initialSession: makeSession(), access: makeAccess('participant') })
    renderRoutes(`/app/events/${TEST_EVENT_ID}/participant`, fake)
    expect(await screen.findByText(/your event membership is verified/i)).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: /log out/i }).at(-1)!)
    expect(await screen.findByRole('heading', { name: /find your people/i })).toBeTruthy()
    expect(screen.queryByText(/your event membership is verified/i)).toBeNull()
    expect(fake.auth.signOut).toHaveBeenCalledOnce()
  })

  it('shows retry guidance when session initialization fails due to a network error', async () => {
    const fake = createFakeSupabase({ sessionError: new Error('Network request failed') })
    renderRoutes('/', fake)
    expect(await screen.findByText(/could not reach supabase to restore your session/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry session check/i })).toBeTruthy()
  })

  it('restores an authenticated route session on browser refresh without redirecting to login', async () => {
    const session = makeSession()
    const fake = createFakeSupabase({ initialSession: session, access: { user_id: session.user.id, display_name: 'Member', memberships: [] } })
    renderRoutes('/app', fake)
    expect(await screen.findByRole('heading', { name: 'Welcome to DropZone' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /log in to dropzone/i })).toBeNull()
  })

  it('exchanges a valid callback code once and enters the application', async () => {
    const fake = createFakeSupabase()
    renderRoutes('/auth/callback?code=valid-pkce-code', fake)
    expect(await screen.findByRole('heading', { name: 'Welcome to DropZone' })).toBeTruthy()
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('valid-pkce-code')
  })

  it('handles expired or invalid callback errors and displays a clear message without looping', async () => {
    const fake = createFakeSupabase()
    renderRoutes('/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', fake)
    expect(await screen.findByRole('heading', { name: 'Link expired or invalid' })).toBeTruthy()
    expect(screen.getByText(/email link is invalid or has expired/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /back to log in/i })).toBeTruthy()
  })

  it('subscribes to onAuthStateChange once and cleans up on unmount', () => {
    const fake = createFakeSupabase()
    const { unmount } = render(<AuthProvider client={fake.client}><AuthStatusProbe /></AuthProvider>)
    expect(fake.auth.onAuthStateChange).toHaveBeenCalledOnce()
    const unsubscribe = (fake.auth.onAuthStateChange.mock.results[0].value as { data: { subscription: { unsubscribe: () => void } } }).data.subscription.unsubscribe
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('protected routes and trusted role resolution', () => {
  it('redirects an unauthenticated direct URL to a public login page', async () => {
    const fake = createFakeSupabase()
    renderRoutes(`/app/events/${TEST_EVENT_ID}/organizer`, fake)
    expect(await screen.findByRole('heading', { name: /log in to dropzone/i })).toBeTruthy()
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('does not trust a browser-stored organizer role for an unauthenticated user', async () => {
    localStorage.setItem('dropzone.role.v1', 'organizer')
    const fake = createFakeSupabase()
    renderRoutes(`/app/events/${TEST_EVENT_ID}/organizer`, fake)
    expect(await screen.findByRole('heading', { name: /log in to dropzone/i })).toBeTruthy()
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('denies a participant who opens an organizer URL directly', async () => {
    const fake = createFakeSupabase({ initialSession: makeSession(), access: makeAccess('participant') })
    renderRoutes(`/app/events/${TEST_EVENT_ID}/organizer`, fake)
    expect(await screen.findByRole('heading', { name: /this workspace is not assigned to your account/i })).toBeTruthy()
    expect(screen.queryByText(/organizer membership verified/i)).toBeNull()
  })

  it('does not display one account’s cached permissions after a different account signs in', async () => {
    const fake = createFakeSupabase({ initialSession: makeSession(), access: makeAccess('organizer', ['manage_members']) })
    renderRoutes(`/app/events/${TEST_EVENT_ID}/organizer`, fake)
    expect(await screen.findByText(/organizer membership verified for this event/i)).toBeTruthy()

    const secondAccount = makeSession('second@example.test')
    secondAccount.user.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    act(() => fake.emit('SIGNED_IN', secondAccount))
    expect(screen.queryByText(/organizer membership verified for this event/i)).toBeNull()
    expect(await screen.findByText(/your event access could not be verified/i)).toBeTruthy()
  })

  it('routes an organizer only from its event membership and shows explicit grants', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase({ initialSession: makeSession(), access: makeAccess('organizer', ['manage_members', 'review_reports']) })
    renderRoutes(`/app/events/${TEST_EVENT_ID}/organizer`, fake)
    expect(await screen.findByText(/organizer membership verified for this event/i)).toBeTruthy()
    expect(screen.getByText('review reports')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /create 7-day participant code/i }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledWith('create_event_invitation', expect.objectContaining({ p_event_id: TEST_EVENT_ID, p_token: expect.any(String) })))
    expect(await screen.findByLabelText(/one-time invitation code/i)).toBeTruthy()
  })

  it('does not auto-open a single membership when the user is signed in and should choose their event explicitly', async () => {
    const fake = createFakeSupabase({ initialSession: makeSession(), access: makeAccess('organizer', ['manage_event']) })
    renderRoutes('/app', fake)
    expect(await screen.findByRole('heading', { name: 'Welcome to DropZone' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /join an event/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /organize an event/i })).toBeTruthy()
    expect(screen.queryByText(/organizer membership verified for this event/i)).toBeNull()
  })

  it('offers a create-event form when a trusted organizer has permission to start a new event', async () => {
    const user = userEvent.setup()
    const access = {
      user_id: TEST_USER_ID,
      display_name: 'Test Member',
      memberships: [
        { event_id: TEST_EVENT_ID, event_name: 'Current Event', event_slug: 'current-event', role: 'organizer', permissions: ['manage_event'], status: 'active' },
        { event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', event_name: 'Second Event', event_slug: 'second-event', role: 'participant', permissions: [], status: 'active' },
      ],
    }
    const fake = createFakeSupabase({ initialSession: makeSession(), access })
    renderRoutes('/app', fake)
    expect(await screen.findByRole('heading', { name: 'Welcome to DropZone' })).toBeTruthy()
    await user.type(await screen.findByLabelText('Event name'), 'Launch Weekend')
    await user.type(screen.getByLabelText('Unique event slug'), 'launch-weekend')
    await user.click(screen.getByRole('button', { name: /^create event$/i }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledWith('dz_command', expect.objectContaining({
      p_event: TEST_EVENT_ID,
      p_action: 'event.create',
      p_data: expect.objectContaining({ name: 'Launch Weekend', slug: 'launch-weekend' }),
    })))
  })

  it('shows only assigned moderator permissions and does not infer organizer rights', async () => {
    const fake = createFakeSupabase({ initialSession: makeSession(), access: makeAccess('moderator', ['review_reports']) })
    renderRoutes(`/app/events/${TEST_EVENT_ID}/moderator`, fake)
    expect(await screen.findByText(/moderator access is limited to assigned permissions/i)).toBeTruthy()
    expect(screen.getByText('review reports')).toBeTruthy()
    expect(screen.queryByText('remove content')).toBeNull()
    expect(screen.queryByText('manage zones')).toBeNull()
  })

  it('accepts an invitation through the database and opens the newly verified event membership', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase({ initialSession: makeSession() })
    const invitation = 'A'.repeat(43)
    renderRoutes('/app/join', fake)
    await user.type(await screen.findByLabelText('Invitation code'), invitation)
    await user.click(screen.getByRole('button', { name: /join event/i }))
    expect(await screen.findByRole('heading', { name: 'Test Event' })).toBeTruthy()
    expect(fake.rpc).toHaveBeenCalledWith('accept_event_invitation', { p_token: invitation })
    expect(fake.rpc).toHaveBeenCalledWith('get_my_access')
    expect(screen.getByText(/your event membership is verified/i)).toBeTruthy()
  })

  it('requires a real active membership before rendering an event route', async () => {
    const fake = createFakeSupabase({ initialSession: makeSession(), access: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: 'Member', memberships: [] } })
    renderRoutes(`/app/events/${TEST_EVENT_ID}/participant`, fake)
    expect(await screen.findByText(/your account has no active membership for this event/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /return to your memberships/i })).toBeTruthy()
  })
})
