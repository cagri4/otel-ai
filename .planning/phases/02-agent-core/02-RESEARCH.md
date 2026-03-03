# Phase 2: Agent Core - Research

**Researched:** 2026-03-03
**Domain:** Claude API (Anthropic SDK), SSE streaming, agent orchestration, multi-tier memory, Supabase async tasks
**Confidence:** HIGH (core stack verified via official docs + npm)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGENT-01 | Stateless agent orchestrator (`invokeAgent()`) that assembles context from DB and calls Claude API | Anthropic SDK `@anthropic-ai/sdk` v0.78.0; stateless pattern fits Vercel serverless; context-from-DB assembly pattern documented |
| AGENT-02 | Layered system prompt assembly (role identity → hotel context → agent memory → behavioral instructions) | Anthropic context engineering guide confirms four-layer order; XML tagging for section separation |
| AGENT-03 | Agent Factory with Role Registry — central registry maps role enum to prompt template, allowed tools, memory scope | Documented as standard pattern for multi-agent systems; Role enum → config object mapping |
| AGENT-04 | Three-tier memory system (semantic hotel facts, episodic guest history, working conversation turns) | Confirmed architecture from ML research + Anthropic context engineering guide; maps to three Supabase tables |
| AGENT-05 | Tool-first policy enforced — agents cannot answer availability/price questions without successful tool call | `tool_choice: { type: "any" }` forces tool use; system prompt behavioral instructions reinforce; verified in official docs |
| AGENT-06 | Streaming response (SSE) for all chat interactions — typing indicator on message send | ReadableStream + SSE Route Handler pattern; Anthropic SDK `messages.stream()` for token delivery |
| AGENT-07 | Agent-to-agent coordination via async tasks table (no synchronous inter-agent calls) | Custom `agent_tasks` table with status polling; pgmq also available but async table is simpler for Phase 2 |
| DESK-01 | User can chat with Front Desk AI from owner dashboard | Client component with SSE fetch + typing indicator; dashboard route group already exists |
</phase_requirements>

---

## Summary

Phase 2 builds the Claude-powered agent core on top of the Phase 1 foundation. The central primitive is `invokeAgent()` — a stateless async function that assembles hotel context from Supabase, calls the Claude API, parses tool use, persists results, and returns streaming tokens via SSE. Stateless invocation is a first-class constraint: Vercel serverless functions cannot hold in-memory state between requests, so all context (hotel profile, agent memory, conversation turns) must be assembled fresh from the database on every call.

The Anthropic SDK (`@anthropic-ai/sdk` v0.78.0) is the integration layer. Streaming uses `client.messages.stream()` which provides event-based callbacks and a `.finalMessage()` accumulator. Tool use is enforced through `tool_choice: { type: "any" }` when the user asks availability or price questions, preventing Claude from answering from training data. The system prompt is assembled in four ordered layers: role identity, hotel context, agent memory, behavioral instructions (including the tool-first policy injected at the behavioral layer).

The three-tier memory system maps directly to three Supabase tables: `hotel_facts` (semantic — stable hotel information), `guest_history` (episodic — past interactions with guests), and `conversation_turns` (working — current conversation turns for this invocation). SSE streaming uses Next.js Route Handlers with `export const runtime = 'edge'` for Vercel compatibility, delivering tokens incrementally to the dashboard chat UI. Agent-to-agent coordination uses an `agent_tasks` Postgres table with a status enum (`pending | processing | completed | failed`) — agents INSERT tasks they delegate and other agents poll or are triggered via row-level webhooks.

