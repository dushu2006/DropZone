import { describe, expect, it } from 'vitest'
import { createSupabaseClient, validateSupabaseConfig } from '../src/lib/supabase'

const publishable = `sb_publishable_${'x'.repeat(35)}`
const projectUrl = 'https://dropzone-example.supabase.co'

function jwtForRole(role: string) {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.${'x'.repeat(43)}`
}

describe('Supabase startup configuration', () => {
  it('fails clearly when either required setting is missing', () => {
    const result = validateSupabaseConfig({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('VITE_SUPABASE_URL')
      expect(result.message).toContain('VITE_SUPABASE_PUBLISHABLE_KEY')
    }
  })

  it('rejects placeholders and malformed project URLs', () => {
    expect(validateSupabaseConfig({ VITE_SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: publishable }).ok).toBe(false)
    expect(validateSupabaseConfig({ VITE_SUPABASE_URL: 'not-a-url', VITE_SUPABASE_PUBLISHABLE_KEY: publishable }).ok).toBe(false)
    expect(validateSupabaseConfig({ VITE_SUPABASE_URL: projectUrl, VITE_SUPABASE_PUBLISHABLE_KEY: 'YOUR_SUPABASE_PUBLISHABLE_KEY' }).ok).toBe(false)
    expect(validateSupabaseConfig({ VITE_SUPABASE_URL: projectUrl, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'x'.repeat(35)}!` }).ok).toBe(false)
    expect(validateSupabaseConfig({ VITE_SUPABASE_URL: projectUrl, VITE_SUPABASE_PUBLISHABLE_KEY: `header.${'x'.repeat(40)}.${'x'.repeat(43)}` }).ok).toBe(false)
  })

  it('refuses a service-role/secret key even if placed in the public variable', () => {
    expect(validateSupabaseConfig({ VITE_SUPABASE_URL: projectUrl, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_secret_${'x'.repeat(35)}` }).ok).toBe(false)
    const serviceRole = validateSupabaseConfig({ VITE_SUPABASE_URL: projectUrl, VITE_SUPABASE_PUBLISHABLE_KEY: jwtForRole('service_role') })
    expect(serviceRole.ok).toBe(false)
    if (!serviceRole.ok) expect(serviceRole.message).toMatch(/privileged|secret/i)
  })

  it('accepts a browser-safe publishable key or a legacy anon JWT', () => {
    const modern = validateSupabaseConfig({ VITE_SUPABASE_URL: `${projectUrl}/`, VITE_SUPABASE_PUBLISHABLE_KEY: publishable })
    expect(modern).toEqual({ ok: true, config: { url: projectUrl, publishableKey: publishable } })
    expect(validateSupabaseConfig({ VITE_SUPABASE_URL: 'http://dropzone-example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: publishable }).ok).toBe(false)
    expect(validateSupabaseConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: publishable }).ok).toBe(true)
    const legacy = validateSupabaseConfig({ VITE_SUPABASE_URL: projectUrl, VITE_SUPABASE_PUBLISHABLE_KEY: jwtForRole('anon') })
    expect(legacy.ok).toBe(true)
  })

  it('configures persistent PKCE sessions and automatic refresh for browser tabs', async () => {
    const client = createSupabaseClient({ url: 'http://127.0.0.1:54321', publishableKey: publishable })
    const auth = client.auth as unknown as {
      storageKey: string
      flowType: string
      persistSession: boolean
      autoRefreshToken: boolean
      detectSessionInUrl: boolean
      storage: Storage
    }
    expect(auth.storageKey).toBe('dropzone.auth.session')
    expect(auth.flowType).toBe('pkce')
    expect(auth.persistSession).toBe(true)
    expect(auth.autoRefreshToken).toBe(true)
    expect(auth.detectSessionInUrl).toBe(true)
    expect(auth.storage).toBe(window.localStorage)
    await client.auth.dispose()
  })
})
