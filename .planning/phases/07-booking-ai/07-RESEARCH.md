# Phase 7: Booking AI - Research

**Researched:** 2026-03-05
**Domain:** Availability tool implementation, Booking AI agent role, rolling context management, PostgreSQL date-range queries
**Confidence:** HIGH (all critical claims verified against codebase + official Anthropic docs; DB pattern verified against PostgreSQL docs)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BOOK-01 | Booking AI handles availability inquiries over WhatsApp and web chat | Existing `invokeAgent()` + WhatsApp webhook + widget SSE already in place; Phase 7 adds a BOOKING_AI role to `AgentRole` enum and wires it up to both channels |
| BOOK-02 | Booking AI retrieves real-time room availability via tool call (never hallucinated) | `stubs.ts` `getAvailability()` explicitly marked "STUB: Replace with real DB query when rooms/bookings tables exist (Phase 7)"; Phase 7 replaces it with a real Supabase query against a new `reservations` table; tool-first policy already enforced via `isToolRequired()` and `tool_choice: { type: "any" }` |
| BOOK-03 | Booking AI provides accurate pricing from hotel knowledge base | `stubs.ts` `getRoomPricing()` explicitly marked for Phase 7 replacement; rooms table has `base_price_note` text field; Phase 7 replaces stub with real DB read from `rooms` table |
| BOOK-04 | Booking AI can soft-upsell room upgrades during inquiry | Behavioral prompt instruction pattern — no new tools needed; upsell triggered after `get_room_availability` returns multiple room types at different price points |
| BOOK-05 | Booking AI escalates complex/custom requests to hotel owner | Existing `detectAndInsertEscalation()` catches fallback phrases; Phase 7 adds explicit escalation trigger phrases for group bookings, special rates, and custom requests to the ESCALATION_PHRASES list |
</phase_requirements>

---

## Summary

