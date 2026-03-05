---
phase: 04-guest-facing-layer
plan: 05
subsystem: api
tags: [escalation, resend, email, notifications, whatsapp, widget, multilingual, supabase]

# Dependency graph
requires:
  - phase: 04-guest-facing-layer
    provides: invokeAgent.ts (agent orchestrator with handleEndTurn), escalations DB table, Supabase service-role client
  - phase: 02-agent-core
    provides: agentFactory.ts with MULTILINGUAL SUPPORT block, InvokeAgentParams type
provides:
  - Escalation detection (ESCALATION_PHRASES check) in detectAndInsertEscalation()
  - Escalation record insertion to escalations table (fire-and-forget side effect)
  - POST /api/escalations — email notification to hotel owner via Resend
  - notified_at timestamp set on escalation record after delivery
  - DESK-05 multilingual support: MULTILINGUAL SUPPORT block explicitly lists English, Turkish, Dutch, German, French
affects: [05-booking-engine, 06-billing, admin-dashboard]

# Tech tracking
tech-stack:
  added: [resend (email notifications)]
  patterns: [fire-and-forget side effects with .catch() safety, double try/catch safety net for non-blocking operations]

key-files:
  created:
    - src/lib/agents/escalation.ts
    - src/app/api/escalations/route.ts
  modified:
    - src/lib/agents/invokeAgent.ts
    - src/lib/agents/agentFactory.ts

key-decisions:
  - "detectAndInsertEscalation() called without await in handleEndTurn — fire-and-forget with .catch() at call site plus internal try/catch (double safety net)"
  - "EscalationChannel determined from conversationId prefix server-side (wa_ = whatsapp, else widget) — channel param ignored to prevent spoofing"
  - "escalation.ts uses (supabase as unknown as SupabaseClient) cast for insert — same postgrest-js v12 type inference workaround used across codebase"
  - "escalations route uses .returns<Pick<Hotel,...>[]>() for SELECT — consistent with .returns<T>() convention in project"
  - "notified_at update falls back to conversation_id match when no id provided — defensive pattern for race conditions"

patterns-established:
  - "Fire-and-forget async side effects: detectAndInsertEscalation().catch(err => console.error()) — never block response flow"
  - "Double safety net: .catch() at call site + internal try/catch in callee — side effects must never crash the agent"

requirements-completed: [DESK-05, DESK-06]

# Metrics
duration: 12min
completed: 2026-03-05
---

# Phase 4 Plan 05: Escalation Notification System Summary

**Fallback phrase detection inserts escalation records to DB and emails hotel owners via Resend as a fire-and-forget side effect after every agent response (DESK-06), with agentFactory MULTILINGUAL SUPPORT updated to list English, Turkish, Dutch, German, French explicitly (DESK-05)**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-05T11:40:14Z
- **Completed:** 2026-03-05T11:51:44Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `escalation.ts` with 8 ESCALATION_PHRASES constants and `detectAndInsertEscalation()` that detects fallback phrases, inserts to DB, and fires notification (fire-and-forget)
- Created `/api/escalations` POST handler that fetches hotel contact_email, sends Resend email notification, and updates `notified_at` on escalation record
- Wired `detectAndInsertEscalation` into `handleEndTurn()` in `invokeAgent.ts` as non-blocking side effect with double safety net
- Updated `agentFactory.ts` MULTILINGUAL SUPPORT block to explicitly list English, Turkish, Dutch, German, French per DESK-05

## Task Commits

Each task was committed atomically:

1. **Task 1: Create escalation detection and notification endpoint** - `d6a883e` (feat)
2. **Task 2: Wire escalation detection into invokeAgent** - `cd7fa10` (feat)

**Plan metadata:** (to be committed with STATE.md/ROADMAP.md)

## Files Created/Modified
- `src/lib/agents/escalation.ts` - ESCALATION_PHRASES constant + detectAndInsertEscalation() — inserts record to DB and fires POST to /api/escalations
- `src/app/api/escalations/route.ts` - POST handler — fetches hotel contact email, sends Resend notification, updates notified_at
- `src/lib/agents/invokeAgent.ts` - Added detectAndInsertEscalation import and fire-and-forget call in handleEndTurn()
- `src/lib/agents/agentFactory.ts` - MULTILINGUAL SUPPORT block updated with explicit language list (DESK-05)

## Decisions Made
- `detectAndInsertEscalation()` called without await in `handleEndTurn` — fire-and-forget with `.catch()` at call site plus internal try/catch (double safety net). Any error in escalation detection must never slow down or crash the agent response.
- Channel determined server-side from `conversationId` prefix (`wa_` = whatsapp, else widget) — the `channel` param passed by caller is only used as a hint but the actual DB insert uses the prefix-derived value.
- Used `(supabase as unknown as SupabaseClient)` cast for insert in `escalation.ts` — same postgrest-js v12 type inference workaround used throughout the codebase.
- Used `.returns<Pick<Hotel,'name'|'contact_email'>[]>()` for SELECT in escalations route — consistent with project's `.returns<T>()` convention for manual Database types.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added .returns<T>() and SupabaseClient casts for Supabase type inference**
- **Found during:** Task 1 (build verification)
- **Issue:** postgrest-js v12 with manual Database types requires explicit type casts for SELECT `.returns<T[]>()` and INSERT `(supabase as unknown as SupabaseClient)` — without these, TypeScript infers `never` for query results
- **Fix:** Applied `.returns<Pick<Hotel,...>[]>()` for hotel SELECT, `(supabase as unknown as SupabaseClient)` cast for escalation INSERT, and `ReturnType<typeof supabase.from>` cast for UPDATE calls
- **Files modified:** `src/lib/agents/escalation.ts`, `src/app/api/escalations/route.ts`
- **Verification:** `pnpm build` passes with zero TypeScript errors
- **Committed in:** `d6a883e` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug: Supabase type inference)
**Impact on plan:** Required workaround is established project pattern. No scope creep. Build clean.

## Issues Encountered
- Three rounds of build fixes needed for Supabase type inference with manual Database types — each fix applied the pre-established codebase pattern (`.returns<T[]>()`, `SupabaseClient` cast, `ReturnType<typeof supabase.from>` cast for updates).

## User Setup Required
None - no external service configuration required (Resend credentials already in .env).

## Next Phase Readiness
- Escalation notification system complete — hotel owners receive email alerts when AI cannot handle guest requests
- Phase 4 Guest-Facing Layer fully complete (5/5 plans): rate limiting, WhatsApp, widget, i18n, escalation
- Ready for Phase 5: Booking Engine

## Self-Check: PASSED

- `src/lib/agents/escalation.ts` — FOUND
- `src/app/api/escalations/route.ts` — FOUND
- `src/lib/agents/invokeAgent.ts` — FOUND (modified)
- `src/lib/agents/agentFactory.ts` — FOUND (modified)
- Commit `d6a883e` — FOUND
- Commit `cd7fa10` — FOUND

---
*Phase: 04-guest-facing-layer*
*Completed: 2026-03-05*