**Primary recommendation:** Build `invokeAgent()` first as a non-streaming function to validate tool-use and context assembly, then add SSE streaming; this separates the two hardest concerns and avoids debugging streaming + tool use simultaneously.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | 0.78.0 (latest) | Claude API client — messages, streaming, tool use | Official Anthropic SDK; only supported JS client |
| `next` | ^16.1.6 (already installed) | Route Handlers for SSE API, Server Components | Already in project |
| `@supabase/supabase-js` | ^2.98.0 (already installed) | DB reads for context assembly, persisting messages | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^4.3.6 (already installed) | Validate tool input schemas at runtime | Tool argument validation before execution |
| `lucide-react` | ^0.576.0 (already installed) | Loading/typing indicator icons in chat UI | Typing indicator, send button states |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@anthropic-ai/sdk` direct | Vercel AI SDK (`@ai-sdk/anthropic`) | Vercel AI SDK abstracts SSE/streaming but adds a dependency layer and hides Claude-specific features (tool_choice, strict tool use); prefer direct SDK for control |
| Custom `agent_tasks` table | Supabase `pgmq` extension | pgmq provides guaranteed delivery + dead letter queues; custom table is simpler and sufficient for Phase 2 polling pattern |
| SSE (fetch + ReadableStream) | WebSockets | WebSockets are bidirectional but require persistent connections incompatible with serverless; SSE is unidirectional server-push, correct for streaming AI responses |

**Installation:**
```bash
pnpm add @anthropic-ai/sdk
```
(All other dependencies already installed in Phase 1)

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── agents/
│   │   ├── invokeAgent.ts        # Core orchestrator — stateless, context assembly + Claude call
│   │   ├── agentFactory.ts       # Role registry — maps role enum to config
│   │   ├── assembleContext.ts    # Layered system prompt builder
│   │   ├── memory.ts             # Three-tier memory read/write helpers
│   │   ├── tools/
│   │   │   ├── registry.ts       # Tool definitions (JSON schema format)
│   │   │   ├── executor.ts       # Tool dispatch — name → implementation
│   │   │   └── [toolName].ts     # Individual tool implementations
│   │   └── types.ts              # AgentRole enum, AgentConfig, InvokeAgentParams types
│   └── supabase/                 # Already exists
├── app/
│   ├── api/
│   │   └── agent/
│   │       └── stream/
│   │           └── route.ts      # POST handler — SSE streaming endpoint
│   └── (dashboard)/
│       └── desk/
│           └── page.tsx          # Front Desk AI chat page (Server Component shell)
└── components/
    └── chat/
        ├── ChatWindow.tsx        # Client component — SSE consumer + message list
        ├── MessageBubble.tsx     # Individual message display
        └── ChatInput.tsx        # Input form + typing indicator
```

### Pattern 1: Stateless invokeAgent() Orchestrator

**What:** A pure async function that assembles context, calls Claude, handles tool use, and persists results. No in-memory state between calls.

**When to use:** Every agent interaction. Never call Claude directly from a component or action — always go through `invokeAgent()`.

**Example:**
```typescript
// Source: https://platform.claude.com/docs/en/build-with-claude/streaming
// Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface InvokeAgentParams {
  role: AgentRole;
  userMessage: string;
  conversationId: string;
  hotelId: string;
  onToken?: (token: string) => void;  // SSE callback
}

export async function invokeAgent(params: InvokeAgentParams) {
  const { role, userMessage, conversationId, hotelId, onToken } = params;

  // 1. Get role config from registry
  const config = agentFactory.getConfig(role);

  // 2. Assemble context fresh from DB
  const systemPrompt = await assembleSystemPrompt({ role, hotelId, conversationId, config });

  // 3. Load working conversation turns
  const messages = await loadConversationTurns(conversationId);

  // 4. Append current user message
  messages.push({ role: "user", content: userMessage });

  // 5. Call Claude with streaming
  const stream = client.messages.stream({
    model: config.model,
    max_tokens: 4096,
    system: systemPrompt,
    tools: config.tools,
    tool_choice: { type: "auto" },  // or "any" when topic requires tool
    messages,
  });

  let fullResponse = "";

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      fullResponse += event.delta.text;
      onToken?.(event.delta.text);
    }
  }

  const finalMessage = await stream.finalMessage();

  // 6. Handle tool use if stop_reason is "tool_use"
  if (finalMessage.stop_reason === "tool_use") {
    const toolResults = await executeTools(finalMessage.content);
    // Recurse with tool results appended
    return invokeAgentWithToolResults({ ...params, toolResults, priorMessages: messages, assistantContent: finalMessage.content });
  }

  // 7. Persist assistant turn
  await persistTurn(conversationId, "assistant", fullResponse);

  return fullResponse;
}
```

