---
phase: 05-guest-experience-ai-and-owner-dashboard
plan: 01
subsystem: database, agents, audit
tags: [supabase, postgres, rls, typescript, anthropic, agent-roles, audit-log]

# Dependency graph
requires:
  - phase: 04-guest-facing-layer
    provides: escalations table, service client, invokeAgent, executeTool pattern
  - phase: 03-knowledge-base-and-onboarding
    provides: seed_hotel_defaults trigger, rooms table pattern
  - phase: 02-agent-core
    provides: AgentRole enum, agentFactory, ToolContext, executor.ts pattern
  - phase: 01-foundation
    provides: hotels table, set_updated_at trigger, RLS JWT pattern

provides:
  - bookings table with RLS (owner SELECT, service INSERT/UPDATE)
  - message_templates table with RLS (owner full CRUD)
  - agents table with RLS (owner SELECT/UPDATE, service INSERT via seed trigger)
  - agent_audit_log table with RLS (owner SELECT, service INSERT, append-only)
  - seed_hotel_defaults extended to insert front_desk and guest_experience agent rows
  - AgentRole.GUEST_EXPERIENCE enum value
  - GUEST_EXPERIENCE agent config in agentFactory (sonnet, no tools, memoryScope none)
  - getToolsForRole case for GUEST_EXPERIENCE returning empty array
  - audit.ts module: classifyAction() (OBSERVE/INFORM/ACT) and writeAuditLog()
  - conversationId field added to ToolContext interface
  - Every executeTool() call now fires writeAuditLog() fire-and-forget
  - invokeAgent() checks is_enabled at depth=0 before proceeding
  - Realtime publications for escalations and agent_audit_log

affects:
  - 05-02 (milestone messaging API — uses bookings, message_templates, GUEST_EXPERIENCE)
  - 05-03 (owner dashboard — uses agents table for on/off toggle, agent_audit_log for display)
  - 05-04 (any Phase 5 features using invokeAgent — now guard-checked)
  - future ACT-class tools (classifyAction defaults unknown tools to ACT)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SupabaseClient cast for new tables (same as escalation.ts) — avoids TypeScript never inference
    - Fire-and-forget audit writes with .catch() — never block tool response for logging
    - is_enabled guard at depth=0 only — prevents per-tool-call overhead, checked once per invocation
    - Conservative ACT default in classifyAction — unknown/future tools treated as most restrictive
    - seed_hotel_defaults extended via CREATE OR REPLACE FUNCTION — avoids new trigger, extends existing

key-files:
  created:
    - supabase/migrations/0005_guest_experience.sql
    - src/lib/agents/audit.ts
  modified:
    - src/types/database.ts
    - src/lib/agents/types.ts
    - src/lib/agents/agentFactory.ts
    - src/lib/agents/tools/registry.ts
    - src/lib/agents/tools/executor.ts
    - src/lib/agents/invokeAgent.ts

key-decisions:
  - "SupabaseClient cast for agents and agent_audit_log tables — manual Database types don't thread through from() inference for new tables until generated types are used; same pattern as escalation.ts"
  - "Conservative ACT default in classifyAction — unknown/future tools default to ACT to prevent false permission assumptions; confirmation gate deferred until first ACT tool exists"
  - "is_enabled guard uses .maybeSingle() not .single() — graceful fallback for hotels created before Phase 5 migration (no agents row yet = treat as enabled)"
  - "seed_hotel_defaults extended via CREATE OR REPLACE FUNCTION in 0005 migration — avoids new trigger, atomically seeds front_desk and guest_experience agents on hotel creation"
  - "GUEST_EXPERIENCE agent uses claude-sonnet-4-6 — internal/background role per project decision (opus for guest-facing only)"

patterns-established:
  - "SupabaseClient cast for new tables: (supabase as unknown as SupabaseClient).from('table').insert(...)"
  - "Audit fire-and-forget: writeAuditLog({...}).catch((err) => console.error('[audit]', err))"
  - "is_enabled guard at depth===0: prevents per-recursive-call overhead, checked once"

requirements-completed:
  - SAFE-01
  - SAFE-02
  - SAFE-03
  - GEXP-04
  - DASH-04
  - DASH-05

# Metrics
duration: 15min
completed: 2026-03-05
---

# Phase 5 Plan 01: Database Foundation and Agent Audit Infrastructure Summary

