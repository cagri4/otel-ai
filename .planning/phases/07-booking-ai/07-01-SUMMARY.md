---
phase: 07-booking-ai
plan: 01
subsystem: database
tags: [supabase, postgresql, rls, migrations, tools, booking]

# Dependency graph
requires:
  - phase: 06-billing
    provides: seed_hotel_defaults with subscriptions, agents table (front_desk, guest_experience)
  - phase: 03-knowledge-base
    provides: rooms table (room_id FK, base_price_note field used by getRoomPricing)
  - phase: 02-agent-core
    provides: tool executor pattern (ToolContext, TOOL_DISPATCH, executeTool), stubs.ts
provides:
  - reservations table with hotel_id/room_id FKs, date constraints, status CHECK, RLS
  - conversation_summaries table with conversation_id PK for plan 07-03 summarization
  - Real getAvailability tool (overlap detection against reservations table)
  - Real getRoomPricing tool (base_price_note from rooms table)
  - Real lookupGuestReservation tool (name/phone search against reservations table)
  - hotel_id injection pattern in executor dispatch map (security critical)
  - Reservation and ConversationSummary TypeScript interfaces in database.ts
affects:
  - 07-02-PLAN.md (booking AI agent uses these tools)
  - 07-03-PLAN.md (uses conversation_summaries table)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Service-role client in tool implementations (no user session in webhook context)
    - hotel_id injected from ToolContext in executor dispatch (never from AI model input)
    - Standard half-open interval overlap detection (.lt check_in_date, .gt check_out_date)
    - CREATE OR REPLACE FUNCTION pattern for extending seed_hotel_defaults across migrations

key-files:
  created:
    - supabase/migrations/0007_booking_ai.sql
    - src/lib/agents/tools/availability.ts
    - src/lib/agents/tools/pricing.ts
  modified:
    - src/types/database.ts
    - src/lib/agents/tools/stubs.ts
    - src/lib/agents/tools/executor.ts

key-decisions:
  - "hotel_id injected from ToolContext.hotelId in executor dispatch — never accepted from AI model input to prevent cross-hotel data leakage (Pitfall 1 from Phase 7 research)"
  - "Overlap detection uses half-open interval: .lt(check_in_date, check_out).gt(check_out_date, check_in) — excludes back-to-back reservations from overlap"
  - "base_price_note returned as-is (freeform text) from getRoomPricing — consistent with Phase 3 decision, not computed price"

patterns-established:
  - "Tool dispatch injects hotel_id: tool implementations receive hotel_id via spread ({...input, hotel_id: context.hotelId}) not from AI model's tool_use input block"
  - "Service client in booking tools: createServiceClient() used because tools run in webhook/widget context without authenticated user session"

requirements-completed: [BOOK-02, BOOK-03]

# Metrics
duration: 4min
completed: 2026-03-05
---

# Phase 7 Plan 01: Booking AI Foundation Summary

**Real Supabase queries replace stub tools: reservations table, overlap-based availability detection, freeform pricing lookup, and hotel-scoped guest reservation search**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T20:20:11Z
- **Completed:** 2026-03-05T20:24:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created `reservations` table with hotel_id/room_id FKs, status CHECK constraint ('pending'/'confirmed'/'cancelled'), check_dates constraint (check_out > check_in), and RLS policies for hotel-scoped reads
- Created `conversation_summaries` table with TEXT primary key for plan 07-03 progressive summarization
- Extended `seed_hotel_defaults()` to add `booking_ai` agent row alongside front_desk and guest_experience; backfilled for existing hotels
- Replaced three stub tools with real Supabase service-client queries: `getAvailability` (overlap detection), `getRoomPricing` (base_price_note), `lookupGuestReservation` (name/phone search)
- Added `Reservation` and `ConversationSummary` TypeScript interfaces to `database.ts` with `Database.Tables` entries
- Updated executor dispatch map to inject `hotel_id: context.hotelId` into all three booking tools (prevents cross-hotel data leakage)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration 0007_booking_ai.sql** - `f3eb351` (feat)
2. **Task 2: TypeScript types, real tool implementations, executor update** - `ec1488b` (feat)

**Plan metadata:** _(created next)_

## Files Created/Modified
- `supabase/migrations/0007_booking_ai.sql` - reservations table, conversation_summaries table, RLS, indexes, seed update, backfill
- `src/lib/agents/tools/availability.ts` - Real getAvailability with overlap detection (.lt/.gt date range)
- `src/lib/agents/tools/pricing.ts` - Real getRoomPricing returning base_price_note from rooms table
- `src/lib/agents/tools/stubs.ts` - Removed getAvailability/getRoomPricing stubs; real lookupGuestReservation query
- `src/lib/agents/tools/executor.ts` - Import from ./availability and ./pricing; hotel_id injection in all 3 dispatch entries
- `src/types/database.ts` - Added Reservation, ConversationSummary interfaces and Database.Tables entries

## Decisions Made
- hotel_id injected from ToolContext in executor dispatch rather than accepted from AI model input — prevents cross-hotel data leakage (security critical, Pitfall 1 from Phase 7 research)
- Overlap detection uses standard half-open interval pattern `.lt('check_in_date', check_out).gt('check_out_date', check_in)` — correctly excludes back-to-back same-day reservations
- base_price_note returned as-is (freeform string) — consistent with Phase 3 decision "base_price_note as freeform text for agent display only"

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — TypeScript compiled on first attempt.

## User Setup Required

**Run the migration against Supabase** to create the reservations and conversation_summaries tables:

```bash
# Using Supabase CLI (if available)
supabase db push

# Or apply manually via Supabase Dashboard SQL Editor:
# supabase/migrations/0007_booking_ai.sql
```

The migration is backward-safe: the backfill INSERT uses ON CONFLICT DO NOTHING.

## Next Phase Readiness
- Reservations table, real availability/pricing/lookup tools, and hotel_id injection are all in place
- Plan 07-02 can now build the booking AI agent that uses these tools
- Plan 07-03 can use conversation_summaries table for progressive summarization

---
*Phase: 07-booking-ai*
*Completed: 2026-03-05*
