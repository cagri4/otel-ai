---
phase: 11-setup-wizard-bot
plan: 01
subsystem: api
tags: [telegram, redis, upstash, wizard, onboarding, state-machine, supabase]

# Dependency graph
requires:
  - phase: 09-telegram-infrastructure
    provides: TelegramUpdate type, sendTelegramReply pattern, escapeMarkdownV2, rateLimiter lazy-init pattern
  - phase: 10-super-admin-panel-and-employee-bots
    provides: hotel_bots table with role/bot_username, onboarding_completed_at column on hotels, seed_hotel_defaults creates trial subscription
provides:
  - Redis-based wizard session CRUD with 7-day TTL (wizardState.ts)
  - 6-step wizard state machine with incremental Supabase writes (wizardSteps.ts)
  - MarkdownV2 message sender, /start deep link handler, callback handler, completion logic (wizardActions.ts)
  - TelegramCallbackQuery type + callback_query field on TelegramUpdate (types.ts)
affects:
  - 11-setup-wizard-bot plan 02 (webhook route handler imports handleWizardMessage, handleWizardCallback)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Lazy-init Redis client with graceful null degradation (isRedisAvailable pattern)
    - Incremental DB writes per wizard step — no single-shot bulk insert
    - MarkdownV2 primary + plaintext fallback for all wizard messages
    - answerCallbackQuery called first before processing inline keyboard data
    - (supabase as unknown as SupabaseClient) cast for manually-typed tables

key-files:
  created:
    - src/lib/telegram/wizard/wizardState.ts
    - src/lib/telegram/wizard/wizardSteps.ts
    - src/lib/telegram/wizard/wizardActions.ts
  modified:
    - src/lib/telegram/types.ts

key-decisions:
  - "sanitizeGuestInput applied in handleWizardMessage before passing text to advanceWizard — double sanitization layer (actions + steps both sanitize)"
  - "completeWizard does NOT touch subscriptions table — trial already created by seed_hotel_defaults at hotel creation (Phase 10 Pitfall 4)"
  - "answerCallbackQuery called unconditionally at start of handleWizardCallback — dismiss spinner before any async work"
  - "getStepPrompt helper for session resume — returns correct question text for each WizardStep without duplicating strings"
  - "upsertHotelFact logs but does not throw on DB error — wizard should not stall on non-critical hotel_facts write failure"

patterns-established:
  - "Wizard state machine: switch/case on WizardState.step, each case sanitizes input, writes to DB, transitions state, sends next prompt"
  - "Redis key pattern: wizard:{chatId} with 7-day TTL reset on every setWizardState call"

requirements-completed: [ONBT-01, ONBT-02, ONBT-03, ONBT-04]

# Metrics
duration: 5min
completed: 2026-03-06
---

# Phase 11 Plan 01: Setup Wizard Bot — State Machine Summary

**Redis-backed 6-step Telegram wizard state machine with incremental Supabase writes, inline keyboard confirmation, and bot-link completion message**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-06T12:21:21Z
- **Completed:** 2026-03-06T12:26:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Extended TelegramUpdate with TelegramCallbackQuery type for inline keyboard support
- Redis-based wizard session CRUD (get/set/clear/isAvailable) with 7-day rolling TTL
- 5-step data-collection state machine with incremental DB writes to hotels and hotel_facts
- /start deep link intake with UUID validation, session resume, and hotel existence check
- Inline keyboard confirmation (wizard:confirm / wizard:restart) with answerCallbackQuery
- completeWizard writes onboarding_completed_at, fetches hotel_bots, sends employee bot links

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Telegram types and create wizard state module** - `e722008` (feat)
2. **Task 2: Create wizard step machine, message helper, and completion logic** - `812910d` (feat)

## Files Created/Modified

- `src/lib/telegram/types.ts` - Added TelegramCallbackQuery interface and callback_query field to TelegramUpdate
- `src/lib/telegram/wizard/wizardState.ts` - Redis CRUD: getWizardState, setWizardState, clearWizardState, isRedisAvailable; WizardState and WizardStep types
- `src/lib/telegram/wizard/wizardSteps.ts` - advanceWizard() state machine: 5 collection steps with hotels/hotel_facts DB writes, confirm_complete inline keyboard
- `src/lib/telegram/wizard/wizardActions.ts` - sendWizardMessage, handleWizardMessage (/start + text routing), handleWizardCallback (confirm/restart), completeWizard

## Decisions Made

- sanitizeGuestInput applied at the message handler level (wizardActions.ts) before passing to advanceWizard, providing a sanitization layer at the entry point
- completeWizard skips subscriptions table — trial subscription is created by seed_hotel_defaults PostgreSQL function at hotel creation time (Phase 10 established this)
- answerCallbackQuery fired unconditionally at the top of handleWizardCallback to dismiss loading spinner before any async DB operations
- upsertHotelFact uses insert (not upsert with onConflict) and logs errors without throwing — wizard should not stall if a hotel_facts write fails

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. SETUP_WIZARD_BOT_TOKEN env var will be configured as part of Plan 02 (webhook route) setup.

## Next Phase Readiness

- All wizard modules ready for Plan 02 webhook route to import
- handleWizardMessage and handleWizardCallback can be directly imported by the /api/telegram/setup-wizard/[slug]/route.ts handler
- Plan 02 will need to pass allowed_updates: ['message', 'callback_query'] when registering the webhook with Telegram

---
*Phase: 11-setup-wizard-bot*
*Completed: 2026-03-06*
