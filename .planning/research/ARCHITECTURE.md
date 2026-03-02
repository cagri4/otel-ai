# Architecture Research

**Domain:** Multi-agent AI SaaS — Hotel Virtual Staff Platform
**Researched:** 2026-03-01
**Confidence:** MEDIUM (training knowledge + well-established patterns; web verification denied)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        TENANT LAYER (Per Hotel)                       │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │                   Hotel Owner Dashboard (Next.js)             │     │
│  │   [Staff Overview] [Chat with Employee] [Settings] [Reports]  │     │
│  └─────────────────────────┬────────────────────────────────────┘     │
│                             │                                          │
│  ┌──────────────────────────▼────────────────────────────────────┐    │
│  │                     Guest-Facing Layer                         │    │
│  │         [Web Chat Widget]   [WhatsApp Webhook]                 │    │
│  └─────────────────────────┬────────────────────────────────────┘     │
└────────────────────────────┼─────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────────┐
│                        API LAYER (Next.js API Routes / Edge)          │
│                                                                        │
│   /api/chat/[agentId]     /api/tasks/[agentId]    /api/webhooks/      │
│   /api/admin/             /api/tenants/            /api/notifications/ │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────────┐
│                       AGENT ORCHESTRATION LAYER                        │
│                                                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │Reception-│ │Housekeep-│ │ Revenue  │ │  Guest   │ │Accounting│   │
│  │  ist AI  │ │ ing Mgr  │ │ Manager  │ │Relations │ │   AI     │   │
│  │          │ │    AI    │ │    AI    │ │    AI    │ │          │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│       │            │            │             │            │          │
│  ┌────▼────────────▼────────────▼─────────────▼────────────▼──────┐  │
│  │                    Agent Context Bus                             │  │
│  │   (Shared Hotel Knowledge + Tenant-Scoped State)                │  │
│  └────────────────────────────┬────────────────────────────────────┘  │
└───────────────────────────────┼──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│                         DATA LAYER (Supabase)                          │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐               │
│  │  hotels      │  │  messages    │  │  agent_memory  │               │
│  │  tenants     │  │  threads     │  │  (per-agent,   │               │
│  │  users       │  │  tasks       │  │   per-tenant)  │               │
│  └──────────────┘  └──────────────┘  └────────────────┘               │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐               │
│  │  bookings    │  │  rooms       │  │  hotel_context │               │
│  │  guests      │  │  inventory   │  │  (policies,    │               │
│  │  (per-tenant)│  │  (per-tenant)│  │   knowledge)   │               │
│  └──────────────┘  └──────────────┘  └────────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Hotel Owner Dashboard | Owner UI: chat with AI staff, configure, monitor | Next.js app with Supabase auth |
| Guest-Facing Layer | Guest chat widget, WhatsApp webhook handler | Embeddable JS widget + Next.js webhook route |
| API Layer | Route messages to correct agent, enforce tenant isolation | Next.js API Routes (Edge Runtime where latency matters) |
| Agent Orchestration | Build agent context, call Claude API, route responses | Server-side service with agent factory pattern |
| Agent Context Bus | Shared hotel knowledge available to all agents | Postgres tables queried at invocation time — NOT a runtime message bus |
| Data Layer | Persist all state (messages, memory, hotel data) | Supabase PostgreSQL with Row Level Security (RLS) for tenant isolation |
| Notification Service | Push internal alerts (Slack/email/in-app) | Supabase Realtime or webhook queue |

---

## Multi-Tenant Architecture

### Tenant Isolation Strategy

Use **Row Level Security (RLS) in Supabase** as the primary isolation mechanism. Every table that holds hotel-specific data has a `hotel_id` column. Supabase RLS policies enforce that every query is automatically scoped to the authenticated hotel's ID.

**Why this over schema-per-tenant or database-per-tenant:**
- Schema-per-tenant works at ~50 tenants but becomes operationally complex beyond that
- RLS scales to thousands of tenants with zero per-tenant overhead
- Supabase has first-class RLS tooling

**Confidence:** HIGH — Supabase's documented recommended approach for SaaS multi-tenancy.

