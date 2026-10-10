import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TrustedAccess } from '../lib/database.types'
import { useAuth } from '../auth/AuthProvider'

export type AccessState = {
  access: TrustedAccess | null
  loading: boolean
  error: string | null
  refreshAccess: () => Promise<TrustedAccess | null>
}

const AccessContext = createContext<AccessState | null>(null)

function parseTrustedAccess(value: unknown): TrustedAccess | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.user_id !== 'string' || !Array.isArray(record.memberships)) return null
  const memberships = record.memberships.filter((item): item is TrustedAccess['memberships'][number] => {
    if (!item || typeof item !== 'object') return false
    const membership = item as Record<string, unknown>
    return typeof membership.event_id === 'string'
      && typeof membership.event_name === 'string'
      && typeof membership.event_slug === 'string'
      && ['participant', 'organizer', 'moderator'].includes(String(membership.role))
      && Array.isArray(membership.permissions)
      && membership.permissions.every((permission) => typeof permission === 'string')
      && membership.status === 'active'
  })
  return {
    user_id: record.user_id,
    display_name: typeof record.display_name === 'string' ? record.display_name : null,
    memberships,
  }
}

function accessErrorMessage(error: unknown) {
  if (error instanceof Error && /network|fetch|timeout|connection/i.test(error.message)) {
    return 'Could not load your event access from Supabase. Check your connection and retry.'
  }
  const pgError = error as { code?: string; message?: string }
  if (pgError?.code === 'PGRST202' || /get_my_access.*not find|schema cache/i.test(pgError?.message ?? '')) {
    return 'Database functions not found on this Supabase project (404 PGRST202). Please apply the database migrations in your Supabase SQL Editor.'
  }
  if (pgError?.code === 'P0001' || /profile.*not initialized/i.test(pgError?.message ?? '')) {
    return 'Your profile is not initialized yet. Please execute supabase/seed_event.sql in your Supabase SQL Editor to activate all features.'
  }
  return 'Your event access could not be verified. Private event pages remain locked; retry or contact an event administrator.'
}

export function AccessProvider({ client, children }: { client: SupabaseClient<Database>; children: ReactNode }) {
  const { session, status: authStatus } = useAuth()
  const [access, setAccess] = useState<TrustedAccess | null>(null)
  const [accessUserId, setAccessUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)

  const refreshAccess = useCallback(async (background = false) => {
    const requestVersionForCall = ++requestVersion.current
    const requestedUserId = session?.user.id
    if (!requestedUserId) {
      setAccess(null)
      setAccessUserId(null)
      setLoading(false)
      setError(null)
      return null
    }

    setAccessUserId(requestedUserId)
    if (!background) setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await client.rpc('get_my_access')
      if (rpcError) throw rpcError
      const parsed = parseTrustedAccess(data)
      if (!parsed || parsed.user_id !== requestedUserId) throw new Error('Invalid access response')
      if (requestVersionForCall !== requestVersion.current) return null
      setAccess(parsed)
      setLoading(false)
      return parsed
    } catch (caught) {
      if (requestVersionForCall !== requestVersion.current) return null
      setAccess(null)
      setLoading(false)
      setError(accessErrorMessage(caught))
      return null
    }
  }, [client, session?.user.id])

  useEffect(() => {
    if (authStatus === 'loading') {
      requestVersion.current += 1
      setLoading(true)
      return
    }
    if (authStatus !== 'authenticated' || !session?.user.id) {
      requestVersion.current += 1
      setAccess(null)
      setAccessUserId(null)
      setLoading(false)
      setError(null)
      return
    }
    void refreshAccess()
  }, [authStatus, session?.user.id, refreshAccess])

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void refreshAccess(true); };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('dropzone:access-invalidated', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('dropzone:access-invalidated', refresh); };
  }, [authStatus, refreshAccess]);

  const currentUserId = authStatus === 'authenticated' ? session?.user.id ?? null : null
  const accessIsForCurrentUser = currentUserId !== null && accessUserId === currentUserId
  const value = useMemo(() => ({
    access: accessIsForCurrentUser ? access : null,
    loading: authStatus === 'loading' || (authStatus === 'authenticated' && (!accessIsForCurrentUser || loading)),
    error: accessIsForCurrentUser ? error : null,
    refreshAccess,
  }), [access, accessIsForCurrentUser, authStatus, error, loading, refreshAccess])
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export function useAccess() {
  const context = useContext(AccessContext)
  if (!context) throw new Error('useAccess must be rendered inside AccessProvider.')
  return context
}
