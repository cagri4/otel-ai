/**
 * Server-side Supabase client for Server Components and Server Actions.
 *
 * Source: https://supabase.com/docs/guides/auth/server-side/nextjs
 * Pattern 5 from: .planning/phases/01-foundation/01-RESEARCH.md
 *
 * Anti-patterns avoided:
 * - NOT using @supabase/auth-helpers-nextjs (deprecated)
 * - NOT calling getSession() — use getUser() for auth checks
 * - NOT creating a singleton — each call creates a new client
 *
 * Note: setAll has a try/catch because Server Components cannot set cookies.
 * The try/catch prevents crashes while allowing middleware to handle cookie refresh.
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components cannot set cookies; ignore.
            // The middleware will refresh the session and set the cookies.
          }
        },
      },
    }
  )
}
