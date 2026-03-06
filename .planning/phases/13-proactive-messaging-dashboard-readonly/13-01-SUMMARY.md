---
phase: 13-proactive-messaging-dashboard-readonly
plan: 01
subsystem: infra
tags: [cron, telegram, supabase-vault, date-fns, vercel]

# Dependency graph
requires:
  - phase: 09-telegram-infrastructure
    provides: sendTelegramReply wrapper, bot token vault resolution via get_bot_token RPC
  - phase: 08-housekeeping-coordinator
    provides: housekeeping_queue and room_housekeeping_status tables queried for briefings
  - phase: 07-booking-ai
    provides: reservations table (check-in/check-out/pending queries)
  - phase: 05-guest-experience
    provides: bookings table (pre-arrival/checkout counts), escalations table
  - phase: 12-billing-model-migration-and-trial-end-flow
    provides: trialNotification.ts cron pattern and getFrontDeskBotToken pattern followed exactly
provides:
  - Daily morning briefing dispatch sending role-specific summaries from each active employee bot to hotel owners at 08:00 UTC
  - runMorningBriefingDispatch() with { sent, errors, skipped } result shape
  - getBotToken() helper generalized from getFrontDeskBotToken for any role
  - 4 per-role briefing builders: front_desk, booking_ai, guest_experience, housekeeping_coordinator
  - Cron route at /api/cron/morning-briefing with CRON_SECRET auth and maxDuration=300
  - vercel.json updated to 4 cron entries (06:00/07:00/08:00/09:00 UTC)
affects: [14-future-phases, monitoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - getBotToken() generalized helper pattern for any role (extends getFrontDeskBotToken from trialNotification.ts)
    - ROLE_BRIEFING_BUILDERS dispatch map for per-role function dispatch
    - Sequential 40ms inter-send delay (INTER_SEND_DELAY_MS) between individual Telegram sends

key-files:
  created:
    - src/lib/cron/morningBriefing.ts
    - src/app/api/cron/morning-briefing/route.ts
  modified:
    - vercel.json

key-decisions:
  - "Morning briefing sends from each active bot role, not just front_desk — hotel owner gets distinct message from each AI employee"
  - "40ms delay between each individual send (not per hotel) — ensures rate limit compliance when one hotel has 4 active bots"
  - "Hotels without owner_telegram_chat_id filtered at DB query level (not code) — avoids loading unnecessary hotel data"
  - "ROLE_BRIEFING_BUILDERS dispatch map — unknown roles logged and skipped without crashing the loop"
  - "Timezone-aware date computation via TZDate from @date-fns/tz — same pattern as housekeepingQueue.ts"
  - "08:00 UTC slot confirmed free — chronological order: 06:00 milestone-dispatch, 07:00 housekeeping-queue, 08:00 morning-briefing, 09:00 trial-notification"

patterns-established:
  - "getBotToken(supabase, hotelId, role): generalized bot token resolver for any role — extends getFrontDeskBotToken pattern"
  - "ROLE_BRIEFING_BUILDERS map: role string -> builder function for O(1) dispatch without if/else chains"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-03-06
---

# Phase 13 Plan 01: Morning Briefing Cron Summary

**Daily 08:00 UTC cron that sends role-specific operational briefings from each active AI employee bot to hotel owners via Telegram — check-ins, pending reservations, guest arrivals, and housekeeping status — with 40ms sequential rate limiting.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-06T18:23:42Z
- **Completed:** 2026-03-06T18:26:51Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `morningBriefing.ts` with 4 per-role briefing builders dispatching role-specific Supabase queries with no Claude API calls
- Created cron route at `/api/cron/morning-briefing` following exact `trial-notification` pattern with CRON_SECRET auth and `maxDuration=300`
- Updated `vercel.json` with 4th cron entry at `0 8 * * *` (chronologically between housekeeping-queue and trial-notification)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create morning briefing dispatch logic with per-role briefing builders** - `3a4b351` (feat)
2. **Task 2: Create cron route and register in vercel.json at 08:00 UTC** - `cda8754` (feat)

## Files Created/Modified
- `src/lib/cron/morningBriefing.ts` - Main dispatch logic: runMorningBriefingDispatch(), getBotToken(), 4 role builders, 40ms rate limiting
- `src/app/api/cron/morning-briefing/route.ts` - Vercel cron handler with CRON_SECRET auth, maxDuration=300, 200-on-error pattern
- `vercel.json` - Added morning-briefing cron at 0 8 * * * (4th entry in chronological order)

## Decisions Made
- Morning briefing sends from each active bot role, not just front_desk — hotel owner gets a distinct message from each AI employee they have deployed
- 40ms delay applies between each individual send (not per hotel) — if a hotel has 4 active bots, 4 sends with 40ms gaps each
- Hotels without `owner_telegram_chat_id` filtered at DB query level with `.not('owner_telegram_chat_id', 'is', null)` — avoids loading hotel data unnecessarily
- Unknown bot roles in `ROLE_BRIEFING_BUILDERS` map are logged and skipped without crashing the dispatch loop

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. CRON_SECRET already configured in Vercel environment from prior cron routes.

## Next Phase Readiness
- Morning briefing cron ready for production — will fire daily at 08:00 UTC on next Vercel deployment
- Phase 13 Plan 02 can proceed independently

---
*Phase: 13-proactive-messaging-dashboard-readonly*
*Completed: 2026-03-06*