### Pattern 2: Layered System Prompt Assembly

**What:** Build the system prompt in four ordered layers. Each layer is a distinct DB query or static config. Order matters — role identity sets the frame, behavioral rules close it.

**When to use:** Every `invokeAgent()` call. The system prompt is never cached — assembled fresh to reflect current hotel state.

**Layer order (from Anthropic context engineering guide):**
```typescript
// Source: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
async function assembleSystemPrompt(params: AssembleParams): Promise<string> {
  const { role, hotelId, conversationId, config } = params;

  // Layer 1: Role Identity — who the agent is
  const identity = config.promptTemplate.identity;

  // Layer 2: Hotel Context — live data from DB (NOT cached)
  const hotel = await db.from("hotels").select("*").eq("id", hotelId).single();
  const hotelContext = formatHotelContext(hotel);

  // Layer 3: Agent Memory — semantic facts + episodic history
  const semanticFacts = await loadSemanticFacts(hotelId);
  const episodicHistory = await loadEpisodicHistory(hotelId, config.memoryScope);

  // Layer 4: Behavioral Instructions — tool-first policy, refusal rules
  const behavioral = config.promptTemplate.behavioral;

  return [
    `<identity>\n${identity}\n</identity>`,
    `<hotel_context>\n${hotelContext}\n</hotel_context>`,
    `<memory>\n${semanticFacts}\n\n${episodicHistory}\n</memory>`,
    `<instructions>\n${behavioral}\n</instructions>`,
  ].join("\n\n");
}
```

### Pattern 3: Tool-First Policy Enforcement

**What:** When a user asks about room availability or prices, the system enforces `tool_choice: { type: "any" }` to prevent Claude from answering from training data. The system prompt also includes a behavioral instruction.

**When to use:** Detect keywords in user message before invoking Claude; switch `tool_choice` accordingly.

**Example:**
```typescript
// Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use
// tool_choice type "any" = Claude MUST call one of the provided tools

const requiresToolCall = isAvailabilityOrPriceQuery(userMessage);

const toolChoice = requiresToolCall
  ? { type: "any" as const }
  : { type: "auto" as const };

// Behavioral instruction in system prompt (Layer 4):
const toolFirstInstruction = `
You MUST NOT state room availability, pricing, or booking status from memory.
If asked about prices, availability, or rooms, you MUST call the appropriate tool
to retrieve current data before responding. Stating data you have not retrieved
via a tool call in this conversation is a policy violation.
`;
```

### Pattern 4: SSE Streaming Route Handler

**What:** A Next.js Route Handler that receives chat messages, calls `invokeAgent()`, and streams tokens back via Server-Sent Events.

**When to use:** All chat interactions from the dashboard (DESK-01, AGENT-06).

**Example:**
```typescript
// Source: https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996
// Source: https://www.eaures.online/streaming-llm-responses-in-next-js

// src/app/api/agent/stream/route.ts
export const runtime = "edge";        // Edge: 300s timeout on Vercel, global distribution
export const dynamic = "force-dynamic"; // Disable Next.js static caching

export async function POST(req: Request) {
  const { message, conversationId, role } = await req.json();
  const encoder = new TextEncoder();

  // Authenticate — get hotel_id from JWT
  // Note: edge runtime uses different Supabase client pattern
  const hotelId = await getHotelIdFromRequest(req);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Heartbeat prevents idle timeout on proxies
      const hb = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: keep-alive\n\n`));
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(hb);
        controller.close();
      });

      invokeAgent({
        role,
        userMessage: message,
        conversationId,
        hotelId,
        onToken: (token) => send({ type: "token", token }),
      })
        .then(() => send({ type: "done" }))
        .catch((err) => send({ type: "error", message: err.message }))
        .finally(() => {
          clearInterval(hb);
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",  // Disable nginx/proxy buffering
    },
  });
}
```

### Pattern 5: Agent Factory with Role Registry

**What:** A central mapping from `AgentRole` enum to configuration object. No conditional logic scattered across the codebase — all role-specific behavior lives here.

**Example:**
```typescript
// src/lib/agents/agentFactory.ts
export enum AgentRole {
  FRONT_DESK = "front_desk",
  // Future: HOUSEKEEPING = "housekeeping", CONCIERGE = "concierge"
}

