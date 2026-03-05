# Phase 8: Housekeeping Coordinator - Research

**Researched:** 2026-03-05
**Domain:** Housekeeping status management, chat-driven state mutations, daily cron priority queue, staff notification via Resend email
**Confidence:** HIGH (all critical patterns verified against live codebase; no new libraries required)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HSKP-01 | Hotel owner can chat with Housekeeping Coordinator to manage room statuses | `invokeAgent()` + SSE `/api/agent/stream` already handle owner-chat for FRONT_DESK, BOOKING_AI, GUEST_EXPERIENCE roles; HOUSEKEEPER_COORDINATOR role added to `AgentRole` enum following identical pattern |
| HSKP-02 | Housekeeping Coordinator maintains room status board (clean, dirty, inspected, out of order) | Requires new `room_housekeeping_status` table (one row per room, mutable) + new agent tool `update_room_status`; existing `rooms` table has no status column — status is a separate concern from room inventory |
| HSKP-03 | Housekeeping Coordinator generates daily cleaning priority queue based on checkouts/check-ins | `bookings` table (Phase 5) has `check_in_date` / `check_out_date`; cron architecture already proven in `milestoneDispatch.ts`; add `/api/cron/housekeeping-queue` triggered at 07:00 hotel timezone; priority: checkout today > check-in today > check-in tomorrow |
| HSKP-04 | Housekeeping Coordinator can assign tasks to housekeeping staff via notification | `Resend` library already installed and used in `milestoneDispatch.ts` and escalations; staff email stored as `contact_email` on `hotels` or new `housekeeping_staff` table; simplest: email via Resend using service client, same pattern as `/api/escalations/route.ts` |
</phase_requirements>

---

## Summary

Phase 8 follows the exact same pattern as Phase 7 (Booking AI) with two complementary work streams. The first is adding a `HOUSEKEEPING_COORDINATOR` agent role to `agentFactory.ts` with tools for reading and writing room cleaning statuses. This requires a new `room_housekeeping_status` table (one row per room per hotel) and two new agent tools: `get_room_status` (read the current status board) and `update_room_status` (write a status change). The agent's tool-first policy enforces that status mutations always go through the DB, not hallucination. The chat UI reuses `ChatWindow` with new `streamOptions`, identical to how Guest Experience and Booking AI pages work.

The second work stream is the daily priority queue cron. The `bookings` table (Phase 5) already contains `check_in_date` and `check_out_date` for all booked guests. The cron reads today's checkouts (rooms that need cleaning before the next guest) and today's or tomorrow's check-ins (rooms that must be ready soonest). The priority queue is written into a new `housekeeping_queue` table (or emitted directly to an owner notification), and the existing Vercel cron configuration in `vercel.json` gets a second entry for 07:00 UTC daily.

The key insight is that almost everything is scaffolding reuse. No new libraries are needed — `@anthropic-ai/sdk`, Supabase, Resend, and `date-fns/@date-fns/tz` are all already installed. The only genuinely new work is the `room_housekeeping_status` table, the two agent tools, the cron function, and the dashboard page. Staff notification for HSKP-04 is simplest via Resend email to a hotel-configured staff email address (same pattern as the escalation notification in `/api/escalations/route.ts`).

**Primary recommendation:** Implement in this order: (1) DB migration — `room_housekeeping_status` table + optionally `housekeeping_queue`; (2) agent tools `get_room_status` + `update_room_status` + `assign_cleaning_task`; (3) HOUSEKEEPING_COORDINATOR role in `agentFactory.ts` + dashboard page; (4) daily priority queue cron. This ordering lets each plan be verified independently before the next.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.78.0 (installed) | Claude API — tool dispatch, streaming SSE | Already in project; all prior agent roles use this |
| `@supabase/supabase-js` | ^2.98.0 (installed) | Room status reads/writes, cron queries | Already in project; service client for tool execution |
| `resend` | ^6.9.3 (installed) | Staff task assignment notification email | Already installed and used in `milestoneDispatch.ts` and `/api/escalations/route.ts` |
| `date-fns` + `@date-fns/tz` | ^4.1.0 + ^1.4.1 (installed) | Hotel timezone date math in cron | Already used in `milestoneDispatch.ts` for timezone-aware date computation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^4.3.6 (installed) | Validate tool inputs (status enum, room_id format) | Already used in Phase 7 tools; same pattern for housekeeping tools |
| `sonner` | ^2.0.7 (installed) | Toast notifications in dashboard UI | Already installed; use for "status updated" feedback in chat UI |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Resend for staff notification | Twilio WhatsApp | Resend is already wired up with service client; WhatsApp would require a staff WhatsApp number; email is simpler and already proven |
| New `housekeeping_queue` table | In-memory/ephemeral queue in cron response | Persistent table allows owner to view queue in dashboard; ephemeral is simpler but loses auditability; recommend persistent table for HSKP-03 |
| One `room_housekeeping_status` table | Status column on `rooms` table | `rooms` is inventory data (name, type, bed); status is operational state that changes frequently; separate table avoids polluting inventory with operational concerns |

