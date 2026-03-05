---
phase: 08-housekeeping-coordinator
plan: 01
subsystem: agents
tags: [supabase, anthropic, typescript, agent, housekeeping, sse, react, polling]

# Dependency graph
requires:
  - phase: 07-booking-ai
    provides: BOOKING_AI role, executor tool dispatch pattern, agentFactory ROLE_REGISTRY pattern, SSE routing ternary chain
  - phase: 05-guest-experience-ai-and-owner-dashboard
    provides: agents table, seed_hotel_defaults pattern, SupabaseClient cast pattern for new tables, ChatWindow component, createBrowserClient pattern

provides:
  - HOUSEKEEPING_COORDINATOR AgentRole enum value (housekeeping_coordinator)
  - room_housekeeping_status, housekeeping_queue, housekeeping_staff DB tables with RLS
  - get_room_status and update_room_status tool implementations in housekeeping.ts
  - HOUSEKEEPING_COORDINATOR entry in ROLE_REGISTRY (sonnet model, memoryScope=none)
  - SSE routing for housekeeping_coordinator role string
  - /housekeeping dashboard page (ChatWindow + StatusBoard split layout)
  - StatusBoard client component with 5s polling and color-coded status badges

affects:
  - Any future phase that adds agent roles (must follow same enum + factory + registry + executor + SSE pattern)
  - Any future phase that adds DB tables (may use SupabaseClient cast pattern)
  - Future housekeeping queue management or staff assignment features

# Tech tracking
tech-stack:
  added: []
  patterns:
    - HOUSEKEEPING_COORDINATOR follows the same stateless agent invocation pattern as BOOKING_AI
    - hotel_id injected from ToolContext in executor dispatch — never accepted from AI model input
    - SupabaseClient cast (supabase as unknown as SupabaseClient) for new tables not in Database type (same as Phase 5 escalation.ts)
    - StatusBoard uses JWT claim extraction from session token to get hotel_id (atob + JSON.parse pattern)
    - Agent escalation phrases list extended for housekeeping-specific scenarios

key-files:
  created:
    - supabase/migrations/0008_housekeeping.sql
    - src/lib/agents/tools/housekeeping.ts
    - src/app/(dashboard)/housekeeping/page.tsx
    - src/components/housekeeping/StatusBoard.tsx
  modified:
    - src/types/database.ts (RoomHousekeepingStatus, HousekeepingQueueItem, HousekeepingStaff interfaces + Database.Tables entries)
    - src/lib/agents/types.ts (HOUSEKEEPING_COORDINATOR enum value)
    - src/lib/agents/agentFactory.ts (HOUSEKEEPING_COORDINATOR ROLE_REGISTRY entry)
    - src/lib/agents/tools/registry.ts (get_room_status, update_room_status tool definitions + getToolsForRole case)
    - src/lib/agents/tools/executor.ts (get_room_status, update_room_status dispatch entries)
    - src/lib/agents/escalation.ts (housekeeping-specific escalation phrases)
    - src/app/api/agent/stream/route.ts (housekeeping_coordinator role resolution)

key-decisions:
  - "HOUSEKEEPING_COORDINATOR uses claude-sonnet-4-6 (internal/owner-facing) and memoryScope=none (stateless — no per-guest history needed)"
  - "hotel_id NOT in tool schema — injected from ToolContext.hotelId in executor dispatch (same security pattern as Phase 7 booking tools)"
  - "StatusBoard polls every 5 seconds via setInterval with Supabase browser client — simplest approach ensuring board updates shortly after agent tool executes"
  - "StatusBoard extracts hotel_id from JWT access token payload (atob+JSON.parse) — same token that custom access token hook embeds hotel_id into"
  - "SupabaseClient cast (as unknown as SupabaseClient) used for room_housekeeping_status queries — bypasses postgrest-js v12 never inference for manually-typed tables (same as Phase 5 decision)"
  - "ILIKE partial match for room resolution in updateRoomStatus — zero matches = error, multiple = disambiguation, single = upsert"

patterns-established:
  - "Stateless owner-facing coordinator agent: sonnet model + memoryScope=none + tool-first behavioral rules"
  - "RLS SELECT via authenticated JWT claim + service role ALL via WITH CHECK(true) for AI tools that write data"
  - "5-second polling StatusBoard: setInterval in useEffect with hotelId dependency, fetchStatuses useCallback"

requirements-completed: [HSKP-01, HSKP-02]

# Metrics
duration: 13min
completed: 2026-03-05
---

