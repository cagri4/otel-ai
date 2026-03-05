---
phase: 08-housekeeping-coordinator
plan: 02
subsystem: agents
tags: [supabase, anthropic, typescript, agent, housekeeping, cron, resend, email]

# Dependency graph
requires:
  - phase: 08-housekeeping-coordinator
    provides: HOUSEKEEPING_COORDINATOR role, housekeeping_queue and housekeeping_staff tables, get_room_status and update_room_status tools, tool executor dispatch pattern
  - phase: 07-booking-ai
    provides: reservations table with room_id FK, milestoneDispatch.ts cron pattern (TZDate timezone math, service client, hotel loop)
  - phase: 05-guest-experience-ai-and-owner-dashboard
    provides: Resend email pattern (milestoneDispatch.ts sendMilestoneEmail), CRON_SECRET guard pattern, vercel.json cron structure

provides:
  - runHousekeepingQueue() cron: priority queue generation from reservations data, idempotent upsert, checkout-room dirty marking
  - /api/cron/housekeeping-queue route handler with CRON_SECRET guard at 07:00 UTC daily
  - second vercel.json cron entry (housekeeping-queue at 0 7 * * *)
  - assignCleaningTask() tool: staff lookup by ILIKE, housekeeping_queue assignment update, Resend email notification
  - assign_cleaning_task registered in registry.ts, executor.ts, agentFactory.ts
  - HOUSEKEEPING_COORDINATOR now has 3 tools (get_room_status, update_room_status, assign_cleaning_task)
  - audit.ts explicit classification for all 3 housekeeping tools

affects:
  - Any future cron jobs (follow housekeepingQueue.ts pattern: upsert ignoreDuplicates, hotel loop, TZDate)
  - Any future tools that send external email (follow assignCleaningTask Resend pattern with RESEND_API_KEY guard)
  - Any future agent role expansions (add tool to registry, executor, factory, audit)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Cron idempotency via upsert with ignoreDuplicates=true on UNIQUE constraint (instead of insert with onConflict — which is not supported by postgrest-js insert overload)
    - Priority queue deduplication in JS: Map<room_id, {priority, reason}> with higher-priority-wins logic
    - Staff assignment email: RESEND_API_KEY guard with graceful degradation returning email_sent=false
    - bookings table lacks room_id FK — only reservations (Phase 7) used for room-level queue generation

key-files:
  created:
    - src/lib/cron/housekeepingQueue.ts
    - src/app/api/cron/housekeeping-queue/route.ts
  modified:
    - vercel.json (second cron entry for housekeeping-queue at 0 7 * * *)
    - src/lib/agents/tools/housekeeping.ts (assignCleaningTask function added)
    - src/lib/agents/tools/registry.ts (assign_cleaning_task tool definition + 3-tool HOUSEKEEPING_COORDINATOR case)
    - src/lib/agents/tools/executor.ts (assign_cleaning_task dispatch with hotel_id injection)
    - src/lib/agents/agentFactory.ts (3 tools + task assignment behavioral prompt)
    - src/lib/agents/audit.ts (get_room_status=OBSERVE, update_room_status=INFORM, assign_cleaning_task=ACT documented)

key-decisions:
  - "Cron idempotency via upsert with ignoreDuplicates=true — postgrest-js insert() does not support onConflict option; upsert() with ignoreDuplicates=true is equivalent to INSERT ON CONFLICT DO NOTHING"
  - "Priority queue deduplication in JS Map: highest-priority entry per room wins; avoids double-counting when a reservation appears in multiple date windows"
  - "bookings table (Phase 5) lacks room_id FK — cron only queries reservations (Phase 7) for room-level housekeeping queue; documented in code comment"
  - "Resend email in assignCleaningTask uses graceful fallback when RESEND_API_KEY unset — returns success:true with email_sent:false; assignment is still recorded in housekeeping_queue"
  - "assign_cleaning_task classified as ACT in audit (sends external email to staff) — falls through to conservative ACT default; documented explicitly in audit.ts comments"
  - "queue update in assignCleaningTask is optional (maybeSingle) — task assignment works even without a queue entry for the room"

patterns-established:
  - "Cron priority queue generation: hotel loop + TZDate + Map deduplication + upsert ignoreDuplicates"
  - "Tool with external side effects (email): RESEND_API_KEY guard, graceful degradation, explicit ACT audit classification"

requirements-completed: [HSKP-03, HSKP-04]

# Metrics
duration: 8min
completed: 2026-03-05
---

# Phase 8 Plan 2: Housekeeping Queue Cron and Task Assignment Summary

