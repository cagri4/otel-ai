---
phase: 02-agent-core
verified: 2026-03-05T00:00:00Z
status: passed
score: 17/17 must-haves verified
re_verification: false
human_verification:
  - test: "Open /desk, type 'What rooms are available for next weekend?' and observe response"
    expected: "AI does not answer immediately — it calls get_room_availability tool first, then responds with mock data (Standard x3, Deluxe x1)"
    why_human: "Tool-first policy enforcement is structurally in place (isToolRequired + tool_choice=any), but the live Claude API call behavior requires a running instance with ANTHROPIC_API_KEY to confirm"
  - test: "Type a message, observe streaming tokens arrive word-by-word with typing indicator"
    expected: "Pulsing dots appear first, then text builds character-by-character with a blinking cursor"
    why_human: "SSE streaming visual behavior cannot be verified without a running browser session"
  - test: "Refresh /desk after a conversation — prior messages must still be visible"
    expected: "Previous user and assistant messages reload from conversation_turns table"
    why_human: "Message persistence requires live Supabase instance with applied migration"
---

# Phase 02: Agent Core Verification Report

**Phase Goal:** Hotel owner can have a real conversation with the Front Desk AI from their dashboard, with responses backed by the Claude API and tool-first policy enforced

**Verified:** 2026-03-05T00:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

The phase goal decomposes into: (1) a working chat UI at /desk, (2) Claude API-backed responses via SSE streaming, and (3) tool-first policy that structurally prevents hallucinated availability or pricing answers. All three are implemented and substantive.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Three-tier memory tables exist (hotel_facts, guest_interactions, conversation_turns) | VERIFIED | `supabase/migrations/0002_agent_core.sql` lines 16–111: all three CREATE TABLE statements with RLS and indexes |
| 2 | agent_tasks coordination table exists with task_status enum | VERIFIED | Migration lines 117–157: CREATE TYPE task_status + CREATE TABLE agent_tasks with complete lifecycle columns |
| 3 | TypeScript types exist for all new tables and agent domain types | VERIFIED | `src/types/database.ts` exports HotelFact, GuestInteraction, ConversationTurn, AgentTask, TaskStatus; `src/lib/agents/types.ts` exports AgentRole, AgentConfig, InvokeAgentParams, ChatMessage |
| 4 | Memory helpers can read/write all three tiers | VERIFIED | `src/lib/agents/memory.ts` exports all 5 functions: loadConversationTurns (20-turn limit), persistTurn, loadSemanticFacts, loadEpisodicHistory (scoped), persistEpisodicMemory |
| 5 | invokeAgent() assembles context fresh from DB on every call (no caching) | VERIFIED | `invokeAgent.ts` calls `assembleSystemPrompt()` unconditionally on every invocation; `assembleContext.ts` uses `Promise.all()` for parallel fresh DB queries — no module-level cache |
| 6 | System prompt is built in four ordered XML layers (identity, hotel_context, memory, instructions) | VERIFIED | `assembleContext.ts` lines 69–112: four explicit layers joined with `\n\n`, each wrapped in `<identity>`, `<hotel_context>`, `<memory>`, `<instructions>` XML tags |
| 7 | Agent Factory maps AgentRole enum to config (model, tools, memoryScope, promptTemplate) | VERIFIED | `agentFactory.ts` ROLE_REGISTRY maps FRONT_DESK to `{ model: 'claude-opus-4-6', tools: [...], memoryScope: 'recent_30', promptTemplate: { identity, behavioral } }` |
| 8 | Claude cannot answer availability/pricing without calling a tool (structurally forced) | VERIFIED | `invokeAgent.ts` `isToolRequired()` keyword list (14 terms) sets `tool_choice: { type: 'any' }` when triggered — structural API-level enforcement, not just instruction |
| 9 | invokeAgent() handles tool_use stop_reason by executing tools and recursing | VERIFIED | `handleToolUse()` and `invokeAgentRecursive()` in `invokeAgent.ts` implement full tool loop with 5-round depth limit and proper message threading |
| 10 | Tool implementations are stubs returning mock data | VERIFIED | `stubs.ts` returns mock availability (Standard x3, Deluxe x1) and pricing (120/200 EUR) with explicit `// STUB: Returns mock data. Replace with real DB query...Phase 7` comments |
| 11 | An agent can delegate a task to another agent via agent_tasks | VERIFIED | `coordination.ts` `delegateTask()` INSERTs to agent_tasks; `delegate_task` tool in `registry.ts` wires through `executor.ts` to real `delegateTask()` — no stub |
| 12 | Task lifecycle covers pending -> processing -> completed/failed | VERIFIED | `coordination.ts` exports: delegateTask (INSERT pending), claimTask (WHERE status=pending atomic update), completeTask, failTask |
| 13 | Hotel owner can open /desk and see a chat interface | VERIFIED | `/desk` route exists in build output; `desk/page.tsx` renders ChatWindow server-component shell; dashboard layout includes "Front Desk" nav link at `/desk` |
| 14 | Owner can type and see a typing indicator while AI responds | VERIFIED | `MessageBubble.tsx` renders pulsing dots when `isStreaming && content === ''`; blinking cursor when streaming with content; `ChatInput.tsx` disables during streaming |
| 15 | AI response streams token by token via SSE | VERIFIED | `route.ts` fire-and-forget ReadableStream with `onToken` callback; `useChatStream.ts` chunked SSE buffer reading with `setMessages` update per token; Node.js runtime prevents buffering |
| 16 | Messages persist across page refresh | VERIFIED | GET /api/agent/stream hydrates history from `conversation_turns`; `useChatStream.ts` `loadHistory()` called on mount via `useEffect` |
| 17 | Chat UI shows both user and assistant messages in conversation layout | VERIFIED | `ChatWindow.tsx` maps all messages to `MessageBubble`; user messages right-aligned (`justify-end`, `bg-primary`); assistant messages left-aligned (`justify-start`, `bg-muted`) |

