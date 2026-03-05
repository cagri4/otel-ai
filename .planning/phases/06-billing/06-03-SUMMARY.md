---
phase: 06-billing
plan: 03
subsystem: payments
tags: [mollie, billing, subscriptions, webhooks, api, typescript]

# Dependency graph
requires:
  - phase: 06-billing/06-01
    provides: subscriptions table, Subscription types, PLAN_LIMITS, PLAN_PRICES, createServiceClient
provides:
  - Mollie client singleton with createMollieClient factory
  - createMollieCustomer — creates Mollie customer (cst_xxx) for hotel
  - createMollieFirstPayment — EUR 0.01 first payment for mandate establishment
  - createMollieSubscription — recurring subscription starting on trial_ends_at
  - changeMolliePlan — cancel current + create new subscription with same mandate
  - validateMollieSignature — HMAC-SHA256, returns true when secret not configured
  - POST /api/webhooks/mollie — form-urlencoded webhook, re-fetches payment from API
  - POST /api/billing/mollie/checkout — creates customer + first payment, returns checkoutUrl
  - GET /api/billing/mollie/callback — redirects to /billing?status=pending
  - POST /api/billing/mollie/change-plan — blocks downgrade, cancels + recreates subscription
affects: [06-04, billing-ui, hotel-dashboard]

# Tech tracking
tech-stack:
  added:
    - "@mollie/api-client 4.4.0 — EU market payment gateway SDK"
  patterns:
    - "Mollie recurring billing: customer -> first payment -> mandate -> subscription (webhook-driven)"
    - "Webhook always returns 200 — never trigger retry storm; errors logged not thrown"
    - "Webhook re-fetches payment from Mollie API — never trusts POST body for authoritative status"
    - "SupabaseClient cast for subscriptions table (same as Phase 5/6 pattern)"
    - "Overloaded Mollie SDK types: use 'as unknown as Payment' to avoid void inference from callback overload"

key-files:
  created:
    - src/lib/billing/mollie.ts
    - src/app/api/webhooks/mollie/route.ts
    - src/app/api/billing/mollie/checkout/route.ts
    - src/app/api/billing/mollie/callback/route.ts
    - src/app/api/billing/mollie/change-plan/route.ts
  modified:
    - package.json (added @mollie/api-client)
    - pnpm-lock.yaml

key-decisions:
  - "Mollie client uses createMollieClient() factory (not 'new Client()') — the SDK v4 exports createMollieClient as named export, not a class"
  - "Test mode controlled by API key prefix (test_xxx vs live_xxx) not a client option — no testmode: bool on client"
  - "validateMollieSignature returns true when MOLLIE_WEBHOOK_SECRET is unset — classic webhooks do not include X-Mollie-Signature; rely on API fetch security model instead"
  - "Payment type cast via 'as unknown as Payment' — SDK overloads cause TypeScript to pick void-returning callback variant; same pattern needed for payments.get as for payments.create"
  - "Webhook looks up subscription by provider_customer_id to find hotel_id — first payment carries no hotel_id directly; customer was created with hotelId in metadata but re-fetching by customerId is simpler"
  - "changeMolliePlan starts new subscription on 1st of next month — simplest billing anchor vs complex prorated calculation"

patterns-established:
  - "EU billing: createMollieCustomer -> createMollieFirstPayment -> webhook creates subscription -> recurring webhooks update status"
  - "Downgrade guard: count enabled agents via service client before allowing plan change to lower tier"
  - "Webhook security: MOLLIE_WEBHOOK_SECRET optional; fallback to re-fetch from API model"

requirements-completed: [BILL-03, BILL-05]

# Metrics
duration: 17min
completed: 2026-03-05
---

# Phase 6 Plan 03: Mollie EU Billing Integration Summary

**Mollie mandate-based recurring billing via customer -> EUR 0.01 first payment -> webhook-driven subscription creation, with plan change and downgrade guard for EU hotel market**

## Performance

- **Duration:** 17 min
- **Started:** 2026-03-05T15:59:22Z
- **Completed:** 2026-03-05T16:16:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created complete Mollie client library (mollie.ts) with typed helpers for customer creation, first payment (mandate setup), subscription creation, plan change, and HMAC signature validation
- Built webhook handler that parses form-urlencoded body, re-fetches payment from Mollie API for authoritative status, creates subscriptions after mandate establishment, and updates status for recurring payments
- Created checkout route (creates customer + first payment, returns checkoutUrl), callback redirect route, and change-plan route with downgrade guard blocking agent-count violations

## Task Commits

Each task was committed atomically:

1. **Task 1: Mollie client library and subscription helpers** - `ecb5329` (feat)
2. **Task 2: Mollie webhook handler and billing API routes** - `39d11f2` (feat)