**07:00 UTC daily cron generates priority-ranked cleaning queue from reservations data; assign_cleaning_task tool enables owner to assign tasks via chat with Resend email notification to staff**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-05T22:33:01Z
- **Completed:** 2026-03-05T22:41:48Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Built daily housekeeping queue cron with timezone-aware date math, 3-level priority ranking, idempotent upsert, and 7-day rolling cleanup
- Created assign_cleaning_task tool with ILIKE staff resolution, housekeeping_queue assignment update, and Resend email with graceful fallback
- HOUSEKEEPING_COORDINATOR upgraded from 2 to 3 tools; all housekeeping tools classified in audit.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Daily housekeeping priority queue cron** - `908816f` (feat)
2. **Task 2: assign_cleaning_task tool with Resend email notification** - `071c32c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/lib/cron/housekeepingQueue.ts` - runHousekeepingQueue(): hotel loop, TZDate timezone math, priority 1/2/3 queue from reservations, idempotent upsert, checkout-rooms marked dirty, 7-day rolling cleanup
- `src/app/api/cron/housekeeping-queue/route.ts` - CRON_SECRET-guarded GET handler calling runHousekeepingQueue(), returns 200 on error (consistent with milestone-dispatch pattern)
- `vercel.json` - Second cron entry: /api/cron/housekeeping-queue at 0 7 * * *
- `src/lib/agents/tools/housekeeping.ts` - Added assignCleaningTask(): room ILIKE resolution, staff ILIKE resolution (zero/multiple/single match handling), queue update, Resend email with fallback
- `src/lib/agents/tools/registry.ts` - assign_cleaning_task tool definition; HOUSEKEEPING_COORDINATOR case now returns 3 tools
- `src/lib/agents/tools/executor.ts` - assign_cleaning_task dispatch entry with hotel_id injection from ToolContext
- `src/lib/agents/agentFactory.ts` - HOUSEKEEPING_COORDINATOR: 3 tools array + task assignment behavioral prompt block
- `src/lib/agents/audit.ts` - Explicit classification: get_room_status=OBSERVE, update_room_status=INFORM, assign_cleaning_task=ACT (documented with conservative default)

## Decisions Made
- Cron idempotency uses upsert with ignoreDuplicates=true instead of insert — postgrest-js v12 insert() does not accept an onConflict option (TypeScript type error discovered during execution); upsert with ignoreDuplicates=true is semantically equivalent to INSERT ON CONFLICT DO NOTHING
- Priority queue deduplication in JavaScript Map: when a room appears in multiple date windows (e.g., checkout today AND check-in today from different reservations), the highest-priority entry wins
- bookings table has no room_id FK (confirmed from 0005_guest_experience.sql migration) — cron exclusively uses reservations table; commented in source code
- assignCleaningTask returns success:true with email_sent:false when RESEND_API_KEY is missing, ensuring assignment is recorded even without email capability
- Queue update in assignCleaningTask is optional (.maybeSingle()) — the tool works for any room assignment, not just rooms already in today's queue

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Changed insert with onConflict to upsert with ignoreDuplicates**
- **Found during:** Task 1 (housekeeping queue cron, step 5)
- **Issue:** Plan specified INSERT ON CONFLICT DO NOTHING but postgrest-js insert() does not accept onConflict in its options type — TypeScript error: "Object literal may only specify known properties, and 'onConflict' does not exist"
- **Fix:** Replaced `.insert(rows, { onConflict: '...' })` with `.upsert(rows, { onConflict: '...', ignoreDuplicates: true })` which is semantically equivalent
- **Files modified:** src/lib/cron/housekeepingQueue.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 908816f (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Fix preserves idempotency guarantee exactly as specified. Upsert with ignoreDuplicates=true is a direct equivalent of INSERT ON CONFLICT DO NOTHING at the Postgres level.

## Issues Encountered
None beyond the onConflict API type error, which was resolved in-line.

## User Setup Required
None — no new external services required. Resend (already configured for milestone dispatch) handles email. CRON_SECRET already present in Vercel environment. Migration from Phase 8 Plan 1 created the housekeeping_staff table required by assignCleaningTask.

To use task assignment: hotel owners must first add staff members to the housekeeping_staff table (via SQL or a future UI).

## Next Phase Readiness
- Housekeeping Coordinator is fully operational with 3 tools: read status, update status, assign tasks
- Daily queue generates at 07:00 UTC with priority ranking based on checkout/check-in dates
- Staff email notifications are sent via Resend when tasks are assigned through chat
- Phase 8 is now complete — all planned housekeeping coordinator features are implemented

## Self-Check: PASSED

- housekeepingQueue.ts: FOUND
- route.ts at /api/cron/housekeeping-queue: FOUND
- 08-02-SUMMARY.md: FOUND
- Commit 908816f (Task 1): FOUND
- Commit 071c32c (Task 2): FOUND
- TypeScript: ZERO ERRORS

---
*Phase: 08-housekeeping-coordinator*
*Completed: 2026-03-05*