export interface AgentConfig {
  model: string;
  tools: Anthropic.Messages.Tool[];
  memoryScope: "full" | "recent_30" | "none";
  promptTemplate: {
    identity: string;
    behavioral: string;
  };
}

const ROLE_REGISTRY: Record<AgentRole, AgentConfig> = {
  [AgentRole.FRONT_DESK]: {
    model: "claude-opus-4-6",          // Guest-facing: highest capability (per prior decisions)
    tools: [
      TOOLS.getAvailability,
      TOOLS.getRoomPricing,
      TOOLS.lookupGuestReservation,
    ],
    memoryScope: "recent_30",
    promptTemplate: {
      identity: `You are the Front Desk AI for this hotel. You handle guest inquiries,
room availability, pricing, and reservations professionally and warmly.`,
      behavioral: `${TOOL_FIRST_POLICY_INSTRUCTION}
Always be concise. For simple factual questions, one paragraph is enough.
Never fabricate data. If you cannot retrieve information via a tool, say so.`,
    },
  },
};

export const agentFactory = {
  getConfig: (role: AgentRole): AgentConfig => ROLE_REGISTRY[role],
};
```

### Pattern 6: Three-Tier Memory System

**What:** Three Supabase tables providing different time horizons and query patterns.

**Tier mapping:**
| Tier | Table | Content | Query Pattern |
|------|-------|---------|---------------|
| Semantic | `hotel_facts` | Stable hotel knowledge (policies, amenities, FAQs) | SELECT all for hotel_id — always loaded |
| Episodic | `guest_interactions` | Past guest conversations, preferences, issues | SELECT recent 10 by guest or topic — optional |
| Working | `conversation_turns` | Current conversation message history | SELECT ordered by created_at for conversation_id |

**Schema:**
```sql
-- Semantic memory: stable hotel knowledge
CREATE TABLE public.hotel_facts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,  -- 'policy', 'amenity', 'faq', 'pricing_note'
  fact        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Episodic memory: guest interaction history
CREATE TABLE public.guest_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  guest_identifier TEXT NOT NULL,    -- email, phone, or session token
  summary         TEXT NOT NULL,     -- agent-written summary of the interaction
  sentiment       TEXT,              -- 'positive', 'neutral', 'negative'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Working memory: current conversation turns
CREATE TABLE public.conversation_turns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT NOT NULL,
  tool_use_id     TEXT,              -- for tool/tool_result correlation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_turns_conversation_id
  ON public.conversation_turns(conversation_id, created_at);
CREATE INDEX idx_hotel_facts_hotel_id ON public.hotel_facts(hotel_id);
CREATE INDEX idx_guest_interactions_hotel_id ON public.guest_interactions(hotel_id, created_at);
```

### Pattern 7: Agent-to-Agent Coordination via Async Tasks Table

**What:** Agents INSERT tasks they want to delegate; other agents poll or are triggered via Supabase Realtime. No direct agent-to-agent function calls.

**Schema:**
```sql
CREATE TYPE public.task_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE public.agent_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  from_role       TEXT NOT NULL,              -- delegating agent role
  to_role         TEXT NOT NULL,              -- target agent role
  task_type       TEXT NOT NULL,              -- 'send_confirmation', 'check_housekeeping', etc.
  payload         JSONB NOT NULL DEFAULT '{}',
  status          public.task_status NOT NULL DEFAULT 'pending',
  result          JSONB,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_agent_tasks_hotel_status
  ON public.agent_tasks(hotel_id, status, created_at);
