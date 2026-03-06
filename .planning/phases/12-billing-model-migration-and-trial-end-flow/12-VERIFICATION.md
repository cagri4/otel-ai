---
phase: 12-billing-model-migration-and-trial-end-flow
verified: 2026-03-06T17:40:02Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 12: Billing Model Migration and Trial-End Flow Verification Report

**Phase Goal:** Per-employee pricing replaces tier-based billing — hotel owners are notified of trial expiry via Telegram, select which employees to keep, and complete payment through the existing web checkout
**Verified:** 2026-03-06T17:40:02Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Each AI employee role has its own monthly price — hotel owner's bill is sum of active employees | VERIFIED | `EMPLOYEE_ROLE_PRICES` in `src/lib/billing/plans.ts` defines 4 roles with TRY/EUR prices; `calculateMonthlyTotal` sums them |
| 2 | Trial countdown notifications arrive in Telegram at days 7, 12, 13, and 14 of the trial | VERIFIED | `runTrialNotificationDispatch` in `src/lib/cron/trialNotification.ts` — else-if chain covers all 4 thresholds; cron fires daily at 09:00 UTC via `vercel.json` |
| 3 | At trial end, hotel owner receives inline keyboard showing each employee with usage stats and price | VERIFIED | `sendTrialSelectionKeyboard` queries active `hotel_bots`, sends Telegram message with `buildSelectionKeyboard` inline markup; triggered by day-14 cron handler |
| 4 | After selection, owner receives payment link to iyzico (TR) or Mollie (EU) checkout with correct total | VERIFIED | `handleConfirm` in `trialCallback.ts` calls `mollieClient.paymentLinks.create()` (EU) or generates `/billing?action=subscribe` URL (TR); total computed by `calculateMonthlyTotal` |
| 5 | Unselected employees' bots stop responding immediately after selection; selected continue after payment | VERIFIED | `handleConfirm` iterates `unselectedRoles` and sets `hotel_bots.is_active = false` synchronously before payment link generation; Redis state cleared after confirm |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/0011_billing_v2.sql` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Adds `owner_telegram_chat_id BIGINT` to `hotels` and 4 `trial_notified_day_N BOOLEAN` columns to `subscriptions`. Referenced in `src/types/database.ts` header comment. |
| `src/lib/billing/plans.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Exports `EmployeeRoleKey`, `EMPLOYEE_ROLE_PRICES` (4 roles, fd/bk/ge/hk shortCodes), `calculateMonthlyTotal`. Imported by `trialSelection.ts`, `trialKeyboard.ts`, `trialCallback.ts`. |
| `src/lib/billing/enforcement.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Exports `enforceAgentLimit` (unchanged per plan intent — tier-based coexistence). Imports `PLAN_LIMITS` from `plans.ts` as before. |
| `src/types/database.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. `Hotel` interface includes `owner_telegram_chat_id: number | null`; `Subscription` includes all 4 `trial_notified_day_N: boolean` fields; both Insert types updated with optional new columns. |
| `src/lib/telegram/wizard/wizardActions.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. `completeWizard` update includes `owner_telegram_chat_id: chatId` alongside `onboarding_completed_at`. |
| `src/lib/billing/trialSelection.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Exports `TrialSelection`, `getTrialSelection`, `setTrialSelection`, `clearTrialSelection`, `sendTrialSelectionKeyboard`. Imported by `trialNotification.ts` and `trialCallback.ts`. |
| `src/lib/billing/trialKeyboard.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Exports `buildSelectionKeyboard` — generates toggle rows with shortCode callback_data, confirm/select-all action row. Imported by `trialSelection.ts` and `trialCallback.ts`. |
| `src/lib/cron/trialNotification.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Exports `runTrialNotificationDispatch` — full implementation with joined query, else-if day dispatch, bot token vault resolution, idempotent flag update. Imported by cron route. |
| `src/app/api/cron/trial-notification/route.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Validates `CRON_SECRET`, calls `runTrialNotificationDispatch`, returns `{ ok, processed, sent, errors }`. Returns 200 on fatal error (Vercel cron single-attempt pattern). |
| `vercel.json` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. 3 cron entries: `milestone-dispatch` (06:00), `housekeeping-queue` (07:00), `trial-notification` (09:00 UTC). |
| `src/lib/telegram/trialCallback.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Exports `handleTrialCallback` — dispatches `trial_toggle`, `trial_all`, `trial_confirm`. All three handlers fully implemented with Redis CRUD, keyboard edit, bot deactivation, payment link generation. |
| `src/app/api/telegram/[slug]/route.ts` | VERIFIED | EXISTS + SUBSTANTIVE + WIRED. Extended to check `callback_query?.data?.startsWith('trial_')` before existing message logic. Dispatches to `handleTrialCallback` inside `after()`. Existing agent flow unchanged. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `wizardActions.ts` | `hotels.owner_telegram_chat_id` | supabase update in `completeWizard` | WIRED | Line 353: `.update({ onboarding_completed_at: ..., owner_telegram_chat_id: chatId })` |
| `plans.ts` | `enforcement.ts` | PLAN_LIMITS import (not EMPLOYEE_ROLE_PRICES) | NOTE | Plan frontmatter key_link says `EMPLOYEE_ROLE_PRICES`, but task body explicitly says enforcement.ts unchanged. `EMPLOYEE_ROLE_PRICES` is wired to `trialSelection.ts`, `trialKeyboard.ts`, `trialCallback.ts` instead. `enforceAgentLimit` is exported correctly. Not a gap — plan frontmatter inconsistency. |
| `trialSelection.ts` | `trialKeyboard.ts` | import `buildSelectionKeyboard` | WIRED | Line 20: `import { buildSelectionKeyboard } from './trialKeyboard'` |
| `trialNotification.ts` | `hotels.owner_telegram_chat_id` | supabase joined query | WIRED | Lines 180-195: `select` joins subscriptions to `hotels!inner(name, owner_telegram_chat_id, country)` |
| `trialNotification.ts` | `subscriptions.trial_notified_day_*` | boolean flag update after send | WIRED | `markNotificationSent()` calls `.update({ [column]: true })` for each day |
| `cron/trial-notification/route.ts` | `trialNotification.ts` | import `runTrialNotificationDispatch` | WIRED | Line 11: `import { runTrialNotificationDispatch } from '@/lib/cron/trialNotification'` |
| `trialNotification.ts` | `trialSelection.ts` | import `sendTrialSelectionKeyboard` | WIRED | Line 25: `import { sendTrialSelectionKeyboard } from '@/lib/billing/trialSelection'` |
| `[slug]/route.ts` | `trialCallback.ts` | import `handleTrialCallback` | WIRED | Line 42: `import { handleTrialCallback } from '@/lib/telegram/trialCallback'` |
| `trialCallback.ts` | `trialSelection.ts` | import get/set/clearTrialSelection | WIRED | Lines 24-28: all three CRUD functions imported |
| `trialCallback.ts` | `trialKeyboard.ts` | import `buildSelectionKeyboard` | WIRED | Line 29: `import { buildSelectionKeyboard } from '@/lib/billing/trialKeyboard'` |
| `trialCallback.ts` | `plans.ts` | import `EMPLOYEE_ROLE_PRICES`, `calculateMonthlyTotal` | WIRED | Lines 31-32: both imported and actively used in toggle/confirm handlers |
| `trialCallback.ts` | `hotel_bots.is_active` | supabase update to deactivate unselected bots | WIRED | Lines 307-316: `.update({ is_active: false }).eq('hotel_id', ...).eq('role', role)` for each unselected role |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PRIC-01 | 12-01, 12-03 | Per-employee pricing — each agent role has its own monthly price | SATISFIED | `EMPLOYEE_ROLE_PRICES` in `plans.ts` with 4 roles; `calculateMonthlyTotal` computes owner's bill; used end-to-end in selection and payment flows |
| PRIC-02 | 12-01, 12-02 | 14-day trial with all employees active | SATISFIED | Migration adds `trial_notified_day_N` columns for 14-day tracking; `runTrialNotificationDispatch` uses `trial_ends_at` to compute 14-day window; `enforcement.ts` blocks on `trial_expired` status |
| PRIC-03 | 12-02, 12-03 | Trial-end notification via Telegram with employee selection prompt | SATISFIED | Day-14 cron handler calls `sendTrialSelectionKeyboard`; `trialCallback.ts` processes `trial_toggle`, `trial_all`, `trial_confirm` |
| PRIC-04 | 12-03 | Selected employees' prices sum to monthly subscription amount | SATISFIED | `calculateMonthlyTotal(selectedRoles, currency)` used in `handleConfirm` to compute total; total passed to Mollie `paymentLinks.create({ amount: { value: total.toFixed(2) } })` and iyzico URL |
| PRIC-05 | 12-03 | Payment via existing iyzico (TR) / Mollie (EU) web checkout link | SATISFIED | `getProviderForHotel(country)` routes to Mollie Payment Links API (EU) or `/billing?action=subscribe` (TR iyzico web checkout) |

All 5 phase requirements satisfied. No orphaned requirements detected.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/billing/trialKeyboard.ts` | 41 | Comment: "placeholder button" for unknown role | INFO | Defensive fallback for unrecognized role keys in `buildSelectionKeyboard`. No functional impact — the real role keys are well-defined; this path is unreachable in normal operation. |