**Installation:**
```bash
# Nothing to install — all dependencies already present
```

---

## Architecture Patterns

### Recommended Project Structure for Phase 8

```
src/
├── lib/
│   └── agents/
│       ├── agentFactory.ts          # Add HOUSEKEEPING_COORDINATOR role config (new entry in ROLE_REGISTRY)
│       ├── types.ts                 # Add HOUSEKEEPING_COORDINATOR to AgentRole enum
│       └── tools/
│           ├── registry.ts          # Add 3 new tool definitions: get_room_status, update_room_status, assign_cleaning_task
│           ├── executor.ts          # Add dispatch map entries for 3 new tools
│           └── housekeeping.ts      # NEW: real implementations of 3 housekeeping tools
├── lib/
│   └── cron/
│       └── housekeepingQueue.ts     # NEW: daily priority queue generation logic
├── types/
│   └── database.ts                  # Add RoomHousekeepingStatus + HousekeepingQueueItem interfaces
└── app/
    ├── api/
    │   └── cron/
    │       └── housekeeping-queue/
    │           └── route.ts          # NEW: GET handler protected by CRON_SECRET
    └── (dashboard)/
        └── housekeeping/
            └── page.tsx              # NEW: ChatWindow + status board view
supabase/
└── migrations/
    └── 0008_housekeeping.sql         # room_housekeeping_status + housekeeping_queue tables + RLS + seed
vercel.json                           # Add second cron entry: /api/cron/housekeeping-queue at 07:00 UTC
```

### Pattern 1: HOUSEKEEPING_COORDINATOR Agent Role

**What:** New `AgentRole.HOUSEKEEPING_COORDINATOR` entry in `ROLE_REGISTRY` in `agentFactory.ts`. Internal/owner-facing role → `claude-sonnet-4-6` (per project decision: opus for guest-facing, sonnet for internal). Tools: `get_room_status`, `update_room_status`, `assign_cleaning_task`.

**When to use:** Called from `/app/(dashboard)/housekeeping/page.tsx` via `ChatWindow` with `streamOptions={{ conversationId: 'housekeeping_chat', role: 'housekeeping_coordinator' }}`.

**Example — adding role to AgentRole enum in `types.ts`:**
```typescript
// Source: /home/cagr/Masaüstü/otel-ai/src/lib/agents/types.ts — existing pattern
export enum AgentRole {
  FRONT_DESK = "front_desk",
  GUEST_EXPERIENCE = "guest_experience",
  BOOKING_AI = "booking_ai",
  HOUSEKEEPING_COORDINATOR = "housekeeping_coordinator", // Phase 8 — NEW
}
```

**Example — agentFactory.ts entry:**
```typescript
// Source: pattern from BOOKING_AI config in agentFactory.ts
[AgentRole.HOUSEKEEPING_COORDINATOR]: {
  model: 'claude-sonnet-4-6',   // internal role — sonnet per project decision
  tools: [
    TOOLS.get_room_status,
    TOOLS.update_room_status,
    TOOLS.assign_cleaning_task,
  ],
  memoryScope: 'none',  // stateless — no per-guest episodic history needed
  promptTemplate: {
    identity: `You are the Housekeeping Coordinator for this hotel. You manage room cleaning status and coordinate housekeeping tasks.`,
    behavioral: `TOOL-FIRST RULES: ...`,
  },
},
```

### Pattern 2: Room Status Tool — update_room_status

**What:** Agent tool that writes a new status to `room_housekeeping_status` for a given room identifier (room name or number). Always uses service client (tool execution has no user session guarantee).