```

### Anti-Patterns to Avoid

- **Caching hotel context in memory:** Vercel serverless functions share nothing between invocations. Always query DB. If you memoize hotel data in a module-level variable, it will silently serve stale data on some instances and not others.
- **Calling Claude from Server Components or Server Actions directly:** Claude streaming requires a Route Handler with a streaming Response. Server Actions cannot stream SSE.
- **Checking for tool use after `.text` property only:** Claude responses with `stop_reason: "tool_use"` have no text delta — the text block may be empty. Always check `finalMessage.stop_reason` before assuming the response is complete.
- **Storing full message history in context without limit:** Context window is finite. Load only the last N turns (e.g., 20) from `conversation_turns`. Summarize older history into episodic memory if needed.
- **Inter-agent synchronous calls:** Never `invokeAgent({ role: "housekeeping", ... })` from within another agent's tool handler. INSERT to `agent_tasks` and return to the caller.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE token accumulation | Custom state machine | `client.messages.stream()` + `.finalMessage()` | SDK accumulates partial JSON tool inputs, handles ping events, manages errors |
| Tool input validation | Manual JSON Schema checks | Zod schema on `input_schema` properties | Edge cases in partial JSON streaming; SDK handles accumulation |
| Streaming response buffering | Manual chunk reassembly | `ReadableStream` with `controller.enqueue()` | Browser EventSource handles reconnection; TransformStream handles backpressure |
| Conversation persistence | In-memory message array across requests | `conversation_turns` Supabase table | Serverless: no shared memory between function instances |
| System prompt templates | Interpolated template strings (no structure) | XML-tagged sections per Anthropic guide | Models perform better with labeled sections; debug-friendly |
| Agent role configuration | If/else chains in invokeAgent() | Role Registry object (ROLE_REGISTRY) | New roles added without touching orchestrator; open/closed principle |

**Key insight:** The hardest parts of this phase (SSE streaming, tool use accumulation, partial JSON parsing) are already solved by `@anthropic-ai/sdk`'s streaming helpers. The custom work is context assembly, tool implementations, and the memory system.

---

## Common Pitfalls

### Pitfall 1: Next.js Buffering SSE Before Returning Response
**What goes wrong:** The Route Handler appears to buffer all tokens and deliver them at once instead of streaming.
**Why it happens:** `async` work inside `start()` that is `await`-ed before the `Response` is returned. Next.js waits for the handler function to return before sending the Response.
**How to avoid:** Inside `ReadableStream.start()`, call the async streaming function WITHOUT `await` — fire and forget. The `Response` returns immediately and the stream stays open.
**Warning signs:** Client receives all tokens at once; no typing effect visible; no tokens until Claude finishes.

```typescript
// WRONG — awaits before Response is returned
start: async (controller) => {
  await invokeAgent({ onToken: ... }); // blocks
  controller.close();
}

