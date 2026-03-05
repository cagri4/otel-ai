# Phase 5: Guest Experience AI and Owner Dashboard - Research

**Researched:** 2026-03-05
**Domain:** Vercel Cron Jobs, Twilio WhatsApp outbound templates, Supabase Realtime, audit log design, owner dashboard UI
**Confidence:** HIGH (stack verified via official Vercel docs, Twilio docs, Supabase docs, and codebase inspection)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GEXP-01 | Guest Experience AI sends pre-arrival info package (D-1 before check-in) | Vercel cron fires daily at e.g. 08:00 UTC; cron handler queries `bookings` table for check-in = tomorrow; calls `invokeAgent()` then `sendWhatsAppReply()` or Resend email |
| GEXP-02 | Guest Experience AI sends checkout reminder (morning of checkout day) | Same cron (or separate cron) queries for check-out = today; sends message via channel stored in booking row |
| GEXP-03 | Guest Experience AI sends post-stay review request (24h after checkout) | Cron queries for check-out = yesterday; sends Resend email with review link; WhatsApp outside 24h window requires approved Meta template |
| GEXP-04 | Guest Experience AI messages are milestone-triggered (automated based on booking dates) | Vercel cron (`vercel.json` `crons[]`) on Pro plan: minimum once per minute, scheduling precision per-minute; daily runs at specific times are reliable |
| GEXP-05 | Hotel owner can customize message templates for each milestone | DB table `message_templates` (hotel_id, milestone, channel, body); loaded at cron time and injected into prompt or message body; owner edits via dashboard form |
| SAFE-01 | All AI agent actions classified as OBSERVE / INFORM / ACT | Classification stored as column on `agent_audit_log` table; classification logic in prompt (self-report) OR rule-based classifier post-hoc |
| SAFE-02 | ACT-class actions require hotel owner confirmation | Before executing ACT tool: insert pending confirmation row; poll or wait for owner approval via dashboard; owner approves/rejects in-app |
| SAFE-03 | All agent actions logged with audit trail | `agent_audit_log` table: hotel_id, agent_role, action_class (OBSERVE/INFORM/ACT), tool_name, input_json, result_json, conversation_id, created_at; written from `executeTool()` after each tool call |
| DASH-01 | Hotel owner can chat with each AI employee individually | Extend existing `/desk` ChatWindow pattern — new page per employee role (e.g. `/guest-experience`); reuse `useChatStream` hook with role param |
| DASH-02 | Hotel owner can view all guest conversations per AI employee | Server Component page queries `conversation_turns` grouped by `conversation_id`; renders list of conversations with timestamps; click to expand full thread |
| DASH-03 | Hotel owner receives escalation notifications (in-app + email) | Email: already done in Phase 4 (`/api/escalations`); in-app: Supabase Realtime `postgres_changes` INSERT on `escalations` table; client component with `useEffect` subscription + toast |
| DASH-04 | Hotel owner can turn AI employees on/off | `agents` config table (hotel_id, role, is_enabled, created_at); cron and invokeAgent check is_enabled; toggle UI in dashboard |
| DASH-05 | Hotel owner can configure each AI employee's behavior/tone | `agent_config` JSONB column on agents table OR separate `agent_settings` table; settings injected into `assembleSystemPrompt()` as additional behavioral layer |
</phase_requirements>

---

## Summary

Phase 5 adds three major capabilities: automated milestone messaging (pre-arrival, checkout, post-stay), an owner dashboard for monitoring and controlling AI employees, and a safety/audit layer classifying every agent action as OBSERVE/INFORM/ACT. Each area maps to well-established patterns already present in the codebase.