Phase 7 has three distinct work streams. The first and most concrete is replacing the two stubbed tool implementations (`getAvailability` and `getRoomPricing` in `stubs.ts`) with real Supabase queries. This requires a new `reservations` table (Phase 4's `bookings` table records milestone-messaging bookings but lacks a rooms FK and overlap-prevention constraint) and updating the tool executor to query it. The second is adding a `BOOKING_AI` agent role to `agentFactory.ts` with a booking-specific system prompt that includes upsell logic and escalation phrases for complex requests. The third is the rolling context management plan (07-03), which is the most architectural: the current system hard-caps conversation turns at 20 rows loaded from the DB, but for booking conversations (which can run long with multiple availability checks and counter-offers) a smarter approach is needed — keep the last N turns verbatim plus a compressed summary of older turns injected into the system prompt's `<memory>` layer.

The key insight from the codebase audit is that almost all the scaffolding exists. `invokeAgent()` already handles tool dispatch, streaming, and the tool-first policy. `assembleContext.ts` already has a `<memory>` layer. The stub functions are already wired to the FRONT_DESK role via the TOOLS registry. Phase 7 is primarily replacement work (stubs → real queries), role extension (adding BOOKING_AI), and context management upgrade (fixed 20-turn cap → rolling N + summary).

**Primary recommendation:** Implement in this order: (1) reservations table migration + real tool implementations, (2) BOOKING_AI role + prompt, (3) rolling context. Rolling context is the least understood risk and should be deferred to the last plan so early plans can be verified independently.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.78.0 (installed) | Claude API — tool_choice enforcement, streaming | Already in project; tool-first policy implemented in Phase 2 |
| `@supabase/supabase-js` | ^2.98.0 (installed) | Availability queries, service client for tool execution | Already in project; service client already used in escalation.ts |
| `zod` | ^4.3.6 (installed) | Validate tool input dates before DB query | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| No new libraries needed | — | All required libraries already installed | Phase 7 is entirely implementation work on existing stack |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Supabase RPC for availability query | Raw SQL via `supabase.rpc()` | RPCs encapsulate complex overlap logic but add a migration step; for Phase 7's simple query, a JS-layer query with `.not()` + `.overlaps()` is simpler and keeps logic visible |
| daterange PostgreSQL type | Two separate `check_in DATE` + `check_out DATE` columns | Separate columns are simpler to query from JS (no range type serialization); btree index works for date overlap via `NOT (check_out <= $check_in OR check_in >= $check_out)` |

**Installation:**
```bash
# Nothing to install — all dependencies already present
```

---

## Architecture Patterns

### Recommended Project Structure for Phase 7

```
src/
├── lib/
│   └── agents/
│       ├── agentFactory.ts          # Add BOOKING_AI role config (new entry in ROLE_REGISTRY)
│       ├── tools/
│       │   ├── stubs.ts             # DELETE stubs — replaced by real implementations
│       │   ├── availability.ts      # NEW: real getAvailability() — Supabase query
│       │   ├── pricing.ts           # NEW: real getRoomPricing() — rooms table read
│       │   ├── executor.ts          # Update dispatch map to use new implementations
│       │   └── registry.ts          # No changes needed — tool definitions already exist
│       └── memory.ts               # Add loadConversationSummary() + summarizeOldTurns()
├── types/
│   └── database.ts                 # Add Reservation interface
└── app/
    └── api/
        └── agent/
            └── stream/
                └── route.ts         # Add BOOKING_AI role routing (alongside FRONT_DESK)
supabase/
└── migrations/
    └── 0007_booking_ai.sql          # reservations table + service-role INSERT policy
```

### Pattern 1: Real Availability Tool — Overlap Query

**What:** Replace `getAvailability()` stub with a real Supabase query that finds rooms not booked during the requested date range.

**When to use:** Called by BOOKING_AI (and FRONT_DESK) whenever `isToolRequired()` returns true and the guest asks about availability.

**Critical detail:** The query must use the service client (not the session client) because tool execution happens inside `executeTool()` which is called from both session-authenticated contexts (widget, dashboard) and unauthenticated contexts (WhatsApp webhook). The service client bypasses RLS and uses `hotel_id` scoping in the query's WHERE clause instead.

**Availability overlap logic (SQL-equivalent in JS):**
```typescript
// Source: PostgreSQL range overlap pattern verified at
// https://www.crunchydata.com/blog/range-types-recursion-how-to-search-availability-with-postgresql
// A room is UNAVAILABLE for [check_in, check_out) if any reservation satisfies:
//   reservation.check_in < check_out AND reservation.check_out > check_in
// Therefore available rooms have NO such reservation.

// src/lib/agents/tools/availability.ts
import { createServiceClient } from '@/lib/supabase/service';

export async function getAvailability(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { hotel_id, check_in, check_out, room_type } = input as {
    hotel_id: string;
    check_in: string;
    check_out: string;
    room_type?: string;
  };

  const supabase = createServiceClient();

  // Step 1: Get booked room IDs for the requested dates
  const { data: bookedRooms } = await supabase
    .from('reservations')
    .select('room_id')
    .eq('hotel_id', hotel_id)
    .neq('status', 'cancelled')
    .lt('check_in_date', check_out)   // reservation starts before requested end
    .gt('check_out_date', check_in);  // reservation ends after requested start

  const bookedRoomIds = (bookedRooms ?? []).map((r) => r.room_id);

  // Step 2: Get all hotel rooms, filter out booked ones
  let roomQuery = supabase
    .from('rooms')
    .select('id, name, room_type, bed_type, max_occupancy, base_price_note, amenities')
    .eq('hotel_id', hotel_id)
    .order('sort_order');

  if (bookedRoomIds.length > 0) {
    roomQuery = roomQuery.not('id', 'in', `(${bookedRoomIds.join(',')})`);
  }
  if (room_type) {
    roomQuery = roomQuery.eq('room_type', room_type);
  }

  const { data: availableRooms, error } = await roomQuery;

  if (error) {
    return { error: true, message: error.message };
  }

  return {
    available: (availableRooms ?? []).length > 0,
    check_in,
    check_out,
    rooms: availableRooms ?? [],
    nights: Math.ceil(
      (new Date(check_out).getTime() - new Date(check_in).getTime()) / (1000 * 60 * 60 * 24),
    ),
  };
}
```

**Key constraint:** Tool executor must pass `hotel_id` from `ToolContext` into the tool function. The current `TOOL_DISPATCH` passes only `input` + `context`. Update `get_room_availability` entry in `executor.ts` to merge `hotel_id: context.hotelId` into input before calling.

### Pattern 2: Real Pricing Tool — Rooms Table Read

**What:** Replace `getRoomPricing()` stub with a real rooms table query.

**When to use:** Called by BOOKING_AI when guest asks about prices.

**Note:** The existing `rooms` table stores `base_price_note` as freeform text (e.g. "from €120/night") — this is intentional per Phase 3 decision: "base_price_note as freeform text for agent display only — not structured pricing data." Phase 7 reads this field; it does NOT add a numeric price column (that would be scope creep toward a booking engine).

```typescript
// src/lib/agents/tools/pricing.ts
export async function getRoomPricing(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { hotel_id, room_type, check_in, check_out } = input as {
    hotel_id: string;
    room_type?: string;
    check_in?: string;
    check_out?: string;
  };

  const supabase = createServiceClient();

  let query = supabase
    .from('rooms')
    .select('name, room_type, base_price_note, bed_type, max_occupancy')
    .eq('hotel_id', hotel_id)
    .order('sort_order');

  if (room_type) {
    query = query.eq('room_type', room_type);
  }

  const { data, error } = await query;

  if (error) return { error: true, message: error.message };

  return {
    prices: (data ?? []).map((room) => ({
      name: room.name,
      type: room.room_type,
      price_note: room.base_price_note ?? 'Pricing available upon request',
      bed_type: room.bed_type,
      max_occupancy: room.max_occupancy,
    })),
    check_in: check_in ?? null,
    check_out: check_out ?? null,
  };
}
```

### Pattern 3: BOOKING_AI Role — System Prompt with Upsell + Escalation

**What:** A new `AgentRole.BOOKING_AI` entry in `agentFactory.ts` with a booking-specific identity and behavioral prompt.

**Upsell mechanism:** After retrieving availability via tool call, if the result contains rooms at multiple price tiers, the behavioral prompt instructs the agent to mention the upgrade option naturally — not as a sales pitch, but as an informational offer. The tool result already contains all room details, so the agent can compose a natural upsell from the data.

**Escalation trigger:** Group bookings, corporate rates, and special package requests are outside the tool's scope (they require human negotiation). The behavioral prompt must list these explicitly as escalation triggers, which complement the existing `detectAndInsertEscalation()` fallback-phrase detection.

```typescript
// In agentFactory.ts ROLE_REGISTRY:
[AgentRole.BOOKING_AI]: {
  model: 'claude-opus-4-6',  // guest-facing = opus per project decision

  tools: [
    TOOLS.get_room_availability,
    TOOLS.get_room_pricing,
  ],

  memoryScope: 'recent_30',

  promptTemplate: {
    identity: `You are the Booking AI for this hotel. You help guests check room availability and pricing, and guide them toward making a reservation. You are professional, warm, and helpful — like speaking to a knowledgeable receptionist who wants to find the right room for you.`,

    behavioral: `CRITICAL POLICY — TOOL-FIRST RULE:
You MUST NOT state room availability or pricing from memory or training data.
If asked about available rooms or prices, you MUST call the appropriate tool first.
Stating data you have not retrieved via a tool call in THIS conversation is a policy violation.

AVAILABILITY INQUIRY FLOW:
1. When a guest asks about availability, call get_room_availability with their dates.
2. Report what is available clearly: room name, type, price note, and nights.
3. If multiple room types are available at different price tiers, mention the upgrade option naturally:
   "We also have a [higher-tier room] available — it includes [key benefit] at [price note] if that interests you."
4. Never pressure — offer once, then let the guest respond.

PRICING INQUIRY:
- Always call get_room_pricing before stating any price.
- Present prices as noted in the knowledge base (freeform price notes, not computed totals).
- If a guest asks for a price quote for specific dates, call get_room_availability first (prices may depend on availability context).

ESCALATION TRIGGERS — say "Please contact reception directly for this" and nothing more for:
- Group bookings (3 or more rooms or 10+ guests)
- Corporate or negotiated rate requests
- Special package requests (honeymoon, anniversary, etc. with custom inclusions)
- Multi-week or extended stay requests with rate negotiations
- Any request that requires a contract or written agreement

MULTILINGUAL SUPPORT:
Detect the guest's language and respond in the same language.
Use hotel knowledge base information to construct responses, but communicate naturally in the guest's language.`,
  },
},
```

### Pattern 4: Rolling Context Management — N-Turn Window + Summary

**What:** Replace the current hard-cap of 20 turns with a rolling window: the last N turns loaded verbatim from the DB, plus a compressed summary of all older turns injected into the `<memory>` layer of the system prompt.

**Why it matters for Booking AI:** Booking conversations are longer than general inquiries. A guest may ask about dates, get redirected to another weekend, ask again, compare rooms, negotiate, ask about the cancellation policy, then ask about availability again. With the current 20-turn hard cap, early conversation context is silently dropped rather than summarized, causing the agent to lose track of stated guest preferences.

**Implementation approach (ConversationSummaryBuffer pattern):**

The existing `memory.ts` has two functions to modify:
1. `loadConversationTurns()`: Instead of blindly loading the last 20 turns, load the last N (e.g. 10) turns verbatim + check if a `conversation_summaries` row exists for older turns.
2. Add `persistConversationSummary()`: Called when the turn count exceeds a threshold; compresses turns 1–(total-N) into a summary via a Claude API call (non-streaming, claude-sonnet-4-6).

**Summary storage:** Add a `conversation_summaries` table with `conversation_id (PK)`, `hotel_id`, `summary` (TEXT), `turns_summarized` (INTEGER), `updated_at`. One row per conversation — updated in place when turns are summarized again.

**Summary injection:** In `assembleContext.ts`, after loading `semanticFacts` and `episodicHistory`, also load the conversation summary (if any) and prepend it to the `<memory>` block as a `[Earlier conversation summary:]` section.

```typescript
// Trigger: called inside loadConversationTurns when turn count > SUMMARY_THRESHOLD
// SUMMARY_THRESHOLD = 30 (must be > RECENT_TURNS_N = 10)

