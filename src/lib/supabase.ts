import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
type Config = { url: string; publishableKey: string };
export function validateSupabaseConfig(env: {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}): { ok: true; config: Config } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  const url = env.VITE_SUPABASE_URL?.trim(),
    key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key)
    return fail("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
  try {
    const parsed = new URL(url);
    if (
      /your_|placeholder/i.test(url + key) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/" ||
      (parsed.protocol !== "https:" &&
        !(
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
        ))
    )
      return fail(
        "Use a valid HTTPS Supabase project URL (HTTP is allowed only for local development).",
      );
    if (key.startsWith("sb_secret_"))
      return fail("Never use privileged secret keys in the browser.");
    if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))
        return fail("Use a publishable key or legacy anon JWT.");
      const role = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ).role;
      if (role !== "anon")
        return fail("Privileged keys are forbidden; use the anon key.");
    }
    return { ok: true, config: { url: parsed.origin, publishableKey: key } };
  } catch {
    return fail("The Supabase URL or browser-safe key is malformed.");
  }
}
export function createSupabaseClient(config: Config) {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      storageKey: "dropzone.auth.session",
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
    },
  });
}
const result = validateSupabaseConfig(import.meta.env);
export const supabaseClient = result.ok
  ? createSupabaseClient(result.config)
  : null;
export const supabaseConfigError = result.ok ? null : result.message;