// CORRECT — fire and forget, Response returns immediately
start(controller) {
  invokeAgent({ onToken: ... })
    .then(() => controller.close())
    .catch(() => controller.close());
  // No await — returns synchronously
}
```

### Pitfall 2: Missing tool_use Stop Reason Handling
**What goes wrong:** Agent appears to ignore tool calls — returns empty response or stops mid-conversation.
**Why it happens:** When `stop_reason === "tool_use"`, the stream has no text delta for the assistant turn. Code that only listens to `onToken` / `.text` events sees nothing and considers the response done.
**How to avoid:** Always inspect `finalMessage.stop_reason`. If `"tool_use"`, extract tool blocks, execute them, and call Claude again with `tool_result` content blocks.
**Warning signs:** Front Desk AI stops responding to price/availability questions; no error thrown; empty assistant message persisted.

### Pitfall 3: Context Too Large — Model Starts Missing Instructions
**What goes wrong:** After many conversation turns, agent responses become inconsistent or forget the tool-first policy.
**Why it happens:** "Context rot" — transformer attention degrades as token count grows. Long conversations push behavioral instructions out of effective attention range.
**How to avoid:** Cap working memory at 20 turns. Summarize old turns into episodic memory when conversation exceeds 20 messages. Use the system prompt (not conversation turns) for behavioral rules — system prompt is always at the head.
**Warning signs:** Agent answers availability questions without tool calls after a long conversation; ignores refusal rules.

### Pitfall 4: Supabase Auth in Edge Runtime
**What goes wrong:** `createServerClient` from `@supabase/ssr` fails in edge runtime because it depends on `cookies()` from `next/headers`.
**Why it happens:** `next/headers` is Node.js-only; edge runtime uses Web APIs.
**How to avoid:** In edge Route Handlers, extract the JWT from the `Authorization` header directly instead of using cookies. Use `createClient` (browser client pattern) with the extracted token, OR move the route to Node.js runtime (`export const runtime = 'nodejs'`) with `export const maxDuration = 60`.
**Warning signs:** `Error: cookies() is not available in edge runtime` at deploy time.

Alternative: Use `export const runtime = 'nodejs'` and `export const maxDuration = 60` to stay on Node.js runtime with 60s limit (Pro tier) — simpler than edge auth workaround for Phase 2.

### Pitfall 5: tool_choice "any" with Empty Tools Array
**What goes wrong:** API returns 400 error when `tool_choice: { type: "any" }` is set but `tools` array is empty.
**Why it happens:** Anthropic API requires at least one tool defined if `tool_choice` is not `"auto"` or `"none"`.
**How to avoid:** Always pair `tool_choice: { type: "any" }` with a non-empty `tools` array. The role registry should guarantee this — if a role has no tools, default `tool_choice` to `"auto"`.
**Warning signs:** 400 `invalid_request_error` from Claude API.

### Pitfall 6: Conversation Turns Include Raw Tool Blocks
**What goes wrong:** When reconstructing conversation history from `conversation_turns`, Claude rejects messages if tool_use and tool_result blocks are malformed or orphaned.
**Why it happens:** Claude requires that every `tool_use` block in an assistant message has a corresponding `tool_result` in the NEXT user message. Storing turns as plain text loses this structure.
**How to avoid:** Store tool_use content as JSON in the `content` column, with a separate `role: 'tool'` row containing the tool_result. Reconstruct the proper `Anthropic.Messages.MessageParam[]` format when loading turns. The `tool_use_id` foreign key links them.
**Warning signs:** `invalid_request_error: tool_result block does not have a matching tool_use block`.

---

## Code Examples

Verified patterns from official sources:

### Streaming with Tool Use (TypeScript)
```typescript
// Source: https://platform.claude.com/docs/en/build-with-claude/streaming
// Source: https://github.com/anthropics/anthropic-sdk-typescript

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Two approaches:
// 1. stream() — accumulates events, provides .finalMessage(), higher memory
// 2. create({stream: true}) — raw async iterable, lower memory

// Recommended for agent use: stream() for its helpers
const stream = client.messages.stream({
  model: "claude-opus-4-6",
  max_tokens: 4096,
  system: systemPrompt,
  tools: [
    {
      name: "get_room_availability",
      description: "Check room availability for given dates. MUST be called before stating availability.",
      input_schema: {
        type: "object",
        properties: {
          check_in: { type: "string", description: "Check-in date ISO 8601" },
          check_out: { type: "string", description: "Check-out date ISO 8601" },
          room_type: { type: "string", description: "Room category e.g. 'standard', 'deluxe'" },
        },
        required: ["check_in", "check_out"],
      },
    },
  ],
  tool_choice: { type: "any" }, // Force tool use — no free-form availability answer allowed
  messages: conversationHistory,
});

// Listen to text tokens for SSE forwarding
stream.on("text", (text) => {
  sendSSE({ type: "token", token: text });
});