// Pseudocode in memory.ts:
export async function loadConversationTurns(conversationId: string): Promise<MessageParam[]> {
  const supabase = await createClient();

  // Count total turns for this conversation
  const { count } = await supabase
    .from('conversation_turns')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  const totalTurns = count ?? 0;

  if (totalTurns > SUMMARY_THRESHOLD) {
    // Summarize old turns (fire-and-forget — don't block the response)
    summarizeOldTurns(conversationId, totalTurns - RECENT_TURNS_N).catch(console.error);
  }

  // Always load only the most recent RECENT_TURNS_N turns for the messages array
  const { data } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(RECENT_TURNS_N)
    .returns<ConversationTurn[]>();

  // Reverse to chronological order for Anthropic messages array
  return (data ?? []).reverse().map(/* ... existing reconstruction logic ... */);
}
```

**Important:** The summary is injected at the system prompt level (via `assembleContext.ts`), not in the messages array. This keeps the Anthropic messages array clean (only the last N real turns) while still giving the model the earlier context.

### Anti-Patterns to Avoid

- **Returning computed price totals:** The `getRoomPricing` tool must return `base_price_note` (freeform text) not computed prices. Phase 3 decision: base_price_note is for agent display, not a booking engine.
- **Querying rooms without hotel_id scope:** The availability tool runs in a serverless context with a service client (bypasses RLS). Always explicitly filter by `hotel_id` from `ToolContext`.
- **Summarizing synchronously in the request path:** The summarization call uses Claude API (latency) — it must be fire-and-forget, same pattern as `detectAndInsertEscalation()`.
- **Using session client in tool executor:** Tool execution happens in WhatsApp webhook context (no user session). The service client must be used for tool DB operations.
- **Adding BOOKING_AI to the widget route without billing check:** `enforceAgentLimit` must be called for BOOKING_AI same as FRONT_DESK — it's a billable AI employee.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date overlap detection | Custom JS date loop | Supabase `.lt()` + `.gt()` overlap query (Pattern 1) | Two simple inequalities correctly detect all overlap cases; loop-based solutions miss edge cases |
| Conversation compression | Custom tokenizer/truncator | Claude API (claude-sonnet-4-6) summarization call | Model-generated summaries preserve semantic meaning; truncation loses context unpredictably |
| Upsell logic | Separate upsell scoring system | Behavioral prompt instruction on tool result data | Tool already returns all rooms; prompt instructs the model to offer upgrade naturally — no extra system needed |
| Escalation detection | NLP classifier | Behavioral prompt + existing `detectAndInsertEscalation()` phrases | The existing phrase-detection system works; Phase 7 extends the ESCALATION_PHRASES array with booking-specific triggers |

**Key insight:** The codebase already has all the dispatch infrastructure. Phase 7 is mostly filling in the blanks the previous phases explicitly left ("STUB: Replace with real DB query when rooms/bookings tables exist (Phase 7)").

---

## Common Pitfalls

### Pitfall 1: Tool Executor Doesn't Pass hotel_id to Tools

**What goes wrong:** `getAvailability()` is called without the hotel_id, queries against all hotels, returns wrong rooms or hits RLS denial.

**Why it happens:** `TOOL_DISPATCH` in `executor.ts` passes `input` (from Claude's tool call) and `context` (ToolContext with hotelId) separately. If the tool implementation only reads `input`, it misses `context.hotelId`.

**How to avoid:** In the `get_room_availability` entry of TOOL_DISPATCH, explicitly merge `hotel_id`:
```typescript
get_room_availability: (input, context) =>
  getAvailability({ ...input, hotel_id: context.hotelId }),
