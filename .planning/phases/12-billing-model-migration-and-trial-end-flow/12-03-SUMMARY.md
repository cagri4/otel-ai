---
phase: 12-billing-model-migration-and-trial-end-flow
plan: "03"
subsystem: billing
tags: [billing, trial, telegram, per-employee-pricing, mollie, iyzico, callback-handler]
dependency_graph:
  requires:
    - 12-01 (EMPLOYEE_ROLE_PRICES, trialSelection.ts, trialKeyboard.ts)
    - 09-telegram-infrastructure (TelegramCallbackQuery type, after() pattern, webhook handler)
    - 06-billing (mollieClient, getProviderForHotel)
  provides:
    - handleTrialCallback (trial-end employee selection callback dispatcher)
    - callback_query routing for trial_ prefix in employee bot webhook
  affects:
    - hotel_bots.is_active (set to false for unselected roles on trial_confirm)
tech_stack:
  added: []
  patterns:
    - Mollie Payment Links API (paymentLink.getPaymentUrl() helper)
    - answerCallbackQuery-first pattern matching wizard callback handler
    - after() wrapping for trial callback handler (prevents Telegram retry)
    - editMessageText to update existing keyboard on toggle
key_files:
  created:
    - src/lib/telegram/trialCallback.ts
  modified:
    - src/app/api/telegram/[slug]/route.ts
decisions:
  - "answerCallbackQuery fetches TrialSelection first to get botToken — slight delay acceptable since state fetch is fast and always required anyway"
  - "Mollie paymentLinks.create() with getPaymentUrl() helper — avoids _links access on Seal type which strips _links"
  - "iyzico confirm redirects to /billing?action=subscribe — cannot generate direct iyzico payment link via Telegram (Turkish national ID required by Checkout Form)"
  - "Unselected bots deactivated synchronously before payment link generation — ensures bots stop immediately regardless of payment status"
  - "editMessageText without reply_markup on confirm — removes keyboard and shows confirmed message"
metrics:
  duration: 4 min
  completed: 2026-03-06
  tasks: 1
  files: 2
---

# Phase 12 Plan 03: Trial Callback Handler and Webhook Extension Summary

**One-liner:** Trial-end inline keyboard handler with toggle/select-all/confirm dispatch, Mollie Payment Links for EU, iyzico web dashboard redirect for TR, and immediate bot deactivation for unselected employees.

## What Was Built

### Task 1: Trial callback handler and webhook extension for callback_query

**`src/lib/telegram/trialCallback.ts`**

New module exporting `handleTrialCallback`. Handles three callback_data patterns:

- **`trial_toggle:{shortCode}`** — finds role by shortCode from `EMPLOYEE_ROLE_PRICES`, toggles selection. Enforces minimum 1 employee: if removal would empty `selectedRoles`, answers with "You must keep at least one employee" toast and returns. Updates Redis state and calls `editMessageText` with new keyboard and updated text.

- **`trial_all`** — sets `selectedRoles = availableRoles` (all selected), updates Redis state, calls `editMessageText` with refreshed keyboard.

- **`trial_confirm`** — validates non-empty selection, deactivates unselected bots via `hotel_bots.is_active = false` (service client cast pattern), fetches hotel country, determines provider via `getProviderForHotel()`, generates Mollie payment link (EU: `paymentLinks.create()` + `getPaymentUrl()`) or iyzico web dashboard URL (TR), sends payment message to owner, clears Redis state, edits original selection message to "Selection confirmed. Proceed to payment."

Internal helpers: `answerCallbackQuery`, `editMessageText`, `sendMessage`, `buildSelectionMessageText` — all `try/catch` wrapped, never throw.

**Design note on `answerCallbackQuery` timing:** The handler fetches `TrialSelection` from Redis first (to obtain `botToken`), then calls `answerCallbackQuery`. This is slightly different from the wizard pattern (which has the token in env). The delay is negligible since Redis is fast and the state fetch is required anyway.

**`src/app/api/telegram/[slug]/route.ts`**

Extended webhook handler to route `callback_query` with `trial_` prefix:

1. After parsing body, checks `body.callback_query?.data?.startsWith('trial_')` before the existing text message check.
2. If trial callback: routes to `handleTrialCallback(callbackQuery, botRow)` inside a new `after()` block, returns 200 immediately.
3. Else: falls through to existing text message / discard logic — **unchanged**.

The import `handleTrialCallback` from `@/lib/telegram/trialCallback` was added at the top.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. `pnpm exec tsc --noEmit` — PASS (zero errors)
2. `trialCallback.ts` handles `trial_toggle`, `trial_all`, and `trial_confirm` — PASS
3. `trialCallback.ts` imports `getTrialSelection`, `setTrialSelection`, `clearTrialSelection` from `trialSelection.ts` — PASS
4. `trialCallback.ts` imports `buildSelectionKeyboard` from `trialKeyboard.ts` — PASS
5. `trial_confirm` deactivates unselected bots (`hotel_bots.is_active = false`) — PASS
6. `trial_confirm` generates Mollie payment link (EU) or iyzico web dashboard URL (TR) — PASS
7. `[slug]/route.ts` routes `callback_query` with `trial_` prefix to `handleTrialCallback` — PASS
8. Existing message handling in `[slug]/route.ts` unchanged — PASS
9. All `after()` patterns used for async work — PASS

## Commits

| Task | Description | Hash |
|------|-------------|------|
| Task 1 | trial callback handler and webhook extension for callback_query | 44057f9 |

## Self-Check: PASSED
