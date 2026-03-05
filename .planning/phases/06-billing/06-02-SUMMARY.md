---
phase: 06-billing
plan: 02
subsystem: payments
tags: [iyzico, iyzipay, billing, subscriptions, webhook, hmac, typescript]

# Dependency graph
requires:
  - phase: 06-billing plan 01
    provides: subscriptions table, Subscription TypeScript types, PLAN_LIMITS, getProviderForHotel
provides:
  - iyzipay package installation
  - iyzico TypeScript type declarations (src/types/iyzipay.d.ts)
  - iyzico client singleton with sandbox/production URI switching
  - initSubscriptionCheckoutForm() promise wrapper
  - upgradeIyzicoSubscription() promise wrapper using library's subscription.upgrade method
  - validateIyzicoSignature() HMAC-SHA256 with timingSafeEqual
  - POST /api/webhooks/iyzico — HMAC-secured subscription event handler
  - POST /api/billing/iyzico/checkout — authenticated checkout form initialization
  - GET /api/billing/iyzico/callback — post-form redirect handler
  - POST /api/billing/iyzico/upgrade — plan change with downgrade enforcement
affects: [06-04, billing-ui, employees-page]

# Tech tracking
tech-stack:
  added:
    - iyzipay@2.0.65 — iyzico Node.js SDK
  patterns:
    - SupabaseClient cast for subscriptions table writes (extends Phase 6 Plan 1 pattern)
    - Promise-wrapped callback-style iyzipay SDK for async/await usage
    - Raw body read before JSON parse in webhook — prevents signature mismatch
    - Always return 200 from webhooks — prevents iyzico retry storm
    - nodejs runtime declared on all billing routes (crypto module requirement)

key-files:
  created:
    - src/lib/billing/iyzico.ts
    - src/types/iyzipay.d.ts
    - src/app/api/webhooks/iyzico/route.ts
    - src/app/api/billing/iyzico/checkout/route.ts
    - src/app/api/billing/iyzico/callback/route.ts
    - src/app/api/billing/iyzico/upgrade/route.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "iyzipay library exposes subscription.upgrade directly (lib/resources/Subscription.js) — no raw fetch needed for upgrade endpoint"
  - "iyzipay ships no TypeScript types — handwritten declarations in src/types/iyzipay.d.ts covering only used surface"
  - "provider_customer_id set to customer.email pre-webhook in checkout route — webhook overwrites with authoritative customerReferenceCode"
  - "Downgrade blocked (not auto-disabled) when enabled agents exceed new plan limit — consistent with research recommendation"
  - "callback route assumes success for unknown status — webhook is authoritative source of subscription state"

patterns-established:
  - "Webhook-first subscription state: checkout sets initial provider info; webhook drives actual activation"
  - "Downgrade enforcement: check enabled agent count vs plan maxAgents before calling iyzico upgrade API"
  - "iyzico signature: HMAC-SHA256 over merchantId+secretKey+eventType+subscriptionRef+orderRef+customerRef"

requirements-completed: [BILL-02, BILL-05]

# Metrics
duration: 16min
completed: 2026-03-05
---

# Phase 6 Plan 02: iyzico Subscription Billing Integration Summary

**iyzico subscription billing for Turkish market — hosted checkout form via iyzipay SDK, HMAC-secured webhook handler driving subscription state, and plan upgrade endpoint with agent count enforcement**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-05T15:57:23Z
- **Completed:** 2026-03-05T16:13:00Z
- **Tasks:** 2
- **Files modified:** 8 (6 created, 2 package files updated)

## Accomplishments
- Installed iyzipay@2.0.65 and created handwritten TypeScript declarations covering the SDK surface used by OtelAI
- Built iyzico client library with client singleton (sandbox/prod URI switching), plan ref mapping, checkout form initialization, subscription upgrade, and HMAC signature validation with timingSafeEqual
- Created four API route handlers: HMAC-secured webhook (subscription.order.success/failure/cancel), checkout initialization, callback redirect, and upgrade with downgrade enforcement

## Task Commits

Each task was committed atomically:

1. **Task 1: iyzico client library and subscription helpers** - `f5768fb` (feat)
2. **Task 2: iyzico webhook handler and billing API routes** - `ef4661c` (feat)

**Plan metadata:** (docs commit follows this summary)

