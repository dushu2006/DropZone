import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { AuthError } from '@supabase/supabase-js'
import { useAuth } from './AuthProvider'

function describeAuthError(error: unknown) {
  if (error instanceof Error && /network|fetch|timeout|connection/i.test(error.message)) {
    return 'Could not reach the authentication service. Check your internet connection and try again.'
  }
  const authError = error as Partial<AuthError>
  if (authError.status === 400 && /invalid login credentials/i.test(authError.message ?? '')) {
    return 'The email or password was not recognized.'
  }
  if (authError.status === 429) return 'Too many attempts. Wait a little while and try again.'
  if (authError.status === 400 && /email not confirmed/i.test(authError.message ?? '')) {
    return 'Confirm your email before signing in, or disable email confirmation in your development Supabase project settings.'
  }
  if (/otp_expired|token.*expired|link.*expired/i.test(authError.message ?? '')) {
    return 'The authentication link has expired or is invalid. Request a new link or log in.'
  }
  return authError.message || 'Authentication could not be completed. Please try again.'
}

export function PublicLanding() {
  const { status } = useAuth()
  if (status === 'authenticated') return <Navigate to="/app" replace />
  if (status === 'loading') return <AuthLoading message="Restoring your secure session…" />
  if (status === 'error') return <AuthBootstrapError />
  return <LandingContent />
}

export function LandingContent() {
  return <main className="auth-page landing-page">
    <header className="auth-topbar"><DropZoneBrand /><nav><Link className="auth-nav-link" to="/login">Log in</Link><Link className="primary-button" to="/register">Create account <ArrowRight size={16} /></Link></nav></header>
    <section className="landing-hero">
      <div className="landing-copy">
        <span className="auth-eyebrow"><span /> EVENT COMMUNITIES, TOGETHER</span>
        <h1>Find your people.<br /><span>Make the moment easier.</span></h1>
        <p>DropZone helps verified event members connect, share what they need, and find the right people nearby.</p>
        <div className="landing-actions"><Link className="primary-button landing-primary" to="/login">Log in to DropZone <ArrowRight size={17} /></Link><Link className="landing-secondary" to="/register">Create an account</Link></div>
        <div className="landing-security-note"><LockKeyhole size={15} /><span>Private event spaces are available only to accounts with an active event membership.</span></div>
      </div>
      <div className="landing-visual" aria-label="DropZone overview cards">
        <div className="landing-card landing-card-top">
          <div className="mini-stat">
            <span>Live event</span>
            <strong>142 members</strong>
          </div>
          <div className="mini-stack" aria-hidden="true">
            <span className="avatar avatar-sm avatar-green">A</span>
            <span className="avatar avatar-sm avatar-violet">M</span>
            <span className="avatar avatar-sm avatar-amber">S</span>
          </div>
        </div>
        <div className="landing-card landing-card-mid">
          <span className="card-kicker">This week</span>
          <ul>
            <li>Quiet check-ins</li>
            <li>Map-linked prompts</li>
            <li>Staff review queues</li>
          </ul>
        </div>
        <div className="landing-card landing-card-bottom">
          <span className="status-pill"><span />Secure access</span>
          <strong>Verified only</strong>
        </div>
      </div>
    </section>
    <section className="landing-showcase" aria-label="How DropZone works">
      <article className="landing-feature">
        <span className="feature-icon">01</span>
        <h2>Private event access</h2>
        <p>Members enter only through verified memberships, so public browsing stays clear and trustworthy.</p>
      </article>
      <article className="landing-feature">
        <span className="feature-icon">02</span>
        <h2>Calm communication</h2>
        <p>Share updates, alerts, and handoffs in one clean stream without sensory overload.</p>
      </article>
      <article className="landing-feature">
        <span className="feature-icon">03</span>
        <h2>Operational clarity</h2>
        <p>Organizers can review requests, manage teams, and keep event context in one place.</p>
      </article>
    </section>
    <footer className="auth-footer">A calmer way to get things done, right where you are. <Link to="/privacy">Privacy notice</Link></footer>
  </main>
}

export function LoginPage() {
  const { client, status, retrySession } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (status === 'authenticated') return <Navigate to="/app" replace />
  if (status === 'loading') return <AuthLoading message="Restoring your secure session…" />

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { error: signInError } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) throw signInError
      await retrySession()
      navigate('/app', { replace: true })
    } catch (caught) {
      setError(describeAuthError(caught))
    } finally {
      setBusy(false)
    }
  }

  return <AuthFrame eyebrow="WELCOME BACK" title="Log in to DropZone" subtitle="Use the account associated with your event membership.">
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
      <label className="auth-field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Log in'} <ArrowRight size={16} /></button>
      <Link className="auth-help-link" to="/recovery">Forgot your password?</Link>
    </form>
    <p className="auth-switch">New to DropZone? <Link to="/register">Create an account</Link></p>
  </AuthFrame>
}