```sql
-- Every tenant-scoped table has this pattern
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel can only see own messages"
  ON messages FOR ALL
  USING (hotel_id = auth.jwt() ->> 'hotel_id');
```

### Tenant Data Scope

```
hotels
  └── hotel_id (UUID, primary key)
  └── name, config, subscription_tier
  └── hotel_context (JSONB: policies, room types, check-in rules, amenities)

hotel_agents
  └── hotel_id (FK)
  └── agent_role (receptionist | housekeeping | revenue | guest_relations | accounting)
  └── system_prompt_overrides (JSONB: customization per hotel)
  └── enabled (bool: subscription tier controls which agents are active)

agent_memory
  └── hotel_id (FK)
  └── agent_role
  └── memory_type (working | episodic | semantic)
  └── content (JSONB)
  └── created_at, expires_at
```

---

## AI Agent Architecture Pattern

### Pattern: Stateless Agent Invocation with Assembled Context

**What:** Each AI agent is stateless — it has no persistent runtime process. On every invocation, the system assembles the full context (system prompt + hotel knowledge + relevant memory + conversation history) and sends it to Claude API. The response is stored back to the database.

**Why stateless over persistent agents:**
- Vercel serverless functions cannot hold long-running processes
- Simpler to reason about: no agent "state" to corrupt or leak between tenants
- Claude's context window is large enough to hold what each agent needs per turn
- Scales horizontally without coordination

**Confidence:** HIGH — this is the correct pattern for Claude API on serverless infrastructure.

```typescript
// Agent invocation pattern
async function invokeAgent(params: {
  hotelId: string;
  agentRole: AgentRole;
  threadId: string;
  newMessage: string;
}): Promise<AgentResponse> {
  // 1. Assemble context (all from DB, scoped to hotel_id)
  const [hotelContext, agentConfig, conversationHistory, agentMemory] =
    await Promise.all([
      getHotelContext(params.hotelId),           // policies, rooms, etc.
      getAgentConfig(params.hotelId, params.agentRole),
      getConversationHistory(params.threadId, { limit: 20 }),
      getAgentMemory(params.hotelId, params.agentRole),
    ]);

  // 2. Build system prompt
  const systemPrompt = buildSystemPrompt({
    role: params.agentRole,
    hotelContext,
    agentConfig,
    agentMemory,
    language: hotelContext.defaultLanguage,
  });

  // 3. Call Claude API
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: conversationHistory,
  });

  // 4. Persist response + update memory
  await Promise.all([
    saveMessage(params.threadId, response),
    updateAgentMemory(params.hotelId, params.agentRole, response),
  ]);

  return parseAgentResponse(response);
}
```

### Pattern: Layered System Prompt Assembly

Each agent's system prompt has four layers assembled at invocation time:

```
┌────────────────────────────────────────────────────┐
│  Layer 1: Role Identity (static, hardcoded)         │
│  "You are Maya, the receptionist at [hotel_name].   │
│   Your job is to..."                                │
├────────────────────────────────────────────────────┤
│  Layer 2: Hotel Context (dynamic, from DB)          │
│  "Hotel facts: 24 rooms, check-in 3pm, no pets,    │
│   pool open 8am-10pm, breakfast €15 extra..."       │
├────────────────────────────────────────────────────┤
│  Layer 3: Agent Memory (dynamic, from DB)           │
│  "Remember: Guest John Smith (room 12) prefers      │
│   quiet room, allergic to feather pillows..."       │
├────────────────────────────────────────────────────┤
│  Layer 4: Current Task / Behavioral Instructions    │
│  "Always respond in the guest's language.           │
│   If you cannot resolve, flag for human review."   │
└────────────────────────────────────────────────────┘
```

**Confidence:** MEDIUM — established pattern, but specific Claude prompt engineering details may require iteration.

### Pattern: Three-Tier Memory Model

**Semantic memory** — Facts that never change or rarely change. Hotel description, room types, pricing tiers, policies. Stored in `hotel_context` JSONB column, loaded on every agent invocation. Updated by owner via settings UI.

