---
phase: 01-foundation
plan: 02
subsystem: auth
tags: [supabase, nextjs, react-hook-form, zod, shadcn, typescript, rls, jwt, middleware]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Next.js 16 project, Supabase clients (browser + server), middleware updateSession, shadcn/ui components (form/input/button/card/label), DB trigger handle_new_user, Custom Access Token Hook"
provides:
  - "Zod schemas for signup and login forms (signupSchema, loginSchema, SignupInput, LoginInput)"
  - "SignupForm: collects email/password/hotelName/fullName, calls supabase.auth.signUp with hotel_name in metadata, calls refreshSession() post-signup to embed hotel_id in JWT"
  - "LoginForm: collects email/password, calls signInWithPassword, router.refresh() + push('/') on success"
  - "(auth) route group layout: centered Card for login/signup pages"
  - "/signup page rendering SignupForm"
  - "/login page rendering LoginForm"
  - "(dashboard) route group layout: server-side getUser() + hotel load via RLS, error state if hotel missing, header with hotel name + sign-out"
  - "Dashboard home page (/) displaying hotel name, timezone, feature placeholder cards"
  - "SignOutButton client component: signOut() then push('/login')"
  - "Bidirectional middleware redirect: unauth to /login, auth away from /login|/signup to /"
affects: [03-hotel-config, all-dashboard-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "signUp with hotel_name in options.data — passed to handle_new_user DB trigger via raw_user_meta_data"
    - "refreshSession() after signUp — forces new JWT issuance through Custom Access Token Hook to embed hotel_id"
    - "Server-side getUser() in dashboard layout — belt-and-suspenders with middleware, validates JWT against Supabase auth server"
    - "RLS-scoped hotel query — supabase.from('hotels').select('*').single() returns only the authenticated user's hotel"
    - "Bidirectional middleware redirect — unauth to /login AND auth away from auth pages to dashboard"
    - "Route groups without URL impact — (auth) and (dashboard) group layouts without adding path segments"

key-files:
  created:
    - "src/lib/validations/auth.ts — signupSchema, loginSchema, SignupInput, LoginInput Zod types"
    - "src/components/forms/signup-form.tsx — signup client component with signUp + refreshSession flow"
    - "src/components/forms/login-form.tsx — login client component with signInWithPassword flow"
    - "src/app/(auth)/layout.tsx — centered Card layout for unauthenticated pages"
    - "src/app/(auth)/signup/page.tsx — /signup route rendering SignupForm"
    - "src/app/(auth)/login/page.tsx — /login route rendering LoginForm"
    - "src/app/(dashboard)/layout.tsx — authenticated layout with server-side session + hotel load"
    - "src/app/(dashboard)/page.tsx — dashboard home with hotel name, timezone, feature cards"
    - "src/components/dashboard/sign-out-button.tsx — client component for signOut + redirect"
  modified:
    - "src/lib/supabase/middleware.ts — added bidirectional redirect (auth users away from /login|/signup)"
  deleted:
    - "src/app/page.tsx — removed old placeholder, replaced by (dashboard)/page.tsx"

key-decisions:
  - "Deleted src/app/page.tsx — Next.js App Router doesn't support two competing handlers for the same path; (dashboard)/page.tsx must be the sole / handler"
  - "refreshSession() non-fatal on error — if refresh fails post-signup, user is still created and redirect proceeds; dashboard layout handles the edge case with an error state"
  - "Sign-out is a client component — supabase.auth.signOut() requires browser-side client; dashboard layout is a Server Component so sign-out is extracted to sign-out-button.tsx"

patterns-established:
  - "Post-signup refresh pattern: always call refreshSession() after signUp to get hotel_id in JWT before redirecting to dashboard"
  - "Dashboard hotel query: supabase.from('hotels').select('*').single() — RLS returns exactly one row for authenticated user"
  - "Error state in layout: if hotel missing, render error card rather than crashing; lets user sign out and try again"

requirements-completed: [FOUND-02]

# Metrics
duration: 7min
completed: 2026-03-02
---

# Phase 1 Plan 02: Auth Flow Summary

**Supabase auth flow with signup-to-hotel creation, JWT refresh for hotel_id embedding, protected dashboard route group using server-side getUser(), and bidirectional middleware redirects**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-02T08:58:45Z
- **Completed:** 2026-03-02T09:05:52Z
- **Tasks:** 2
- **Files modified:** 9 (8 created, 1 modified, 1 deleted)

## Accomplishments
- Signup form that passes hotel_name in Supabase auth metadata so the DB trigger (handle_new_user) atomically creates hotel + profile, then forces a session refresh to embed hotel_id in the JWT via Custom Access Token Hook before redirecting to dashboard
- Login form using signInWithPassword with router.refresh() + push('/') to ensure the new session cookie is read by server components before the dashboard renders
- Protected dashboard layout that validates user server-side with getUser(), loads hotel data via RLS-scoped query, and shows a graceful error state if hotel setup is incomplete
- Bidirectional middleware route protection: unauthenticated users blocked from dashboard, authenticated users skipped past login/signup

## Task Commits

Each task was committed atomically:

1. **Task 1: Auth validation schemas and form components** - `0b2fd5e` (feat)
2. **Task 2: Auth pages, dashboard layout, and route protection** - `6af2a95` (feat)

## Files Created/Modified
- `src/lib/validations/auth.ts` — signupSchema (email, password, hotelName, optional fullName), loginSchema (email, password), inferred SignupInput and LoginInput types
- `src/components/forms/signup-form.tsx` — Client component: react-hook-form + zodResolver(signupSchema), signUp with hotel_name in options.data, refreshSession() after success, push('/')
- `src/components/forms/login-form.tsx` — Client component: react-hook-form + zodResolver(loginSchema), signInWithPassword, router.refresh() + push('/') on success
- `src/app/(auth)/layout.tsx` — Centered flex layout with Card + CardContent for auth pages
- `src/app/(auth)/signup/page.tsx` — /signup route, renders SignupForm, page title "Create your hotel account"
- `src/app/(auth)/login/page.tsx` — /login route, renders LoginForm, page title "Welcome back"
- `src/app/(dashboard)/layout.tsx` — Server Component: getUser() session check, hotel load via RLS .single(), error state if hotel missing, header with hotel name + SignOutButton
- `src/app/(dashboard)/page.tsx` — Server Component: dashboard home with hotel name heading, timezone subtitle, 3 feature placeholder cards
- `src/components/dashboard/sign-out-button.tsx` — Client Component: signOut() then router.push('/login')
- `src/lib/supabase/middleware.ts` — Added bidirectional redirect: auth users on /login|/signup redirected to /

## Decisions Made
- **Deleted src/app/page.tsx:** Next.js App Router cannot have two competing handlers for `/`. The route group `(dashboard)/page.tsx` must be the single handler for the root route.
- **refreshSession() non-fatal:** If the post-signup session refresh fails, execution continues and the redirect happens anyway. The dashboard layout handles the "no hotel" edge case gracefully rather than crashing.
- **Sign-out extracted to client component:** The dashboard layout is a Server Component; signOut() requires the browser-side Supabase client and useRouter. Extracted to `sign-out-button.tsx`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed competing root page.tsx to resolve route conflict**
- **Found during:** Task 2 (dashboard page creation)
- **Issue:** `src/app/page.tsx` (placeholder from Plan 01) and `src/app/(dashboard)/page.tsx` both claim the `/` route. Next.js App Router disallows two handlers for the same path.
- **Fix:** Deleted `src/app/page.tsx`. The `(dashboard)/page.tsx` is the correct handler — it has the authenticated layout and hotel data display.
- **Files modified:** `src/app/page.tsx` (deleted)
- **Verification:** `pnpm build` passes with single `/` route in route table
- **Committed in:** 6af2a95 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug/conflict)
**Impact on plan:** Essential fix. No scope creep.

## Issues Encountered
None beyond the route conflict above.

## User Setup Required
None beyond what was documented in 01-01 USER SETUP — the Supabase schema, trigger, and Custom Access Token Hook must already be applied for auth to work.

## Next Phase Readiness
- Auth flow complete: /signup and /login are functional pages wired to Supabase
- Dashboard layout is ready to receive new pages in the (dashboard) group
- Hotel data is loaded in both the layout (for header) and the page (for display)
- Settings page at /settings can be built in Plan 03 — the link already exists in the dashboard home card

---
*Phase: 01-foundation*
*Completed: 2026-03-02*