**DB write pattern (verified from `coordination.ts` and `executor.ts`):**
```typescript
// Source: /home/cagr/Masaüstü/otel-ai/src/lib/agents/coordination.ts — delegateTask pattern
// Source: /home/cagr/Masaüstü/otel-ai/src/lib/agents/tools/executor.ts — service client injection

import { createServiceClient } from '@/lib/supabase/service';

export async function updateRoomStatus(params: {
  hotel_id: string;          // injected from ToolContext — never from AI model input
  room_identifier: string;   // room name or number the owner typed
  new_status: 'clean' | 'dirty' | 'inspected' | 'out_of_order';
  notes?: string;
}): Promise<Record<string, unknown>> {
  const supabase = createServiceClient();
  // Resolve room by name (fuzzy match or exact) — same hotel scope
  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, name')
    .eq('hotel_id', params.hotel_id)
    .ilike('name', `%${params.room_identifier}%`);
  // ... upsert into room_housekeeping_status
}
```

**Critical:** `hotel_id` is ALWAYS injected from `ToolContext.hotelId` in the executor dispatch map, never from the AI's tool input. This prevents cross-hotel data leakage (same pattern enforced in Phase 7 — see `executor.ts` `TOOL_DISPATCH` map).

### Pattern 3: Daily Priority Queue Cron

**What:** Runs at 07:00 UTC daily. Queries `bookings` (Phase 5) and `reservations` (Phase 7) for checkout/check-in dates. Generates a prioritized cleaning list written to `housekeeping_queue` table (or directly to `room_housekeeping_status` by setting status to 'dirty' for checkout rooms).

**Priority logic:**
1. **Priority 1 — Checkout today:** Rooms where a guest checks out today. Must be cleaned before next guest arrives.
2. **Priority 2 — Check-in today:** Rooms where a new guest checks in today (and whose status is not already 'clean').
3. **Priority 3 — Check-in tomorrow:** Rooms where a guest arrives tomorrow (buffer for advance cleaning).

**Timezone handling (verified from `milestoneDispatch.ts`):**
```typescript
// Source: /home/cagr/Masaüstü/otel-ai/src/lib/cron/milestoneDispatch.ts — proven pattern
import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';

const now = new TZDate(new Date(), hotel.timezone);
const todayStr = format(now, 'yyyy-MM-dd');
const tomorrowStr = format(addDays(now, 1), 'yyyy-MM-dd');
```

**Cron route pattern (verified from milestone-dispatch route):**
```typescript
// Source: /home/cagr/Masaüstü/otel-ai/src/app/api/cron/milestone-dispatch/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;  // Pro plan allows up to 300s

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // ...
}
```

**vercel.json addition:**
```json
{
  "crons": [
    { "path": "/api/cron/milestone-dispatch", "schedule": "0 6 * * *" },
    { "path": "/api/cron/housekeeping-queue", "schedule": "0 7 * * *" }
  ]
}
```

### Pattern 4: Staff Notification (HSKP-04)

**What:** Tool `assign_cleaning_task` inserts a queue item for a staff member and sends an email via Resend. Staff email can be stored as `housekeeping_staff_email` in `hotels.behavior_config` JSONB (simplest, no new table) or in a new `housekeeping_staff` table.

**Simplest approach — use hotels table or a staff_contacts table:**
```typescript
// Notification pattern verified from:
// Source: /home/cagr/Masaüstü/otel-ai/src/app/api/escalations/route.ts — Resend usage

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
await resend.emails.send({
  from: process.env.RESEND_FROM_EMAIL!,
  to: staffEmail,
  subject: `Cleaning task: Room ${roomName}`,
  html: `<p>Please clean <strong>${roomName}</strong>. Priority: ${priority}. Notes: ${notes ?? 'None'}.</p>`,
});
```

**Staff email storage decision:** Two options:
- **Option A (simpler):** Store `housekeeping_staff_email` in a JSON field on `agents.behavior_config` for the housekeeping_coordinator role. No new table.
- **Option B (more flexible):** New `housekeeping_staff` table with `(hotel_id, name, email, phone)`. Allows assigning specific staff members by name, supports future WhatsApp notification.

Recommendation: **Option B** — HSKP-04 says "assign tasks to a staff member", implying named assignment. A minimal `housekeeping_staff` table is the right call.

### Pattern 5: Dashboard Page — Housekeeping Chat + Status Board

