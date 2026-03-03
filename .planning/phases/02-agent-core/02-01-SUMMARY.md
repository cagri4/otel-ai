---
phase: 02-agent-core
plan: 01
subsystem: database
tags: [supabase, postgresql, rls, typescript, memory, agent]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: hotels table, profiles table, set_updated_at trigger, RLS JWT pattern
provides:
  - "hotel_facts table (semantic memory tier) with RLS and set_updated_at trigger"
  - "guest_interactions table (episodic memory tier) with RLS"
  - "conversation_turns table (working memory tier) with RLS"
  - "agent_tasks table (task coordination) with task_status enum and set_updated_at trigger"
  - "TypeScript interfaces: HotelFact, GuestInteraction, ConversationTurn, AgentTask, TaskStatus"
  - "Agent domain types: AgentRole enum, AgentConfig, InvokeAgentParams, ChatMessage, MessageParam"
  - "Memory helpers: loadConversationTurns, persistTurn, loadSemanticFacts, loadEpisodicHistory, persistEpisodicMemory"
affects:
  - 02-02-agent-invoke
  - 02-03-chat-api
  - 02-04-chat-ui

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ".returns<T>() on Supabase SELECT queries to bypass postgrest-js v12 type inference with manual Database types"
    - "SupabaseClient cast + Record<string, unknown> for INSERT queries with manual Database types"
    - "Three-tier memory architecture: semantic (hotel_facts) / episodic (guest_interactions) / working (conversation_turns)"
    - "AgentRole enum with commented placeholder roles for future phases"

key-files:
  created:
    - supabase/migrations/0002_agent_core.sql
    - src/lib/agents/types.ts
    - src/lib/agents/memory.ts
  modified:
    - src/types/database.ts

key-decisions:
  - "Conversation turns limited to 20 (not unlimited) to prevent context rot per research recommendation"
  - "Episodic history capped at 100 rows maximum safety limit even in 'full' scope"
  - "Tool result turns stored with role='tool' and reconstructed as user-turn tool_result blocks on load (Anthropic API requirement)"
  - ".returns<T>() used for SELECT queries; SupabaseClient unknown cast for INSERT — workaround for postgrest-js v12 type inference with manually-written Database types (generated types don't need this)"
  - "No service_role client used anywhere in memory helpers — all queries respect RLS via anon key + session cookie"

patterns-established:
  - "Supabase SELECT with manual types: .from('table').select('*').returns<T[]>()"
  - "Supabase INSERT with manual types: (supabase as unknown as SupabaseClient).from('table').insert(payload as Record<string, unknown>)"
  - "RLS pattern: hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid (caches JWT per statement)"

requirements-completed: [AGENT-04]

# Metrics
duration: 19min
completed: 2026-03-03
---

# Phase 02 Plan 01: Agent Core Foundation Summary

**SQL migration + TypeScript types for three-tier agent memory (hotel_facts, guest_interactions, conversation_turns, agent_tasks) and 5 memory read/write helpers using server Supabase client with RLS**

## Performance

- **Duration:** 19 min
- **Started:** 2026-03-03T10:00:30Z
- **Completed:** 2026-03-03T10:19:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Four Supabase tables created via 0002_agent_core.sql with RLS policies, indexes, and triggers reusing the set_updated_at function from Phase 1
- TypeScript Database wrapper extended with all four table Row/Insert/Update types plus task_status enum
- Agent domain types established: AgentRole enum, AgentConfig, InvokeAgentParams, ChatMessage, MessageParam with inline Anthropic-compatible content block types (TODO: replace with SDK types in 02-02)
- Five memory helpers implemented covering all three memory tiers: loadConversationTurns (20-turn limit), persistTurn, loadSemanticFacts (grouped by category), loadEpisodicHistory (full/recent_30/none scope), persistEpisodicMemory

## Task Commits

Each task was committed atomically:

1. **Task 1: SQL migration and TypeScript database types** - `f7d58e6` (feat)
2. **Task 2: Memory read/write helpers** - `3e49fc5` (feat)

**Plan metadata:** (next commit — docs)

## Files Created/Modified
- `supabase/migrations/0002_agent_core.sql` - Four CREATE TABLE statements, task_status enum, RLS policies, indexes, triggers
- `src/types/database.ts` - Added HotelFact, GuestInteraction, ConversationTurn, AgentTask interfaces + Database wrapper entries
- `src/lib/agents/types.ts` - AgentRole enum, AgentConfig, InvokeAgentParams, ChatMessage, MessageParam, ContentBlock types
- `src/lib/agents/memory.ts` - 5 async memory helper functions with typed Supabase queries

## Decisions Made
- `.returns<T>()` pattern chosen for SELECT queries to work around postgrest-js v12 type inference limitation with manually-written Database types — this is a known compatibility gap until generated types are in place
- INSERT queries use `(supabase as unknown as SupabaseClient)` + `as Record<string, unknown>` cast — same pattern as existing `actions.ts` in Phase 1
- AgentRole enum uses string values matching DB `from_role`/`to_role` columns to avoid separate type mapping
- ContentBlock and MessageParam defined inline in types.ts with TODO comment to replace with Anthropic SDK types in Plan 02-02

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added .returns<T>() to all SELECT queries and cast pattern for INSERT**
- **Found during:** Task 2 (Memory read/write helpers)
- **Issue:** supabase-js v2.98 (postgrest-js v12) cannot infer Row types from manually-written Database types without `.returns<T>()`. TypeScript reported `type 'never'` for all `.data` results from SELECT and INSERT queries on the new tables. The existing `hotels` table queries in Phase 1 worked because they used `.single<Hotel>()` or explicit `as` casts — this difference was not visible until new queries were written without those casts.
- **Fix:** Added `.returns<T[]>()` to all SELECT queries. For INSERT + SELECT + single() chain, used `(supabase as unknown as SupabaseClient).from(...)` with `insert(payload as Record<string, unknown>)` and final `data as T` cast — matching the pattern already established in `src/app/(dashboard)/settings/actions.ts`.
- **Files modified:** src/lib/agents/memory.ts
- **Verification:** `pnpm build` passes with zero TypeScript errors
- **Committed in:** 3e49fc5 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required fix for TypeScript compilation. No scope creep. Pattern is consistent with existing codebase workaround for the same issue.

## Issues Encountered
- postgrest-js v12 type inference with manual Database types is different from generated types. The `.returns<T>()` workaround is stable and well-documented. Long-term fix is to switch to `supabase gen types typescript` in a future phase.

## User Setup Required
**External services require manual configuration.** The SQL migration `supabase/migrations/0002_agent_core.sql` must be applied to Supabase manually:

1. Go to Supabase Dashboard > SQL Editor
2. Paste the contents of `supabase/migrations/0002_agent_core.sql`
3. Run the migration
4. Verify in Table Editor that hotel_facts, guest_interactions, conversation_turns, agent_tasks tables exist

## Next Phase Readiness
- All tables and types ready for Plan 02-02 (agent invocation with Anthropic SDK)
- Memory helpers provide complete read/write interface for three-tier memory
- AgentConfig and InvokeAgentParams types define the invokeAgent() function signature
- No blockers

---
*Phase: 02-agent-core*
*Completed: 2026-03-03*