The milestone trigger engine uses **Vercel Cron Jobs** — a GET Route Handler in `/app/api/cron/` secured by `CRON_SECRET`, configured in `vercel.json`. On the Pro plan, crons can fire as often as every minute with per-minute scheduling precision; daily sends at fixed times are reliable. The cron queries a new `bookings` table for guests hitting their D-1 / checkout day / D+1 milestones, assembles a message via Claude (`claude-sonnet-4-6` for background tasks per project decision), and dispatches via Twilio (WhatsApp) or Resend (email). A critical constraint: Twilio WhatsApp outbound messages sent outside the guest's 24-hour customer service window **require a Meta-approved template** (`contentSid` + `contentVariables`). Post-stay review requests (D+1) will always be outside this window, so a pre-approved Utility template is mandatory.

The owner dashboard extends existing patterns: the `/desk` ChatWindow and `useChatStream` hook serve as the blueprint for per-employee chat pages; conversation history is a Server Component querying `conversation_turns` grouped by `conversation_id`; in-app escalation notifications use Supabase Realtime `postgres_changes` INSERT on the `escalations` table (already exists from Phase 4) via a `useEffect` subscription in a client component with toast UI. The safety layer adds a new `agent_audit_log` table written from inside `executeTool()` — every tool call records role, action class (OBSERVE/INFORM/ACT), tool name, input/result JSON, and conversation ID. ACT-class gating requires a pending-confirmation pattern (insert confirmation request, poll for owner approval before executing the tool).

**Primary recommendation:** Build in four sequential plans exactly as outlined: (1) GEXP AI agent role + milestone prompts, (2) cron trigger engine + bookings table, (3) owner dashboard pages, (4) safety/audit layer + audit log table.

---

## Standard Stack

### Core (all already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vercel.json` crons | N/A (Vercel infra) | Trigger milestone cron at fixed times | Only reliable scheduling mechanism on Vercel serverless; no external service needed |
| `twilio` | ^5.12.2 (installed) | Send WhatsApp outbound messages | Already used for inbound; `client.messages.create()` with `contentSid` for templates |
| `resend` | ^6.9.3 (installed) | Send milestone emails | Already used for escalation emails; same `resend.emails.send()` pattern |
| `@supabase/supabase-js` | ^2.98.0 (installed) | Realtime subscriptions for in-app notifications | `supabase.channel().on('postgres_changes', ...)` pattern |
| `@anthropic-ai/sdk` | ^0.78.0 (installed) | Generate milestone messages via Claude | `claude-sonnet-4-6` for background/internal; `claude-opus-4-6` for guest-facing |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` + `@date-fns/tz` | ^4.1.0 / ^1.4.1 (installed) | Date arithmetic for booking milestones | Computing D-1, D+1, comparing booking dates to today in hotel timezone |
| shadcn `toast` / `sonner` | via shadcn CLI | In-app notification toasts | Displaying real-time escalation alerts from Supabase Realtime subscription |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vercel Cron + Route Handler | Supabase pg_cron + Edge Function | pg_cron would avoid Vercel cron limits but adds Supabase Edge Function complexity; Vercel cron matches existing infra pattern |
| Supabase Realtime postgres_changes | Polling | Polling wastes requests and adds latency; Realtime is already used for widget (Phase 4) |
| Resend HTML email (post-stay) | Twilio WhatsApp template | Resend email avoids template approval process for post-stay; WhatsApp is preferred for in-stay messages |

**Installation:**
```bash
# No new packages needed — all dependencies already installed.
# Add toast component if not present:
pnpm dlx shadcn@latest add sonner
```

---

## Architecture Patterns

### Recommended Project Structure additions
```
src/
├── app/
│   ├── api/
│   │   ├── cron/
│   │   │   └── milestone-dispatch/
│   │   │       └── route.ts          # GET — secured by CRON_SECRET
│   │   └── agent-confirmations/
│   │       └── route.ts              # POST — ACT confirmation approval
│   └── (dashboard)/
│       ├── guest-experience/
│       │   └── page.tsx              # Chat with GUEST_EXPERIENCE AI
│       ├── conversations/
│       │   ├── page.tsx              # List all conversations per employee
│       │   └── [conversationId]/
│       │       └── page.tsx          # Full conversation thread view
│       ├── employees/
│       │   └── page.tsx              # Toggle on/off + configure behavior
│       └── audit/
│           └── page.tsx              # Audit log viewer
├── lib/
│   ├── agents/
│   │   ├── agentFactory.ts           # Add AgentRole.GUEST_EXPERIENCE
│   │   └── tools/
│   │       └── executor.ts           # Add audit log write after executeTool()
│   └── cron/
│       └── milestoneDispatch.ts      # Core cron logic: query bookings, dispatch messages
supabase/
└── migrations/
    └── 0005_guest_experience.sql     # bookings, message_templates, agent_config, agent_audit_log
