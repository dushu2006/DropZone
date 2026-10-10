/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_MAP_TILE_URL?: string
  readonly VITE_MAP_ATTRIBUTION?: string
  readonly VITE_ENABLE_DEMO_PREVIEW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv & {
    readonly DEV: boolean
    readonly PROD: boolean
  }
}