**Episodic memory** — Things that happened. Specific guest interactions, incidents, complaints, requests. Stored in `agent_memory` with `memory_type = 'episodic'`. Retrieved selectively (e.g., for the specific guest currently in conversation).

**Working memory** — Current conversation thread. Last 15-20 messages from `messages` table. The active context window for the ongoing interaction.

```typescript
// Memory retrieval strategy
async function buildMemoryContext(
  hotelId: string,
  agentRole: AgentRole,
  guestId?: string
): Promise<string> {
  const [semanticMemory, episodicMemory] = await Promise.all([
    // Always load: hotel facts
    db.hotelContext.findUnique({ where: { hotelId } }),
    // Conditionally load: guest-specific memories (only if guest in conversation)
    guestId
      ? db.agentMemory.findMany({
          where: { hotelId, agentRole, guestId, memoryType: 'episodic' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
      : Promise.resolve([]),
  ]);
  return formatMemoryForPrompt(semanticMemory, episodicMemory);
}
```

**Confidence:** MEDIUM — pattern is sound; specifics of what to include need product iteration.

### Pattern: Agent-to-Agent Coordination via Database Queue

Agents do NOT call each other directly (no synchronous agent-to-agent API calls). Instead, coordination happens through a tasks/notifications table:

```
Receptionist AI receives: "Room 204 checkout, please clean for 3pm arrival"
  → Receptionist WRITES a task: { type: 'clean_room', room: 204, deadline: 15:00, assigned_to: 'housekeeping' }
  → Housekeeping AI reads this task on next invocation (or via realtime trigger)
  → Housekeeping AI takes action, marks task complete
  → Receptionist AI is notified on next invocation
```

**Why async queue over direct calls:**
- Avoids cascading failures (one agent's API timeout doesn't block another)
- Creates an audit trail of all agent actions
- Works naturally with serverless architecture
- Human owner can see all pending/completed tasks

**Confidence:** HIGH — async task queues are the correct coordination pattern for distributed agent systems.

```sql
-- tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id),
  created_by_agent agent_role NOT NULL,
  assigned_to_agent agent_role,  -- NULL = unassigned/for human
  task_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | done | escalated
  priority INTEGER DEFAULT 5,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Data Flow

### Flow 1: Guest Message → AI Receptionist → Response

```
Guest sends message (web chat widget or WhatsApp)
  ↓
POST /api/webhooks/guest-chat (Next.js API Route)
  ↓
Middleware: Identify hotel_id from widget token / WhatsApp number mapping
  ↓
Middleware: Rate limit + content filter
  ↓
Create/find conversation thread for this guest
  ↓
Queue task: invoke_agent { hotel_id, agent=receptionist, thread_id, message }
  ↓
[Edge function or background job]
  ↓
