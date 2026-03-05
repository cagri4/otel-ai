/**
 * Root Next.js middleware — rate limiting and session refresh.
 *
 * Source: https://supabase.com/docs/guides/auth/server-side/nextjs
 *
 * Execution order for guest-facing routes (/api/widget/*, /api/whatsapp/*):
 * 1. Extract client IP from x-forwarded-for header (set by Vercel/proxy)
 * 2. Check IP rate limit via Upstash Redis (30 req/min sliding window)
 * 3. Return 429 if rate limit exceeded
 * 4. Otherwise pass through to route handler (updateSession skips auth for public routes)
 *
 * Execution order for all other routes:
 * 1. Delegate to updateSession() which refreshes Supabase session and enforces auth
 *
 * Rate limiting gracefully degrades: if UPSTASH_REDIS_REST_URL is not set,
 * checkIpRateLimit() returns { success: true } and all requests pass through.
 *
 * Matcher config excludes static files and images to prevent unnecessary
 * auth checks on assets that don't require authentication.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { checkIpRateLimit } from '@/lib/security/rateLimiter'

// Routes that receive IP rate limiting before any auth check.
// These are guest-facing routes where unauthenticated guests make requests.
const RATE_LIMITED_PREFIXES = ['/api/widget', '/api/whatsapp'];

function isRateLimitedRoute(pathname: string): boolean {
  return RATE_LIMITED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Apply IP rate limiting on guest-facing API routes before session handling.
  if (isRateLimitedRoute(pathname)) {
    // Extract real client IP (Vercel sets x-forwarded-for for all requests)
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      '127.0.0.1';

    const { success } = await checkIpRateLimit(ip);

    if (!success) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': '60',
          'Content-Type': 'text/plain',
        },
      });
    }
  }

  // All other routes — refresh Supabase session and enforce auth.
  // updateSession() also handles the auth bypass for /api/widget/*, /widget/*, etc.
  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