```

**Warning signs:** Availability returning rooms from the wrong hotel, or empty results when rooms exist.

### Pitfall 2: stubs.ts Still in Dispatch Map After Replacement

**What goes wrong:** `stubs.ts` `getAvailability()` is still imported in `executor.ts` despite new implementations in `availability.ts` and `pricing.ts`. Mock data is returned in production.

**Why it happens:** The executor imports from stubs at line 21: `import { getAvailability, getRoomPricing, lookupGuestReservation } from './stubs';`. This must be updated.

**How to avoid:** Replace the stubs import with imports from the new tool files. Delete `stubs.ts` or leave only `lookupGuestReservation` stub (which is out of scope for Phase 7).

**Warning signs:** Availability always returns "Standard: 3, Deluxe: 1" regardless of actual reservations.

### Pitfall 3: reservations Table vs bookings Table Confusion

**What goes wrong:** Using the existing `bookings` table for availability lookup. `bookings` (added in Phase 5) is for milestone-messaging records (pre-arrival, checkout reminder, review request) — it has no `room_id` FK, no overlap constraint, and no `status` field.

**Why it happens:** `bookings` has `check_in_date` and `check_out_date` which look correct but serve a different purpose.

**How to avoid:** Create a new `reservations` table in migration `0007_booking_ai.sql`. Schema: `id, hotel_id, room_id (FK rooms.id), guest_name, guest_phone, check_in_date DATE, check_out_date DATE, status TEXT (CHECK: 'pending'|'confirmed'|'cancelled'), created_at`.

**Warning signs:** Availability tool is querying `bookings` table — any code referencing `.from('bookings')` in the availability tool is wrong.

### Pitfall 4: Summarization Runs Every Request After Threshold

**What goes wrong:** `summarizeOldTurns()` is called on every `loadConversationTurns()` call once the turn count exceeds the threshold — even if the summary is already up to date.

**Why it happens:** No check whether a fresh summary already exists for the current turn count.

**How to avoid:** In `conversation_summaries`, store `turns_summarized` (INT). In `summarizeOldTurns()`, first check if `turns_summarized >= totalTurns - RECENT_TURNS_N`. If yes, skip. Only summarize the delta (new turns since last summary).

**Warning signs:** Unexpected Claude API calls on every message in a long conversation; high sonnet-4-6 token usage.

### Pitfall 5: BOOKING_AI Role Missing from agents Table Seed

**What goes wrong:** `is_enabled` check in `invokeAgent()` (depth 0) queries `agents` table for the role. BOOKING_AI row doesn't exist → `maybeSingle()` returns null → agent is treated as enabled (graceful fallback). But then billing enforcement via `enforceAgentLimit` may skip it if the role isn't registered.

**Why it happens:** Phase 5 migration seeds default agent rows in `seed_hotel_defaults_agents()`. BOOKING_AI must be added to this seed function.

**How to avoid:** Add to migration `0007_booking_ai.sql`:
```sql
-- Add BOOKING_AI to existing hotels (for hotels created before this migration)
INSERT INTO public.agents (hotel_id, role, is_enabled, behavior_config)
SELECT id, 'booking_ai', true, '{}'
FROM public.hotels
ON CONFLICT DO NOTHING;
```
And update `seed_hotel_defaults` trigger to include `booking_ai`.

---

## Code Examples

Verified patterns from official sources and codebase:

### Tool-First Enforcement for Booking Queries (Existing Pattern to Extend)
```typescript
// Source: src/lib/agents/invokeAgent.ts (existing isToolRequired function)
// Phase 7: No changes needed — existing keywords already cover booking queries
export function isToolRequired(message: string): boolean {
  const lower = message.toLowerCase();
  const keywords = [
    'available', 'availability', 'price', 'pricing', 'cost', 'rate',
    'room', 'book', 'booking', 'reservation', 'how much', 'per night',
    'vacant', 'free room',
    // Already covers Phase 7 booking inquiry patterns
  ];
  return keywords.some((keyword) => lower.includes(keyword));
}
```

### Reservations Table Schema (Migration 0007)
```sql
-- Source: PostgreSQL overlap prevention pattern
-- https://axellarsson.com/blog/postgres-prevent-overlapping-time-inteval/

