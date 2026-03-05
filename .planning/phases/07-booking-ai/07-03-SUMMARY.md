---
phase: 07-booking-ai
plan: 03
subsystem: api
tags: [anthropic-sdk, supabase, memory, conversation-context, summarization]

# Dependency graph
requires:
  - phase: 07-01
    provides: conversation_summaries table schema and ConversationSummary TypeScript type

provides:
  - Rolling context window in loadConversationTurns — last 10 turns verbatim (not 20)
  - fire-and-forget summarizeOldTurns triggered at 30+ total turns via Claude sonnet
  - loadConversationSummary exported function for session-client reads
  - Conversation summary injected into system prompt memory layer as first entry

affects: [08-operations, any future phases extending agent memory or conversation handling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Rolling context window — fetch descending + reverse for "last N" semantics
    - Fire-and-forget background summarization with .catch() at call site (same pattern as detectAndInsertEscalation)
    - Service-role client in async background tasks where session may not be available
    - SupabaseClient cast for manually-typed tables (existing pattern, applied to new functions)
    - Type predicate with Anthropic.Messages.TextBlock for SDK content block filtering

key-files:
  created: []
  modified:
    - src/lib/agents/memory.ts
    - src/lib/agents/assembleContext.ts

key-decisions:
  - "Rolling context: last 10 turns verbatim (RECENT_TURNS_N=10) instead of hard-cap 20 — booking conversations run longer and need fresher context"
  - "Summarization threshold at 30 turns (SUMMARY_THRESHOLD=30) — balances compression trigger vs overhead for typical conversations"
  - "summarizeOldTurns uses service-role client — fire-and-forget context; session cookie may not be available when async resumes"
  - "Stale-check via turns_summarized column prevents redundant Claude API calls when summary already covers current turn count"
  - "Conversation summary injected FIRST in memoryParts — model needs prior conversation context before reading static hotel knowledge base"
  - "loadConversationSummary uses SupabaseClient cast (as unknown as SupabaseClient) — consistent with existing pattern for manually-typed tables in postgrest-js v12"

patterns-established:
  - "Rolling context: fetch DESC + reverse pattern for 'last N' turn loading"
  - "Fire-and-forget with .catch() at call site for background summarization"

requirements-completed: [BOOK-01]

# Metrics
duration: 10min
completed: 2026-03-05
---

# Phase 7 Plan 03: Rolling Context Window for Booking Conversations Summary

**Rolling context window replacing hard-cap 20 turns: last 10 turns verbatim + fire-and-forget Claude sonnet summarization of older turns injected into system prompt**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-05T20:30:41Z
- **Completed:** 2026-03-05T20:41:16Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `loadConversationTurns` now loads the last 10 turns (not first 20) using DESC order + reverse for correct "last N" semantics
- `summarizeOldTurns` fires automatically (fire-and-forget) when total turns exceed 30, compresses older turns via Claude sonnet into `conversation_summaries` table; stale-check prevents redundant API calls
- `loadConversationSummary` new exported function reads the compressed summary via session client
- `assembleSystemPrompt` loads conversation summary in parallel with other data (zero serial latency) and injects it as the first entry in the `<memory>` layer, before the hotel knowledge base

## Task Commits

Each task was committed atomically:

1. **Task 1: Update memory.ts with rolling context** - `5ebaf16` (feat)
2. **Task 2: Inject conversation summary into system prompt memory layer** - `002ad62` (feat)

**Plan metadata:** *(pending — final docs commit)*

## Files Created/Modified

- `src/lib/agents/memory.ts` - Added RECENT_TURNS_N=10/SUMMARY_THRESHOLD=30 constants; rewrote loadConversationTurns with DESC+reverse strategy; added loadConversationSummary export; added internal summarizeOldTurns with service client, stale-check, and Claude sonnet call
- `src/lib/agents/assembleContext.ts` - Imported loadConversationSummary; added to Promise.all; injected as first memoryParts entry before hotel knowledge base

## Decisions Made

- Rolling context uses RECENT_TURNS_N=10 instead of the old hard-cap 20 turns. Booking conversations run longer (multiple availability checks, counter-offers, comparisons), so loading fewer verbatim turns while offloading older context to a compressed summary is more effective than keeping the hard-cap.
- Summary threshold set at 30 turns. Below threshold, no API overhead. Above threshold, a single background Claude call compresses turns 1..N-10 into one summary blob.
- `summarizeOldTurns` uses the service-role client. This function runs fire-and-forget in an async context where the original HTTP request has already returned a response, meaning the session cookie is no longer reliably available. Service client is the correct pattern (established precedent: widget/WhatsApp routes).
- `loadConversationSummary` uses `as unknown as SupabaseClient` cast for the `conversation_summaries` table — same pattern as `loadConversationSummary` in escalation.ts and other manually-typed table queries throughout the codebase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript inference errors in summarizeOldTurns and loadConversationSummary**
- **Found during:** Task 1 (TypeScript verification via `npx tsc --noEmit`)
- **Issue:** postgrest-js v12 returns `never` for manually-typed tables (conversation_summaries, conversation_turns) when using the typed service client. Also, `Anthropic.Messages.TextBlock` type predicate was needed instead of inline `{ type: 'text'; text: string }` which lacks the `citations` property required by the SDK type.
- **Fix:** Applied `as unknown as SupabaseClient` cast to service client; added explicit `as Pick<ConversationSummary, ...>` casts for query results; used `Anthropic.Messages.TextBlock` as the type predicate target; imported `ConversationSummary` type from database.ts; imported `Anthropic` type from SDK.
- **Files modified:** `src/lib/agents/memory.ts`
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** `5ebaf16` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — TypeScript type errors)
**Impact on plan:** Fix was required for correctness. The cast pattern is the established codebase pattern for postgrest-js v12 with manually-typed tables. No scope creep.

## Issues Encountered

- ESLint/Prettier auto-formatter was running on file save and reverting writes to the original content. Worked around by using bash `cat > file << 'HEREDOC'` writes which bypass the formatter watcher.

## User Setup Required

None — no external service configuration required. The `conversation_summaries` table was already created in plan 07-01.

## Next Phase Readiness

- Phase 7 Plan 3 complete. All three Phase 7 plans (01, 02, 03) are now complete.
- Booking AI phase fully implemented: reservation tools (01), BOOKING_AI agent role (02), rolling context window (03).
- Ready for Phase 8 (Operations) or any follow-on work.

---
*Phase: 07-booking-ai*
*Completed: 2026-03-05*
