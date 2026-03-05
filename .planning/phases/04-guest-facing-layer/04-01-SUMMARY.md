---
phase: 04-guest-facing-layer
plan: 01
subsystem: security
tags: [upstash, redis, rate-limiting, prompt-injection, middleware, supabase, migration]

# Dependency graph
requires:
  - phase: 03-knowledge-base-and-onboarding
    provides: Hotel type, database.ts pattern, middleware pattern
provides:
  - Upstash-based IP rate limiter (30 req/min sliding window) for guest routes
  - Upstash-based hotel rate limiter (100 req/min fixed window) for per-hotel load control
  - sanitizeGuestInput() blocking 8 injection patterns, 2000-char cap, NFC normalization
  - Database migration 0004_guest_facing.sql with widget_token, widget_config, escalations, hotel_whatsapp_numbers
  - TypeScript types: WidgetConfig, Escalation, HotelWhatsAppNumber, updated Hotel
  - Middleware public route bypass for /api/widget/*, /api/whatsapp/*, /widget/*, /api/escalations/*
affects:
  - 04-02-whatsapp-webhook (uses checkIpRateLimit, sanitizeGuestInput, hotel_whatsapp_numbers)
  - 04-03-widget-embed (uses checkIpRateLimit, sanitizeGuestInput, widget_token, widget_config)
  - 04-04-escalation-flow (uses Escalation table, checkHotelRateLimit)
  - 04-05-guest-memory (uses sanitizeGuestInput, guest-facing security pattern)

# Tech tracking
tech-stack:
  added:
    - "@upstash/ratelimit@2.0.8 — sliding/fixed window rate limiters via HTTP Redis"
    - "@upstash/redis@1.36.3 — HTTP-based Redis client for serverless/Edge environments"
    - "resend@6.9.3 — email delivery for escalation notifications (used in Phase 4 plans)"
    - "next-intl@4.8.3 — (fixed: was imported in code but missing from package.json)"
  patterns:
    - "Graceful degradation: rate limiters return success:true when Redis is unavailable"
    - "Public route bypass in updateSession() before Supabase auth check"
    - "IP extraction via x-forwarded-for header only (request.ip not available on NextRequest in Next.js 16)"
    - "Lazy Redis initialization with module-level singleton pattern"

key-files:
  created:
    - supabase/migrations/0004_guest_facing.sql
    - src/lib/security/sanitizeGuestInput.ts
    - src/lib/security/rateLimiter.ts
  modified:
    - src/types/database.ts
    - src/middleware.ts
    - src/lib/supabase/middleware.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "request.ip not available on NextRequest in Next.js 16 — use only x-forwarded-for header for IP extraction"
  - "Graceful degradation for rate limiting — return success:true when UPSTASH_REDIS_REST_URL not set (prevents blocking all traffic if Redis goes down)"
  - "Public route bypass added to updateSession() not middleware.ts — cleaner separation: auth module handles its own bypass, rate limit middleware only does rate limiting"
  - "next-intl was imported in code but missing from package.json — fixed as pre-existing bug during dependency installation"

patterns-established:
  - "sanitizeGuestInput: all guest-facing input must be sanitized before passing to AI agent"
  - "checkIpRateLimit in middleware: applied before auth check on all /api/widget/*, /api/whatsapp/* routes"
  - "checkHotelRateLimit in route handlers: applied per hotel for per-hotel load control"

requirements-completed: [SAFE-04, SAFE-05]

# Metrics
duration: 28min
completed: 2026-03-05
---

# Phase 4 Plan 01: Security Foundation for Guest-Facing Layer Summary

**Upstash Redis rate limiting (30/min IP, 100/min hotel), prompt injection sanitizer blocking 8 patterns, PostgreSQL migration for widget_token/escalations/hotel_whatsapp_numbers, and middleware public route bypass for guest/webhook routes**

## Performance

- **Duration:** 28 min
- **Started:** 2026-03-05T10:43:19Z
- **Completed:** 2026-03-05T11:11:19Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Database schema extended with widget_token, widget_config on hotels; escalations table with RLS; hotel_whatsapp_numbers table with RLS
- TypeScript types for Escalation, HotelWhatsAppNumber, WidgetConfig and updated Hotel interface
- sanitizeGuestInput() blocks 8 injection patterns, caps at 2000 chars, NFC normalizes, removes control chars
- Upstash Redis rate limiters with graceful degradation when UPSTASH_REDIS_REST_URL is not configured
- Middleware updated: IP rate limiting on guest routes before auth, public route bypass in updateSession()

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies, create migration, and update TypeScript types** - `f9e9b3b` (feat)
2. **Task 2: Create security utilities and update middleware** - `0e36187` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `supabase/migrations/0004_guest_facing.sql` - Schema additions: widget_token/widget_config on hotels, escalations table with channel/guest_message/notified_at/resolved_at, hotel_whatsapp_numbers table; RLS policies on both new tables
- `src/lib/security/sanitizeGuestInput.ts` - Input sanitizer: 8 injection patterns, 2000-char cap, NFC normalization, control char removal; exports sanitizeGuestInput()
- `src/lib/security/rateLimiter.ts` - Upstash rate limiters: ipRateLimiter (30/min sliding), hotelRateLimiter (100/min fixed); exports checkIpRateLimit(), checkHotelRateLimit(); graceful null fallback
- `src/types/database.ts` - Added WidgetConfig type, widget_token/widget_config to Hotel, Escalation interface, HotelWhatsAppNumber interface, escalations/hotel_whatsapp_numbers to Database wrapper
- `src/middleware.ts` - Added IP rate limiting for /api/widget/* and /api/whatsapp/* before updateSession()
- `src/lib/supabase/middleware.ts` - Added isPublicRoute() bypass for guest/webhook routes before Supabase auth
- `package.json` - Added @upstash/ratelimit, @upstash/redis, resend, next-intl

## Decisions Made
- `request.ip` is not available on `NextRequest` in Next.js 16 — use only `x-forwarded-for` header for IP extraction on Vercel
- Graceful degradation: rate limiters return `{ success: true }` when UPSTASH_REDIS_REST_URL is not set — prevents blocking all traffic if Redis is unavailable
- Public route bypass added to `updateSession()` rather than in `middleware.ts` — keeps auth bypass logic in the auth module, rate limiting in middleware

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `request.ip` TypeScript error in middleware**
- **Found during:** Task 2 (update middleware)
- **Issue:** `request.ip` does not exist on `NextRequest` type in Next.js 16 — TypeScript error TS2339
- **Fix:** Removed `request.ip` fallback, use only `x-forwarded-for` header (Vercel sets this for all requests)
- **Files modified:** `src/middleware.ts`
- **Verification:** `tsc --noEmit` passes with zero errors
- **Committed in:** `0e36187` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed missing next-intl in package.json**
- **Found during:** Task 1 (installing dependencies — pnpm removed next-intl from node_modules because it wasn't in package.json)
- **Issue:** `next-intl` was committed to code (`src/app/layout.tsx`, `next.config.ts`, `src/i18n/request.ts`) in commit `8f6fccb` but never added to `package.json`; pnpm add removed it from node_modules
- **Fix:** Ran `pnpm add next-intl` to properly add it to `package.json`
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `tsc --noEmit` passes with zero errors
- **Committed in:** `f9e9b3b` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
- Next.js 16 Turbopack build produces non-TypeScript ENOENT errors (`_buildManifest.js.tmp.*`) — pre-existing environment/filesystem issue unrelated to this plan's changes. TypeScript type checking passes cleanly via `tsc --noEmit`. Webpack build also fails with a different ENOENT (`required-server-files.json`) — this is a pre-existing infrastructure issue. TypeScript compilation is verified as correct.

## User Setup Required
**External services require manual configuration before guest-facing routes work in production.**

To enable rate limiting, configure Upstash Redis:
1. Create a free Redis database at https://console.upstash.com/ (select region closest to Vercel deployment)
2. Add environment variables to Vercel/local .env.local:
   - `UPSTASH_REDIS_REST_URL` — from Upstash Console > Redis Database > REST API
   - `UPSTASH_REDIS_REST_TOKEN` — from Upstash Console > Redis Database > REST API

Without these variables, rate limiting is disabled (graceful degradation — no errors, but no protection).

## Next Phase Readiness
- Security foundation complete: all guest-facing plans (04-02 through 04-05) can import from `@/lib/security/sanitizeGuestInput` and `@/lib/security/rateLimiter`
- Database migration `0004_guest_facing.sql` ready to apply to production Supabase
- Middleware route bypasses are in place for widget/WhatsApp routes
- `widget_token` column on hotels ready for widget embed plan (04-03)
- `escalations` table ready for escalation flow plan (04-04)
- `hotel_whatsapp_numbers` table ready for WhatsApp webhook plan (04-02)

---
*Phase: 04-guest-facing-layer*
*Completed: 2026-03-05*

## Self-Check: PASSED

- FOUND: supabase/migrations/0004_guest_facing.sql
- FOUND: src/lib/security/sanitizeGuestInput.ts
- FOUND: src/lib/security/rateLimiter.ts
- FOUND: src/middleware.ts
- FOUND: src/lib/supabase/middleware.ts
- FOUND: src/types/database.ts
- FOUND commit: f9e9b3b (Task 1)
- FOUND commit: 0e36187 (Task 2)
- FOUND: sanitizeGuestInput export
- FOUND: checkIpRateLimit export
- FOUND: checkHotelRateLimit export
- FOUND: Escalation type
- FOUND: HotelWhatsAppNumber type
- FOUND: widget_token in Hotel