**Score:** 17/17 truths verified

---

## Required Artifacts

| Artifact | Provided | Status | Evidence |
|----------|----------|--------|---------|
| `supabase/migrations/0002_agent_core.sql` | All Phase 2 DB tables, indexes, RLS | VERIFIED | 158 lines; 4 CREATE TABLE + task_status enum + 8 RLS policies + 2 triggers |
| `src/types/database.ts` | Updated Database type with all new tables | VERIFIED | Contains HotelFact, GuestInteraction, ConversationTurn, AgentTask; Database.public.Tables entries for all 4 tables; task_status in Enums |
| `src/lib/agents/types.ts` | AgentRole enum, AgentConfig, InvokeAgentParams, ChatMessage | VERIFIED | 139 lines; exports AgentRole enum, AgentConfig interface, InvokeAgentParams interface, ChatMessage type; re-exports Anthropic SDK types |
| `src/lib/agents/memory.ts` | Memory read/write for all three tiers | VERIFIED | 319 lines; exports: loadConversationTurns, persistTurn, loadSemanticFacts, loadEpisodicHistory, persistEpisodicMemory |
| `src/lib/agents/agentFactory.ts` | Role Registry mapping AgentRole to AgentConfig | VERIFIED | Exports `agentFactory` and `AgentRole`; FRONT_DESK mapped to claude-opus-4-6 |
| `src/lib/agents/assembleContext.ts` | Four-layer system prompt assembly | VERIFIED | Exports `assembleSystemPrompt`; 4 XML-tagged layers; parallel DB queries; no caching |
| `src/lib/agents/invokeAgent.ts` | Stateless agent orchestrator | VERIFIED | Exports `invokeAgent` and `isToolRequired`; full tool loop with depth limit 5; streaming via onToken |
| `src/lib/agents/tools/registry.ts` | Tool definitions in Anthropic JSON Schema format | VERIFIED | Exports `TOOLS` (4 tools) and `getToolsForRole`; FRONT_DESK gets all 4 tools including delegate_task |
| `src/lib/agents/tools/executor.ts` | Tool name to implementation dispatch | VERIFIED | Exports `executeTool` with `ToolContext`; dispatches to stubs + real delegateTask; errors return JSON error result |
| `src/lib/agents/tools/stubs.ts` | Stub tool implementations returning mock data | VERIFIED | Exports getAvailability, getRoomPricing, lookupGuestReservation — all with Phase 7 replacement comments |
| `src/lib/agents/coordination.ts` | Agent-to-agent async task delegation and polling | VERIFIED | Exports 5 functions: delegateTask, getPendingTasks, claimTask, completeTask, failTask; zero dependency on invokeAgent |
| `src/app/api/agent/stream/route.ts` | SSE streaming endpoint | VERIFIED | Exports POST (streaming) and GET (history); Node.js runtime; fire-and-forget invokeAgent; 15s heartbeat |
| `src/hooks/useChatStream.ts` | React hook consuming SSE stream | VERIFIED | Exports `useChatStream`; chunked SSE buffer; AbortController; optimistic update |
| `src/components/chat/ChatWindow.tsx` | Main chat container | VERIFIED | 79 lines (req: 30); auto-scroll; renders MessageBubble list; ChatInput at bottom |
| `src/components/chat/MessageBubble.tsx` | Individual message display | VERIFIED | 65 lines (req: 15); user/assistant distinct styling; streaming indicators |
| `src/components/chat/ChatInput.tsx` | Input form with streaming-disabled state | VERIFIED | 75 lines (req: 20); Enter-to-send; auto-focus; disabled during streaming |
| `src/app/(dashboard)/desk/page.tsx` | Front Desk AI chat page | VERIFIED | 29 lines (req: 15); Server Component shell mounting ChatWindow |