CREATE TABLE public.reservations (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id        UUID         NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  guest_name     TEXT         NOT NULL,
  guest_phone    TEXT,
  check_in_date  DATE         NOT NULL,
  check_out_date DATE         NOT NULL,
  status         TEXT         NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  notes          TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT check_dates CHECK (check_out_date > check_in_date)
);

CREATE INDEX idx_reservations_hotel_dates ON public.reservations(hotel_id, check_in_date, check_out_date);
CREATE INDEX idx_reservations_room ON public.reservations(room_id, check_in_date);

-- RLS: hotel owners can see their own reservations
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own reservations"
  ON public.reservations FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role inserts (tools use service client)
CREATE POLICY "Service can insert reservations"
  ON public.reservations FOR INSERT WITH CHECK (true);

CREATE POLICY "Service can update reservations"
  ON public.reservations FOR UPDATE USING (true) WITH CHECK (true);
```

### Conversation Summary Table Schema (Migration 0007, Plan 07-03)
```sql
CREATE TABLE public.conversation_summaries (
  conversation_id  TEXT         PRIMARY KEY,  -- matches conversation_turns.conversation_id
  hotel_id         UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  summary          TEXT         NOT NULL,
  turns_summarized INTEGER      NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conv_summaries_hotel ON public.conversation_summaries(hotel_id);

ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff see own summaries"
  ON public.conversation_summaries FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role manages summaries (summarization runs in tool execution context)
CREATE POLICY "Service can upsert summaries"
  ON public.conversation_summaries FOR ALL WITH CHECK (true);
```

### Rolling Context: loadConversationTurns with Summary Support
```typescript
// Source: Pattern based on ConversationSummaryBuffer approach
// https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/

const RECENT_TURNS_N = 10;    // Load last 10 turns verbatim
const SUMMARY_THRESHOLD = 30; // Start summarizing when > 30 turns exist

// New function: load conversation summary for system prompt injection
export async function loadConversationSummary(conversationId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('conversation_summaries')
    .select('summary')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  return data?.summary ?? '';
}
```

### System Prompt with Summary Injection (assembleContext.ts extension)
```typescript
// Add to assembleContext.ts — inject summary into <memory> layer
const conversationSummary = await loadConversationSummary(params.conversationId);

const memoryParts: string[] = [];
if (conversationSummary.trim()) {
  memoryParts.push(`[Earlier conversation summary]:\n${conversationSummary}`);
}
if (semanticFacts.trim()) {
  memoryParts.push(`Hotel Knowledge Base:\n${semanticFacts}`);
}
// ... rest of memory assembly unchanged
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mock availability stubs | Real Supabase query against reservations table | Phase 7 | Eliminates hallucination risk; BOOK-02 satisfied |
| base_price_note text-only | base_price_note text-only (unchanged) | N/A — intentional | Phase 7 does NOT add numeric pricing; that's a booking engine feature out of scope |
| Hard-cap 20 turns | Rolling N turns + compressed summary | Phase 7 | Longer booking conversations retain full context without context rot |

**Deprecated/outdated:**
- `stubs.ts` `getAvailability()` and `getRoomPricing()`: These are explicitly marked for Phase 7 replacement. Phase 7 replaces them and removes or retains only `lookupGuestReservation` (which remains a stub — reservation lookup requires integration with the hotel's actual PMS, out of scope).

---

## Open Questions

1. **Should BOOKING_AI replace FRONT_DESK or run alongside it?**
   - What we know: FRONT_DESK already has `get_room_availability` and `get_room_pricing` tools + stub implementations. Adding a separate BOOKING_AI role means two roles with overlapping capabilities.
   - What's unclear: Whether Phase 7 intends BOOKING_AI to be an entirely separate role (selectable by channel) or an upgrade to FRONT_DESK's existing behavior.
   - Recommendation: Make BOOKING_AI a distinct role (separate entry in ROLE_REGISTRY) but with a booking-specific prompt. Keep FRONT_DESK for the owner-dashboard chat. Guest channels (WhatsApp, widget) route to BOOKING_AI. This is a planning decision.

2. **What is the RECENT_TURNS_N value for rolling context?**
   - What we know: Current hard cap is 20. The summary pattern works best when N is small enough to save tokens but large enough to maintain conversational coherence.
   - What's unclear: Optimal N for booking conversations.
   - Recommendation: Start with N=10, SUMMARY_THRESHOLD=30. Adjust post-launch based on observed context rot patterns.

3. **Does `lookupGuestReservation` get a real implementation in Phase 7?**
   - What we know: The stub returns "No reservation found" always. Phase 7 creates a `reservations` table.
   - What's unclear: The plan list (07-01, 07-02, 07-03) doesn't include lookup as a plan but it's natural to implement alongside availability.
   - Recommendation: Implement `lookupGuestReservation` as a real query against the `reservations` table in plan 07-01, alongside `getAvailability`. It's a one-liner given the table exists.

4. **Should BOOKING_AI have `is_enabled` billing enforcement?**
   - What we know: Phase 6 `enforceAgentLimit` checks agent count against plan limits before toggling. BOOKING_AI is a new billable agent.
   - What's unclear: Whether plan 07-02 needs to update billing enforcement logic.
   - Recommendation: Yes — add BOOKING_AI to the agents seed and ensure `enforceAgentLimit` counts it. Add this to plan 07-02.

---

## Sources

### Primary (HIGH confidence)
- Codebase audit: `/home/cagr/Masaüstü/otel-ai/src/lib/agents/tools/stubs.ts` — explicit Phase 7 replacement markers
- Codebase audit: `/home/cagr/Masaüstü/otel-ai/src/lib/agents/agentFactory.ts` — existing role/tool wiring
- Codebase audit: `/home/cagr/Masaüstü/otel-ai/src/lib/agents/memory.ts` — 20-turn cap, existing memory tiers
- Codebase audit: `/home/cagr/Masaüstü/otel-ai/src/lib/agents/tools/executor.ts` — tool dispatch pattern with ToolContext
- Codebase audit: `/home/cagr/Masaüstü/otel-ai/src/lib/agents/escalation.ts` — existing escalation phrase detection
- Codebase audit: `/home/cagr/Masaüstü/otel-ai/supabase/migrations/` — all prior table schemas

### Secondary (MEDIUM confidence)
- [Anthropic tool_choice docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) — tool_choice: "any" forces tool use; verified against existing codebase implementation
- [CrunchyData PostgreSQL range overlap](https://www.crunchydata.com/blog/range-types-recursion-how-to-search-availability-with-postgresql) — date overlap query pattern using `&&` operator; adapted to two-column DATE approach
- [Maxim AI context management](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) — ConversationSummaryBuffer pattern; confirmed as standard approach

### Tertiary (LOW confidence)
- WebSearch findings on upsell prompting: general guidance only; upsell behavior is entirely in prompt instruction text, no external validation needed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing stack verified in codebase
- Architecture: HIGH — stubs.ts replacement is explicit; service client usage verified against escalation.ts pattern
- Rolling context: MEDIUM — pattern is well-established but specific RECENT_TURNS_N and SUMMARY_THRESHOLD values are estimates; should be validated post-launch
- Pitfalls: HIGH — hotel_id missing from tool input and stubs import are direct codebase risks; reservations vs bookings confusion is schema-level risk

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (Anthropic SDK API is stable; rolling context pattern is stable; Supabase query patterns are stable)