```

### Pattern 1: Vercel Cron Job Configuration

**What:** `vercel.json` declares cron schedules; GET Route Handler secured by CRON_SECRET bearer token check.

**When to use:** Any automated background task that must fire at a specific time on Vercel serverless.

**Example:**
```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/milestone-dispatch",
      "schedule": "0 6 * * *"
    }
  ]
}
```

```typescript
// src/app/api/cron/milestone-dispatch/route.ts
// Source: https://vercel.com/docs/cron-jobs/manage-cron-jobs
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  await runMilestoneDispatch();
  return Response.json({ ok: true });
}
```

### Pattern 2: Milestone Dispatch Logic

**What:** Query `bookings` table for guests matching each milestone date relative to today in the hotel's timezone, then send personalized messages.

**When to use:** Inside the cron Route Handler, once per cron execution.

**Example:**
```typescript
// src/lib/cron/milestoneDispatch.ts
import { formatInTimeZone } from 'date-fns-tz';
import { addDays } from 'date-fns';

// Pre-arrival: check_in = tomorrow
const tomorrow = formatInTimeZone(addDays(new Date(), 1), hotel.timezone, 'yyyy-MM-dd');
const { data: preArrivalBookings } = await supabase
  .from('bookings')
  .select('*, hotels(*)')
  .eq('check_in_date', tomorrow)
  .eq('milestone_pre_arrival_sent', false);

// Checkout reminder: check_out = today
const today = formatInTimeZone(new Date(), hotel.timezone, 'yyyy-MM-dd');
// ... similar query

// Post-stay: check_out = yesterday
const yesterday = formatInTimeZone(addDays(new Date(), -1), hotel.timezone, 'yyyy-MM-dd');
// ... similar query
```

### Pattern 3: Twilio Outbound WhatsApp with Template

**What:** For business-initiated messages outside the 24h customer service window, `client.messages.create()` with `contentSid` and `contentVariables`.

**When to use:** Post-stay review requests (D+1, always outside 24h window). Pre-approved "Utility" template required.

**Example:**
```typescript
// Source: https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates
const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

await client.messages.create({
  from: `whatsapp:${twilioNumber}`,
  to: `whatsapp:${guestPhone}`,
  contentSid: process.env.TWILIO_TEMPLATE_SID_REVIEW_REQUEST!,   // e.g. "HXxxx..."
  contentVariables: JSON.stringify({
    '1': guestFirstName,
    '2': hotelName,
    '3': reviewUrl,
  }),
});
```

For pre-arrival (D-1) and checkout reminder (morning of checkout day): guest likely messaged the hotel recently (within 24h window), so free-form `body` is acceptable. If outside window, same template pattern applies.

### Pattern 4: Supabase Realtime In-App Notifications

**What:** Client component subscribes to `postgres_changes` INSERT on `escalations` table. When a new escalation lands, show a toast notification.

**When to use:** Dashboard layout or a dedicated notification provider wrapping the dashboard.

**Example:**
```typescript
// 'use client'
// Source: https://supabase.com/docs/guides/realtime/postgres-changes
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

