---
phase: 12-billing-model-migration-and-trial-end-flow
plan: "02"
subsystem: billing
tags: [billing, trial, cron, telegram, notifications, idempotent]
dependency_graph:
  requires:
    - 12-01 (EMPLOYEE_ROLE_PRICES, sendTrialSelectionKeyboard, trial_notified_day_N columns)
    - 09-telegram-infrastructure (hotel_bots table, get_bot_token RPC, sendTelegramReply)
  provides:
    - runTrialNotificationDispatch (trial countdown cron logic)
    - /api/cron/trial-notification (Vercel cron endpoint)
    - Vercel daily cron schedule at 9 AM UTC
  affects:
    - 12-03-PLAN.md (callback handler receives trial_select keyboard from day-14 trigger)
tech_stack:
  added: []
  patterns:
    - SupabaseClient cast for joined query (subscriptions + hotels inner join)
    - else-if most-recent-first ordering to prevent batch catch-up sends
    - Vault RPC (get_bot_token) for plaintext bot token resolution
    - 200 on fatal error (Vercel cron single-attempt consistency)
key_files:
  created:
    - src/lib/cron/trialNotification.ts
    - src/app/api/cron/trial-notification/route.ts
  modified:
    - vercel.json
decisions:
  - "else-if chaining ordered most-recent-first — prevents batch catch-up sends when a hotel crosses multiple thresholds before first check"
  - "SupabaseClient cast through unknown for joined query — avoids TypeScript never inference from cross-table PostgREST select with manually-typed Database"
metrics:
  duration: 4 min
  completed: 2026-03-06
  tasks: 2
  files: 3
---

# Phase 12 Plan 02: Trial Countdown Notification Cron Summary

**One-liner:** Vercel daily cron at 9 AM UTC sending Telegram countdown notifications to hotel owners at trial days 7, 12, 13, 14 via front desk bot, with idempotent boolean guards and day-14 selection keyboard trigger.

## What Was Built

### Task 1: Trial notification dispatch logic

**`src/lib/cron/trialNotification.ts`**
- `runTrialNotificationDispatch()` — main export, returns `{ processed, sent, errors }`
- Queries all `subscriptions` with `status='trialing'` and `trial_ends_at IS NOT NULL`, inner-joined to `hotels` for `owner_telegram_chat_id` and `country`
- Computes `daysRemaining = Math.ceil((trial_ends_at - now) / ms_per_day)` for each subscription
- else-if chain ordered most-recent-first: `<= 0` (day 14) → `<= 1` (day 13) → `<= 2` (day 12) → `<= 7` (day 7) — only ONE notification sent per hotel per cron run
- Hotels without `owner_telegram_chat_id` skipped silently
- Bot token resolved via `hotel_bots` query (`role='front_desk'`, `is_active=true`) then `get_bot_token` Vault RPC
- Currency determined from `hotel.country === 'TR' ? 'try' : 'eur'`
- Days 7/12/13: `sendTelegramReply` with countdown plain text messages
- Day 14: `sendTrialSelectionKeyboard` presents inline keyboard for employee selection flow (Plan 12-03)
- After each successful send: `markNotificationSent()` sets `trial_notified_day_N = true` (idempotency guard)
- Per-hotel try/catch — errors logged, loop continues, returns 200 even on partial failure

**Notification messages:**
- Day 7: "Your OtelAI trial has 7 days remaining. All your AI employees are working for you! Enjoy the rest of your trial."
- Day 12 (2 days): "Your OtelAI trial ends in 2 days. You'll be asked to select which AI employees to keep. Start thinking about which roles are most valuable to your hotel."
- Day 13 (1 day): "Your OtelAI trial ends tomorrow. After expiry, you'll select your AI team and complete payment to keep them active."
- Day 14 (expired): `sendTrialSelectionKeyboard` — employee selection inline keyboard

### Task 2: Cron route and Vercel schedule

**`src/app/api/cron/trial-notification/route.ts`**
- Follows exact pattern of `milestone-dispatch/route.ts`
- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 300`
- Validates `CRON_SECRET` via `Authorization: Bearer` header
- Calls `runTrialNotificationDispatch()` and returns `{ ok: true, ...result }`
- On fatal error: logs and returns `{ ok: false, error: message }` with status 200 (Vercel cron single-attempt)

**`vercel.json`**
- Added third cron entry: `{ "path": "/api/cron/trial-notification", "schedule": "0 9 * * *" }`
- Runs daily at 9 AM UTC — after milestone-dispatch (6 AM) and housekeeping-queue (7 AM)
- Hotel owners in TR/EU timezones receive notifications during late morning

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript cast through unknown for joined query**
- **Found during:** Task 1 TypeScript check
- **Issue:** `as Array<{ hotels: { ... } }>` failed type narrowing because PostgREST inferred `hotels` as an array type (array-of-objects from inner join), making the direct cast fail with "types not sufficiently overlapping"
- **Fix:** Introduced local `type RawRow` and cast `subscriptions as unknown as RawRow[]` — the established project pattern from milestoneDispatch.ts and other cron files
- **Files modified:** `src/lib/cron/trialNotification.ts`
- **Commit:** 6086420 (same task commit)

## Verification Results

1. `pnpm exec tsc --noEmit` — PASS (zero errors)
2. `src/lib/cron/trialNotification.ts` exports `runTrialNotificationDispatch` — PASS
3. `src/app/api/cron/trial-notification/route.ts` follows milestone-dispatch pattern (CRON_SECRET, 200 on error) — PASS
4. `vercel.json` has 3 cron entries: milestone-dispatch (6 AM), housekeeping-queue (7 AM), trial-notification (9 AM) — PASS
5. Notifications sent via front desk bot token from Vault (get_bot_token RPC) — PASS
6. Boolean tracking columns prevent duplicate sends (else-if idempotency logic) — PASS
7. Hotels without `owner_telegram_chat_id` skipped silently — PASS

## Commits

| Task | Description | Hash |
|------|-------------|------|
| Task 1 | trial notification dispatch logic | 6086420 |
| Task 2 | cron route and Vercel schedule for trial notifications | 16d8401 |

## Self-Check: PASSED