**Four new Supabase tables (bookings, message_templates, agents, agent_audit_log) with GUEST_EXPERIENCE agent role, automatic tool call audit logging via classifyAction/writeAuditLog, and is_enabled guard in invokeAgent**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-05T13:35:28Z
- **Completed:** 2026-03-05T13:50:34Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Created 4 new tables with RLS, indexes, and correct constraints (bookings, message_templates, agents, agent_audit_log)
- Established GUEST_EXPERIENCE agent role in enum, factory (sonnet, no tools), and tool registry
- Created audit module classifying all existing tools (OBSERVE: get_room_availability, get_room_pricing, lookup_guest_reservation; INFORM: delegate_task, update_hotel_info; ACT: default for unknown/future)
- Every executeTool() call now automatically writes audit log row fire-and-forget
- invokeAgent() checks is_enabled at depth=0 before any agent processing begins

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration and TypeScript types for Phase 5 tables** - `5be52ed` (feat)
2. **Task 2: GUEST_EXPERIENCE role, audit module, and invokeAgent integration** - `9b41285` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `supabase/migrations/0005_guest_experience.sql` — 4 new tables with RLS, Realtime publications, extended seed_hotel_defaults trigger
- `src/types/database.ts` — Added Booking, MessageTemplate, Agent, AgentAuditLog, ActionClass types and Database table entries
- `src/lib/agents/audit.ts` — New module: classifyAction() and writeAuditLog() via service client
- `src/lib/agents/types.ts` — Added AgentRole.GUEST_EXPERIENCE enum value
- `src/lib/agents/agentFactory.ts` — Added GUEST_EXPERIENCE config (sonnet, no tools, memoryScope none, milestone messaging prompts)
- `src/lib/agents/tools/registry.ts` — Added getToolsForRole case for GUEST_EXPERIENCE (returns empty array)
- `src/lib/agents/tools/executor.ts` — Added conversationId to ToolContext; wired writeAuditLog fire-and-forget after every handler
- `src/lib/agents/invokeAgent.ts` — Added is_enabled guard at depth=0; pass conversationId through to executeTool context

## Decisions Made

- SupabaseClient cast for new tables `(supabase as unknown as SupabaseClient).from(...)` — manual Database types don't thread through from() inference for new tables until generated types are used; consistent with escalation.ts pattern from STATE.md
- Conservative ACT default in classifyAction — unknown tools default to ACT to prevent false permission assumptions; owner confirmation gate deferred until first ACT-class tool is added in a future phase
- is_enabled uses `.maybeSingle()` not `.single()` — graceful fallback for hotels created before Phase 5 migration (no agents row = treat as enabled)
- Extended seed_hotel_defaults via `CREATE OR REPLACE FUNCTION` in 0005 migration — cleanest approach without adding a second trigger

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Applied SupabaseClient cast to audit.ts and invokeAgent.ts new table queries**
- **Found during:** Task 2 build verification
- **Issue:** TypeScript `never` inference on `.from('agent_audit_log').insert(...)` and `.from('agents').select('is_enabled')` — manual Database types don't auto-infer for new tables in postgrest-js v12
- **Fix:** Applied `(supabase as unknown as SupabaseClient).from(...)` cast, same pattern as escalation.ts; added explicit `{ is_enabled: boolean }` cast for the agentConfig check
- **Files modified:** src/lib/agents/audit.ts, src/lib/agents/invokeAgent.ts
- **Verification:** Build passes with zero TypeScript errors
- **Committed in:** 9b41285 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - TypeScript compatibility bug)
**Impact on plan:** Auto-fix necessary for TypeScript compilation. Same established project pattern. No scope creep.

## Issues Encountered

- SupabaseClient TypeScript inference for new tables — resolved by applying existing `(supabase as unknown as SupabaseClient)` cast pattern from escalation.ts (documented in project STATE.md decisions)

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All Phase 5 database tables exist and are ready for use
- GUEST_EXPERIENCE agent role is fully registered and usable via agentFactory.getConfig()
- Audit logging is active on all tool calls immediately (no additional wiring needed)
- is_enabled guard protects all agent invocations from disabled agents
- Ready for 05-02: Milestone messaging API (uses bookings, message_templates, GUEST_EXPERIENCE role)
- Ready for 05-03: Owner dashboard (uses agents table for on/off toggle, agent_audit_log for display)

## Self-Check: PASSED

- FOUND: supabase/migrations/0005_guest_experience.sql
- FOUND: src/types/database.ts (updated with 4 new types)
- FOUND: src/lib/agents/audit.ts
- FOUND: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-01-SUMMARY.md
- FOUND: commit 5be52ed (Task 1)
- FOUND: commit 9b41285 (Task 2)
- BUILD: pnpm build passes with zero TypeScript errors

---
*Phase: 05-guest-experience-ai-and-owner-dashboard*
*Completed: 2026-03-05*
