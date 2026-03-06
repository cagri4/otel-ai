---
phase: 10-super-admin-panel-and-employee-bots
plan: 02
subsystem: ui
tags: [nextjs, server-components, client-components, server-actions, tailwind, admin-panel]

requires:
  - phase: 10-super-admin-panel-and-employee-bots
    provides: adminCreateHotel Server Action, provisionAllBots Server Action, hotel_bots table, delete_vault_secret SQL function

provides:
  - (admin)/layout.tsx — Server Component layout with SUPER_ADMIN_EMAIL env var guard, redirects non-admin to /
  - (admin)/admin/page.tsx — Hotel list with trial/active/expired status badges and create hotel form
  - (admin)/admin/[hotelId]/page.tsx — Hotel detail Server Component with bot status table, imports BotProvisionForm and DeepLinkCopy
  - BotProvisionForm.tsx — Client Component: 4-field bot provisioning form calling provisionAllBots, per-role results, token clearing
  - DeepLinkCopy.tsx — Client Component: copyable Setup Wizard deep link with clipboard API

affects:
  - 10-03 (if any further admin features)
  - 11-setup-wizard (deep link points to Setup Wizard bot entry point)

tech-stack:
  added: []
  patterns:
    - Server Component + Client Component split in same route — page.tsx stays Server Component, interactive sub-components extracted to dedicated *Form.tsx/*Copy.tsx Client Components
    - useTransition for Server Action form submission — enables pending state without useFormStatus in non-form-action submissions
    - searchParams as Promise<{...}> pattern — Next.js 15+ async searchParams in Server Components
    - params as Promise<{...}> pattern — Next.js 15+ async params in dynamic route Server Components

key-files:
  created:
    - src/app/(admin)/layout.tsx
    - src/app/(admin)/admin/page.tsx
    - src/app/(admin)/admin/[hotelId]/page.tsx
    - src/app/(admin)/admin/[hotelId]/BotProvisionForm.tsx
    - src/app/(admin)/admin/[hotelId]/DeepLinkCopy.tsx
  modified: []

key-decisions:
  - "Client Component split: BotProvisionForm and DeepLinkCopy extracted as separate files — page.tsx Server Component cannot mix 'use client' with server-side DB queries; dedicated *Form.tsx and *Copy.tsx files allow clean Server/Client boundary"
  - "useTransition for provisionAllBots call — enables isPending state for button disable/loading text without React 19 useActionState; more explicit control over optimistic updates"
  - "NEXT_PUBLIC_APP_URL with window.location.origin fallback in BotProvisionForm — client-side env var available via NEXT_PUBLIC_ prefix; window.location.origin as fallback handles missing env var in dev"
  - "searchParams and params as Promise — Next.js 15 async component params pattern; await required before destructuring"

patterns-established:
  - "Pattern: Server Component page + extracted Client Components for forms — use page.tsx for DB queries and data loading, extract interactive forms to *Form.tsx with 'use client'"
  - "Pattern: useTransition for async Server Action calls in Client Components — startTransition wraps await serverAction(); provides isPending without form submission coupling"

requirements-completed: [SADM-01, SADM-02, SADM-03, SADM-04]

duration: 8min
completed: 2026-03-06
---

# Phase 10 Plan 02: Super Admin Panel UI Summary

**Route-guarded admin panel with SUPER_ADMIN_EMAIL layout guard, hotel list with subscription status badges, create hotel form, and hotel detail page with 4-bot provisioning form and one-click Setup Wizard deep link**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-06T11:40:26Z
- **Completed:** 2026-03-06T11:48:37Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `(admin)/layout.tsx` with `SUPER_ADMIN_EMAIL` env var guard — non-matching users redirected to `/`, unauthenticated to `/login`, minimal "OtelAI Admin" header with Super Admin badge
- Created `(admin)/admin/page.tsx` hotel list with trial/active/expired status badges and a native HTML create hotel form that calls `adminCreateHotel` Server Action and redirects to `/admin/{hotelId}` on success
- Created hotel detail page split across three files: Server Component page (DB queries, bot status table), `BotProvisionForm` Client Component (4-field provisioning form with per-role results), `DeepLinkCopy` Client Component (copyable deep link with clipboard API)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create admin layout guard and hotel list page with create form** - `c974c94` (feat)
2. **Task 2: Create hotel detail page with bot provisioning form and deep link** - `c6cf22b` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/app/(admin)/layout.tsx` — Server Component with `SUPER_ADMIN_EMAIL` env var guard, `redirect('/')` for non-admin, `redirect('/login')` for unauthenticated; minimal "OtelAI Admin" header
- `src/app/(admin)/admin/page.tsx` — Service client hotel query with subscription join, status badge logic (trialing/active/expired), hotel list table with Manage links, create hotel form with `handleCreateHotel` Server Action wrapper
- `src/app/(admin)/admin/[hotelId]/page.tsx` — Server Component loading hotel + all 4 bot rows, bot status table showing all roles (provisioned or not), imports BotProvisionForm and DeepLinkCopy
- `src/app/(admin)/admin/[hotelId]/BotProvisionForm.tsx` — `'use client'` component with per-role token inputs, `useTransition` for `provisionAllBots` call, per-role success/error display, token clearing after submit, `router.refresh()` for server table update
- `src/app/(admin)/admin/[hotelId]/DeepLinkCopy.tsx` — `'use client'` component with readOnly input showing deep link, "Copy" button using `navigator.clipboard.writeText()` with 2s "Copied!" confirmation

## Decisions Made

- **Client Component split:** `BotProvisionForm` and `DeepLinkCopy` extracted as separate `*Form.tsx` and `*Copy.tsx` files. The hotel detail `page.tsx` must remain a Server Component to run DB queries; mixing `'use client'` with server-side Supabase calls is not permitted. Clean Server/Client boundary achieved by delegation pattern.
- **`useTransition` for Server Action call:** Used `startTransition(async () => { await provisionAllBots(...) })` in `BotProvisionForm` instead of `useActionState`. Provides `isPending` for button loading state with explicit control over result handling and token clearing.
- **`NEXT_PUBLIC_APP_URL` with `window.location.origin` fallback:** Client component reads `process.env.NEXT_PUBLIC_APP_URL` (available client-side via NEXT_PUBLIC_ prefix) with `window.location.origin` as fallback for development environments missing the env var.
- **Async searchParams/params:** Next.js 15+ requires `await params` and `await searchParams` in Server Components; both hotel list and detail pages use the `Promise<{...}>` pattern.

## Deviations from Plan

None — plan executed exactly as written. The Client Component split into separate files (rather than inline) is a standard Next.js pattern, not a deviation from the plan's intent.

## Issues Encountered

None.

## User Setup Required

Two environment variables must be set before the admin panel is functional:

| Variable | Source | Purpose |
|---|---|---|
| `SUPER_ADMIN_EMAIL` | Your Supabase auth login email | Route guard — only this email can access `/admin` |
| `SETUP_WIZARD_BOT_USERNAME` | BotFather — @username of Setup Wizard bot | Deep link generation (`t.me/{username}?start={hotelId}`); can be placeholder until Phase 11 |

Add both to `.env.local` and Vercel project settings.

## Next Phase Readiness

- All four employee bots (front_desk, booking_ai, guest_experience, housekeeping_coordinator) can now be provisioned by visiting `/admin/{hotelId}` as the super admin
- The Phase 9 webhook handler already routes all four roles via `roleMap` — bots are operational the moment `hotel_bots` rows are provisioned
- Phase 11 (Setup Wizard) can use the deep link format `https://t.me/{SETUP_WIZARD_BOT_USERNAME}?start={hotelId}` established here
- The `delete_vault_secret` SQL function must be applied to the database (`supabase db push`) before provisioning is tested in production

---
*Phase: 10-super-admin-panel-and-employee-bots*
*Completed: 2026-03-06*
