/**
 * Browser-side Supabase client for Client Components.
 *
 * Source: https://supabase.com/docs/guides/auth/server-side/creating-a-client
 * Pattern: https://supabase.com/docs/guides/auth/server-side/nextjs
 *
 * IMPORTANT: Do NOT create a singleton — each call creates a new client.
 * This is required by @supabase/ssr to properly handle cookie updates.
 *
 * Anti-patterns avoided:
 * - NOT using @supabase/auth-helpers-nextjs (deprecated)
 * - NOT creating a module-level singleton
 */
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