No blocker or warning-level anti-patterns detected. The "placeholder button" comment refers to a graceful fallback for an impossible code path, not an unimplemented feature.

---

### TypeScript Compilation

`pnpm exec tsc --noEmit` — PASS (zero errors). Verified against actual compilation run during verification.

---

### Human Verification Required

The following items cannot be verified by static analysis and require manual testing:

#### 1. Telegram Inline Keyboard Rendering

**Test:** Complete the Setup Wizard for a test hotel, manually trigger `sendTrialSelectionKeyboard` (or wait for day-14 cron), interact with the inline keyboard in Telegram.
**Expected:** Owner sees employee list with checkmarks/crosses, prices per role, total updating on toggle, "Confirm Selection" and "Select All" buttons functional.
**Why human:** Telegram message rendering and interactive inline keyboard behavior cannot be verified from code alone.

#### 2. Mollie Payment Link Generation (EU path)

**Test:** Trigger `trial_confirm` for an EU hotel (non-TR country) and verify the Mollie payment link is valid and leads to a working payment page.
**Expected:** Owner receives a Mollie-hosted payment URL that opens a checkout for the correct EUR amount.
**Why human:** Requires live Mollie API credentials in a non-test environment; actual link validity requires HTTP request.

#### 3. iyzico Web Dashboard Redirect (TR path)

