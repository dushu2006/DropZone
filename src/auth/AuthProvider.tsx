import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/database.types'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error'

type AuthContextValue = {
  client: SupabaseClient<Database>
  session: Session | null
  status: AuthStatus
  error: string | null
  recoveryRequired: boolean
  retrySession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function sessionErrorMessage(error: unknown) {
  if (error instanceof Error && /network|fetch|timeout|connection/i.test(error.message)) {
    return 'DropZone could not reach Supabase to restore your session. Check your connection and retry.'
  }
  return 'DropZone could not restore your authentication session. Retry, or sign in again if your session has expired.'
}

export function AuthProvider({ client, children }: { client: SupabaseClient<Database>; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const authEventVersion = useRef(0)
  const sessionReadVersion = useRef(0)

  const retrySession = useCallback(async () => {
    const requestVersion = ++sessionReadVersion.current
    const startingAuthEventVersion = authEventVersion.current
    setStatus('loading')
    setError(null)
    try {
      const { data, error: sessionError } = await client.auth.getSession()
      if (requestVersion !== sessionReadVersion.current || startingAuthEventVersion !== authEventVersion.current) return
      if (sessionError) throw sessionError
      setSession(data.session)
      setStatus(data.session ? 'authenticated' : 'anonymous')
      if (!data.session) setRecoveryRequired(false)
    } catch (caught) {
      if (requestVersion !== sessionReadVersion.current || startingAuthEventVersion !== authEventVersion.current) return
      setSession(null)
      setStatus('error')
      setError(sessionErrorMessage(caught))
    }
  }, [client])

  useEffect(() => {
    let mounted = true
    const requestVersion = ++sessionReadVersion.current
    const startingAuthEventVersion = authEventVersion.current
    const onAuthChange = (event: AuthChangeEvent, nextSession: Session | null) => {
      if (!mounted) return
      if (event === 'INITIAL_SESSION') {
        if (authEventVersion.current !== startingAuthEventVersion) return
        if (nextSession) {
          setSession(nextSession)
          setStatus('authenticated')
          setError(null)
        }
        return
      }

      authEventVersion.current += 1
      sessionReadVersion.current += 1
      setSession(nextSession)
      setStatus(nextSession ? 'authenticated' : 'anonymous')
      setError(null)
      if (event === 'PASSWORD_RECOVERY') setRecoveryRequired(true)
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') setRecoveryRequired(false)
    }

    const { data: { subscription } } = client.auth.onAuthStateChange(onAuthChange)
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted || requestVersion !== sessionReadVersion.current || startingAuthEventVersion !== authEventVersion.current) return
      if (sessionError) {
        setSession(null)
        setStatus('error')
        setError(sessionErrorMessage(sessionError))
        return
      }
      setSession(data.session)
      setStatus(data.session ? 'authenticated' : 'anonymous')
      setError(null)
    }).catch((caught: unknown) => {
      if (!mounted || requestVersion !== sessionReadVersion.current || startingAuthEventVersion !== authEventVersion.current) return
      setSession(null)
      setStatus('error')
      setError(sessionErrorMessage(caught))
    })

    return () => {
      mounted = false
      sessionReadVersion.current += 1
      subscription.unsubscribe()
    }
  }, [client])

  const value = useMemo(() => ({ client, session, status, error, recoveryRequired, retrySession }), [client, session, status, error, recoveryRequired, retrySession])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be rendered inside AuthProvider.')
  return context
}