**What:** `/housekeeping/page.tsx` in the `(dashboard)` route group. Server Component shell that renders:
1. `ChatWindow` component (already built) with `streamOptions={{ conversationId: 'housekeeping_chat', role: 'housekeeping_coordinator' }}`
2. A read-only status board (server-rendered table showing all rooms with their current status from `room_housekeeping_status`)

**Page pattern (verified from `/desk/page.tsx` and `/guest-experience/page.tsx`):**
```typescript
// Source: /home/cagr/Masaüstü/otel-ai/src/app/(dashboard)/guest-experience/page.tsx
import { ChatWindow } from '@/components/chat/ChatWindow';

export default function HousekeepingPage() {
  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Housekeeping Coordinator</h1>
        <p className="text-muted-foreground text-sm">...</p>
      </div>
      <div className="h-[calc(100%-4rem)] border rounded-lg overflow-hidden bg-card">
        <ChatWindow
          streamOptions={{ conversationId: 'housekeeping_chat', role: 'housekeeping_coordinator' }}
          emptyStateText="Tell the Housekeeping Coordinator about a room status change"
        />
      </div>
    </div>
  );
}
```

**Status board enhancement:** The page can optionally render a separate React Server Component that queries `room_housekeeping_status` and displays a grid of rooms with color-coded statuses (clean=green, dirty=red, inspected=blue, out_of_order=gray). This is pure read-only server data — no client interactivity needed.

### Anti-Patterns to Avoid

- **Storing room status in `rooms.status` column:** `rooms` is inventory metadata. Mixing operational state into inventory creates update complexity and history loss.
- **Not injecting hotel_id from ToolContext:** Phase 7 established this as a mandatory pattern. Every housekeeping tool MUST inject `hotel_id` from `ToolContext.hotelId`, not from AI model input.
- **Using `tool_choice: "any"` for status reads:** Unlike availability (where hallucination is catastrophic), reading room status does not need forced tool invocation. Use `tool_choice: "auto"`.
- **Updating room status from the cron:** The cron generates the priority queue (which rooms SHOULD be cleaned). It should NOT automatically reset room statuses — the owner or agent reports actual status via chat.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email notification to staff | Custom SMTP client | `resend` (already installed) | Already integrated; `RESEND_API_KEY` and `RESEND_FROM_EMAIL` already in env; proven in `milestoneDispatch.ts` and escalations |
| Timezone-aware "today" computation | Manual UTC offset math | `TZDate` from `@date-fns/tz` (installed) | Already used in `milestoneDispatch.ts`; handles DST correctly |
| Hotel-per-hotel processing loop in cron | Ad-hoc hotel iteration | Pattern from `runMilestoneDispatch()` | Proven: fetch all hotels, compute timezone-adjusted dates per hotel, process in batches |
| Agent role configuration | Custom agent class | `ROLE_REGISTRY` in `agentFactory.ts` | Adding one entry to the registry is 100% of what's needed — the factory is already exhaustive |

**Key insight:** Phase 8 is a scaffolding reuse exercise. The hardest problems (streaming, tool dispatch, cron auth, Resend email, timezone handling, service client injection) are all solved. The new work is DB schema + tool implementations + prompt engineering.

---

## Common Pitfalls

### Pitfall 1: Hotel_id Injection Forgotten in Tool Executor