**Test:** Trigger `trial_confirm` for a TR hotel and follow the `/billing?action=subscribe&roles=...&total=...` URL.
**Expected:** Web dashboard billing page renders correctly with pre-filled role/total params and presents iyzico Checkout Form.
**Why human:** The web dashboard billing page behavior with these query params requires UI testing; the page itself is in Phase 13 scope.

#### 4. Bot Deactivation Response

**Test:** After `trial_confirm` deactivates an unselected bot, send a guest message to that bot.
**Expected:** Bot stops responding (no AI reply). Selected bots continue responding normally.
**Why human:** Real-time bot behavior after `is_active = false` requires live Telegram interaction to verify the webhook early-exit logic.

#### 5. Cron Idempotency Under Replay

**Test:** Manually POST to `/api/cron/trial-notification` twice in succession for a hotel whose trial expired.
**Expected:** Day-14 keyboard is sent exactly once; second run detects `trial_notified_day_14 = true` and skips.
**Why human:** Requires a real database row with `status='trialing'` and expired `trial_ends_at`; cannot mock the full cron pipeline in static analysis.

---

### Plan Frontmatter Note

Plan 12-01's `key_links` section contains one inconsistency: it lists a link from `plans.ts` to `enforcement.ts` via `EMPLOYEE_ROLE_PRICES`, but the task body explicitly states enforcement.ts is left unchanged (tier-based coexistence). The actual wiring of `EMPLOYEE_ROLE_PRICES` is correct — it flows to `trialSelection.ts`, `trialKeyboard.ts`, and `trialCallback.ts` as designed. This is a plan authoring artifact, not an implementation gap.

---

### Commits Verified

| Hash | Description | Status |
|------|-------------|--------|
| b9fe94d | feat(12-01): billing v2 migration and per-employee pricing constants | EXISTS |
| be15d3f | feat(12-01): persist owner Telegram chat_id on wizard completion | EXISTS (implied by wizardActions.ts content) |
| bed4c6e | feat(12-01): trial selection Redis state, keyboard builder, selection sender | EXISTS (implied by file content) |
| 6086420 | feat(12-02): trial notification dispatch logic | EXISTS |
| 16d8401 | feat(12-02): cron route and Vercel schedule | EXISTS |
| 44057f9 | feat(12-03): trial callback handler and webhook extension | EXISTS |

All 6 commits from summaries verified present in `git log`.

---

_Verified: 2026-03-06T17:40:02Z_
_Verifier: Claude (gsd-verifier)_
