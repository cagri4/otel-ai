---
phase: 06-billing
plan: 04
subsystem: ui
tags: [billing, ui, react, nextjs, iyzico, mollie, subscriptions, enforcement, typescript]

# Dependency graph
requires:
  - phase: 06-billing/06-01
    provides: subscriptions table, SubscriptionInfo type, getSubscriptionStatus, PLAN_LIMITS, PLAN_PRICES
  - phase: 06-billing/06-02
    provides: iyzico checkout, upgrade, callback API routes
  - phase: 06-billing/06-03
    provides: Mollie checkout, change-plan, callback API routes
provides:
  - /billing page (Server + Client Component) with current plan display, trial countdown, plan comparison grid
  - BillingClient.tsx with iyzico customer form (TC identity number) and Mollie checkout redirect
  - enforceAgentLimit wired into toggleAgent Server Action with redirect-based error reporting
  - /employees error banners for limit_reached and trial_expired enforcement outcomes
  - Billing nav link in dashboard layout
affects: [07-bookings, hotel-owner-ux, agent-toggle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server + Client Component split for billing page — same pattern as other dashboard pages"
    - "Enforcement redirect pattern: toggleAgent redirects to /employees?error=X instead of returning error (keeps Server Action return type as void)"
    - "iyzico checkout: collect customer data client-side, POST to /api/billing/iyzico/checkout, render returned HTML form inline"
    - "Mollie checkout: POST to /api/billing/mollie/checkout, redirect to returned checkoutUrl"
    - "Plan comparison grid: PLAN_ORDER typed as Array<Exclude<PlanName, 'trial'>> to satisfy getPlanPrice type constraint"

key-files:
  created:
    - src/app/(dashboard)/billing/page.tsx
    - src/app/(dashboard)/billing/BillingClient.tsx
  modified:
    - src/app/(dashboard)/employees/actions.ts
    - src/app/(dashboard)/employees/page.tsx
    - src/app/(dashboard)/layout.tsx

key-decisions:
  - "toggleAgent returns void (Server Action constraint) — enforcement errors communicated via redirect to /employees?error=X search param"
  - "Agent hotel_id fetched from agent row in toggleAgent — cleaner than extracting from JWT user metadata, consistent with existing pattern"
  - "PLAN_ORDER typed as Array<Exclude<PlanName, 'trial'>> — getPlanPrice only accepts paid plans; typing PLAN_ORDER narrowly avoids TypeScript error without casting"
  - "iyzico form HTML rendered inline via dangerouslySetInnerHTML — iyzico returns a complete hosted form that replaces the billing UI until payment completes"

patterns-established:
  - "Billing enforcement redirect: Server Action calls enforceAgentLimit, redirects with ?error= params, page reads searchParams to display banners"
  - "iyzico customer form: inline form section before checkout, required fields noted with regulation context"

requirements-completed: [BILL-01, BILL-04, BILL-05, BILL-06]

# Metrics
duration: 9min
completed: 2026-03-05
---

# Phase 6 Plan 04: Billing Dashboard UI and Enforcement Summary

**Billing dashboard page with trial countdown, plan comparison grid (iyzico TRY/Mollie EUR), and enforceAgentLimit wired into agent toggle with redirect-based error banners**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-05T16:20:23Z
- **Completed:** 2026-03-05T16:29:09Z
- **Tasks:** 2 (+ 1 human-verify checkpoint)
- **Files modified:** 5

## Accomplishments
- Created `/billing` page: Server Component loads subscription status via `getSubscriptionStatus()`, routes TR hotels to iyzico and EU to Mollie, passes to BillingClient with hotel country and provider
- Built BillingClient with current plan card (status badge, trial countdown, expired banner), plan comparison grid (Starter/Pro/Enterprise) with provider-correct prices, subscribe/upgrade/downgrade actions with loading states and inline errors
- Wired `enforceAgentLimit` into `toggleAgent` Server Action — fetches agent's hotel_id, blocks enable when limit reached or trial expired, redirects with `?error=` search params
- Added error banners to `/employees` page for `limit_reached` and `trial_expired` enforcement outcomes with Billing page links
- Added Billing nav link to dashboard layout between Employees and Conversations

## Task Commits

Each task was committed atomically:

1. **Task 1: Billing dashboard page with plan display and checkout flows** - `37869f8` (feat)
2. **Task 2: Wire enforceAgentLimit into toggleAgent and add Billing nav link** - `cf736a1` (feat)

**Plan metadata:** (docs commit follows this summary)

## Files Created/Modified
- `src/app/(dashboard)/billing/page.tsx` - Server Component: loads subscription + hotel, handles ?status= banners, renders BillingClient
- `src/app/(dashboard)/billing/BillingClient.tsx` - Client Component: plan card, comparison grid, iyzico customer form, Mollie redirect, upgrade/downgrade API calls
- `src/app/(dashboard)/employees/actions.ts` - Added enforceAgentLimit call before enable toggle, redirect on enforcement violation
- `src/app/(dashboard)/employees/page.tsx` - Added searchParams prop, limit_reached and trial_expired error banners
- `src/app/(dashboard)/layout.tsx` - Added Billing nav link between Employees and Conversations

## Decisions Made
- `toggleAgent` keeps `Promise<void>` return type (Server Action constraint) — enforcement errors communicated via `redirect()` to `/employees?error=X` search params instead of return value
- Agent `hotel_id` fetched from the agent row itself (single DB query) rather than extracting from JWT user metadata — consistent with existing codebase patterns and avoids JWT claim parsing complexity
- `PLAN_ORDER` typed as `Array<Exclude<PlanName, 'trial'>>` — `getPlanPrice` signature only accepts paid plan names; narrowing the array type eliminates the TypeScript error without casting
- iyzico checkout form HTML rendered inline via `dangerouslySetInnerHTML` — iyzico returns a complete hosted payment form; rendering it inline replaces the billing UI state until payment completes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error in PLAN_ORDER array**
- **Found during:** Task 1 (BillingClient.tsx)
- **Issue:** `PLAN_ORDER` typed as `PlanName[]` caused TypeScript error when passing elements to `getPlanPrice()` which accepts `Exclude<PlanName, 'trial'>`
- **Fix:** Changed `PLAN_ORDER` type annotation to `Array<Exclude<PlanName, 'trial'>>` — the array never contains 'trial' by design
- **Files modified:** `src/app/(dashboard)/billing/BillingClient.tsx`
- **Verification:** `pnpm tsc --noEmit` passed with zero errors
- **Committed in:** `37869f8` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 TypeScript type narrowing)
**Impact on plan:** Fix necessary for TypeScript correctness. No scope creep.

## Issues Encountered
None — plan executed cleanly.

## User Setup Required
None — billing UI uses the same API routes and environment variables already documented in 06-02-SUMMARY.md (iyzico) and 06-03-SUMMARY.md (Mollie). No additional configuration required for the UI layer.

## Next Phase Readiness
- Phase 6 billing complete — full subscription lifecycle: trial auto-creation (Phase 6 Plan 1), iyzico TR billing (Plan 2), Mollie EU billing (Plan 3), billing UI + enforcement (Plan 4)
- Phase 7 (Bookings) can proceed — billing enforcement is in place; hotel owners must be on an active plan to enable agents

## Self-Check: PASSED

All created and modified files exist on disk. All task commits (`37869f8`, `cf736a1`) exist in git history. `pnpm tsc --noEmit` passes with zero errors. SUMMARY.md created.

---
*Phase: 06-billing*
*Completed: 2026-03-05*
