---
phase: 09-telegram-infrastructure
plan: 01
subsystem: database
tags: [telegram, supabase-vault, sql, typescript, hotel-bots, escalation]

# Dependency graph
requires:
  - phase: 04-guest-facing-layer
    provides: escalations table with channel CHECK constraint that is extended here
  - phase: 08-housekeeping-coordinator
    provides: agents and invokeAgent patterns this plan follows
provides:
  - hotel_bots table with vault_secret_id-based token storage (no plaintext tokens)
  - create_bot_token_secret() and get_bot_token() SECURITY DEFINER Vault functions
  - Vault cleanup trigger on hotel_bots DELETE
  - EscalationChannel extended with 'telegram'
  - resolveBot() helper for webhook-to-hotel routing by slug
  - tg_ conversationId prefix detection in escalation.ts and invokeAgent.ts
affects:
  - 09-02 (Telegram webhook handler — depends on resolveBot, hotel_bots schema)
  - 09-03 (sendReply — depends on get_bot_token Vault function)
  - future escalation queries (channel = 'telegram' now valid)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Supabase Vault for bot token storage — vault_secret_id UUID in table, plaintext only via SECURITY DEFINER function
    - webhook_path_slug pattern — random UUID as URL path segment instead of bot token (prevents token exposure in URLs/logs)
    - tg_ conversationId prefix — consistent with wa_ (WhatsApp) and widget_ namespace pattern

key-files:
  created:
    - supabase/migrations/0009_telegram.sql
    - src/lib/telegram/resolveBot.ts
  modified:
    - src/types/database.ts
    - src/lib/agents/escalation.ts
    - src/lib/agents/invokeAgent.ts

key-decisions:
  - "webhook_path_slug is a random UUID (not the bot token) — prevents token exposure in webhook URLs, HTTP logs, and intermediary caches"
  - "No FK constraint from vault_secret_id to vault.secrets — vault schema is internal to Supabase and not available via pg_catalog"
  - "Vault functions restricted to service_role via REVOKE/GRANT — anon and authenticated roles cannot call get_bot_token()"
  - "Vault cleanup trigger deletes vault secret on hotel_bots DELETE — prevents orphaned secrets accumulating"
  - "EscalationChannel parameter type in detectAndInsertEscalation() changed from hardcoded union to EscalationChannel type — stays in sync with DB constraint automatically"
  - "tg_ channel detection uses conversationId prefix (server-side) not channel param — consistent with wa_ pattern, prevents spoofing"
  - "invokeAgent.ts fallback changed from 'dashboard' (invalid) to 'widget' — DB CHECK constraint only allows whatsapp | widget | telegram"

patterns-established:
  - "Supabase Vault pattern: store bot tokens via create_bot_token_secret(), save returned UUID as vault_secret_id, retrieve via get_bot_token()"
  - "webhook_path_slug routing: Telegram webhook URL contains random UUID slug, resolveBot() maps slug to hotel context"
  - "Conversation ID prefix for Telegram: tg_{hotelId}_{role} — consistent with wa_ and widget_ namespace"

requirements-completed: [TGIF-04, TGIF-05, EBOT-05]

# Metrics
duration: 4min
completed: 2026-03-06
---

# Phase 9 Plan 01: Telegram Infrastructure Foundation Summary

**hotel_bots table with Supabase Vault token encryption, SECURITY DEFINER Vault functions, resolveBot() webhook routing helper, and EscalationChannel extended to 'telegram'**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-06T09:46:42Z
- **Completed:** 2026-03-06T09:50:19Z
- **Tasks:** 2
- **Files modified:** 5 (1 created migration, 1 created resolveBot.ts, 3 updated)

## Accomplishments
- Created 0009_telegram.sql: hotel_bots table, RLS policies, two SECURITY DEFINER Vault functions, Vault cleanup trigger, escalation channel extension
- Created resolveBot.ts: looks up active bot by webhook_path_slug using service client, returns hotel_id + role + vault_secret_id + webhook_secret
- Extended EscalationChannel type and DB CHECK constraint to include 'telegram'
- Added tg_ prefix detection in escalation.ts (channel detection) and invokeAgent.ts (handleEndTurn call site)
- Fixed invokeAgent.ts fallback from invalid 'dashboard' to 'widget' (DB constraint compliance)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 0009_telegram.sql migration** - `31cec31` (feat)
2. **Task 2: Add HotelBot type, update EscalationChannel, create resolveBot** - `86befca` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `supabase/migrations/0009_telegram.sql` - hotel_bots table, Vault functions, cleanup trigger, escalation extension
- `src/lib/telegram/resolveBot.ts` - Bot lookup by webhook_path_slug using service client
- `src/types/database.ts` - Added HotelBot interface; EscalationChannel now includes 'telegram'; 0009 migration comment added
- `src/lib/agents/escalation.ts` - channel param type changed to EscalationChannel; tg_ prefix detection added
- `src/lib/agents/invokeAgent.ts` - handleEndTurn: tg_ branch added before widget_; fallback fixed from 'dashboard' to 'widget'

## Decisions Made
- `webhook_path_slug` stores a random UUID (not the bot token) as the webhook URL path segment — prevents bot token exposure in URLs and logs
- No FK constraint from `vault_secret_id` to `vault.secrets` — Supabase Vault schema is internal and not addressable via `pg_catalog`
- `get_bot_token()` and `create_bot_token_secret()` are SECURITY DEFINER with REVOKE from PUBLIC/anon/authenticated, GRANT to service_role only
- Vault cleanup trigger deletes the corresponding vault secret when a hotel_bots row is removed
- `detectAndInsertEscalation()` channel parameter type changed from `'whatsapp' | 'widget' | 'dashboard'` to `EscalationChannel` — ensures type stays in sync with DB constraint without manual updates
- `invokeAgent.ts` fallback channel changed from `'dashboard'` (not in DB CHECK constraint) to `'widget'`

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The Vault functions will work automatically once applied to the Supabase database via `supabase db push` or the dashboard SQL editor.

## Next Phase Readiness
- hotel_bots schema is ready for bot registration (Plan 02: webhook handler)
- resolveBot() ready for use in the Telegram webhook route handler
- Vault functions ready for getBot token retrieval in sendReply
- EscalationChannel + tg_ detection ready for Telegram conversations flowing through invokeAgent()
- TypeScript: zero compilation errors, all types aligned with migration schema

---
*Phase: 09-telegram-infrastructure*
*Completed: 2026-03-06*
