---
phase: 12-billing-model-migration-and-trial-end-flow
plan: "01"
subsystem: billing
tags: [billing, per-employee-pricing, migration, telegram, redis, trial]
dependency_graph:
  requires:
    - 11-setup-wizard-bot (hotel_bots table, wizard completion flow)
    - 09-telegram-infrastructure (bot token, hotel_bots schema)
  provides:
    - EMPLOYEE_ROLE_PRICES (per-employee pricing constants)
    - owner_telegram_chat_id persistence
    - trial notification tracking columns
    - TrialSelection Redis CRUD
    - sendTrialSelectionKeyboard (shared entry point)
    - buildSelectionKeyboard (inline keyboard builder)
  affects:
    - 12-02-PLAN.md (cron imports sendTrialSelectionKeyboard)
    - 12-03-PLAN.md (callback handler imports getTrialSelection, setTrialSelection)
tech_stack:
  added:
    - Upstash Redis (same @upstash/redis client pattern as wizardState.ts)
  patterns:
    - Lazy-init Redis singleton (same pattern as wizardState.ts)
    - SupabaseClient cast for manually-typed tables
    - Telegram Bot API sendMessage with inline keyboard
key_files:
  created:
    - supabase/migrations/0011_billing_v2.sql
    - src/lib/billing/trialSelection.ts
    - src/lib/billing/trialKeyboard.ts
  modified:
    - src/lib/billing/plans.ts
    - src/types/database.ts
    - src/lib/telegram/wizard/wizardActions.ts
decisions:
  - "EmployeeRoleKey uses shortCode (2 letters) for Telegram callback_data — stays within 64-byte limit"
  - "All roles selected by default in sendTrialSelectionKeyboard — owner deselects, not selects"
  - "trialSelect:{chatId} key pattern with 1-hour TTL — shorter than wizard 7-day TTL since selection is transient"
  - "enforcement.ts left unchanged — tier-based enforceAgentLimit coexists with per-employee model until fully wired in later phase"
  - "EMPLOYEE_ROLE_PRICES defined alongside existing PLAN_PRICES — backward compatible, no breaking changes"
metrics:
  duration: 7 min
  completed: 2026-03-06
  tasks: 3
  files: 6
---

# Phase 12 Plan 01: Billing V2 Migration and Per-Employee Pricing Foundation Summary

**One-liner:** Per-employee pricing constants (TRY/EUR with 2-letter shortCodes), DB migration for owner chat_id and trial notification tracking, Redis-backed trial selection state with inline keyboard builder.

## What Was Built

### Task 1: Database migration and per-employee pricing constants

**`supabase/migrations/0011_billing_v2.sql`**
- `ALTER TABLE hotels ADD COLUMN owner_telegram_chat_id BIGINT` — nullable, set on wizard completion
- 4 `ALTER TABLE subscriptions ADD COLUMN trial_notified_day_N BOOLEAN NOT NULL DEFAULT FALSE` — idempotency guards for cron

**`src/lib/billing/plans.ts`** (additive — existing tier constants unchanged)
- `EmployeeRoleKey` type union for 4 employee roles
- `EMPLOYEE_ROLE_PRICES` record with `try`, `eur`, `displayName`, and 2-letter `shortCode` per role
- `calculateMonthlyTotal(roles, currency)` helper

**`src/types/database.ts`**
- `Hotel` interface gains `owner_telegram_chat_id: number | null`
- `Subscription` interface gains `trial_notified_day_7/12/13/14: boolean`
- `Database.public.Tables.hotels.Insert` and `subscriptions.Insert` updated with optional new columns

### Task 2: Persist owner Telegram chat_id in wizard completion

**`src/lib/telegram/wizard/wizardActions.ts`**
- `completeWizard` update call extended: `owner_telegram_chat_id: chatId` added alongside `onboarding_completed_at`
- No other changes to wizardActions.ts

### Task 3: Trial selection state, keyboard builder, and selection sender

**`src/lib/billing/trialKeyboard.ts`**
- `buildSelectionKeyboard(availableRoles, selectedRoles, currency)` — returns Telegram inline keyboard
- Checkmark (✅) for selected roles, cross (❌) for deselected
- Each role row shows: `{prefix} {displayName} — {price} {CUR}/mo`
- `callback_data = "trial_toggle:{shortCode}"` (e.g. `trial_toggle:fd`)
- Action row: `Confirm Selection` (trial_confirm) + `Select All` (trial_all)

**`src/lib/billing/trialSelection.ts`**
- `TrialSelection` interface with hotelId, chatId, botToken, messageId, selectedRoles, availableRoles, currency
- `getTrialSelection(chatId)` / `setTrialSelection(chatId, state)` / `clearTrialSelection(chatId)` — Redis CRUD with 1-hour TTL
- `sendTrialSelectionKeyboard({ hotelId, chatId, botToken, currency })` — queries active hotel_bots, initializes all-selected state, sends message with inline keyboard, stores message_id + state in Redis

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. `pnpm exec tsc --noEmit` — PASS (zero errors)
2. `0011_billing_v2.sql` contains ALTER TABLE for both hotels and subscriptions — PASS
3. `plans.ts` exports EMPLOYEE_ROLE_PRICES with 4 roles (fd/bk/ge/hk shortCodes) — PASS
4. `plans.ts` exports calculateMonthlyTotal — PASS
5. `database.ts` Hotel interface includes `owner_telegram_chat_id: number | null` — PASS
6. `database.ts` Subscription interface includes all 4 `trial_notified_day_N: boolean` fields — PASS
7. `wizardActions.ts` completeWizard update includes `owner_telegram_chat_id: chatId` — PASS
8. `trialSelection.ts` exports getTrialSelection, setTrialSelection, clearTrialSelection, sendTrialSelectionKeyboard — PASS
9. `trialKeyboard.ts` exports buildSelectionKeyboard — PASS

## Commits

| Task | Description | Hash |
|------|-------------|------|
| Task 1 | billing v2 migration and per-employee pricing constants | b9fe94d |
| Task 2 | persist owner Telegram chat_id on wizard completion | be15d3f |
| Task 3 | trial selection Redis state, keyboard builder, and selection sender | bed4c6e |

## Self-Check: PASSED
