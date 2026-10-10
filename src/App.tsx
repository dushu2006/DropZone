import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react'
import { LandingContent, AuthBootstrapError, AuthCallbackPage, AuthLoading, LoginPage, PublicLanding, RecoveryPage, RegisterPage, ResetPasswordPage } from './auth/AuthPages'
import { AccountSettings, PrivacyNotice } from './auth/Account'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { AccessProvider } from './phase1/AccessProvider'
import { AccessHome, EventWorkspace, JoinEventPage } from './phase1/Workspaces'
import { supabaseClient, supabaseConfigError } from './lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './lib/database.types'

const developmentPreviewEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_PREVIEW === 'true'
const DevelopmentPreview = developmentPreviewEnabled ? lazy(() => import('./PrototypePreview')) : null

export function AppRoutes({
  client,
  allowDevelopmentPreview = false,
}: {
  client: SupabaseClient<Database>
  allowDevelopmentPreview?: boolean
}) {
  return <AuthProvider client={client}><Routes>
    <Route path="/" element={<PublicLanding />} />
    <Route path="/privacy" element={<PrivacyNotice />} />
    <Route path="/app/account" element={<PrivatePage client={client}><AccountSettings /></PrivatePage>} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/recovery" element={<RecoveryPage />} />
    <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
    <Route path="/auth/callback" element={<AuthCallbackPage />} />
    <Route path="/app" element={<PrivatePage client={client}><AccessHome /></PrivatePage>} />
    <Route path="/app/join" element={<PrivatePage client={client}><JoinEventPage /></PrivatePage>} />
    <Route path="/app/events/:eventId/:workspace" element={<PrivatePage client={client}><EventWorkspace /></PrivatePage>} />
    <Route path="/app/*" element={<PrivatePage client={client}><AccessHome /></PrivatePage>} />
    <Route path="/development-preview" element={allowDevelopmentPreview && DevelopmentPreview
      ? <Suspense fallback={<AuthLoading message="Loading isolated development preview…" />}><DevelopmentPreview /></Suspense>
      : <Navigate to="/" replace />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></AuthProvider>
}

function PrivatePage({ client, children }: { client: SupabaseClient<Database>; children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <AuthLoading message="Restoring your secure session…" />
  if (status === 'error') return <AuthBootstrapError />
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <AccessProvider client={client}>{children}</AccessProvider>
}

export function MissingConfigurationPage({ message }: { message: string }) {
  return <main className="auth-page auth-status-page"><Link className="auth-brand" to="/"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>DropZone<span className="brand-period">.</span></span></Link><section className="auth-card config-card">
    <span className="auth-status-icon config-icon"><AlertCircle size={21} /></span><span className="auth-eyebrow">AUTHENTICATION NOT CONFIGURED</span><h1>Connect a Supabase project</h1><p>{message}</p><div className="config-instructions"><strong>Required browser-safe settings</strong><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code><small>Set these in <code>.env.local</code> and restart Vite. Use the project URL and publishable/legacy anon key from Supabase Project Settings → API / API Keys. Never use a service-role or secret key in the browser.</small></div><Link className="auth-help-link" to="/">Configuration errors do not fall back to demo login or sample accounts.</Link>
  </section></main>
}

function NotFoundPage() {
  return <main className="auth-page auth-status-page"><section className="auth-card"><span className="auth-status-icon"><ShieldCheck size={21} /></span><h1>Page not found</h1><p>This address does not match a DropZone page.</p><Link className="primary-button auth-link-button" to="/">Go to DropZone home <ArrowRight size={16} /></Link></section></main>
}

export default function App() {
  if (!supabaseClient || supabaseConfigError) {
    return <BrowserRouter><Routes><Route path="/" element={<LandingContent />} /><Route path="/privacy" element={<PrivacyNotice />} /><Route path="*" element={<MissingConfigurationPage message={supabaseConfigError ?? 'Supabase configuration is not available.'} />} /></Routes></BrowserRouter>
  }
  return <BrowserRouter><AppRoutes client={supabaseClient} allowDevelopmentPreview={developmentPreviewEnabled} /></BrowserRouter>
}

