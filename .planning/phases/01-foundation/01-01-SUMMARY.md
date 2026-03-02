---
phase: 01-foundation
plan: 01
subsystem: database
tags: [supabase, postgresql, rls, jwt, typescript, nextjs, tailwindcss, shadcn, date-fns, timezone]

# Dependency graph
requires: []
provides:
  - "Next.js 16 project with TypeScript, Tailwind CSS 4, ESLint, App Router, shadcn/ui components"
  - "Supabase multi-tenant schema: hotels table, profiles table, RLS policies (x4), idx_profiles_hotel_id index"
  - "PostgreSQL signup trigger (handle_new_user): atomically creates hotel + profile on auth.users INSERT"
  - "Custom Access Token Hook (custom_access_token_hook): injects hotel_id into JWT for zero-subquery RLS"
  - "Browser Supabase client (createBrowserClient from @supabase/ssr)"
  - "Server Supabase client (createServerClient with Next.js 15+ async cookies())"
  - "Session refresh middleware (updateSession using getUser() not getSession())"
  - "Timezone display helper (formatInHotelTz using @date-fns/tz TZDate)"
  - "TypeScript types: Hotel, Profile, Database interfaces"
affects: [02-auth, 03-hotel-config, all-phases]

# Tech tracking
tech-stack:
  added:
    - "next@16.1.6 — App Router, Server Components, Server Actions"
    - "@supabase/supabase-js@2.98.0 — Supabase client"
    - "@supabase/ssr@0.8.0 — Cookie-based auth for Next.js App Router"
    - "react-hook-form@7.71.2 — form state management"
    - "@hookform/resolvers@5.2.2 — Zod resolver bridge"
    - "zod@4.3.6 — schema validation"
    - "react-timezone-select@3.3.2 — IANA timezone picker with react-select"
    - "date-fns@4.1.0 — date formatting"
    - "@date-fns/tz@1.4.1 — first-class timezone support via TZDate"
    - "shadcn/ui — form, input, button, card, label, textarea components"
    - "tailwindcss@4.2.1 — utility-first CSS with v4 CSS variable system"
  patterns:
    - "@supabase/ssr pattern — cookie-based auth, NOT auth-helpers-nextjs (deprecated)"
    - "getUser() in middleware — NOT getSession() (insecure in server context)"
    - "RLS policy caching — (SELECT auth.jwt()) wrapping prevents per-row JWT parse"
    - "JWT hotel_id claim — Custom Access Token Hook for zero-subquery tenant isolation"
    - "Atomic signup — PostgreSQL trigger creates hotel + profile on auth.users INSERT"
    - "IANA timezone storage — store 'Europe/Istanbul' not '+03:00' offset"
    - "UTC timestamptz storage — all timestamps UTC; display-layer conversion via TZDate"

key-files:
  created:
    - "supabase/migrations/0001_foundation.sql — complete schema, RLS, trigger, hook, indexes"
    - "src/types/database.ts — Hotel, Profile, Database TypeScript interfaces"
    - "src/lib/supabase/client.ts — browser Supabase client"
    - "src/lib/supabase/server.ts — async server Supabase client"
    - "src/lib/supabase/middleware.ts — updateSession session refresh helper"
    - "src/middleware.ts — root middleware with route protection"
    - "src/lib/timezone.ts — formatInHotelTz UTC-to-hotel-local converter"
    - "src/app/layout.tsx — Next.js root layout"
    - "src/app/globals.css — Tailwind CSS 4 + shadcn CSS variables"
    - "package.json — project with all Phase 1 dependencies"
    - ".gitignore — excludes node_modules, .next, .env.local"
    - "components.json — shadcn/ui config"
  modified: []

key-decisions:
  - "Used NEXT_PUBLIC_SUPABASE_ANON_KEY (not publishable key) — project created before new key format; consistent with plan instruction"
  - "Used direct node_modules CSS paths in globals.css — Turbopack does not support CSS package exports with 'style' condition; webpack does but next build uses Turbopack in Next.js 16"
  - "Initialized Next.js manually (not via create-next-app) — existing .planning/.claude directories conflicted with create-next-app safety check"
  - "Explicit if/else type narrowing for TZDate(string|Date) — TypeScript strict mode requires explicit overload selection for union types"

patterns-established:
  - "Supabase client pattern: createBrowserClient for client components, async createServerClient for server components/actions"
  - "RLS policy pattern: (SELECT auth.jwt()) caching + hotel_id from JWT top-level claim"
  - "Multi-tenant table pattern: hotel_id FK + idx_{table}_hotel_id index + RLS USING hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid"
  - "Timestamp pattern: always timestamptz, display via formatInHotelTz with hotel.timezone IANA string"

requirements-completed: [FOUND-01, FOUND-03]

# Metrics
duration: 16min
completed: 2026-03-02
---

# Phase 1 Plan 01: Foundation — Multi-tenant Supabase Schema and Next.js Bootstrap Summary

