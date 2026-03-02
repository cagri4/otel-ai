/**
 * Session refresh middleware helper.
 *
 * Source: https://supabase.com/docs/guides/auth/server-side/nextjs
 * Pattern 4 from: .planning/phases/01-foundation/01-RESEARCH.md
 *
 * Responsibilities:
 * 1. Refresh the Supabase session on every request (updates cookie expiry)
 * 2. Redirect unauthenticated users away from protected routes
 *
 * Anti-patterns avoided:
 * - NOT using getSession() — getUser() validates the JWT server-side (secure)
 * - NOT using @supabase/auth-helpers-nextjs (deprecated)
 *
 * Protected routes: everything except /login, /signup, /auth/*
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Use getUser() not getSession() in server code.
  // getUser() makes a network call to validate the JWT against the Supabase auth server.
  // getSession() reads directly from the cookie without validation (insecure for route protection).
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Redirect unauthenticated users to /login for all protected routes.
  // Auth routes (/login, /signup, /auth/*) are always accessible.
  if (
    !user &&
    !pathname.startsWith('/login') &&
    !pathname.startsWith('/signup') &&
    !pathname.startsWith('/auth')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from login/signup to the dashboard.
  // Prevents logged-in users from seeing auth pages.
  if (
    user &&
    (pathname.startsWith('/login') || pathname.startsWith('/signup'))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
