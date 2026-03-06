---
phase: 14-fix-callback-query-delivery
verified: 2026-03-06T20:30:00Z
status: passed
score: 3/3 must-haves verified
re_verification: false
---

# Phase 14: Fix Callback Query Delivery Verification Report

**Phase Goal:** Trial-end inline keyboard buttons reach the server and the full trial selection -> payment -> deactivation flow works end-to-end
**Verified:** 2026-03-06T20:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Success Criteria (from ROADMAP.md)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Employee bot webhooks registered with `allowed_updates: ['message', 'callback_query']` | VERIFIED | `provisionBots.ts` line 111: `allowed_updates: ['message', 'callback_query']` |
| 2 | Owner tapping trial selection inline keyboard triggers `handleTrialCallback` — no silent drop | VERIFIED | `[slug]/route.ts` dispatches `callback_query` to `handleTrialCallback`; `provisionBots.ts` fix ensures Telegram delivers it |
| 3 | After selection and payment, unselected bots stop responding and selected bots continue | VERIFIED | `trialCallback.ts` deactivates unselected bots (`hotel_bots.is_active = false`) and generates payment link via Mollie/iyzico |

**Score:** 3/3 criteria verified

### Observable Truths (from PLAN frontmatter must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New employee bot provisions include `callback_query` in allowed_updates | VERIFIED | `provisionBots.ts:111` — `allowed_updates: ['message', 'callback_query']` present in `setWebhook` body |
| 2 | Existing employee bots can be re-provisioned via admin endpoint without losing pending guest messages | VERIFIED | `reprovision-employee-webhooks/route.ts` — no `drop_pending_updates` field anywhere in the setWebhook body |
| 3 | After re-provision, owner tapping trial selection inline keyboard triggers handleTrialCallback — no silent drop | VERIFIED | `[slug]/route.ts:91-107` dispatches `callback_query` with `trial_` prefix to `handleTrialCallback`; fix ensures Telegram delivers the update |

**Score:** 3/3 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/admin/provisionBots.ts` | Fixed allowed_updates array including `callback_query` | VERIFIED | Line 111: `allowed_updates: ['message', 'callback_query']` — correct value confirmed |
| `src/app/api/admin/reprovision-employee-webhooks/route.ts` | Admin endpoint to re-provision existing bots | VERIFIED | 194 lines, exports `POST`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` |

### Artifact Level Checks

**`src/lib/admin/provisionBots.ts`**
- Level 1 (Exists): PASS — file present, 211 lines
- Level 2 (Substantive): PASS — contains full `provisionBotForRole` and `provisionAllBots` functions with real Telegram API calls, Vault storage, and DB upsert logic
- Level 3 (Wired): PASS — called by the super admin panel (Phase 10 wiring, unchanged)