useEffect(() => {
  const supabase = createClient();
  const channel = supabase
    .channel('escalations-notifications')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'escalations',
        filter: `hotel_id=eq.${hotelId}`,
      },
      (payload) => {
        toast.error('Guest needs assistance', {
          description: payload.new.guest_message,
        });
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, [hotelId]);
```

RLS ensures only the hotel's own escalations are delivered. For this to work, `supabase_realtime` publication must include the `escalations` table.

### Pattern 5: Agent Audit Log

**What:** Write to `agent_audit_log` after every `executeTool()` call. Log tool name, input, result, action class, role, conversation ID.

**When to use:** Inside `executeTool()` in `src/lib/agents/tools/executor.ts` — after the handler returns, before returning the JSON string.

**Example:**
```typescript
// In executeTool(), after: const result = await handler(input, context);
await writeAuditLog({
  hotelId: context.hotelId,
  agentRole: context.fromRole,
  conversationId: context.conversationId,
  toolName: name,
  actionClass: classifyAction(name),   // OBSERVE | INFORM | ACT
  inputJson: input,
  resultJson: JSON.parse(rawResult),
});
```

Action classification is rule-based (not LLM-based) for reliability and zero latency:
- **OBSERVE**: `get_room_availability`, `get_room_pricing`, `lookup_guest_reservation` — read-only data queries
- **INFORM**: `delegate_task` — writes to queue but no external effect
- **ACT**: any future tool that modifies external state (send email, book room, update external system)

### Pattern 6: Employee On/Off Toggle

**What:** `agents` table with `is_enabled` flag per hotel per role. `invokeAgent()` and cron both check `is_enabled` before proceeding.

**When to use:** Before invoking any agent. Check is a single SELECT from `agents` — fast.

**Example:**
```typescript
const { data: agentConfig } = await supabase
  .from('agents')
  .select('is_enabled, behavior_config')
  .eq('hotel_id', hotelId)
  .eq('role', role)
  .single();

if (!agentConfig?.is_enabled) {
  return; // Agent is off — skip invocation
}
```

### Anti-Patterns to Avoid

- **Fire-and-forget cron results:** Always return 200 from cron handler even on partial errors; log individual failures per booking rather than failing the entire batch.
- **Using Hobby cron for hourly milestones:** Hobby plan crons fire at most once per day with ±59 min precision. This project must be on Pro for reliable per-minute or per-hour scheduling.
- **Free-form WhatsApp body for post-stay (D+1):** The 24-hour customer service window will be closed. Use `contentSid` + `contentVariables` with a pre-approved Meta Utility template. Sending a free-form body after the window fails silently (Twilio returns an error code).
- **Blocking cron on Claude response:** `invokeAgent()` takes 1-10 seconds per guest. With many bookings, the cron would time out. Use `Promise.allSettled()` with a batch limit, or process bookings sequentially with early exit on Vercel function timeout.
- **Supabase Realtime without cleanup:** Always return `() => supabase.removeChannel(channel)` from `useEffect` to prevent memory leaks and duplicate subscriptions.
- **ACT actions without confirmation UX:** SAFE-02 requires owner confirmation before ACT-class actions execute. Do not add this as a prompt-only instruction — implement it structurally (insert a pending confirmation row, block tool execution until row is approved).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | Custom timer logic | Vercel cron + `vercel.json` | Vercel handles scheduling, retries on 5xx (single attempt), logs; free-standing timers die with serverless function |
| WhatsApp templates | HTML-in-body for outbound | Twilio Content API `contentSid` | Meta requires pre-approved templates outside 24h window; custom format fails |
| In-app notifications | Long-polling or SSE custom | Supabase Realtime `postgres_changes` | Already used for widget Broadcast; consistent with existing stack |
| Toast notifications | Custom modal/banner | `sonner` via shadcn | Zero config, accessible, handles multiple concurrent notifications |

**Key insight:** The existing `executeTool()` / `invokeAgent()` pipeline is the right injection point for the audit log — not a separate middleware layer.

---

## Common Pitfalls

### Pitfall 1: WhatsApp 24-Hour Window for Outbound Messages

**What goes wrong:** Sending a free-form body string to a guest who hasn't messaged the hotel in more than 24 hours results in a Twilio error (Error 63016: Channel inactive) — the message is silently dropped.

**Why it happens:** Meta's WhatsApp Business Platform only allows free-form "session" messages within 24 hours of the guest's last inbound message. Business-initiated messages after that window require a pre-approved template.

**How to avoid:** For post-stay review requests (D+1), always use `contentSid`/`contentVariables` with a pre-approved Utility template. For pre-arrival (D-1), the guest may or may not be within the window — safest to use a template for all milestone messages. Register templates in the Twilio Console before coding.

**Warning signs:** Twilio logs showing Error 63016 or "Channel inactive". Test by messaging from a guest number more than 24h before the cron fires.

### Pitfall 2: Cron Timeout on Large Booking Volume

**What goes wrong:** The cron Route Handler processes 100 bookings × 3s per Claude call = 300s. Vercel functions have a 10s default `maxDuration` (300s on Pro for Node.js). With many hotels, batch processing can exceed limits.

**Why it happens:** `invokeAgent()` is synchronous per call; processing all hotels × bookings sequentially in one request can breach the function timeout.

**How to avoid:** Set `export const maxDuration = 300;` on the cron route. Process bookings with `Promise.allSettled()` (parallel) capped at 10 concurrent (to avoid Claude API rate limits). Log failures per booking, never abort entire batch. Consider splitting into per-hotel cron calls if volume grows.

**Warning signs:** Cron logs showing 504 timeouts; partial message sends.

### Pitfall 3: Supabase Realtime RLS — Table Must Be in Supabase Realtime Publication

**What goes wrong:** Subscribing to `postgres_changes` on `escalations` returns no events despite inserts happening.

**Why it happens:** By default, only tables explicitly added to the `supabase_realtime` publication receive CDC events. The `escalations` table was created in Phase 4 but may not be in the publication.

**How to avoid:** In migration `0005_guest_experience.sql`, add:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.escalations;
-- Also add any new tables that need Realtime:
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_audit_log;
```

**Warning signs:** Realtime subscription `subscribe()` returns `SUBSCRIBED` status but `postgres_changes` callback never fires.

### Pitfall 4: ACT Confirmation UX Blocks Agent Response

**What goes wrong:** If ACT confirmation is implemented by awaiting owner approval inside `executeTool()`, the guest's streaming response will hang until the owner clicks approve — potentially minutes.

**Why it happens:** `invokeAgent()` is synchronous; blocking in `executeTool()` blocks the entire response.

**How to avoid:** ACT-class tools are by definition high-risk automated actions (Phase 5 doesn't have any yet since current tools are all OBSERVE/INFORM). For future ACT tools: insert a confirmation request row, return a "pending confirmation" result to Claude so it can inform the guest, and let the owner approve asynchronously. Do NOT block the agent call.

**Warning signs:** SSE stream stalls; guest sees spinner indefinitely.

### Pitfall 5: Booking Date Timezone Mismatch

**What goes wrong:** Cron fires at 06:00 UTC. Hotel is in UTC+3 (Istanbul). "Tomorrow's" check-in guests in Istanbul are actually "today" in UTC. Pre-arrival message sent wrong day.

**Why it happens:** `new Date()` returns UTC; `check_in_date` in DB may be stored as a date string. Arithmetic done in UTC will be wrong for hotels in non-UTC timezones.

**How to avoid:** All milestone date comparisons must use `date-fns-tz` with each hotel's timezone stored in `hotels.timezone`. The cron queries per hotel and applies timezone-aware date computation. Pattern: `formatInTimeZone(addDays(new Date(), 1), hotel.timezone, 'yyyy-MM-dd')`.

**Warning signs:** Guests receive pre-arrival messages two days before check-in; or on the check-in day instead of the day before.

---

## Code Examples

Verified patterns from official sources and codebase inspection:

### Vercel Cron `vercel.json` Configuration
```json
// Source: https://vercel.com/docs/cron-jobs/quickstart
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/milestone-dispatch",
      "schedule": "0 6 * * *"
    }
  ]
}
```
Pro plan: fires at exactly 06:00 UTC ±59s. Hobby plan: fires anywhere in the 06:xx hour window.

### Booking Milestone Query Pattern
```typescript
// src/lib/cron/milestoneDispatch.ts
import { createServiceClient } from '@/lib/supabase/service';
import { formatInTimeZone } from 'date-fns-tz';
import { addDays } from 'date-fns';

const supabase = createServiceClient(); // service_role needed — no user session in cron

// Step 1: Get all hotels with their timezones
const { data: hotels } = await supabase.from('hotels').select('id, timezone, name');

for (const hotel of hotels ?? []) {
  const tz = hotel.timezone;
  const todayStr = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
  const tomorrowStr = formatInTimeZone(addDays(new Date(), 1), tz, 'yyyy-MM-dd');
  const yesterdayStr = formatInTimeZone(addDays(new Date(), -1), tz, 'yyyy-MM-dd');

  // Pre-arrival: check_in = tomorrow
  const { data: preArrival } = await supabase
    .from('bookings')
    .select('*')
    .eq('hotel_id', hotel.id)
    .eq('check_in_date', tomorrowStr)
    .eq('pre_arrival_sent', false);

  // Checkout reminder: check_out = today
  const { data: checkoutDay } = await supabase
    .from('bookings')
    .select('*')
    .eq('hotel_id', hotel.id)
    .eq('check_out_date', todayStr)
    .eq('checkout_reminder_sent', false);

  // Post-stay: check_out = yesterday
  const { data: postStay } = await supabase
    .from('bookings')
    .select('*')
    .eq('hotel_id', hotel.id)
    .eq('check_out_date', yesterdayStr)
    .eq('review_request_sent', false);

  // Dispatch messages for each group...
}
```

### Audit Log Write in executeTool()
```typescript
// Augment ToolContext with conversationId for audit trail
// In src/lib/agents/tools/executor.ts

export interface ToolContext {
  hotelId: string;
  fromRole: string;
  conversationId: string;  // ADD THIS
}

// After: const result = await handler(input, context);
const rawResult = JSON.stringify(result);

// Write audit log (fire-and-forget, never block tool response)
writeAuditLog({
  hotelId: context.hotelId,
  agentRole: context.fromRole,
  conversationId: context.conversationId,
  toolName: name,
  actionClass: classifyAction(name),
  inputJson: input,
  resultJson: result,
}).catch((err) => console.error('[audit] Failed to write audit log:', err));

return rawResult;
```

### Action Classification (Rule-Based)
```typescript
// src/lib/agents/audit.ts
export type ActionClass = 'OBSERVE' | 'INFORM' | 'ACT';

const OBSERVE_TOOLS = new Set([
  'get_room_availability',
  'get_room_pricing',
  'lookup_guest_reservation',
]);

const INFORM_TOOLS = new Set([
  'delegate_task',
  'update_hotel_info',
]);

// All other tools default to ACT (conservative — future-proof)
export function classifyAction(toolName: string): ActionClass {
  if (OBSERVE_TOOLS.has(toolName)) return 'OBSERVE';
  if (INFORM_TOOLS.has(toolName)) return 'INFORM';
  return 'ACT';
}
```

### Supabase Realtime Subscription (In-App Escalation Notification)
```typescript
// Source: https://supabase.com/docs/guides/realtime/postgres-changes
// 'use client' component
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export function EscalationNotificationProvider({ hotelId, children }) {
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`escalations-${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'escalations',
          filter: `hotel_id=eq.${hotelId}`,
        },
        (payload) => {
          toast.error('Guest needs assistance', {
            description: payload.new.guest_message?.slice(0, 100),
            duration: 10000,
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [hotelId]);

  return children;
}
```

---

## Database Schema for Phase 5

New tables needed in `0005_guest_experience.sql`:

### `bookings` table
```sql
CREATE TABLE public.bookings (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              UUID        NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  guest_name            TEXT        NOT NULL,
  guest_email           TEXT,
  guest_phone           TEXT,           -- WhatsApp-formatted if available: "whatsapp:+1555..."
  channel               TEXT        NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp')),
  check_in_date         DATE        NOT NULL,
  check_out_date        DATE        NOT NULL,
  pre_arrival_sent      BOOLEAN     NOT NULL DEFAULT FALSE,
  checkout_reminder_sent BOOLEAN   NOT NULL DEFAULT FALSE,
  review_request_sent   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- RLS: hotel owners see own bookings; service_role inserts/updates
```

### `message_templates` table (GEXP-05)
```sql
CREATE TABLE public.message_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID        NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  milestone   TEXT        NOT NULL CHECK (milestone IN ('pre_arrival', 'checkout_reminder', 'review_request')),
  channel     TEXT        NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  subject     TEXT,           -- for email
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, milestone, channel)
);
```

### `agents` table (DASH-04, DASH-05)
```sql
CREATE TABLE public.agents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID        NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL,   -- e.g. 'front_desk', 'guest_experience'
  is_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  behavior_config JSONB       NOT NULL DEFAULT '{}',  -- tone, language preferences, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, role)
);
```

### `agent_audit_log` table (SAFE-01, SAFE-03)
```sql
CREATE TABLE public.agent_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID        NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  agent_role      TEXT        NOT NULL,
  conversation_id TEXT        NOT NULL,
  tool_name       TEXT        NOT NULL,
  action_class    TEXT        NOT NULL CHECK (action_class IN ('OBSERVE', 'INFORM', 'ACT')),
  input_json      JSONB       NOT NULL DEFAULT '{}',
  result_json     JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- No UPDATE/DELETE — audit logs are append-only
