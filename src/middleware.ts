/**
 * Root Next.js middleware — session refresh and route protection.
 *
 * Source: https://supabase.com/docs/guides/auth/server-side/nextjs
 *
 * Delegates to updateSession() which:
 * 1. Refreshes the Supabase session on every request
 * 2. Redirects unauthenticated users to /login
 *
 * Matcher config excludes static files and images to prevent unnecessary
 * auth checks on assets that don't require authentication.
 */
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
