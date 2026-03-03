---
phase: 02-agent-core
plan: 02
subsystem: api
tags: [anthropic, claude, agent, tool-use, streaming, typescript]

# Dependency graph
requires:
  - phase: 02-01
    provides: "Three-tier memory helpers (loadConversationTurns, persistTurn, loadSemanticFacts, loadEpisodicHistory), TypeScript types for agent system, SQL schema for conversation_turns, hotel_facts, guest_interactions"

provides:
  - "Anthropic SDK installed and configured"
  - "Tool registry with 3 tool definitions in Anthropic JSON Schema format"
  - "Stub tool implementations returning mock data (Phase 7 will replace with real DB queries)"
  - "Agent Factory mapping FRONT_DESK role to claude-opus-4-6 with full tool config"
  - "Four-layer XML-tagged system prompt assembly (identity, hotel_context, memory, instructions)"
  - "invokeAgent() stateless orchestrator with streaming, tool execution loop, and turn persistence"
  - "Tool-first policy enforcement via isToolRequired() keyword detection"
  - "Recursion depth limit (5 rounds) for tool loops"

affects: [02-03, 02-04, phase-3, phase-4, phase-5]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/sdk 0.78.0"]
  patterns:
    - "Stateless agent invocation — assembleSystemPrompt() called fresh on every invokeAgent() call"
    - "Four-layer XML system prompt: <identity>, <hotel_context>, <memory>, <instructions>"
    - "Tool-first policy: isToolRequired() forces tool_choice=any for availability/pricing queries"
    - "Tool use loop: tool_use stop_reason triggers executeTool(), results fed back, recurse"
    - "Tool content stored as JSON string in conversation_turns (preserves tool_use metadata)"
    - "MessageStream imported from @anthropic-ai/sdk/lib/MessageStream (not main export)"
    - "Anthropic SDK types used directly in types.ts (replaced manual placeholder types)"

key-files:
  created:
    - "src/lib/agents/agentFactory.ts"
    - "src/lib/agents/assembleContext.ts"
    - "src/lib/agents/invokeAgent.ts"
    - "src/lib/agents/tools/registry.ts"
    - "src/lib/agents/tools/executor.ts"
    - "src/lib/agents/tools/stubs.ts"
  modified:
    - "src/lib/agents/types.ts (replaced placeholder types with Anthropic SDK types)"
    - "package.json (added @anthropic-ai/sdk)"

key-decisions:
  - "Anthropic SDK types used directly in types.ts — replaced TextBlock/ToolUseBlock/MessageParam/Tool placeholders with SDK-native types for full compatibility"
  - "MessageStream type imported from @anthropic-ai/sdk/lib/MessageStream (internal path) — not re-exported from main SDK module"
  - "Tool-first policy uses keyword heuristic erring toward false positives — better to over-call tools than allow Claude to answer from training data"
  - "invokeAgentRecursive() uses auto tool_choice on recursive calls — tools already called, force-calling again would be circular"

patterns-established:
  - "agentFactory.getConfig(role) pattern — all role config fetched from centralized registry"
  - "assembleSystemPrompt always called fresh, never cached (stateless constraint)"
  - "Tool results persisted with role=tool + tool_use_id before recursive Claude call"
  - "Tool implementations return Record<string,unknown>, executor serializes to JSON string"

requirements-completed: [AGENT-01, AGENT-02, AGENT-03, AGENT-05]

# Metrics
duration: 11min
completed: 2026-03-03
---

# Phase 2 Plan 2: Agent Core Orchestration Summary

**invokeAgent() with tool execution loop, four-layer XML prompt assembly, and Agent Factory — structurally forces tool calls before any availability or pricing responses**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-03T10:22:41Z
- **Completed:** 2026-03-03T10:34:28Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Complete agent orchestration stack built: invokeAgent() calls Claude API, handles tool_use loops, persists all turns
- Four-layer XML system prompt (identity, hotel_context, memory, instructions) assembled fresh from DB on every call
- Tool-first policy enforced structurally: messages with availability/pricing keywords trigger tool_choice="any"
- Agent Factory maps FRONT_DESK role to claude-opus-4-6 with all three tools and correct behavioral policies
- Anthropic SDK types replaced all manual placeholder types in types.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Install SDK, Agent Factory, and system prompt assembly** - `979cb20` (feat)
2. **Task 2: invokeAgent() orchestrator with tool execution loop** - `2e25fc2` (feat)