**Next.js 16 project bootstrapped with Supabase multi-tenant schema (hotels/profiles, RLS via JWT hotel_id claims, atomic signup trigger, Custom Access Token Hook) and timezone display utility using @date-fns/tz TZDate**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-02T08:38:57Z
- **Completed:** 2026-03-02T08:55:29Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- Full Next.js 16 project initialized with TypeScript, Tailwind CSS 4, ESLint, App Router, shadcn/ui (form/input/button/card/label/textarea components)
- SQL migration (`0001_foundation.sql`) containing complete multi-tenant schema ready to run in Supabase SQL editor: hotels table, profiles table, 4 RLS policies, signup trigger, Custom Access Token Hook, updated_at trigger, performance index
- Supabase client utilities following official @supabase/ssr patterns: browser client, async server client, middleware session refresh with `getUser()` route protection
- Timezone display utility `formatInHotelTz` wrapping @date-fns/tz TZDate for correct DST-aware UTC-to-hotel-local conversion

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize Next.js project, install dependencies, create SQL migration** - `813c3aa` (feat)
2. **Task 2: Create Supabase client utilities and timezone helper** - `ba3584d` (feat)

## Files Created/Modified
- `supabase/migrations/0001_foundation.sql` — Complete Supabase schema: hotels table, profiles table, RLS policies (x4), handle_new_user trigger, custom_access_token_hook, set_updated_at trigger, idx_profiles_hotel_id index
- `src/types/database.ts` — Hotel and Profile TypeScript interfaces; Database wrapper type for typed Supabase client
- `src/lib/supabase/client.ts` — Browser Supabase client using createBrowserClient from @supabase/ssr
- `src/lib/supabase/server.ts` — Async server Supabase client with Next.js 15+ cookies() pattern; setAll try/catch for Server Components
- `src/lib/supabase/middleware.ts` — updateSession() using getUser() (not getSession) with unauthenticated redirect to /login
- `src/middleware.ts` — Root Next.js middleware with correct static asset exclusion matcher
- `src/lib/timezone.ts` — formatInHotelTz() with TZDate for UTC-to-hotel-local timezone conversion
- `src/app/globals.css` — Tailwind CSS 4 + shadcn CSS variables + dark mode
- `src/app/layout.tsx` — Root layout with metadata
- `package.json` — All Phase 1 dependencies: @supabase/ssr, react-hook-form, zod, @hookform/resolvers, react-timezone-select, react-select, date-fns, @date-fns/tz, shadcn/ui, lucide-react
- `components.json` — shadcn/ui configuration (Tailwind v4, src/components path)
- `.gitignore` — Standard Next.js gitignore excluding node_modules, .next, .env.local
- `tsconfig.json` — TypeScript config with @/* path alias, Next.js plugin, strict mode

## Decisions Made
- **NEXT_PUBLIC_SUPABASE_ANON_KEY (not publishable key):** Plan explicitly states to default to anon key; consistent with existing Supabase project key format
- **Direct node_modules CSS paths:** Turbopack (default in Next.js 16 build) doesn't support CSS package exports with `"style"` condition. Used `../../node_modules/tw-animate-css/dist/tw-animate.css` paths instead of package names as a workaround
- **Manual Next.js init:** `create-next-app` refused to run in directory containing `.planning/` and `.claude/` subdirectories. Initialized manually by installing packages and creating config files
- **Explicit type narrowing for TZDate:** TypeScript strict mode resolves union `string | Date` to the last overload (`number`) which fails. Fixed with explicit `if typeof === 'string'` branching

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Turbopack CSS module resolution for shadcn and tw-animate-css**
- **Found during:** Task 1 (build verification)
- **Issue:** `@import "tw-animate-css"` and `@import "shadcn/tailwind.css"` in globals.css fail under Turbopack — Turbopack does not support CSS packages using the `"style"` export condition
- **Fix:** Replaced package import names with direct paths to the CSS files: `../../node_modules/tw-animate-css/dist/tw-animate.css` and `../../node_modules/shadcn/dist/tailwind.css`
- **Files modified:** `src/app/globals.css`
- **Verification:** `pnpm build` passes after fix
- **Committed in:** 813c3aa (Task 1 commit)

**2. [Rule 1 - Bug] Fixed TypeScript TZDate union type overload mismatch**
- **Found during:** Task 2 (build verification)
- **Issue:** `new TZDate(utcTimestamp, hotelTimezone)` where `utcTimestamp: string | Date` causes TypeScript error — union type resolves to last overload (`number`) which doesn't accept `string | Date`
- **Fix:** Explicit `if typeof === 'string'` branching so TypeScript can narrow to the correct overload
- **Files modified:** `src/lib/timezone.ts`
- **Verification:** `pnpm build` passes with no TypeScript errors after fix
- **Committed in:** ba3584d (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs)
**Impact on plan:** Both fixes essential for correct build. No scope creep.

## Issues Encountered
- `create-next-app` refused to run in non-empty directory containing `.planning/` and `.claude/`. Resolved by manual Next.js initialization (installing packages individually, creating config files by hand). Functionally equivalent result.

## User Setup Required

The SQL migration (`supabase/migrations/0001_foundation.sql`) must be applied manually to the Supabase project:
1. Open Supabase Dashboard > SQL Editor
2. Paste the full contents of `supabase/migrations/0001_foundation.sql`
3. Run the SQL
4. Enable the Custom Access Token Hook: Authentication > Hooks > Custom Access Token > select `public.custom_access_token_hook`
5. Set environment variables in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL` — from Supabase Dashboard > Settings > API
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase Dashboard > Settings > API
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Dashboard > Settings > API

## Next Phase Readiness
- Foundation complete: all tenant-isolated tables, RLS, signup trigger, JWT hook ready to apply to Supabase
- Supabase clients available for all Server Components, Client Components, and middleware
- TypeScript types ready for database queries
- Timezone utility ready for display-layer use in any component
- shadcn/ui components (form, input, button, card, label, textarea) available for Phase 2 auth forms

---
*Phase: 01-foundation*
*Completed: 2026-03-02*