**What goes wrong:** Tool input from the AI model contains `hotel_id` (or doesn't), and the executor uses the AI-provided value instead of `ToolContext.hotelId`.
**Why it happens:** Developers copy the tool schema and forget the executor override pattern.
**How to avoid:** In `executor.ts`, all three housekeeping tools MUST inject `hotel_id` from context:
```typescript
get_room_status:     (input, context) => getRoomStatus({ ...input, hotel_id: context.hotelId }),
update_room_status:  (input, context) => updateRoomStatus({ ...input, hotel_id: context.hotelId }),
assign_cleaning_task: (input, context) => assignCleaningTask({ ...input, hotel_id: context.hotelId }),
```
**Warning signs:** Tool input schema includes `hotel_id` as a required field — it should not. Remove it.

### Pitfall 2: Room Identifier Resolution

**What goes wrong:** Owner says "room 12 is clean" but the DB stores rooms by UUID and name. The AI model may output "room 12" or "Room 12" or "room twelve".
**Why it happens:** `rooms.name` is a free-text field (e.g., "Room 12", "Deluxe Suite", "102"). Owner natural language doesn't guarantee exact match.
**How to avoid:** Use `ilike('%room_identifier%')` partial match on `rooms.name`. Return a list of candidates if multiple match, ask the agent to clarify in its response.
**Warning signs:** Tool returns "room not found" for rooms that exist — check if name casing/spacing differs.

### Pitfall 3: Cron Double-Processes Hotels

**What goes wrong:** Cron runs, hotel fails to process, hotel is re-processed on retry without a guard.
**Why it happens:** No idempotency key on queue items.
**How to avoid:** `housekeeping_queue` table uses `(hotel_id, room_id, queue_date) UNIQUE` constraint. The cron uses `INSERT ... ON CONFLICT DO NOTHING` so re-runs are safe. Verified pattern from `milestoneDispatch.ts` which uses `pre_arrival_sent` boolean flags as idempotency guards.
**Warning signs:** Duplicate queue entries for the same room on the same day.

### Pitfall 4: AgentRole Enum Not Exhaustive in getToolsForRole

**What goes wrong:** Adding `HOUSEKEEPING_COORDINATOR` to `AgentRole` enum without adding a case to `getToolsForRole()` switch in `registry.ts`. TypeScript's `default` case catches it at runtime, not compile time.
**Why it happens:** The `switch` in `getToolsForRole()` has a `default` case that returns the three core tools — it won't fail, but it will return wrong tools.
**How to avoid:** Add an explicit `case AgentRole.HOUSEKEEPING_COORDINATOR:` in the `getToolsForRole()` switch. Also add to `ROLE_REGISTRY` in `agentFactory.ts` (TypeScript WILL catch this one — `Record<AgentRole, AgentConfig>` is exhaustive).
**Warning signs:** Housekeeping agent has access to `get_room_availability` and `get_room_pricing` (booking tools) — wrong tools silently assigned.

### Pitfall 5: Status Board Stale After Chat Update

**What goes wrong:** Owner says "room 12 is clean" via chat. Tool executes, DB updates. But the status board on the same page shows stale data (server-rendered at page load, doesn't refresh).
**Why it happens:** Status board is a Server Component — it renders once on page load.
**How to avoid:** Two options: (A) Make the status board a Client Component that re-fetches after the SSE `done` event fires (simplest). (B) Put the status board on a separate `/housekeeping/status` sub-route that the owner refreshes manually. Recommend (A) for success criterion 1 ("see the room status board update").
**Warning signs:** Success criterion 1 ("hotel owner can tell the agent room 12 is clean and SEE the status board update") is not met if status board is pure server-rendered.

---

## Code Examples

Verified patterns from codebase:

### New Tool Definition (registry.ts pattern)
```typescript
// Source: /home/cagr/Masaüstü/otel-ai/src/lib/agents/tools/registry.ts
const updateRoomStatusTool: Anthropic.Messages.Tool = {
  name: 'update_room_status',
  description: 'Update the cleaning status of a hotel room. MUST be called when the owner reports a room status change.',
  input_schema: {
    type: 'object',
    properties: {
      room_identifier: {
        type: 'string',
        description: 'Room name or number as the owner stated it (e.g., "Room 12", "Deluxe Suite", "102")',
      },
      new_status: {
        type: 'string',
        enum: ['clean', 'dirty', 'inspected', 'out_of_order'],
        description: 'The new cleaning status for the room',
      },
      notes: {
        type: 'string',
        description: 'Optional notes about the status change (e.g., "needs extra towels")',
      },
    },
    required: ['room_identifier', 'new_status'],
  },
};
```

### DB Migration Pattern (room_housekeeping_status)
```sql
-- Verified pattern from 0007_booking_ai.sql
CREATE TABLE public.room_housekeeping_status (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id     UUID         NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  status      TEXT         NOT NULL DEFAULT 'dirty'
              CHECK (status IN ('clean', 'dirty', 'inspected', 'out_of_order')),
  notes       TEXT,
  updated_by  TEXT,        -- 'agent' | 'cron' | 'owner' for audit trail
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, room_id)  -- one status row per room
);

ALTER TABLE public.room_housekeeping_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own room statuses"
  ON public.room_housekeeping_status FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role writes (agent tools use service client)
CREATE POLICY "Service role can upsert room statuses"
  ON public.room_housekeeping_status FOR ALL
  WITH CHECK (true);
```

### Cron Route Auth (verified from milestone-dispatch route)
```typescript
// Source: /home/cagr/Masaüstü/otel-ai/src/app/api/cron/milestone-dispatch/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const result = await runHousekeepingQueue();
  return Response.json({ ok: true, ...result });
}
```

### SSE Route Role Routing (agent/stream/route.ts pattern)
```typescript
// Source: /home/cagr/Masaüstü/otel-ai/src/app/api/agent/stream/route.ts
// Add this branch alongside FRONT_DESK, GUEST_EXPERIENCE, BOOKING_AI:
const role =
  roleStr === 'guest_experience'   ? AgentRole.GUEST_EXPERIENCE
  : roleStr === 'booking_ai'       ? AgentRole.BOOKING_AI
  : roleStr === 'housekeeping_coordinator' ? AgentRole.HOUSEKEEPING_COORDINATOR  // NEW
  : AgentRole.FRONT_DESK;
```

### seed_hotel_defaults Extension (migration pattern)
```sql
-- Verified pattern from 0007_booking_ai.sql — CREATE OR REPLACE FUNCTION
INSERT INTO public.agents (hotel_id, role, is_enabled, behavior_config) VALUES
  (NEW.id, 'front_desk',               TRUE, '{}'),
  (NEW.id, 'guest_experience',         TRUE, '{}'),
  (NEW.id, 'booking_ai',               TRUE, '{}'),
  (NEW.id, 'housekeeping_coordinator', TRUE, '{}');  -- NEW

-- Backfill for existing hotels (ON CONFLICT DO NOTHING — safe with unique constraint):
INSERT INTO public.agents (hotel_id, role, is_enabled, behavior_config)
SELECT id, 'housekeeping_coordinator', true, '{}'
FROM public.hotels
ON CONFLICT (hotel_id, role) DO NOTHING;
```

---

## Data Model Design

### Tables Required

**`room_housekeeping_status`** — One row per room. Upserted by agent tool and cron.
- `hotel_id` UUID FK hotels(id)
- `room_id` UUID FK rooms(id)
- `status` TEXT CHECK ('clean','dirty','inspected','out_of_order') DEFAULT 'dirty'
- `notes` TEXT NULLABLE
- `updated_by` TEXT (e.g., 'agent', 'cron')
- `updated_at` TIMESTAMPTZ DEFAULT NOW()
- UNIQUE(hotel_id, room_id)

**`housekeeping_queue`** — Daily generated priority list. One row per room per date.
- `hotel_id` UUID FK hotels(id)
- `room_id` UUID FK rooms(id)
- `queue_date` DATE (the date this queue was generated for)
- `priority` INTEGER (1=highest, e.g. checkout today; 2=check-in today; 3=check-in tomorrow)
- `reason` TEXT (e.g., 'checkout_today', 'checkin_today', 'checkin_tomorrow')
- `assigned_to` TEXT NULLABLE (staff email or name after assignment)
- `assigned_at` TIMESTAMPTZ NULLABLE
- `created_at` TIMESTAMPTZ DEFAULT NOW()
- UNIQUE(hotel_id, room_id, queue_date)  — idempotency guard

**`housekeeping_staff`** — Staff directory for task assignment (HSKP-04).
- `hotel_id` UUID FK hotels(id)
- `name` TEXT
- `email` TEXT
- `phone` TEXT NULLABLE (for future WhatsApp)
- `is_active` BOOLEAN DEFAULT TRUE
- `created_at` TIMESTAMPTZ DEFAULT NOW()

### Relationship to Existing Tables
- `room_housekeeping_status.room_id` → `rooms.id` (Phase 3 rooms inventory)
- `housekeeping_queue` derived from: `bookings.check_in_date/check_out_date` (Phase 5) + `reservations.check_in_date/check_out_date` (Phase 7)
- Priority queue generation queries BOTH `bookings` and `reservations` tables (they serve different purposes but both contain checkout/check-in dates)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-agent stub implementations | Real Supabase queries via service client | Phase 7 | All new tools should use service client from day one |
| Hard-coded 20-turn context cap | Rolling window (last 10 turns + summary) | Phase 7 Plan 3 | Housekeeping coordinator gets rolling context for free — no additional work |
| Single cron entry in vercel.json | Multiple cron entries | Phase 8 | Just add a second JSON entry; Vercel supports multiple crons |

**Deprecated/outdated:**
- `tools/stubs.ts` `getAvailability` / `getRoomPricing` stubs: Replaced in Phase 7 with real implementations. New housekeeping tools go directly into `tools/housekeeping.ts` — no stub phase.

---

## Open Questions

1. **Should priority queue query `bookings` or `reservations` or both?**
   - What we know: `bookings` (Phase 5) = guest experience milestone messaging records. `reservations` (Phase 7) = AI-managed booking records with room FK. Both have `check_in_date`/`check_out_date`.
   - What's unclear: Are `bookings` kept in sync with `reservations` in the current data model? Or are they separate populations? The codebase shows no join between them.
   - Recommendation: Query both tables with UNION ALL and deduplicate by `room_id + date`. Add a comment explaining why both sources are queried.

2. **Status board refresh strategy after chat update**
   - What we know: The status board must update after the agent tool executes (success criterion 1 explicitly says "see the room status board update"). The current `ChatWindow` fires `onToken` callbacks but has no post-completion hook exposed to parent.
   - What's unclear: Does `useChatStream` expose a callback for when streaming completes? Would need to verify hook API.
   - Recommendation: Plan 08-01 should explicitly decide refresh strategy. `useChatStream` returns `isStreaming`; a `useEffect` watching `isStreaming` going false can trigger a re-fetch of the status board via SWR or router.refresh().

3. **housekeeping_queue — emit or persist?**
   - What we know: Phase requirement says "generates a daily priority queue" and "hotel owner can assign a cleaning task." An owner UI implies the queue needs to be readable.
   - What's unclear: Does the queue need to persist long-term (days of history) or just be the current day's list?
   - Recommendation: Persist to `housekeeping_queue` table with `queue_date`. Truncate rows older than 7 days in the cron to keep the table small. This gives the owner a 7-day view without unbounded growth.

---

## Sources

### Primary (HIGH confidence)
- `/home/cagr/Masaüstü/otel-ai/src/lib/agents/agentFactory.ts` — ROLE_REGISTRY pattern, model selection rules
- `/home/cagr/Masaüstü/otel-ai/src/lib/agents/types.ts` — AgentRole enum, AgentConfig interface
- `/home/cagr/Masaüstü/otel-ai/src/lib/agents/tools/registry.ts` — Tool definition format
- `/home/cagr/Masaüstü/otel-ai/src/lib/agents/tools/executor.ts` — ToolContext injection pattern, hotel_id security
- `/home/cagr/Masaüstü/otel-ai/src/lib/agents/invokeAgent.ts` — Invocation lifecycle, SSE streaming
- `/home/cagr/Masaüstü/otel-ai/src/lib/cron/milestoneDispatch.ts` — Cron hotel loop, timezone handling, Resend email
- `/home/cagr/Masaüstü/otel-ai/src/app/api/cron/milestone-dispatch/route.ts` — Cron route auth pattern
- `/home/cagr/Masaüstü/otel-ai/src/app/api/agent/stream/route.ts` — Role routing in SSE endpoint
- `/home/cagr/Masaüstü/otel-ai/src/app/(dashboard)/guest-experience/page.tsx` — ChatWindow page pattern
- `/home/cagr/Masaüstü/otel-ai/src/app/api/escalations/route.ts` — Resend email + service client pattern
- `/home/cagr/Masaüstü/otel-ai/supabase/migrations/0005_guest_experience.sql` — bookings table schema
- `/home/cagr/Masaüstü/otel-ai/supabase/migrations/0007_booking_ai.sql` — reservations table + seed_hotel_defaults extension pattern
- `/home/cagr/Masaüstü/otel-ai/src/types/database.ts` — Full type registry, Booking/Reservation interfaces
- `/home/cagr/Masaüstü/otel-ai/vercel.json` — Cron configuration format
- `/home/cagr/Masaüstü/otel-ai/package.json` — Confirmed all dependencies already installed

### Secondary (MEDIUM confidence)
- None needed — all critical patterns are verified directly from the live codebase.

### Tertiary (LOW confidence)
- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed from `package.json`; usage patterns confirmed from codebase
- Architecture: HIGH — every pattern directly mirrors an existing phase implementation verified from source files
- Pitfalls: HIGH — four of five pitfalls directly derived from prior phase implementation decisions documented in code comments
- Data model: HIGH — table design follows exact conventions of `0007_booking_ai.sql` migration
- Open questions: MEDIUM — refresh strategy and query source (bookings vs reservations) require a planning decision, not further research

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable stack; no fast-moving dependencies)