// Get accumulated message to check stop_reason
const finalMessage = await stream.finalMessage();

if (finalMessage.stop_reason === "tool_use") {
  // Must continue the conversation with tool results
  const toolUseBlocks = finalMessage.content.filter(b => b.type === "tool_use");
  // Execute each tool, then call Claude again...
}
```

### SSE Client (React Hook)
```typescript
// Source: pattern from https://oneuptime.com/blog/post/2026-01-15-server-sent-events-sse-react/view
// and https://medium.com/@dlrnjstjs/implementing-react-sse-server-sent-events-real-time-notification-system-a999bb983d1b

"use client";
import { useState, useRef, useCallback } from "react";

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (userText: string, conversationId: string) => {
    // Add user message immediately
    setMessages(prev => [...prev, { role: "user", content: userText }]);
    setIsStreaming(true);

    // Start optimistic assistant message (empty — will fill as tokens arrive)
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const response = await fetch("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userText, conversationId, role: "front_desk" }),
      signal: abortRef.current.signal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = JSON.parse(line.slice(6));

        if (data.type === "token") {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: updated[updated.length - 1].content + data.token,
            };
            return updated;
          });
        }

        if (data.type === "done") {
          setIsStreaming(false);
        }
      }
    }
  }, []);

  return { messages, isStreaming, sendMessage };
}
```

### Tool Result Continuation Pattern
```typescript
// Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use
// After receiving stop_reason: "tool_use"

async function continueWithToolResults(
  originalMessages: Anthropic.Messages.MessageParam[],
  assistantMessage: Anthropic.Messages.Message,
  toolExecutor: ToolExecutor,
) {
  const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

  for (const block of assistantMessage.content) {
    if (block.type !== "tool_use") continue;

    const result = await toolExecutor.execute(block.name, block.input);

    toolResults.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(result),
    });
  }

  // Append assistant turn + tool results as user turn
  const updatedMessages: Anthropic.Messages.MessageParam[] = [
    ...originalMessages,
    { role: "assistant", content: assistantMessage.content },
    { role: "user", content: toolResults },
  ];

  // Call Claude again — may use more tools or produce final text
  return client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    messages: updatedMessages,
    // ... system, tools
  });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual SSE via `res.write()` (Pages Router) | `ReadableStream` in Route Handler (App Router) | Next.js 13 App Router | Cleaner, works on both Node.js and Edge runtimes |
| `client.messages.create({ stream: true })` raw loop | `client.messages.stream()` with `.on("text")` and `.finalMessage()` | @anthropic-ai/sdk ~v0.20+ | SDK handles partial JSON accumulation for tool inputs; less boilerplate |
| Single system prompt string | XML-tagged layered sections | 2024-2025 Anthropic guidance | Models respond better to structured sections; easier to debug |
| Polling for streaming updates | SSE (Server-Sent Events) | Industry standard since 2023 for LLM streaming | Lower overhead than WebSocket; compatible with Vercel Edge |
| EventSource API (GET-only) | `fetch()` + `ReadableStream` reader | 2024 pattern | POST body support (authentication, message payload); EventSource is GET-only |
| `tool_choice: "auto"` always | Conditional `tool_choice: "any"` for gated questions | Claude tool use docs 2024+ | Forces tool use only when needed, preserving performance for general questions |

**Deprecated/outdated:**
- `EventSource` for SSE: Still works for GET endpoints but cannot send POST body. Use `fetch()` + `response.body.getReader()` instead.
- `next/server` manual `TransformStream` patterns: Replaced by `ReadableStream` constructor pattern with `controller.enqueue()`.

---

## Open Questions

1. **Supabase Auth in Edge Runtime**
   - What we know: `@supabase/ssr`'s `createServerClient` uses `cookies()` from `next/headers`, which is Node.js only
   - What's unclear: Whether to use Edge runtime (300s timeout, global) or Node.js runtime (60s on Pro, simpler auth)
   - Recommendation: Start with `export const runtime = 'nodejs'` and `export const maxDuration = 60` in Phase 2. Migrate to Edge in a later optimization phase once auth pattern is clear.

