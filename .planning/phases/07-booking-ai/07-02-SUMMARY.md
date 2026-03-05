---
phase: 07-booking-ai
plan: 02
subsystem: api
tags: [agent, booking, claude-opus-4-6, sse, escalation, tool-routing]

# Dependency graph
requires:
  - phase: 07-01
    provides: reservations table, real booking tools (getAvailability, getRoomPricing, lookupGuestReservation)
  - phase: 02-agent-core
    provides: AgentRole enum, ROLE_REGISTRY pattern, agentFactory, getToolsForRole
  - phase: 04-guest-facing-layer
    provides: escalation detection, SSE stream route

provides:
  - BOOKING_AI agent role with AgentRole.BOOKING_AI = "booking_ai" enum value
  - ROLE_REGISTRY entry for BOOKING_AI with claude-opus-4-6 model, 3 booking tools, upsell prompt
  - getToolsForRole(AgentRole.BOOKING_AI) returning availability + pricing + reservation lookup
  - Booking-specific escalation phrases (group booking, corporate rate, special package, etc.)
  - SSE stream route accepts role=booking_ai and routes to AgentRole.BOOKING_AI

affects:
  - 07-03 (rolling context window — BOOKING_AI is now a routable agent)
  - dashboard UI (can now target booking_ai role via SSE stream)
  - widget/WhatsApp channels (future routing to BOOKING_AI)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ROLE_REGISTRY Record<AgentRole, AgentConfig> exhaustive coverage enforced by TypeScript
    - BOOKING_AI has no delegate_task (prevents circular delegation chains from non-FRONT_DESK roles)
    - Tool-first policy enforced in BOOKING_AI behavioral prompt (same pattern as FRONT_DESK)
    - Escalation phrases matched to agent behavioral prompt trigger language

key-files:
  created: []
  modified:
    - src/lib/agents/types.ts
    - src/lib/agents/agentFactory.ts
    - src/lib/agents/tools/registry.ts
    - src/lib/agents/escalation.ts
    - src/app/api/agent/stream/route.ts

key-decisions:
  - "BOOKING_AI gets 3 tools (availability, pricing, reservation lookup) — no delegate_task (prevents circular delegation chains from non-FRONT_DESK roles, per existing project decision)"
  - "BOOKING_AI uses claude-opus-4-6 — guest-facing agent per project decision"
  - "Upsell instruction embedded in behavioral prompt — offer upgrade once naturally, never pressure"
  - "Escalation phrase 'please contact reception directly for this' matches exact trigger phrase from BOOKING_AI behavioral prompt"

patterns-established:
  - "SSE role mapping: roleStr === 'booking_ai' ? AgentRole.BOOKING_AI pattern extends guest_experience precedent"
  - "Booking-specific escalation phrases added to shared ESCALATION_PHRASES array (backward compatible)"

requirements-completed: [BOOK-01, BOOK-04, BOOK-05]

# Metrics
duration: 6min
completed: 2026-03-05
---

# Phase 7 Plan 2: Booking AI Summary

**BOOKING_AI agent role registered with claude-opus-4-6, upsell behavioral prompt, 3 booking tools, escalation triggers for group/corporate requests, and SSE stream routing for role=booking_ai**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-05T20:30:37Z
- **Completed:** 2026-03-05T20:37:20Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `AgentRole.BOOKING_AI = "booking_ai"` to the enum in types.ts — TypeScript enforces exhaustive ROLE_REGISTRY coverage
- Added BOOKING_AI to ROLE_REGISTRY with claude-opus-4-6, tool-first behavioral prompt including natural upsell flow and 5 escalation triggers
- Added `case AgentRole.BOOKING_AI` to `getToolsForRole()` returning 3 booking-specific tools (no delegate_task, no update_hotel_info)
- Extended ESCALATION_PHRASES with 7 booking-specific triggers matching BOOKING_AI behavioral prompt language
- Updated SSE stream POST handler to map `role=booking_ai` to `AgentRole.BOOKING_AI`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add BOOKING_AI to AgentRole enum, ROLE_REGISTRY, and getToolsForRole** - `fe53baa` (feat)
2. **Task 2: Extend escalation phrases and add booking_ai SSE routing** - `c6a70f6` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/lib/agents/types.ts` - Added `BOOKING_AI = "booking_ai"` to AgentRole enum; updated comments for Phase 7
- `src/lib/agents/agentFactory.ts` - Added BOOKING_AI entry to ROLE_REGISTRY (claude-opus-4-6, 3 tools, upsell/escalation behavioral prompt)
- `src/lib/agents/tools/registry.ts` - Added `case AgentRole.BOOKING_AI` to getToolsForRole() returning 3 booking tools
- `src/lib/agents/escalation.ts` - Added 7 booking-specific escalation phrases to ESCALATION_PHRASES array
- `src/app/api/agent/stream/route.ts` - Extended role resolution to map 'booking_ai' to AgentRole.BOOKING_AI

## Decisions Made

- BOOKING_AI gets 3 tools (availability, pricing, reservation lookup) — no delegate_task (prevents circular delegation chains from non-FRONT_DESK roles, per existing project decision)
- BOOKING_AI uses claude-opus-4-6 — guest-facing agent per project decision (STATE.md)
- Upsell instruction embedded in behavioral prompt: "offer upgrade once naturally, then let the guest respond" — non-pressuring approach
- Escalation phrase 'please contact reception directly for this' added to match the exact wording in the BOOKING_AI behavioral prompt trigger pattern
- SSE route role resolution uses ternary chain: guest_experience → GUEST_EXPERIENCE, booking_ai → BOOKING_AI, else → FRONT_DESK (backward compatible)

## Deviations from Plan

### Out-of-Scope Discovery (Not Fixed)

During `git stash pop` (used to check pre-existing error state), a pre-existing memory.ts draft (Plan 03 rolling context window work) was re-introduced as unstaged changes. These changes had TypeScript errors because `ConversationSummary.turns_summarized` type wasn't complete. This was reverted to committed state — it is Plan 03 scope, not Plan 02.

Logged to deferred items: memory.ts Plan 03 draft (rolling context window, summarizeOldTurns) exists as stash work in progress.

Otherwise: None — plan executed exactly as written.

## Issues Encountered

- Old git stash (from Phase 4) was accidentally re-applied during a git stash/pop cycle used to diagnose pre-existing TypeScript errors. The memory.ts changes were Plan 03 scope and reverted to committed state. TypeScript compilation confirmed clean after revert.

## User Setup Required

None - no external service configuration required. BOOKING_AI is routable via the existing SSE stream endpoint without any environment variable changes.

## Next Phase Readiness

- BOOKING_AI is fully registered and routable via `POST /api/agent/stream` with `role: "booking_ai"`
- All 3 booking tools (get_room_availability, get_room_pricing, lookup_guest_reservation) are assigned to BOOKING_AI
- Plan 03 can implement rolling context window summarization (conversation_summaries table already created in Plan 01)
- Dashboard UI could add a BOOKING_AI tab by passing `role: "booking_ai"` to useChatStream

---
*Phase: 07-booking-ai*
*Completed: 2026-03-05*