**`src/app/api/admin/reprovision-employee-webhooks/route.ts`**
- Level 1 (Exists): PASS — file present, 194 lines
- Level 2 (Substantive): PASS — full implementation: SUPER_ADMIN_EMAIL auth guard, hotel_bots query, sequential for-loop, `get_bot_token` RPC, `setWebhook` fetch per bot, structured JSON response
- Level 3 (Wired): PASS — Next.js App Router auto-discovers the route at `/api/admin/reprovision-employee-webhooks`; POST export present

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/admin/provisionBots.ts` | Telegram setWebhook API | `fetch` with `allowed_updates: ['message', 'callback_query']` | WIRED | Line 111 confirmed; pattern: `allowed_updates: \['message', 'callback_query'\]` |
| `src/app/api/admin/reprovision-employee-webhooks/route.ts` | `hotel_bots` table + `get_bot_token` RPC + Telegram setWebhook | Iterate all bots, decrypt token, call setWebhook with updated allowed_updates | WIRED | Lines 93-95 query hotel_bots; line 122 calls get_bot_token RPC; lines 144-152 call setWebhook with `secret_token` and `allowed_updates: ['message', 'callback_query']` |

### Additional Wiring Verified

- `[slug]/route.ts` dispatches `callback_query` to `handleTrialCallback` (lines 91-107) — pre-existing from Phase 12, confirmed intact
- `trialCallback.ts` deactivates unselected bots (line 307-315: `hotel_bots.update({ is_active: false })`) — pre-existing from Phase 12, confirmed intact
- `trialCallback.ts` generates Mollie/iyzico payment links (lines 340-370) — pre-existing from Phase 12, confirmed intact

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PRIC-03 | 14-01-PLAN.md | Trial-end notification via Telegram with employee selection prompt | SATISFIED | Keyboard delivery now unblocked: `callback_query` in `allowed_updates`; `handleTrialCallback` handles `trial_select` and `trial_confirm` actions; dispatch confirmed in `[slug]/route.ts` |
| PRIC-04 | 14-01-PLAN.md | Selected employees' prices sum to monthly subscription amount | SATISFIED | `trialCallback.ts` `calculateMonthlyTotal` and confirm handler were correct in Phase 12; delivery gap fixed means this path is now reachable |
| PRIC-05 | 14-01-PLAN.md | Payment via existing iyzico (TR) / Mollie (EU) web checkout link | SATISFIED | `trialCallback.ts` lines 342-370 generate Mollie payment link or iyzico dashboard URL; reachable now that `callback_query` is delivered |

**Requirements.md cross-reference:** PRIC-03, PRIC-04, PRIC-05 are all marked `Complete` in the phase mapping table (Phase 14). No orphaned requirements detected.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | None found |

No TODO/FIXME/PLACEHOLDER comments. No empty implementations. No stub return values. Both files are fully implemented.

**Critical anti-pattern absences confirmed (from plan):**
- `drop_pending_updates` absent from re-provision endpoint: CONFIRMED (grep returned no matches in `body: JSON.stringify` block)
- No `Promise.all` in re-provision loop: CONFIRMED (sequential `for (const bot of botRows)` on line 120)
- `secret_token: bot.webhook_secret` present in every setWebhook call: CONFIRMED (line 149)
- No Vault write calls (`create_bot_token_secret`): CONFIRMED — only `get_bot_token` (read) used

---

## TypeScript Compilation

`npx tsc --noEmit` — PASSED (no output, exit code 0). Both files compile without errors.

---

## Human Verification Required

### 1. End-to-End Inline Keyboard Flow

**Test:** Log in as super admin, call `POST /api/admin/reprovision-employee-webhooks`. Then, as hotel owner on Telegram, receive trial-end notification and tap an employee selection button.
**Expected:** Bot responds with updated selection state (toggled employee); tapping Confirm triggers deactivation message and payment link.
**Why human:** Requires live Telegram interaction with a real bot, real webhook delivery, and Supabase Vault decryption — cannot be verified programmatically in a static code check.

### 2. Re-provision Admin Endpoint Auth

**Test:** Call `POST /api/admin/reprovision-employee-webhooks` without a session cookie and with a non-super-admin session.
**Expected:** Returns 401 (no session) and 403 (wrong email) respectively.
**Why human:** Auth guard correctness depends on runtime session state and `SUPER_ADMIN_EMAIL` env var being set in production.

### 3. Pending Messages Preservation

**Test:** With a real bot that has pending guest messages, call the re-provision endpoint and verify those messages are not discarded.
**Expected:** Messages queued before re-provision are still delivered after the setWebhook call completes.
**Why human:** Requires a real Telegram bot with queued updates and live observation — cannot be simulated statically.

---

## Gaps Summary

No gaps found. All automated checks passed.

The phase delivered exactly its two artifacts:
1. `provisionBots.ts` — one-line fix changing `allowed_updates: ['message']` to `['message', 'callback_query']`, ensuring all future employee bot provisions accept inline keyboard taps.
2. `/api/admin/reprovision-employee-webhooks` — fully implemented admin POST endpoint that iterates all `hotel_bots` rows sequentially, decrypts each token via `get_bot_token` RPC, and calls Telegram `setWebhook` with corrected `allowed_updates` while preserving `webhook_secret` and omitting `drop_pending_updates`.

The pre-existing Phase 12 handler code (`handleTrialCallback`, `[slug]/route.ts` dispatch, deactivation logic, payment link generation) was verified intact and correctly wired. The delivery gap was the sole root cause; it is now closed.

---

_Verified: 2026-03-06T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