2. **Tool Implementations for Phase 2**
   - What we know: `get_room_availability`, `get_room_pricing`, `lookup_guest_reservation` are the Front Desk tools needed
   - What's unclear: What tables/data exists for rooms/reservations — Phase 2 may need stub implementations returning mock data until a rooms/bookings phase adds real data
   - Recommendation: Implement tool stubs that return plausible mock data; note in code that they require real DB tables from a future phase.

3. **Conversation ID Management**
   - What we know: Working memory indexed by `conversation_id`; Front Desk chat from owner dashboard is one persistent conversation or per-session
   - What's unclear: Whether the owner-chat conversation should be a single persistent thread or create a new session on each page load
   - Recommendation: One persistent conversation per hotel owner (hotel_id + "owner_chat" as deterministic conversation_id); simplest for Phase 2.

4. **pgvector for Semantic Memory**
   - What we know: pgvector is available in Supabase for vector similarity search; would enable semantic search over hotel facts
   - What's unclear: Embedding model choice and cost; whether hotel_facts volume warrants vector search vs. simple SELECT all
   - Recommendation: Phase 2 use simple `SELECT * FROM hotel_facts WHERE hotel_id = $1` — load all facts. pgvector/semantic search is a Phase 3+ optimization.

---

## Sources

### Primary (HIGH confidence)
- `https://platform.claude.com/docs/en/build-with-claude/streaming` — SSE streaming event format, tool_use streaming blocks, code examples
- `https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview` — tool definition format, tool_choice options, tool_result format
- `https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use` — tool_choice "any", strict tool use, system prompt assembly with tools
- `https://platform.claude.com/docs/en/about-claude/models/overview` — model IDs `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` verified as current
- `https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents` — layered context assembly, system prompt structure, context rot
- `https://github.com/anthropics/anthropic-sdk-typescript` — SDK streaming API, `messages.stream()`, `.finalMessage()`, tool runner helpers
- `npm view @anthropic-ai/sdk version` → `0.78.0` (verified locally)

### Secondary (MEDIUM confidence)
- `https://www.eaures.online/streaming-llm-responses-in-next-js` — SSE Route Handler pattern with ReadableStream, headers, heartbeat (verified against Next.js docs)
- `https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996` — Vercel SSE buffering pitfall and fix (Jan 2026, matches known Next.js behavior)
- `https://vercel.com/docs/functions/limitations` + `https://vercel.com/docs/functions/configuring-functions/duration` — Edge runtime 300s timeout, Node.js runtime 60s (Pro tier), `export const maxDuration`
- `https://supabase.com/docs/guides/database/extensions/pgvector` — pgvector available in Supabase for vector similarity

### Tertiary (LOW confidence — flag for validation)
- `https://machinelearningmastery.com/beyond-short-term-memory-the-3-types-of-long-term-memory-ai-agents-need/` — three-tier memory taxonomy (semantic/episodic/working) — widely accepted pattern but specific implementation details are our own design
- `https://supabase.com/ui/docs/nextjs/realtime-chat` — Supabase Realtime Broadcast chat schema — not used directly (we use custom tables) but informed schema design

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@anthropic-ai/sdk` v0.78.0 verified via npm; model IDs verified via official docs
- SSE streaming pattern: HIGH — verified via Anthropic streaming docs + multiple practical guides
- Tool use / tool_choice "any": HIGH — verified via official docs
- Architecture patterns (layered prompt, role registry): HIGH — confirmed by Anthropic context engineering guide
- Three-tier memory schema: MEDIUM — memory taxonomy is well-established; specific Supabase table design is our own
- Vercel runtime/timeout: MEDIUM — documented limits may vary by plan; recommend testing
- Anti-patterns: HIGH — Pitfalls 1-6 all verified against official behavior or SDK source

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (30 days; Claude API and Anthropic SDK move frequently — re-verify model IDs and SDK version before planning)