invokeAgent()
  ├── Load hotel context from DB
  ├── Load conversation history (last 20 msgs)
  ├── Load guest memory (this guest's past interactions)
  └── Build system prompt
  ↓
Claude API (claude-opus-4-6 or claude-haiku for speed)
  ↓
Parse response → extract: reply_text, actions[], flags[]
  ↓
Save message to messages table
  ↓
Execute actions (e.g., create task for housekeeping, update booking)
  ↓
If flags.needs_human_review → send notification to hotel owner
  ↓
Return response to guest (via SSE stream or webhook callback)
```

### Flow 2: Hotel Owner Chatting with AI Employee

```
Owner opens "Maya (Receptionist)" chat in dashboard
  ↓
POST /api/chat/receptionist (authenticated with Supabase session)
  ↓
Supabase JWT → extract hotel_id (RLS auto-enforces tenant scope)
  ↓
invokeAgent() with owner-context flag
  ↓
[Different system prompt layer: owner mode vs guest mode]
  ↓
Claude API
  ↓
Response includes: natural language reply + optional structured data
(e.g., "Here are today's arrivals: [table data]")
  ↓
Stream response to dashboard via SSE
```

### Flow 3: Autonomous Task Execution (Background)

```
Scheduled job runs every 15 minutes (Vercel Cron or Supabase pg_cron)
  ↓
For each active hotel:
  └── For each active agent role:
      ↓
      Check: Are there pending tasks for this agent?
      Check: Are there scheduled actions due (e.g., morning report)?
      ↓
      If yes → invokeAgent() with task context
      ↓
      Agent decides: execute task | request more info | escalate to owner
      ↓
      Update task status
      ↓
      If escalated → notification to owner
```

**Confidence for data flows:** HIGH — these flows follow standard event-driven SaaS patterns adapted for AI agents.

---

## Recommended Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Login, register, onboarding
│   ├── (dashboard)/              # Hotel owner authenticated area
│   │   ├── staff/                # AI employee management
│   │   │   └── [agentRole]/      # Chat with specific employee
│   │   ├── guests/               # Guest management
│   │   ├── tasks/                # Task queue view
│   │   ├── reports/              # Analytics
│   │   └── settings/             # Hotel config, agent customization
│   ├── guest/                    # Guest-facing chat (unauthenticated)
│   │   └── [hotelSlug]/          # Embeddable or hosted guest chat
│   └── api/
│       ├── chat/                 # Owner ↔ agent chat endpoint
│       │   └── [agentRole]/
│       ├── guest/                # Guest ↔ receptionist endpoint
│       ├── webhooks/             # WhatsApp, external integrations
│       │   └── whatsapp/
│       ├── tasks/                # Task CRUD
│       ├── agents/               # Agent config management
│       └── cron/                 # Scheduled autonomous tasks
│
├── lib/
│   ├── agents/                   # Agent system — core domain
│   │   ├── types.ts              # AgentRole, AgentConfig, AgentResponse
│   │   ├── factory.ts            # createAgent(role, hotelId) → Agent
│   │   ├── orchestrator.ts       # invokeAgent() — main entry point
│   │   ├── context-builder.ts    # Assembles system prompt from layers
│   │   ├── memory.ts             # Read/write agent memory
│   │   └── roles/                # Per-role definitions
│   │       ├── receptionist.ts   # System prompt template, tools, behavior
│   │       ├── housekeeping.ts
│   │       ├── revenue.ts
│   │       ├── guest-relations.ts
│   │       └── accounting.ts
│   │
│   ├── claude/                   # Claude API wrapper
│   │   ├── client.ts             # Anthropic SDK instance
│   │   ├── stream.ts             # SSE streaming helpers
│   │   └── rate-limiter.ts       # Per-tenant rate limiting
│   │
│   ├── db/                       # Database access layer
│   │   ├── client.ts             # Supabase client (server-side)
│   │   ├── hotels.ts             # Hotel CRUD
│   │   ├── messages.ts           # Message thread operations
│   │   ├── tasks.ts              # Task queue operations
│   │   ├── memory.ts             # Agent memory operations
│   │   └── guests.ts             # Guest profile operations
│   │
│   ├── notifications/            # Alert system
│   │   ├── in-app.ts             # Supabase Realtime push
│   │   └── email.ts              # Transactional emails
│   │
│   └── multi-tenancy/
│       ├── tenant-context.ts     # Extract hotel_id from JWT/session
│       └── rate-limits.ts        # Per-tenant API limits
│
├── components/                   # React UI components
│   ├── chat/                     # Chat interface components
│   ├── staff/                    # Employee card, status display
│   ├── tasks/                    # Task list, task status
│   └── shared/                   # Buttons, forms, layout
│
└── types/                        # Shared TypeScript types
    ├── agents.ts
    ├── hotel.ts
    └── database.ts               # Supabase generated types
```

### Structure Rationale

- **lib/agents/roles/:** Each agent role is a self-contained module with its own system prompt template, allowed tools, and behavioral rules. Adding a 6th agent = adding one file here.
- **lib/claude/:** Isolated Claude API layer makes it easy to swap models, add retries, or inject rate limiting without touching agent logic.
- **lib/db/:** All database access is centralized — RLS enforcement happens at Supabase level, but DB functions provide typed, tested abstractions.
- **app/api/cron/:** Autonomous agent tasks run as Vercel cron jobs — keeps scheduled work visible and testable.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude API (Anthropic) | Direct REST via `@anthropic-ai/sdk` | Use streaming for owner chat; non-streaming for background tasks |
| Supabase | Supabase JS SDK (server client) | Service role key for API routes; anon key + session for client |
| WhatsApp Business API | Inbound webhook + outbound HTTP | Requires Meta Business verification; use official WhatsApp Cloud API |
| Vercel Cron | Endpoint invocation on schedule | Free tier: 1 cron per day; Pro: more frequent; needed for autonomous tasks |
| Supabase Realtime | WebSocket subscription | For pushing task notifications to owner dashboard without polling |
| Resend (email) | REST API for transactional email | Escalation alerts, daily summaries |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Dashboard UI ↔ API | HTTPS REST + SSE streaming | SSE for streaming chat responses; REST for everything else |
| API ↔ Agent Orchestrator | Direct function call (same process) | Not microservices — keep it simple for v1 |
| Agent Orchestrator ↔ Claude API | HTTP via Anthropic SDK | Each invocation is independent; no persistent connection |
| Agent ↔ Agent coordination | Async via tasks table | Never synchronous direct calls between agents |
| API ↔ Database | Supabase JS SDK (server-side) | All queries go through service role with RLS for safety |
| Guest Widget ↔ API | HTTPS REST with hotel token | Hotel token identifies tenant; guest session managed separately |

---

## Architectural Patterns

### Pattern 1: Agent Factory with Role Registry

Each agent role is registered in a central registry. The factory creates the correct agent configuration by composing role-specific behavior with hotel-specific configuration.

**What:** Central registry maps `AgentRole` enum to role definition (system prompt template, available tools, memory scope, communication mode: guest-facing vs internal-only).

**When to use:** Whenever new agent is invoked. Single entry point for all agent creation.

**Trade-offs:** Adds indirection, but makes adding new roles trivial and keeps all role-specific logic in one place.

```typescript
// lib/agents/roles/registry.ts
export const AGENT_REGISTRY: Record<AgentRole, AgentRoleDefinition> = {
  receptionist: {
    name: 'Receptionist',
    defaultName: 'Maya',
    systemPromptTemplate: receptionistPrompt,
    guestFacing: true,
    allowedTools: ['lookup_booking', 'create_task', 'update_guest_profile'],
    memoryScope: ['hotel', 'guest'],  // loads both hotel and guest-specific memory
  },
  housekeeping: {
    name: 'Housekeeping Manager',
    defaultName: 'Rosa',
    systemPromptTemplate: housekeepingPrompt,
    guestFacing: false,
    allowedTools: ['update_room_status', 'create_task', 'assign_task'],
    memoryScope: ['hotel'],           // only hotel-level memory
  },
  // ...
};
```

**Confidence:** HIGH — standard factory/registry pattern, well-suited to this use case.

### Pattern 2: Streaming Response with Structured Action Extraction

For owner chat, stream the conversational text to the UI while also parsing structured actions out of the response. Use Claude's tool_use feature to return actions as structured JSON alongside natural language.

**What:** System prompt instructs Claude to respond with both: (a) a natural language reply for the human, and (b) optional tool_use blocks for structured actions like creating tasks, updating rooms, sending alerts.

**When to use:** Any time an agent response might trigger a database action or notification.

**Trade-offs:** More complex response parsing, but avoids fragile string parsing and enables reliable action extraction.

```typescript
// lib/agents/orchestrator.ts
const response = await anthropic.messages.create({
  model: 'claude-opus-4-6',
  system: systemPrompt,
  messages: conversationHistory,
  tools: getToolsForRole(agentRole),  // role-specific tool definitions
});

// Parse response: text blocks for display, tool_use blocks for actions
const textContent = response.content
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('');

const actions = response.content
  .filter(b => b.type === 'tool_use')
  .map(b => ({ tool: b.name, input: b.input }));

await executeActions(actions, { hotelId, agentRole });
```

**Confidence:** HIGH — Claude tool use is the canonical approach for structured output alongside natural language.

### Pattern 3: Hybrid Autonomous + Interactive Mode

Agents operate in two modes: **interactive** (human sends message, agent responds) and **autonomous** (cron-triggered, agent reviews state and acts without prompting).

**What:** The same `invokeAgent()` function handles both modes. The difference is only in the input: interactive mode passes a user message; autonomous mode passes a "system review" prompt asking the agent to check for pending tasks or proactive actions.

**When to use:** Autonomous mode runs on Vercel Cron (e.g., every 15 mins for task processing, daily for reports).

**Trade-offs:** Simple and reuses all agent logic. Risk: autonomous mode can generate unnecessary actions — requires well-designed system prompts with "if nothing needs doing, do nothing" instructions.

```typescript
// Autonomous invocation example
await invokeAgent({
  hotelId,
  agentRole: 'housekeeping',
  threadId: 'system-autonomous',
  mode: 'autonomous',
  context: {
    pendingTasks: await getPendingTasksForAgent(hotelId, 'housekeeping'),
    todayCheckouts: await getTodayCheckouts(hotelId),
    currentTime: new Date().toISOString(),
  },
});
```

**Confidence:** MEDIUM — pattern is sound; the system prompt engineering for reliable autonomous behavior requires iteration.

---

## Data Flow: State Management

```
[Owner Dashboard (React)]
  ↓ POST /api/chat/[agentRole]
  ↓
[API Route]
  ├── Validate session (Supabase auth)
  ├── Extract hotel_id from JWT
  └── invokeAgent()
      ├── DB: Load hotel context
      ├── DB: Load conversation history
      ├── DB: Load agent memory
      ├── Build system prompt
      └── Claude API → stream response
  ↓
  ↓ SSE stream
[Owner Dashboard]
  → Renders streaming text
  → On complete: actions executed, task created if needed
  → Supabase Realtime: other agents notified of new task
```

```
[Guest Widget (embedded in hotel website)]
  ↓ POST /api/guest (with hotel token)
  ↓
[API Route — no auth, identified by hotel token]
  ├── Resolve hotel_id from token
  ├── Detect or create guest session
  └── invokeAgent({ agentRole: 'receptionist' })
  ↓
[Response]
  → JSON (not streamed) — simpler for widget integration
  → Guest sees response
  → Any tasks created go to owner notification queue
```

---

## Anti-Patterns

### Anti-Pattern 1: Persistent Agent Processes

**What people do:** Run long-lived agent processes (e.g., Node.js websocket connections per agent) that hold conversation state in memory.

**Why it's wrong:** Incompatible with Vercel serverless. If server restarts, all in-memory state is lost. Cannot scale horizontally. Memory leaks per tenant accumulate.

**Do this instead:** Stateless invocation — load all context from DB on each call. Claude's context window is large enough that this adds only ~50-100ms DB overhead per invocation.

### Anti-Pattern 2: Putting Hotel Context in a Single Giant System Prompt

**What people do:** Build one massive 10,000-token system prompt with everything about the hotel baked in at startup.

**Why it's wrong:** Context is stale the moment it is compiled. Hotel policies change, rooms go out of service, prices update. Also, all agents share the same mega-prompt which prevents role-specific behavior.

**Do this instead:** Layered prompt assembly at invocation time. Load only what's needed for this agent's role. Hotel context comes from DB (always fresh). Agent role definition is static code.

### Anti-Pattern 3: Direct Agent-to-Agent Synchronous Calls

**What people do:** Receptionist agent calls a function that directly invokes the housekeeping agent and waits for the response.

**Why it's wrong:** Creates tight coupling and cascading timeouts. If housekeeping agent call takes 5 seconds, receptionist response is delayed. On Vercel, function timeout chains become a problem.

**Do this instead:** Agent writes a task/notification to the database. Housekeeping agent picks it up on next invocation (triggered by cron or Supabase webhook). Completely decoupled.

### Anti-Pattern 4: Single Shared Thread for All Hotel Communication

**What people do:** Store all messages in one big table, filtered only by `hotel_id`.

**Why it's wrong:** Owner chat with agent Maya, guest chat in room 12, and autonomous task logs all mixed together. Makes context assembly complex and pollutes conversation history.

**Do this instead:** Thread-scoped conversations. Each context (owner ↔ Maya, guest_session_xyz ↔ receptionist, autonomous_daily_report) has its own thread. Agents only see history relevant to current interaction.

### Anti-Pattern 5: Skipping Rate Limiting on AI Endpoints

**What people do:** Expose `/api/chat` with no rate limiting, trusting that only paying customers will use it.

**Why it's wrong:** A single guest with a web chat widget can generate hundreds of Claude API calls in minutes (intentionally or accidentally). Claude API costs are per-token and scale with usage.

**Do this instead:** Per-tenant rate limiting at the API route level. Use Redis (Upstash) or Supabase counters. Limit: reasonable messages-per-minute per guest session and per hotel per hour.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-50 hotels | Monolith is correct. One Next.js app, one Supabase project, Vercel free/hobby tier. Cron every 15 min. |
| 50-500 hotels | Monitor Claude API rate limits (per-org limits). Add Redis (Upstash) for rate limiting. Consider Supabase Pro for connection pooling. |
| 500-5000 hotels | Supabase becomes bottleneck for connection counts. Add PgBouncer or use Supabase's built-in pooler mode. Split cron jobs by region if multi-region. |
| 5000+ hotels | Consider queue-based agent invocation (BullMQ + Upstash Redis) to handle burst task processing. Agent orchestration may need its own service. |

### Scaling Priorities

1. **First bottleneck:** Claude API token costs and rate limits — instrument token usage per hotel/agent from day 1; add caching for repeated hotel context calls.
2. **Second bottleneck:** Supabase connection pool exhaustion under concurrent requests — enable Supabase Pooler from the start (uses PgBouncer behind the scenes).
3. **Third bottleneck:** Vercel function cold starts for streaming responses — use Edge Runtime for latency-sensitive endpoints.

---

## Build Order Implications

The architecture has hard dependencies that dictate build sequence:

```
1. Database Schema + RLS (Supabase)
   Must exist before anything else. All other components depend on it.

2. Auth + Tenant Context Middleware
   Must exist before any API routes. Establishes hotel_id extraction.

3. Hotel Context Storage (CRUD for hotel knowledge)
   Agent system is useless without hotel data to inject into prompts.

4. Agent Orchestrator Core (invokeAgent, context-builder, memory)
   The engine. Build this before any UI that talks to agents.

5. First Agent (Receptionist — owner-facing chat only)
   Prove the pattern works with one agent before building 5.
   Owner can chat with receptionist from a basic UI.

6. Guest-Facing Layer (web widget, WhatsApp webhook)
   Built after receptionist works, adds external-facing channel.

7. Remaining Agent Roles
   Add agents one by one using the established factory pattern.

8. Autonomous Mode + Cron
   Add autonomous behavior after interactive mode is stable.

9. Owner Dashboard Polish + Analytics
   UI layer on top of working agent system.
```

**Dependency graph:**
```
Schema → Auth → Hotel CRUD → Agent Core → First Agent → Guest Layer
                                    ↓
                              More Agents
                                    ↓
                           Autonomous Mode → Cron Jobs
                                    ↓
                              Dashboard UI
```

---

## Sources

- Anthropic Claude API documentation — tool use and agent patterns (training knowledge, confidence: MEDIUM; web verification denied)
- Supabase RLS documentation — multi-tenant isolation pattern (training knowledge + Supabase's documented recommended approach, confidence: HIGH for RLS pattern)
- Vercel serverless architecture constraints — stateless execution model (training knowledge, confidence: HIGH — fundamental platform constraint)
- Standard multi-tenant SaaS patterns — Row Level Security approach (MEDIUM — well-established pattern verified by multiple community sources in training)
- Agent memory taxonomy (semantic/episodic/working) — derived from cognitive science and applied to AI agent systems (MEDIUM — standard framing in AI agent literature)

---

*Architecture research for: OtelAI — Multi-agent Hotel Virtual Staff SaaS*
*Researched: 2026-03-01*
*Note: Web search and web fetch tools were unavailable during this research session. All findings are based on training knowledge (cutoff August 2025) and project context. Confidence levels reflect this limitation. Verify Claude API tool_use syntax and Supabase RLS specifics against current official documentation before implementation.*