## Files Created/Modified
- `src/lib/billing/iyzico.ts` - iyzipayClient singleton, getIyzicoPlanRef(), initSubscriptionCheckoutForm(), upgradeIyzicoSubscription(), validateIyzicoSignature()
- `src/types/iyzipay.d.ts` - TypeScript declarations for iyzipay SDK (no official types published)
- `src/app/api/webhooks/iyzico/route.ts` - POST handler: raw body read, HMAC validation (timingSafeEqual), DB update via service client, always 200
- `src/app/api/billing/iyzico/checkout/route.ts` - POST handler: auth gate, plan ref resolution, checkout form init, pre-webhook subscription row update
- `src/app/api/billing/iyzico/callback/route.ts` - GET handler: iyzico redirect URL, success/failure/token_expired -> /billing?status=...
- `src/app/api/billing/iyzico/upgrade/route.ts` - POST handler: auth gate, provider validation, downgrade enforcement, iyzico upgrade API call, DB update
- `package.json` - Added iyzipay@2.0.65
- `pnpm-lock.yaml` - Lockfile updated

## Decisions Made
- The iyzipay library already exposes `subscription.upgrade` in `lib/resources/Subscription.js` — no raw fetch needed. Using the library method directly.
- Handwritten TypeScript declarations (`src/types/iyzipay.d.ts`) instead of `@types/iyzipay` (not published to npm registry).
- `provider_customer_id` is set to `customer.email` in the checkout route as a pre-webhook placeholder. The webhook will set the authoritative `customerReferenceCode` from iyzico.
- Downgrade is blocked (not auto-disabled) when enabled agents exceed new plan limit — matches plan spec and research recommendation to force manual agent management.
- callback route treats unknown status as failure redirect to avoid silent data inconsistency — webhook is the authoritative source of subscription state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Applied SupabaseClient cast to subscriptions writes in Task 2 routes**
- **Found during:** Task 2 (webhook handler and billing API routes)
- **Issue:** TypeScript reports `never` type for `.from('subscriptions').update()` because `subscriptions` is a manually-typed table added to `Database.public.Tables` in 06-01 using the same manual pattern as Phase 5 tables. PostgREST-js v12 type inference fails without the cast.
- **Fix:** Applied `(supabase as unknown as SupabaseClient).from('subscriptions')` in all four routes — same pattern already established in `enforcement.ts` from 06-01
- **Files modified:** All four new route files
- **Verification:** `pnpm tsc --noEmit` passes cleanly
- **Committed in:** ef4661c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix required for TypeScript compliance. No scope creep — identical pattern already established in enforcement.ts (06-01).

## Issues Encountered
- iyzipay ships no TypeScript types — required creating handwritten declarations. The library surface used by OtelAI is narrow (subscriptionCheckoutForm.initialize, subscription.upgrade) so handwritten declarations were straightforward.

## User Setup Required

The following iyzico environment variables must be configured before the iyzico billing flow works:

| Variable | Source |
|---|---|
| `IYZIPAY_API_KEY` | iyzico merchant panel → API keys (use sandbox key for testing) |
| `IYZIPAY_SECRET_KEY` | iyzico merchant panel → API keys (use sandbox secret for testing) |
| `IYZIPAY_MERCHANT_ID` | iyzico merchant panel → Account info |
| `IYZICO_PLAN_STARTER_REF` | iyzico merchant panel → Subscriptions → Products → Pricing Plans → Starter |
| `IYZICO_PLAN_PRO_REF` | iyzico merchant panel → Subscriptions → Products → Pricing Plans → Pro |
| `IYZICO_PLAN_ENTERPRISE_REF` | iyzico merchant panel → Subscriptions → Products → Pricing Plans → Enterprise |

Dashboard configuration required:
1. Activate Subscription add-on: iyzico merchant panel → Settings → Add-ons
2. Create 'OtelAI' product with three pricing plans (Starter/Pro/Enterprise), MONTHLY interval, trialPeriodDays=14

## Next Phase Readiness
- iyzico billing integration complete — Turkish market hotels can subscribe via hosted checkout form
- Plan 06-03 (Mollie) can follow the same patterns for EU market
- Plan 06-04 (billing UI) can call POST /api/billing/iyzico/checkout and display checkoutFormContent
- Webhook endpoint `/api/webhooks/iyzico` must be registered in iyzico merchant panel as subscription notification URL

## Self-Check: PASSED

All files confirmed present:
- src/lib/billing/iyzico.ts — FOUND
- src/types/iyzipay.d.ts — FOUND
- src/app/api/webhooks/iyzico/route.ts — FOUND
- src/app/api/billing/iyzico/checkout/route.ts — FOUND
- src/app/api/billing/iyzico/callback/route.ts — FOUND
- src/app/api/billing/iyzico/upgrade/route.ts — FOUND

All commits confirmed:
- f5768fb (Task 1: iyzico client library) — FOUND
- ef4661c (Task 2: webhook and billing routes) — FOUND

---
*Phase: 06-billing*
*Completed: 2026-03-05*