---

## Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|-----|--------|---------|
| `invokeAgent.ts` | `agentFactory.ts` | `agentFactory.getConfig(role)` | WIRED | Line 92: `const config = agentFactory.getConfig(params.role)` |
| `invokeAgent.ts` | `assembleContext.ts` | `assembleSystemPrompt()` | WIRED | Line 97: `const systemPrompt = await assembleSystemPrompt(...)` |
| `invokeAgent.ts` | `memory.ts` | `loadConversationTurns`, `persistTurn` | WIRED | Lines 37, 107, 114, 206, 223, 288: imported and called |
| `invokeAgent.ts` | `@anthropic-ai/sdk` | `client.messages.stream()` | WIRED | Lines 134 and 332: both initial and recursive calls use `client.messages.stream()` |
| `assembleContext.ts` | `memory.ts` | `loadSemanticFacts`, `loadEpisodicHistory` | WIRED | Line 21: imported; lines 62–63: called in parallel via Promise.all |
| `coordination.ts` | `supabase/server.ts` | `createClient()` | WIRED | Line 18: imported; called in every function |
| `coordination.ts` | `database.ts` | `AgentTask` type | WIRED | Line 20: `import type { AgentTask }` |
| `executor.ts` | `coordination.ts` | `delegateTask()` | WIRED | Line 22: imported; line 55: called in delegate_task handler |
| `useChatStream.ts` | `/api/agent/stream` | `fetch POST with ReadableStream reader` | WIRED | Line 131: `fetch('/api/agent/stream', { method: 'POST', ... })` |
| `route.ts` | `invokeAgent.ts` | `invokeAgent()` call with onToken | WIRED | Line 27: imported; line 144: called fire-and-forget with onToken callback |
| `route.ts` | `supabase/server.ts` | `createClient()` for auth check | WIRED | Line 29: imported; lines 58, 194: called for auth and hotel query |
| `ChatWindow.tsx` | `useChatStream.ts` | `useChatStream` hook | WIRED | Line 24: imported; line 29: destructured |

**All 12 key links: WIRED**

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| AGENT-01 | 02-02-PLAN.md | Stateless agent orchestrator (invokeAgent()) | SATISFIED | `invokeAgent.ts` assembles fresh context on every call; no module-level hotel state |
| AGENT-02 | 02-02-PLAN.md | Layered system prompt assembly | SATISFIED | `assembleContext.ts` builds 4 XML-tagged layers: identity, hotel_context, memory, instructions |
| AGENT-03 | 02-02-PLAN.md | Agent Factory with Role Registry | SATISFIED | `agentFactory.ts` ROLE_REGISTRY; getConfig() throws on unknown role |
| AGENT-04 | 02-01-PLAN.md | Three-tier memory system | SATISFIED | SQL migration creates all 3 tier tables; memory.ts covers all read/write operations |
| AGENT-05 | 02-02-PLAN.md | Tool-first policy enforced | SATISFIED | `isToolRequired()` keyword detection forces `tool_choice: { type: 'any' }` at API level |
| AGENT-06 | 02-04-PLAN.md | Streaming response (SSE) with typing indicator | SATISFIED | SSE route + useChatStream hook + MessageBubble streaming indicators |
| AGENT-07 | 02-03-PLAN.md | Agent-to-agent coordination via async tasks | SATISFIED | `coordination.ts` + `delegate_task` tool in registry/executor; no synchronous inter-agent calls |
| DESK-01 | 02-04-PLAN.md | User can chat with Front Desk AI from dashboard | SATISFIED | /desk route in build output; ChatWindow renders; dashboard nav link present |