export function RegisterPage() {
  const { client, status, retrySession } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  if (status === 'authenticated') return <Navigate to="/app" replace />
  if (status === 'loading') return <AuthLoading message="Restoring your secure session…" />

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < 12) {
      setError('Use at least 12 characters for your password.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data, error: signUpError } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (signUpError) throw signUpError
      if (data.session) {
        await retrySession()
        navigate('/app', { replace: true })
      } else setNotice('Check your email for a confirmation link. You can log in after confirming your account.')
    } catch (caught) {
      setError(describeAuthError(caught))
    } finally {
      setBusy(false)
    }
  }

  return <AuthFrame eyebrow="CREATE YOUR ACCOUNT" title="A place to start" subtitle="Create an account first. An event invitation is required to enter private event spaces.">
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-field"><span>Name</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={80} /></label>
      <label className="auth-field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
      <label className="auth-field"><span>Password <small>At least 12 characters</small></span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="auth-success" role="status"><CheckCircle2 size={16} />{notice}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'} <ArrowRight size={16} /></button>
    </form>
    <p className="auth-switch">Already registered? <Link to="/login">Log in</Link></p>
  </AuthFrame>
}

export function RecoveryPage() {
  const { client } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: resetError } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      })
      if (resetError) throw resetError
      setNotice('If an account matches that address, Supabase will send a password reset link.')
    } catch (caught) {
      setError(describeAuthError(caught))
    } finally {
      setBusy(false)
    }
  }

  return <AuthFrame eyebrow="ACCOUNT RECOVERY" title="Reset your password" subtitle="Supabase will send a secure, time-limited recovery link if an account matches.">
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="auth-success" role="status"><CheckCircle2 size={16} />{notice}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send recovery link'} <ArrowRight size={16} /></button>
    </form>
  </AuthFrame>
}

export function ResetPasswordPage() {
  const { client, recoveryRequired, status, retrySession } = useAuth()
  const navigate = useNavigate()
  const [recoveryCheckComplete, setRecoveryCheckComplete] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (status === 'loading' || recoveryRequired) {
      setRecoveryCheckComplete(false)
      return
    }
    const timer = window.setTimeout(() => setRecoveryCheckComplete(true), 500)
    return () => window.clearTimeout(timer)
  }, [status, recoveryRequired])
  if (status === 'loading' || (!recoveryRequired && !recoveryCheckComplete)) return <AuthLoading message="Checking your recovery session…" />
  if (status === 'error') return <AuthBootstrapError />
  if (!recoveryRequired || status !== 'authenticated') return <Navigate to="/recovery" replace />

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < 12) { setError('Use at least 12 characters for your password.'); return }
    if (password !== confirmPassword) { setError('The passwords do not match.'); return }
    setBusy(true)
    setError('')
    try {
      const { error: updateError } = await client.auth.updateUser({ password })
      if (updateError) throw updateError
      await retrySession()
      navigate('/app', { replace: true })
    } catch (caught) {
      setError(describeAuthError(caught))
    } finally {
      setBusy(false)
    }
  }

  return <AuthFrame eyebrow="SECURE RECOVERY" title="Choose a new password" subtitle="Use a new password of at least 12 characters.">
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-field"><span>New password</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} /></label>
      <label className="auth-field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={12} /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'} <ArrowRight size={16} /></button>
    </form>
  </AuthFrame>
}

export function clearAuthUrlParams() {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const authParams = ['code', 'error', 'error_code', 'error_description', 'type']
    let modified = false
    for (const param of authParams) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param)
        modified = true
      }
    }
    if (url.hash) {
      url.hash = ''
      modified = true
    }
    if (modified) {
      const cleanPath = url.pathname + (url.search ? url.search : '')
      window.history.replaceState(window.history.state, '', cleanPath)
    }
  } catch {
    // Ignore in non-browser testing environments
  }
}

