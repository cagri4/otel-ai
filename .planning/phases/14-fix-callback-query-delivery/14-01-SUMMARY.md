---
phase: 14-fix-callback-query-delivery
plan: 01
subsystem: api
tags: [telegram, webhook, callback_query, inline-keyboard, admin]

# Dependency graph
requires:
  - phase: 10-super-admin-panel-and-employee-bots
    provides: provisionBots.ts, hotel_bots table, Vault-encrypted bot tokens, get_bot_token RPC
  - phase: 12-billing-model-migration-and-trial-end-flow
    provides: Trial selection inline keyboard flow (PRIC-03, PRIC-04, PRIC-05)
provides:
  - provisionBots.ts registers new employee bots with callback_query in allowed_updates
  - Admin endpoint /api/admin/reprovision-employee-webhooks updates all existing bots
affects: [15-any-future-phase-using-inline-keyboards, trial-selection-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Telegram setWebhook allowed_updates must include both message and callback_query for inline keyboard support"
    - "Re-provision endpoint iterates sequentially (no Promise.all) to respect Telegram rate limits"

key-files:
  created:
    - src/app/api/admin/reprovision-employee-webhooks/route.ts
  modified:
    - src/lib/admin/provisionBots.ts

key-decisions:
  - "Re-provision endpoint omits drop_pending_updates — preserves real pending guest messages on existing bots"
  - "Re-provision queries ALL hotel_bots rows (no is_active filter) — inactive bots updated so reactivation works correctly"
  - "Sequential bot iteration in re-provision loop — no Promise.all to respect Telegram API rate limits at scale"

patterns-established:
  - "Employee bot setWebhook must always include both message and callback_query in allowed_updates"

requirements-completed: [PRIC-03, PRIC-04, PRIC-05]

# Metrics
duration: 2min
completed: 2026-03-06
---

# Phase 14 Plan 01: Fix callback_query Delivery Summary

**Employee bot webhook registrations fixed to include callback_query in allowed_updates, unblocking the trial-end inline keyboard flow via a one-line provisionBots.ts fix and a new admin re-provision endpoint**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-06T19:06:32Z
- **Completed:** 2026-03-06T19:08:46Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Fixed `provisionBots.ts` to register new employee bots with `allowed_updates: ['message', 'callback_query']` — trial selection inline keyboard taps will now reach the server
- Created `/api/admin/reprovision-employee-webhooks` POST endpoint to update all existing hotel_bots without discarding pending guest messages
- Entire PRIC-03/PRIC-04/PRIC-05 trial-end payment flow is now unblocked end-to-end

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix allowed_updates in provisionBots.ts and create admin re-provision endpoint** - `2daad33` (fix)

**Plan metadata:** _(final docs commit below)_

## Files Created/Modified

- `src/lib/admin/provisionBots.ts` - Changed `allowed_updates: ['message']` to `['message', 'callback_query']` on line 111 inside setWebhook body
- `src/app/api/admin/reprovision-employee-webhooks/route.ts` - New admin POST endpoint; SUPER_ADMIN_EMAIL auth guard, queries all hotel_bots via service client, decrypts each token via get_bot_token RPC, calls setWebhook sequentially with corrected allowed_updates and existing webhook_secret, returns structured total/updated/failed/details response

## Decisions Made

- **No drop_pending_updates in re-provision** — this is different from initial provision (which uses drop_pending_updates: true for new bots where no real guests exist). Existing bots may have pending guest messages that must not be discarded.
- **ALL hotel_bots queried (no is_active filter)** — inactive bots should also receive the fix so they work correctly if ever reactivated.
- **Sequential iteration, no Promise.all** — Telegram rate-limit safety at scale.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — TypeScript compiled clean on first run, all verification checks passed immediately.

## User Setup Required

After deploying this change, the super admin must call the re-provision endpoint once to update all existing employee bots:

```bash
curl -X POST https://<app-url>/api/admin/reprovision-employee-webhooks \
  -H "Cookie: <super-admin-session-cookie>"
```

Or via browser: log in as SUPER_ADMIN_EMAIL, then POST to `/api/admin/reprovision-employee-webhooks`.

New bot provisions going forward automatically get the correct allowed_updates — no additional action needed.

## Next Phase Readiness

- Trial-end inline keyboard flow (PRIC-03/04/05) is unblocked. Owner tapping the trial selection keyboard will now trigger `handleTrialCallback` instead of being silently dropped by Telegram.
- No blockers for subsequent phases.

## Self-Check: PASSED

- FOUND: src/lib/admin/provisionBots.ts
- FOUND: src/app/api/admin/reprovision-employee-webhooks/route.ts
- FOUND: .planning/phases/14-fix-callback-query-delivery/14-01-SUMMARY.md
- FOUND commit: 2daad33

---
*Phase: 14-fix-callback-query-delivery*
*Completed: 2026-03-06*
