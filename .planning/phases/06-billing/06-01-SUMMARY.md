---
phase: 06-billing
plan: 01
subsystem: database
tags: [supabase, postgresql, rls, billing, subscriptions, typescript]

# Dependency graph
requires:
  - phase: 05-guest-experience
    provides: seed_hotel_defaults trigger and agents table (extended again here)
provides:
  - subscriptions table with RLS (SELECT only for authenticated, writes via service_role)
  - Subscription TypeScript interface and Database.public.Tables entry
  - PLAN_LIMITS constant with tier-to-agent-count mapping (trial/starter/pro/enterprise)
  - getProviderForHotel() routing TR->iyzico, else->mollie
  - enforceAgentLimit() gates agent toggles by tier limit and trial expiry
  - getSubscriptionStatus() returns SubscriptionInfo with trialDaysRemaining and isTrialExpired
affects: [06-02, 06-03, 06-04, employees actions, billing dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SupabaseClient cast for billing tables (same as Phase 5 escalation/audit pattern)
    - Plan limits as TypeScript constants — not database rows
    - service_role client for enforcement reads (hotel_id validated upstream in server action)

key-files:
  created:
    - supabase/migrations/0006_billing.sql
    - src/lib/billing/plans.ts
    - src/lib/billing/enforcement.ts
    - src/lib/billing/trialStatus.ts
  modified:
    - src/types/database.ts

key-decisions:
  - "SubscriptionInfo named instead of SubscriptionStatus in trialStatus.ts to avoid clash with DB type SubscriptionStatus defined in database.ts"
  - "enforceAgentLimit uses service_role client (not RLS-scoped) — hotel_id already validated by session in calling server action"
  - "getProviderForHotel uses toUpperCase() for case-insensitive TR comparison (plan spec said case-insensitive)"

patterns-established:
  - "Billing enforcement: enforceAgentLimit() called server-side before any agent enable toggle"
  - "Trial state: checked in code (trial_ends_at < now), not via DB trigger — no automatic status transition"
  - "Plan limits: TypeScript constants in plans.ts, not database rows"

requirements-completed: [BILL-01, BILL-04, BILL-06]

# Metrics
duration: 4min
completed: 2026-03-05
---

# Phase 6 Plan 01: Billing Schema and Lib Foundation Summary

**Subscriptions table with RLS, 14-day trial seed trigger, TypeScript plan tier constants (PLAN_LIMITS), and server-side enforceAgentLimit() and getSubscriptionStatus() utilities**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T15:50:14Z
- **Completed:** 2026-03-05T15:54:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created 0006_billing.sql migration with subscriptions table, hotel_id unique constraint, RLS (SELECT only for authenticated), updated_at trigger, and extended seed_hotel_defaults to auto-insert trial subscription on new hotel creation
- Added SubscriptionStatus type, BillingProvider type, and Subscription interface to database.ts with full Database.public.Tables entry (Row/Insert/Update/Relationships)
- Created three billing lib modules: plans.ts (PLAN_LIMITS, PLAN_PRICES, getProviderForHotel), enforcement.ts (enforceAgentLimit), trialStatus.ts (getSubscriptionStatus with SubscriptionInfo type)

## Task Commits

Each task was committed atomically:

1. **Task 1: Subscriptions table migration and TypeScript types** - `9ad0bf1` (feat)
2. **Task 2: Billing lib — plan constants, enforcement, and trial status** - `d74def9` (feat)

**Plan metadata:** (docs commit follows this summary)

## Files Created/Modified
- `supabase/migrations/0006_billing.sql` - subscriptions table, index, RLS SELECT policy, updated_at trigger, extended seed_hotel_defaults with trial subscription insert
- `src/types/database.ts` - Added SubscriptionStatus type, BillingProvider type, Subscription interface, and subscriptions Database table entry
- `src/lib/billing/plans.ts` - PLAN_NAMES, PlanName, PLAN_LIMITS (trial=2, starter=2, pro=4, enterprise=6), PLAN_PRICES (TRY/EUR), getProviderForHotel()
- `src/lib/billing/enforcement.ts` - enforceAgentLimit() checks tier limit, trial expiry, and canceled status before allowing agent enable
- `src/lib/billing/trialStatus.ts` - getSubscriptionStatus() returns SubscriptionInfo with trialDaysRemaining and isTrialExpired computed fields

## Decisions Made
- Named the trialStatus.ts exported type `SubscriptionInfo` (not `SubscriptionStatus`) to avoid a name clash with the `SubscriptionStatus` DB column type already in database.ts
- `getProviderForHotel()` uses `toUpperCase()` for case-insensitive TR comparison (plan spec required case-insensitive; uppercase avoids issues with mixed-case country values from onboarding)
- `enforceAgentLimit()` uses service_role client because it runs inside server actions where hotel_id is already validated by the authenticated session

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required for this plan. (iyzico and Mollie credentials are required for plans 06-02 and 06-03.)

## Next Phase Readiness
- Billing data foundation complete — subscriptions table, types, plan constants, enforcement, and trial status helpers are ready
- Plans 06-02 (iyzico) and 06-03 (Mollie) can now build payment provider integrations on top of this foundation
- Plan 06-04 (billing UI) can import enforceAgentLimit, getSubscriptionStatus, and PLAN_LIMITS
- The employees server action needs enforceAgentLimit() wired in (done in 06-02 or dedicated task)

---
*Phase: 06-billing*
*Completed: 2026-03-05*