export function AuthCallbackPage() {
  const { client, status, error: authError, retrySession } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [callbackError, setCallbackError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(true)
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true
    let mounted = true

    const handleCallback = async () => {
      const searchStr = location.search || (typeof window !== 'undefined' ? window.location.search : '')
      const rawHash = location.hash || (typeof window !== 'undefined' ? window.location.hash : '')
      const hashStr = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash

      const searchParams = new URLSearchParams(searchStr)
      const hashParams = new URLSearchParams(hashStr)

      const error = searchParams.get('error') || hashParams.get('error')
      const errorDescription = searchParams.get('error_description') || hashParams.get('error_description')
      const errorCode = searchParams.get('error_code') || hashParams.get('error_code')

      if (error || errorDescription || errorCode) {
        clearAuthUrlParams()
        if (mounted) {
          setProcessing(false)
          setCallbackError(
            errorDescription
              ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
              : 'The authentication link could not be completed. Request a fresh link or sign in.'
          )
        }
        return
      }

      const code = searchParams.get('code')
      if (code && typeof client.auth.exchangeCodeForSession === 'function') {
        try {
          const { error: exchangeError } = await client.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            const { data: sessionData } = await client.auth.getSession()
            if (!sessionData.session) throw exchangeError
          }
          clearAuthUrlParams()
          await retrySession()
          if (mounted) {
            setProcessing(false)
            navigate('/app', { replace: true })
          }
          return
        } catch (caught) {
          clearAuthUrlParams()
          if (mounted) {
            setProcessing(false)
            setCallbackError(describeAuthError(caught))
          }
          return
        }
      }

      try {
        const { data: sessionData } = await client.auth.getSession()
        if (sessionData.session) {
          clearAuthUrlParams()
          await retrySession()
          if (mounted) {
            setProcessing(false)
            navigate('/app', { replace: true })
          }
          return
        }
      } catch {
        // Fall through
      }

      clearAuthUrlParams()
      if (mounted) {
        setProcessing(false)
      }
    }

    void handleCallback()

    return () => {
      mounted = false
    }
  }, [client, navigate, retrySession])

  useEffect(() => {
    if (status === 'authenticated') {
      clearAuthUrlParams()
      navigate('/app', { replace: true })
    }
  }, [status, navigate])

  if (status === 'authenticated') return <Navigate to="/app" replace />
  if (processing || status === 'loading') return <AuthLoading message="Completing secure sign-in…" />

  const displayError = callbackError ?? authError ?? 'The authentication link could not be completed. Request a fresh link or sign in.'

  return <AuthFrame eyebrow="SECURE SIGN-IN" title="Link expired or invalid" subtitle={displayError}>
    <Link className="primary-button auth-submit auth-link-button" to="/login">Back to log in <ArrowRight size={16} /></Link>
  </AuthFrame>
}

export function AuthBootstrapError() {
  const { error, retrySession } = useAuth()
  return <main className="auth-page auth-status-page"><DropZoneBrand /><section className="auth-card"><span className="auth-status-icon"><ShieldCheck size={21} /></span><h1>Session could not be restored</h1><p>{error ?? 'Check your connection and try again.'}</p><button className="secondary-button" type="button" onClick={() => void retrySession()}>Retry session check</button><Link className="auth-help-link" to="/login">Go to log in</Link></section></main>
}

export function AuthLoading({ message }: { message: string }) {
  return <main className="auth-page auth-status-page"><DropZoneBrand /><section className="auth-card" aria-live="polite"><span className="auth-spinner" /><p>{message}</p></section></main>
}

function AuthFrame({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children: ReactNode }) {
  return <main className="auth-page auth-form-page">
    <Link className="auth-back-link" to="/"><ArrowLeft size={15} /> DropZone home</Link>
    <div className="auth-split-layout">
      <aside className="auth-side-panel" aria-label="About DropZone">
        <DropZoneBrand />
        <span className="auth-eyebrow"><span /> Private event communities</span>
        <h2>Built for calmer coordination.</h2>
        <p>Give every attendee the right context, a clear path to help, and a secure place to stay connected.</p>
        <div className="auth-side-list">
          <div><strong>Verified access</strong><span>Only active event members can enter private spaces.</span></div>
          <div><strong>Clear updates</strong><span>Announcements, reminders, and pending tasks stay easy to scan.</span></div>
          <div><strong>Shared visibility</strong><span>Staff, participants, and moderators all work from the same event context.</span></div>
        </div>
      </aside>
      <section className="auth-card">
        <DropZoneBrand />
        <div className="auth-card-heading"><span className="auth-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{children}<div className="auth-card-security"><LockKeyhole size={14} /> Authentication is handled by Supabase Auth.</div>
      </section>
    </div>
  </main>
}

function DropZoneBrand() {
  return <Link className="auth-brand" to="/" aria-label="DropZone home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>DropZone<span className="brand-period">.</span></span></Link>
}