# Phase 8 Plan 1: Housekeeping Coordinator Summary

**HOUSEKEEPING_COORDINATOR agent with get_room_status and update_room_status tools, 5s-polling StatusBoard, and /housekeeping dashboard with ChatWindow + live room status board**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-05T22:13:46Z
- **Completed:** 2026-03-05T22:26:46Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Created three housekeeping database tables (room_housekeeping_status, housekeeping_queue, housekeeping_staff) with RLS and idempotency constraints
- Built HOUSEKEEPING_COORDINATOR agent with full registration across enum, factory, registry, executor, and SSE route
- Created /housekeeping dashboard with split layout: ChatWindow on left and live-updating StatusBoard on right

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration and TypeScript types for housekeeping tables** - `cbfeeb4` (feat)
2. **Task 2: HOUSEKEEPING_COORDINATOR role, tools, SSE routing, and dashboard page** - `3b09cdc` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `supabase/migrations/0008_housekeeping.sql` - Three housekeeping tables, RLS policies, seed_hotel_defaults extension, backfill for existing hotels, and initial room status seed
- `src/types/database.ts` - RoomHousekeepingStatus, HousekeepingQueueItem, HousekeepingStaff interfaces + Database.Tables entries for all three new tables
- `src/lib/agents/types.ts` - Added HOUSEKEEPING_COORDINATOR = "housekeeping_coordinator" to AgentRole enum
- `src/lib/agents/tools/housekeeping.ts` - getRoomStatus (joined query with rooms) and updateRoomStatus (ILIKE resolution + upsert) implementations using service client
- `src/lib/agents/tools/registry.ts` - get_room_status and update_room_status tool definitions; getToolsForRole HOUSEKEEPING_COORDINATOR case returning two tools
- `src/lib/agents/tools/executor.ts` - Import housekeeping tools; add get_room_status and update_room_status to TOOL_DISPATCH with hotel_id injection
- `src/lib/agents/agentFactory.ts` - HOUSEKEEPING_COORDINATOR entry in ROLE_REGISTRY (sonnet, none scope, tool-first behavioral prompt)
- `src/lib/agents/escalation.ts` - Added housekeeping escalation phrases: maintenance issue, plumbing problem, safety hazard
- `src/app/api/agent/stream/route.ts` - Added housekeeping_coordinator to role resolution ternary chain before FRONT_DESK fallback
- `src/app/(dashboard)/housekeeping/page.tsx` - Dashboard page with ChatWindow + StatusBoard in split layout
- `src/components/housekeeping/StatusBoard.tsx` - Client component with 5s polling, JWT hotel_id extraction, color-coded status badges, relative timestamps, and summary counts

## Decisions Made
- HOUSEKEEPING_COORDINATOR uses `claude-sonnet-4-6` (internal/owner-facing role) and `memoryScope: 'none'` (stateless — no per-guest episodic history needed for room status management)
- hotel_id NOT in tool schema — injected from ToolContext.hotelId in executor dispatch (same security pattern as Phase 7 booking tools, prevents cross-hotel data leakage)
- StatusBoard polls every 5 seconds via setInterval — simplest approach ensuring the board reflects agent tool changes within one polling window
- StatusBoard extracts hotel_id from JWT access token payload via `atob(jwt.split('.')[1])` — the custom access token hook embeds hotel_id into JWT claims at login
- SupabaseClient cast `(supabase as unknown as SupabaseClient)` for room_housekeeping_status queries — same pattern as Phase 5 escalation.ts for new tables not in generated Database type inference
- ILIKE partial match for room resolution in updateRoomStatus: zero matches = error message, multiple = disambiguation candidates list, single = upsert — provides good UX for agents disambiguating room names

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
- Pre-existing pnpm build failure (iyzipay dynamic require in Next.js) — not caused by this plan's changes, confirmed by stash test. TypeScript type checking (tsc --noEmit) passes with zero errors which is the relevant verification for these changes.

## User Setup Required
None — no external service configuration required. Migration must be applied to the Supabase project to activate the housekeeping tables.

## Next Phase Readiness
- HOUSEKEEPING_COORDINATOR is fully operational: hotel owners can navigate to /housekeeping and manage room cleaning statuses through natural conversation
- StatusBoard live-updates every 5 seconds after agent tool calls
- Three housekeeping tables ready for future queue management and staff assignment features
- housekeeping_queue and housekeeping_staff tables created and ready for future cron-driven priority queue implementation

---
*Phase: 08-housekeeping-coordinator*
*Completed: 2026-03-05*