**Plan metadata:** (docs commit — next)

## Files Created/Modified

- `src/lib/agents/tools/registry.ts` — 3 tool definitions (get_room_availability, get_room_pricing, lookup_guest_reservation) in Anthropic JSON Schema format
- `src/lib/agents/tools/stubs.ts` — Stub implementations returning mock data; Phase 7 TODO comments
- `src/lib/agents/tools/executor.ts` — Dispatch map from tool names to implementations; returns JSON string; errors become error result objects
- `src/lib/agents/agentFactory.ts` — ROLE_REGISTRY mapping FRONT_DESK to claude-opus-4-6 config; throws on unknown role
- `src/lib/agents/assembleContext.ts` — Four-layer XML system prompt assembly; parallel DB queries (hotel + semantic + episodic); never cached
- `src/lib/agents/invokeAgent.ts` — Stateless orchestrator: context assembly, streaming, tool_use handling, recursion limit, turn persistence; exports invokeAgent() and isToolRequired()
- `src/lib/agents/types.ts` — Updated to import Anthropic SDK types directly (TextBlock, ToolUseBlock, MessageParam, Tool)
- `package.json` — Added @anthropic-ai/sdk 0.78.0

## Decisions Made

- Replaced manual placeholder types in types.ts with Anthropic SDK types directly — eliminates type compatibility issues between SDK and our codebase
- MessageStream type imported from `@anthropic-ai/sdk/lib/MessageStream` (internal path) because it is not re-exported from the main SDK module
- isToolRequired() errs on false positives (over-triggers) rather than false negatives — prevents Claude from answering availability/pricing from training data
- Recursive tool continuation uses `tool_choice: auto` (not `any`) since tools have already been called at that point

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated types.ts to use Anthropic SDK types**
- **Found during:** Task 1 (build verification)
- **Issue:** types.ts had custom Tool type with `description: string` but SDK's Tool has `description: string | undefined`, causing TypeScript error: "Type 'string | undefined' is not assignable to type 'string'"
- **Fix:** Updated types.ts to import and re-export Anthropic SDK types (TextBlock, ToolUseBlock, ToolResultBlock, MessageParam, Tool) — these TODOs were already noted in the file comments
- **Files modified:** src/lib/agents/types.ts
- **Verification:** `pnpm build` passes with zero TypeScript errors
- **Committed in:** 979cb20 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed MessageStream type import path**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** `Anthropic.MessageStream` does not exist — MessageStream is not re-exported from main SDK module
- **Fix:** Import `MessageStream` from `@anthropic-ai/sdk/lib/MessageStream` (internal path)
- **Files modified:** src/lib/agents/invokeAgent.ts
- **Verification:** `npx tsc --noEmit` passes, `pnpm build` passes
- **Committed in:** 2e25fc2 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - type bugs discovered during build verification)
**Impact on plan:** Both fixes essential for TypeScript compilation. The types.ts update was explicitly planned as a TODO in the file — executing it was the right thing to do.

## Issues Encountered

None beyond the two auto-fixed type errors above.

## User Setup Required

**External services require configuration before invokeAgent() can be called.**

Add to `.env.local`:
```
ANTHROPIC_API_KEY=<your-key-from-console.anthropic.com>
```

Get your key from: https://console.anthropic.com/ → API Keys → Create Key

Without this key, invokeAgent() will throw at the Anthropic client initialization step.

## Next Phase Readiness

- invokeAgent() is ready to be called from Route Handlers (Plan 03 wires it to an HTTP endpoint)
- SSE streaming (Plan 04) attaches to the `onToken` callback already in place
- All three stub tools are correctly implemented — real DB queries come in Phase 7
- Tool-first policy is enforced — agents cannot hallucinate availability or pricing data

---
*Phase: 02-agent-core*
*Completed: 2026-03-03*