**All 8 requirements: SATISFIED**

No orphaned requirements — every requirement mapped to Phase 2 in REQUIREMENTS.md appears in at least one plan's `requirements` field.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tools/stubs.ts` | 29, 56, 81 | STUB comments on tool implementations | Info | Expected — plan explicitly specifies stub implementations until Phase 7; not a blocker |
| `memory.ts` | 32 | `// TODO: Replace ContentBlock...` comment | Info | Obsolete — the replacement was done in Plan 02-02; the TODO comment was not cleaned up |

No blockers. No placeholder components. No empty handlers. No console.log-only implementations.

The single ℹ️ item (stale TODO in memory.ts line 32) is cosmetic — the actual SDK types ARE used (the types.ts file re-exports them from `@anthropic-ai/sdk` and memory.ts imports them from there). The TODO comment is leftover from Plan 01 and was superseded by Plan 02-02.

---

## Human Verification Required

### 1. Tool-First Policy Live Enforcement

**Test:** Log in as a hotel owner, navigate to /desk, type: "What rooms do you have available for next weekend?"
**Expected:** AI response is delayed (tool call takes ~2s), then shows availability from the mock result — Standard x3, Deluxe x1. AI does NOT answer with generic availability from training data before calling the tool.
**Why human:** Structural enforcement (isToolRequired + tool_choice=any) is verified in code, but the Claude API's actual response behavior requires a live ANTHROPIC_API_KEY to confirm the tool is actually called before the answer.

### 2. Token-by-Token Streaming Visibility

**Test:** Type any message and watch the response appear
**Expected:** Pulsing dots appear first (while Claude is generating or tool is executing), then text builds up character-by-character with a blinking cursor at the end
**Why human:** SSE streaming visual behavior requires a browser session to verify the streaming is not buffered

### 3. Message Persistence Across Refresh

**Test:** Have a conversation with the AI, then refresh the page
**Expected:** All previous user and assistant messages appear in the chat window immediately on page load (loaded from database via GET /api/agent/stream)
**Why human:** Requires live Supabase instance with the SQL migration applied

---

## Build Verification

`pnpm build` completed with zero errors. Routes in build output:

```
ƒ /api/agent/stream   (Dynamic — server-rendered on demand)
ƒ /desk               (Dynamic — server-rendered on demand)
```

Both routes correctly listed as Dynamic (not statically prerendered), confirming `export const dynamic = 'force-dynamic'` is effective on the stream route and the desk page has client-side hydration requirements.

---

## Summary

Phase 2 achieved its goal. All 17 observable truths are verified against the actual codebase:

- The **memory foundation** (Plan 01) is a complete, substantive SQL migration plus 5 typed helper functions — no stubs in the data layer.
- The **agent orchestration stack** (Plan 02) is fully wired: invokeAgent → assembleSystemPrompt → loadConversationTurns → Claude API → tool execution → persistTurn. The tool-first policy operates at the API level (tool_choice), not just as instructions.
- The **coordination backbone** (Plan 03) is real infrastructure, not stubs — delegate_task writes to the actual agent_tasks table and the executor passes hotel context through.
- The **chat UI** (Plan 04) is a complete, production-quality implementation: chunked SSE parsing, AbortController cleanup, optimistic state updates, streaming indicators, and message persistence.

Human verification is flagged for the three items that require a live runtime (Claude API, Supabase, browser) — the automated code-level verification cannot substitute for these. The SUMMARY notes that human verification was performed during Plan 04 Task 3 and approved, so these are confirmatory checks for the permanent record.

---

_Verified: 2026-03-05_
_Verifier: Claude (gsd-verifier)_