**Plan metadata:** (docs commit follows this summary)

## Files Created/Modified
- `src/lib/billing/mollie.ts` - Mollie client singleton + createMollieCustomer, createMollieFirstPayment, createMollieSubscription, changeMolliePlan, validateMollieSignature
- `src/app/api/webhooks/mollie/route.ts` - POST webhook: form-urlencoded parse, API re-fetch, first payment -> mandate -> subscription, recurring payment status updates
- `src/app/api/billing/mollie/checkout/route.ts` - POST: authenticated checkout initiation, creates Mollie customer + first payment, returns { checkoutUrl }
- `src/app/api/billing/mollie/callback/route.ts` - GET: redirect to /billing?status=pending after Mollie payment redirect
- `src/app/api/billing/mollie/change-plan/route.ts` - POST: validates provider, downgrade guard, mandate lookup, cancel + recreate subscription
- `package.json` - Added @mollie/api-client 4.4.0
- `pnpm-lock.yaml` - Lock file updated

## Decisions Made
- Used `createMollieClient({ apiKey })` factory from `@mollie/api-client` — v4 SDK does not export a `Client` class; the factory pattern is the correct initialization approach
- Test/live mode controlled by API key prefix, not a client option — MOLLIE_API_KEY should be `test_xxx` in non-production environments
- `validateMollieSignature` returns `true` when `MOLLIE_WEBHOOK_SECRET` is not configured — classic Mollie webhooks (form-urlencoded POST with payment ID) do not reliably include `X-Mollie-Signature`; the security model of always re-fetching from Mollie API is sufficient
- TypeScript overload resolution picks `void` for `mollieClient.payments.get()` when no explicit type annotation is given — worked around with `as unknown as Payment` import from Mollie's internal type path
- Webhook locates hotel subscription by `provider_customer_id = customerId` from the payment — avoids needing to store hotel reference separately; customerId was stored on the subscriptions row during checkout

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed SequenceType string literal type error**
- **Found during:** Task 1 (Mollie client library)
- **Issue:** Used string literal `'first'` but SDK uses a `SequenceType` enum; TypeScript rejected the assignment
- **Fix:** Imported `SequenceType` enum from `@mollie/api-client` and used `SequenceType.first`
- **Files modified:** `src/lib/billing/mollie.ts`
- **Verification:** `pnpm tsc --noEmit` passed with zero errors
- **Committed in:** `ecb5329` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed Mollie SDK overload TypeScript void inference**
- **Found during:** Task 2 (webhook handler)
- **Issue:** `mollieClient.payments.get()` type resolved to `void` due to overloaded callback signature being picked by TypeScript; accessing `.status`, `.sequenceType` etc. failed
- **Fix:** Imported `Payment` type from `@mollie/api-client/dist/types/data/payments/Payment` and cast result with `as unknown as Payment`
- **Files modified:** `src/app/api/webhooks/mollie/route.ts`
- **Verification:** `pnpm tsc --noEmit` passed with zero errors
- **Committed in:** `39d11f2` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs in type resolution)
**Impact on plan:** Both fixes necessary for TypeScript correctness. No scope creep.

## Issues Encountered
- Initial `pnpm add mollie-api-typescript` (plan-specified package name) returned no results — the actual package is `@mollie/api-client` (scoped). Confirmed by checking Mollie's documentation pattern. Installed correct package.
- `@mollie/api-client` first install did not save to package.json (ran without --save in wrong directory context); re-ran to ensure entry appears in dependencies.

## User Setup Required
Two environment variables are required before Mollie processing can work:

- `MOLLIE_API_KEY` — from Mollie Dashboard -> Developers -> API keys. Use `test_xxx` prefixed key for non-production environments.
- `MOLLIE_WEBHOOK_SECRET` — Optional. From Mollie Dashboard -> Developers -> Webhooks -> Secret. If not set, signature validation is skipped and security relies on always re-fetching from Mollie API (which is the documented Mollie security pattern).

## Next Phase Readiness
- Mollie EU billing complete — customer creation, mandate-based first payment, webhook-driven subscription creation, and plan change all implemented
- Plan 06-04 (billing UI) can call `/api/billing/mollie/checkout` to get a `checkoutUrl` and redirect the user
- Change-plan UI can call `/api/billing/mollie/change-plan` with `{ newPlanName }`
- Plan 06-02 (iyzico) must be executed separately for TR market billing

## Self-Check: PASSED

All created files exist on disk. All task commits exist in git history. SUMMARY.md created. TypeScript compiles with zero errors.

---
*Phase: 06-billing*
*Completed: 2026-03-05*