CREATE INDEX idx_audit_log_hotel ON public.agent_audit_log(hotel_id, created_at);
CREATE INDEX idx_audit_log_conv ON public.agent_audit_log(conversation_id);
```

---

## Codebase Integration Points

The Phase 5 work integrates with these existing files:

| File | Change Required |
|------|----------------|
| `src/lib/agents/types.ts` | Add `AgentRole.GUEST_EXPERIENCE = "guest_experience"` |
| `src/lib/agents/agentFactory.ts` | Add `GUEST_EXPERIENCE` role config; add `is_enabled` check pattern |
| `src/lib/agents/invokeAgent.ts` | Add `conversationId` to `ToolContext` passed to `executeTool()` |
| `src/lib/agents/tools/executor.ts` | Add `conversationId` to `ToolContext`; write audit log after each tool execution |
| `src/app/(dashboard)/layout.tsx` | Wrap with `EscalationNotificationProvider`; add nav links for new pages |
| `vercel.json` | Add `crons` configuration array |
| `supabase/migrations/` | New `0005_guest_experience.sql` |
| `src/types/database.ts` | Add `Booking`, `MessageTemplate`, `Agent`, `AgentAuditLog` types |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom timer / setInterval | Vercel Cron Jobs | Feb 2023 (GA) | No external cron service needed; works natively in Next.js |
| Twilio `body` for all outbound | Meta Utility Templates via `contentSid` | WhatsApp Business API policy (ongoing) | Free-form body outside 24h window silently fails; templates required |
| Manual RLS publication config | Supabase auto-publication (new projects) | Supabase 2024 | Older tables may need explicit `ALTER PUBLICATION` to receive Realtime events |

**Deprecated/outdated:**
- `node-cron` on Vercel: Does not work on serverless — process dies after each request. Use Vercel Cron Jobs.
- Twilio `body` for business-initiated WhatsApp: Fails outside 24h window. Use `contentSid`/`contentVariables` with approved template.

---

## Open Questions

1. **WhatsApp template pre-approval timing**
   - What we know: Meta approval takes minutes to 48 hours; templates are approved via the Twilio Console
   - What's unclear: Whether the project already has approved Utility templates for hotel use cases; template content must be finalized before coding
   - Recommendation: Create and submit three templates (pre-arrival, checkout-reminder, review-request) in Twilio Console immediately; store `contentSid` values as env vars (`TWILIO_TEMPLATE_SID_PRE_ARRIVAL`, etc.)

2. **Booking data source**
   - What we know: No `bookings` table exists yet; the schema needs to be created in Phase 5
   - What's unclear: Will bookings be manually entered by hotel owners, or imported from a PMS (Property Management System)?
   - Recommendation: Start with manual entry via dashboard form (simplest); PMS integration is a future phase

3. **SAFE-02 ACT confirmation scope in Phase 5**
   - What we know: Current tools (get_room_availability, get_room_pricing, lookup_guest_reservation, delegate_task, update_hotel_info) are classified as OBSERVE or INFORM — no ACT-class tools exist yet
   - What's unclear: Will Phase 5 introduce any new ACT-class tools (e.g., modifying a booking, sending an email directly)?
   - Recommendation: Implement the ACT classification column and the confirmation row schema in this phase, but the confirmation gate only needs to activate if an ACT tool is added; document the pattern clearly for future phases

4. **Vercel plan confirmation**
   - What we know: Hobby plan limits cron to once per day (±59 min). Pro plan allows once per minute with per-minute precision
   - What's unclear: What plan is this project on?
   - Recommendation: Confirm Vercel plan before finalizing cron schedule. Pre-arrival (D-1), checkout reminder, and post-stay review can all run from a single daily cron at 06:00 UTC; a daily cron is fine even on Hobby if milestones are daily events. However, if more frequent checks are needed (e.g., hourly for same-day bookings), Pro is required.

---

## Sources

### Primary (HIGH confidence)
- Vercel Cron Jobs Quickstart: https://vercel.com/docs/cron-jobs/quickstart — configuration, security, vercel.json syntax
- Vercel Cron Jobs Usage & Pricing: https://vercel.com/docs/cron-jobs/usage-and-pricing — plan limits (Hobby once/day ±59min, Pro once/minute)
- Vercel Managing Cron Jobs: https://vercel.com/docs/cron-jobs/manage-cron-jobs — CRON_SECRET pattern, idempotency, concurrency
- Supabase Realtime Postgres Changes: https://supabase.com/docs/guides/realtime/postgres-changes — filter syntax, RLS interaction, subscribe pattern
- Twilio WhatsApp Notification Templates: https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates — contentSid/contentVariables, 24h window constraint
- Codebase inspection: `src/lib/agents/invokeAgent.ts`, `escalation.ts`, `agentFactory.ts`, `coordination.ts`, `tools/executor.ts`, `tools/registry.ts`, `memory.ts`, all 4 migration files, `database.ts`, dashboard layout, escalations API

### Secondary (MEDIUM confidence)
- Supabase Realtime with Next.js: https://supabase.com/docs/guides/realtime/realtime-with-nextjs — useEffect subscription pattern verified against official docs
- Twilio outbound WhatsApp 24h window: https://www.twilio.com/docs/whatsapp/tutorial/send-and-receive-media-messages-whatsapp-nodejs — confirmed free-form body limitation
- Supabase Cron quickstart: https://supabase.com/docs/guides/cron/quickstart — verified as alternative but Vercel cron preferred for this project

### Tertiary (LOW confidence — verify before implementing)
- Post-stay D+1 always outside 24h window: Confirmed by 24h window definition, but exact timing depends on when guest last messaged; for safety treat all milestone sends as potentially outside the window
- `sonner` vs `shadcn/ui/toast` for notifications: Both are valid; sonner is the newer shadcn-recommended default, verify current `components.json` to see which toast primitives are available

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all core deps already installed, confirmed via package.json inspection
- Architecture: HIGH — patterns derived from existing codebase (escalation, invokeAgent, ChatWindow all inspected) and official docs
- Pitfalls: HIGH for WhatsApp templates and cron timeout (official Twilio/Vercel docs); MEDIUM for Realtime publication pitfall (pattern from community, confirmed by Supabase docs mention of publication requirement)
- Database schema: HIGH — follows established pattern from 0001-0004 migrations

**Research date:** 2026-03-05
**Valid until:** 2026-06-05 (90 days — Vercel and Twilio APIs are stable; Supabase Realtime API is stable)
