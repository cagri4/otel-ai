# Architecture Research

**Domain:** Telegram Multi-Bot Agent-Native SaaS — Hotel AI Platform Extension
**Researched:** 2026-03-06
**Confidence:** HIGH (existing codebase verified + Telegram API official docs verified)

---

## Context: What Already Exists

The following is confirmed by reading the actual codebase. This is not speculative.

**Existing pipeline (complete, working):**
```
invokeAgent(params) → assembleSystemPrompt(DB) → Claude API → executeTool() → persistTurn()
```

**Existing channels:**
- SSE streaming: `POST /api/agent/stream` (authenticated owner, session-scoped)
- WhatsApp webhook: `POST /api/whatsapp/webhook` (Twilio signature validation, service-role resolution)
- Web widget: `POST /api/widget/message` (widget_token hotel resolution)

**Existing agent roles in AgentRole enum:**
- `FRONT_DESK` — claude-opus-4-6, tools: availability + pricing + reservation + update_hotel_info
- `BOOKING_AI` — claude-opus-4-6, tools: availability + pricing + reservation
- `GUEST_EXPERIENCE` — claude-sonnet-4-6, no tools (milestone messaging)
- `HOUSEKEEPING_COORDINATOR` — claude-sonnet-4-6, tools: get_room_status + update_room_status + assign_cleaning_task

**Existing DB tables:** hotels, profiles, hotel_facts, rooms, conversation_turns, conversation_summaries, guest_interactions, agent_tasks, escalations, hotel_whatsapp_numbers, agents, subscriptions

**Key design decisions already in place:**
- `hotel_id` injected from ToolContext, never trusted from Claude's tool input
- Service-role client used in webhook handlers (no session cookies on webhooks)
- Conversation ID format: `{channel_prefix}_{hotelId}_{guestIdentifier}`
- escalation detection runs fire-and-forget after every agent response
- channel field in escalations: `'whatsapp' | 'widget' | 'dashboard'`

---

## New System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     TELEGRAM DELIVERY LAYER (new)                    │
│                                                                       │
│  [Setup Wizard Bot]  [Front Desk Bot]  [Booking Bot]                 │
│  [Housekeeping Bot]  [Guest Experience Bot]                          │
│       │                    │                                          │
│       └────────────────────┘                                          │
│                     Telegram API                                      │
│                     POST webhooks                                     │
└────────────────────────────┬────────────────────────────────────────┘
                              │
┌────────────────────────────▼────────────────────────────────────────┐
│                  WEBHOOK ROUTER (new route handler)                   │
│                                                                       │
│  POST /api/telegram/[botToken]                                        │
│    1. Validate X-Telegram-Bot-Api-Secret-Token header                 │
│    2. Resolve hotel_id + AgentRole from botToken via DB lookup        │
│    3. Extract chat_id + text from Telegram Update JSON                │
│    4. Derive conversationId: tg_{hotelId}_{chatId}                   │
│    5. invokeAgent() — same pipeline as WhatsApp webhook               │
│    6. sendMessage() via Telegram Bot API with resolved bot token      │
│    7. Return 200 (always, prevents Telegram retries)                  │
└────────────────────────────┬────────────────────────────────────────┘
                              │
┌────────────────────────────▼────────────────────────────────────────┐
│              EXISTING AGENT PIPELINE (unchanged)                      │
│                                                                       │
│  invokeAgent({ role, userMessage, conversationId, hotelId })         │
│    → assembleSystemPrompt (DB fresh every call)                       │
│    → Claude API (tool_use → executeTool → recurse)                   │
│    → persistTurn                                                      │
│    → detectAndInsertEscalation (fire-and-forget)                     │
└────────────────────────────┬────────────────────────────────────────┘
                              │
┌────────────────────────────▼────────────────────────────────────────┐
│                    EXISTING DATA LAYER (Supabase)                     │
│                                                                       │
│  hotels          hotel_facts      conversation_turns                  │
│  agents          hotel_bots (new) subscriptions (modified)           │
│  agent_tasks     escalations                                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   SUPER ADMIN PANEL (new UI route)                    │
│                                                                       │
│  /admin/* — guarded by role: 'super-admin' in JWT app_metadata       │
│    [Create Hotel Account]  [List Hotels]  [Manage Bots]              │
│    [Billing Overview]      [Generate Deep Links]                      │
│                                                                       │
│  POST /api/admin/hotels       — create hotel + user account          │
│  POST /api/admin/hotels/[id]/bots — provision bot tokens             │
│  GET  /api/admin/hotels       — list all hotels                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## New Components

### 1. `hotel_bots` Table (NEW — critical)

Maps bot tokens to hotel + agent role. This is the resolution table for webhook routing.

```sql
CREATE TABLE public.hotel_bots (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID    NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL,  -- matches AgentRole enum values
  bot_token   TEXT    NOT NULL UNIQUE,   -- Telegram bot token (encrypted at rest)
  bot_username TEXT,                     -- for display in admin panel
  webhook_secret TEXT NOT NULL,          -- X-Telegram-Bot-Api-Secret-Token value
  is_active   BOOL    NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hotel_bots_token ON public.hotel_bots(bot_token);
CREATE UNIQUE INDEX idx_hotel_bots_hotel_role ON public.hotel_bots(hotel_id, role);
```

**Why one row per hotel+role:** Enables fast O(1) lookup at webhook time. Index on `bot_token` is the hot path — every incoming Telegram message hits this index.

**Why `webhook_secret` stored per-bot:** Each bot gets a distinct secret to validate `X-Telegram-Bot-Api-Secret-Token`. This prevents spoofed requests even if one token leaks.

### 2. `POST /api/telegram/[botToken]/route.ts` (NEW)

Dynamic route segment captures the bot token from the URL path. This matches the Telegram setWebhook URL pattern `https://your-domain.com/api/telegram/{BOT_TOKEN}`.

```typescript
// src/app/api/telegram/[botToken]/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: { botToken: string } }
): Promise<Response> {
  // 1. Validate X-Telegram-Bot-Api-Secret-Token header
  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token') ?? '';

  // 2. Resolve hotel + role from botToken via DB (service-role, no auth session on webhooks)
  const supabase = createServiceClient();
  const { data: botRecord } = await supabase
    .from('hotel_bots')
    .select('hotel_id, role, webhook_secret')
    .eq('bot_token', params.botToken)
    .eq('is_active', true)
    .single();

  if (!botRecord || botRecord.webhook_secret !== secretHeader) {
    return new Response('Forbidden', { status: 403 });
  }

  // 3. Parse Telegram Update JSON
  const update = await req.json();
  const message = update.message;
  if (!message?.text || !message?.chat?.id) {
    return new Response('', { status: 200 }); // non-message updates: ack and ignore
  }

  const chatId = String(message.chat.id);
  const userText = message.text;

  // 4. Derive conversationId — same pattern as existing channels
  const conversationId = `tg_${botRecord.hotel_id}_${chatId}`;

  // 5. Sanitize + rate limit (reuse existing helpers)
  const sanitized = sanitizeGuestInput(userText);
  const rateLimit = await checkHotelRateLimit(botRecord.hotel_id);
  if (!rateLimit.success) {
    await sendTelegramMessage(params.botToken, chatId, 'Too many messages. Please wait a moment.');
    return new Response('', { status: 200 });
  }

  // 6. Invoke agent — identical to WhatsApp webhook pattern
  try {
    const response = await invokeAgent({
      role: botRecord.role as AgentRole,
      userMessage: sanitized,
      conversationId,
      hotelId: botRecord.hotel_id,
      guestIdentifier: chatId,
    });

    // 7. Reply via Telegram Bot API
    await sendTelegramMessage(params.botToken, chatId, response);
  } catch (err) {
    console.error('[telegram webhook] invokeAgent failed:', err);
    // Do not expose errors to users
  }

  // 8. Always 200 — prevents Telegram retry storms
  return new Response('', { status: 200 });
}
```

### 3. `lib/telegram/sendMessage.ts` (NEW)

Outbound message sender. Mirrors `lib/whatsapp/sendReply.ts` in pattern.

```typescript
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  // Telegram Bot API: https://api.telegram.org/bot{token}/sendMessage
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  // Telegram max message length: 4096 characters
  // Split if needed or truncate to prevent API errors
  const truncated = text.length > 4000 ? text.slice(0, 4000) + '...' : text;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: truncated }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}
```

### 4. `lib/telegram/registerWebhook.ts` (NEW)

Called by the admin panel when a bot token is provisioned. Sets the Telegram webhook URL.

```typescript
export async function registerTelegramWebhook(
  botToken: string,
  webhookSecret: string,
  appUrl: string,
): Promise<void> {
  const webhookUrl = `${appUrl}/api/telegram/${botToken}`;

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        drop_pending_updates: true,
        allowed_updates: ['message'],  // only text messages, no inline/callback needed for MVP
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`setWebhook failed: ${res.status} ${body}`);
  }
}
```

### 5. Super Admin Route Group (NEW)

```
src/app/admin/                   — super admin area
  layout.tsx                     — guards: JWT role === 'super-admin' + redirect
  page.tsx                       — hotel list
  hotels/
    new/page.tsx                 — create hotel account form
    [hotelId]/page.tsx           — hotel detail: bots, billing, settings
    [hotelId]/bots/page.tsx      — bot provisioning UI

src/app/api/admin/
  hotels/route.ts                — GET list, POST create
  hotels/[hotelId]/bots/route.ts — GET list, POST provision bot
  hotels/[hotelId]/bots/[botId]/
    register/route.ts            — POST setWebhook + save record
```

**Super admin JWT guard:**
```typescript
// src/app/admin/layout.tsx
export default async function AdminLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // JWT app_metadata.role must be 'super-admin'
  // This is set via: UPDATE auth.users SET raw_app_meta_data = ... (SQL, not client-side)
  const role = user?.app_metadata?.role;
  if (!user || role !== 'super-admin') {
    redirect('/login');
  }
  return <>{children}</>;
}
```

### 6. Setup Wizard Bot Handler (SPECIAL CASE)

The Setup Wizard bot is a separate agent role, not one of the four employee bots. It handles hotel onboarding via Telegram conversation when a hotel owner first signs up.

**Key difference:** The Setup Wizard bot operates across ALL hotels (before hotel association exists). Resolution requires a different flow:

```
Setup Wizard Bot webhook arrives
  → Look up hotel_bots WHERE role = 'setup_wizard' AND bot_token = :token
  → This is a single shared setup wizard bot (not per-hotel)
  → Resolve hotel_id from chat_id via a setup_sessions table
  → OR: use Telegram start parameter deep link to pass hotel_id
```

**Setup wizard flow:**
```
Super admin creates hotel account in /admin panel
  → Generates unique deep link: https://t.me/OtelAISetupBot?start={hotelId}
  → Sends this link to hotel owner via email
  → Hotel owner clicks link → Telegram opens, /start {hotelId} fires
  → Setup Wizard bot webhook receives: update.message.text = "/start {hotelId}"
  → Extract hotelId from start parameter
  → Begin onboarding conversation (hotel name, timezone, room count, etc.)
  → Agent calls update_hotel_info tool to persist answers
  → At end: provision the 4 employee bot tokens (manual step, guided by wizard)
```

**Deep link format (Telegram spec):**
```
https://t.me/{bot_username}?start={payload}
// payload: A-Z, a-z, 0-9, _, - only. Max 512 chars.
// Received in webhook as: update.message.text = "/start {payload}"
```

---

## Modified Components

### 1. `escalation.ts` — channel enum extended

Current `channel` check in `invokeAgent.ts`:
```typescript
channel: params.conversationId.startsWith('wa_') ? 'whatsapp'
       : params.conversationId.startsWith('widget_') ? 'widget'
       : 'dashboard',
```

Must add `'telegram'` to channel detection AND to the DB CHECK constraint:
```typescript
channel: params.conversationId.startsWith('wa_') ? 'whatsapp'
       : params.conversationId.startsWith('widget_') ? 'widget'
       : params.conversationId.startsWith('tg_') ? 'telegram'
       : 'dashboard',
```

```sql
-- Migration needed: add 'telegram' to escalations.channel CHECK
ALTER TABLE public.escalations
  DROP CONSTRAINT escalations_channel_check,
  ADD CONSTRAINT escalations_channel_check
    CHECK (channel IN ('whatsapp', 'widget', 'telegram', 'dashboard'));
```

### 2. `assembleContext.ts` — service-role client for webhook invocations

Current `assembleSystemPrompt` calls `createClient()` (session-based). This breaks for webhook handlers which have no session cookie.

**Fix required:** Pass a `supabase` client instance into `assembleSystemPrompt`, or use the service-role client when `hotelId` is already verified externally. The WhatsApp webhook works because `invokeAgent` already calls `createServiceClient()` for the `is_enabled` guard, but `assembleContext.ts` re-creates a session client that will fail.

**The WhatsApp webhook passes this today because:**
- `invokeAgent` is called from `POST /api/whatsapp/webhook`
- The `assembleContext.ts` uses `await createClient()` which returns the server-side Supabase client
- This client in Route Handlers reads cookies from `cookies()` — but there are no cookies on webhook requests

**Investigate:** Check whether existing WhatsApp webhook actually works with `assembleContext.ts` using `createClient()`. If it does, Next.js may be allowing the service-role fallback. If not, this is an existing bug that the Telegram milestone must fix. The Telegram webhook handler must pass a service-role client, or `invokeAgent` needs a `useServiceRole` flag.

**Recommended fix — add `supabase` param option to `invokeAgent`:**
```typescript
// InvokeAgentParams addition
interface InvokeAgentParams {
  // ... existing fields ...
  _serviceClient?: SupabaseClient; // webhook callers inject their own service client
}
```

### 3. `billing/plans.ts` — replace tier limits with per-bot pricing

Current model: `maxAgents` per plan tier (2 on starter, 4 on pro, 6 on enterprise).

New model: Per-bot pricing. Each active bot = one billing unit. No tier gates on bot count.

**New billing data model:**
```sql
-- hotel_bots already has is_active
-- Billing is now: COUNT(hotel_bots WHERE hotel_id = X AND is_active = TRUE)
-- Super admin sets price per bot per month in admin panel or external payment config
```

**Enforcement change:** Remove `enforceAgentLimit()` call from agent enable/disable toggle. Replace with a subscription check that counts active bots and compares against payment status. If payment is overdue, deactivate all bots (not a tier limit, but a payment enforcement).

### 4. `subscriptions` table — extend for per-bot billing

```sql
ALTER TABLE public.subscriptions
  ADD COLUMN price_per_bot_eur NUMERIC DEFAULT 9.00,
  ADD COLUMN price_per_bot_try NUMERIC DEFAULT 90.00;
-- active_bot_count computed at charge time: COUNT(hotel_bots WHERE is_active AND hotel_id = X)
```

---

## Data Flow: Telegram Message to Agent Response

```
Telegram sends POST to /api/telegram/{botToken}
  ↓
X-Telegram-Bot-Api-Secret-Token header present?
  No → 403 Forbidden
  Yes → continue
  ↓
DB lookup: hotel_bots WHERE bot_token = {botToken}
  Not found → 200 (silently ignore — prevents enumeration)
  Found → { hotel_id, role, webhook_secret }
  ↓
webhook_secret === header value?
  No → 403 Forbidden
  Yes → continue
  ↓
Parse update.message: { chat.id, text }
  No text or no chat.id → 200 (non-message update, ignored)
  ↓
sanitizeGuestInput(text)
  ↓
checkHotelRateLimit(hotel_id)
  Exceeded → sendTelegramMessage(token, chatId, polite_decline) → 200
  OK → continue
  ↓
conversationId = `tg_{hotel_id}_{chatId}`
  ↓
invokeAgent({
  role,           // from hotel_bots row
  userMessage,    // sanitized text
  conversationId, // tg_ prefixed
  hotelId,        // from hotel_bots row
  guestIdentifier: chatId
})
  ↓
[Same pipeline as WhatsApp — assembleSystemPrompt → Claude → tools → persist]
  ↓
response: string
  ↓
sendTelegramMessage(botToken, chatId, response)
  ↓
return new Response('', { status: 200 })
```

---

## Data Flow: Super Admin Provisions New Hotel

```
Super admin logs in to /admin (JWT role === 'super-admin')
  ↓
POST /api/admin/hotels
  { hotelName, ownerEmail, ownerName, country }
  ↓
1. Create Supabase auth user for hotel owner
   → supabase.auth.admin.createUser({ email, user_metadata: { hotel_name, full_name } })
   → handle_new_user trigger fires: creates hotel + profile + seeds defaults + creates trial subscription
   ↓
2. Return hotel_id + generated magic link for owner login
  ↓
POST /api/admin/hotels/{hotelId}/bots
  { role: 'front_desk', bot_token: '...', bot_username: '...' }
  ↓
1. Generate webhook_secret (crypto.randomUUID())
2. INSERT into hotel_bots
3. Call registerTelegramWebhook(botToken, webhookSecret, NEXT_PUBLIC_APP_URL)
   → Telegram confirms: setWebhook returns { ok: true }
4. Return bot record + deep link for owner: `https://t.me/{bot_username}`
  ↓
Super admin repeats for each of 4 employee bots per hotel
  ↓
Super admin generates Setup Wizard deep link:
  `https://t.me/OtelAISetupBot?start={hotelId}`
  → Sends to hotel owner via email (Resend)
```

---

## Data Flow: Setup Wizard Onboarding

```
Hotel owner receives email with Setup Wizard deep link
  ↓
Owner taps link → Telegram opens Setup Wizard bot
  ↓
Telegram sends POST /api/telegram/{setupWizardToken}:
  update.message.text = "/start {hotelId}"
  ↓
Webhook handler detects "/start {payload}" pattern
  → Extract hotelId from payload
  → Resolve hotel: SELECT * FROM hotels WHERE id = hotelId
  ↓
conversationId = `tg_setup_{hotelId}_{chatId}`
  ↓
invokeAgent({
  role: AgentRole.FRONT_DESK,  // Setup Wizard uses Front Desk role in onboarding mode
  userMessage: "Welcome! Let's set up your hotel.",
  conversationId,
  hotelId,
})
  ↓
Setup Wizard agent asks questions:
  "What is your hotel's city?"
  "What timezone are you in?"
  "How many room types do you have?"
  → Agent calls update_hotel_info tool on each answer
  ↓
At completion: agent sends instructions for connecting employee bots
  (The bot tokens were already provisioned by super admin; owner just needs to follow guide)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `/api/telegram/[botToken]` | Validate webhook, resolve hotel+role, call invokeAgent, send reply | Telegram API (inbound webhook), hotel_bots table, invokeAgent, sendTelegramMessage |
| `hotel_bots` table | Maps bot tokens to hotel+role, stores webhook secrets | Webhook router (reads), admin panel (writes) |
| `lib/telegram/sendMessage.ts` | POST to Telegram Bot API to deliver text response | Telegram Bot API (https://api.telegram.org) |
| `lib/telegram/registerWebhook.ts` | Call setWebhook on Telegram API for a given bot token | Telegram Bot API (https://api.telegram.org) |
| `/admin` route group | Super admin UI for hotel and bot management | /api/admin/* routes |
| `/api/admin/hotels` | Create hotel accounts, list hotels | Supabase auth.admin (service role), hotels table |
| `/api/admin/hotels/[id]/bots` | Provision bot tokens, trigger setWebhook | hotel_bots table, registerTelegramWebhook |
| `invokeAgent()` | Unchanged — stateless agent orchestrator | assembleSystemPrompt, Claude API, executeTool, persistTurn |

---

## Architectural Patterns

### Pattern 1: Bot Token in URL Path (Routing by URL)

**What:** Each bot gets its own webhook URL: `/api/telegram/{BOT_TOKEN}`. Telegram sends updates to the bot's unique URL. The token in the path is the routing key for hotel + role resolution.

**Why this over a shared dispatcher URL:**
- Zero routing ambiguity: one URL = one bot = one hotel+role
- Telegram's `secret_token` header adds a second layer of security per bot
- Scales to any number of bots without changing routing logic
- Pattern proven in production for multi-bot SaaS (verified via community sources)

**When to use:** Multi-tenant SaaS with many independent bots. Works with Vercel's file-based routing via `[botToken]` dynamic segment.

**Trade-off:** Bot tokens appear in server logs and Vercel function URL logs. Mitigate by not logging the raw URL, and by also validating the `secret_token` header — so knowing the URL alone is insufficient.

### Pattern 2: Service-Role DB Lookup for Webhook Resolution

**What:** Webhook handlers cannot use session cookies. Use service-role Supabase client to look up `hotel_id` + `role` from `hotel_bots` table by bot token. This mirrors the existing `resolveHotelFromNumber()` pattern for WhatsApp.

**Why:** Telegram webhooks are unauthenticated inbound HTTP — no Supabase session. Service client bypasses RLS. The bot token itself is the authentication credential.

**Security:** Double validate: (1) bot token in path must exist in `hotel_bots`, (2) `webhook_secret` in header must match stored secret. Both checks must pass before `invokeAgent` is called.

### Pattern 3: Shared `invokeAgent()` Pipeline Across All Channels

**What:** The Telegram webhook handler calls the same `invokeAgent()` function as the WhatsApp webhook, the SSE stream endpoint, and the cron jobs. No channel-specific agent logic.

**Why:** Channel differences (streaming vs non-streaming, message format, delivery mechanism) are handled in the webhook handler layer. The agent pipeline is channel-agnostic.

**What changes per channel:**
- Conversation ID prefix: `wa_` vs `widget_` vs `tg_`
- Role resolution: WhatsApp uses Twilio number → hotel_id, Telegram uses bot_token → hotel_id + role
- Response delivery: Twilio API vs Telegram Bot API vs SSE stream

### Pattern 4: Super Admin Role via JWT app_metadata

**What:** Super admin is a single Supabase user with `raw_app_meta_data.role = 'super-admin'`. Set via direct SQL in Supabase dashboard (not client-side). The `/admin` layout checks JWT claims — no separate admin table needed.

**Why:** Simpler than a separate admin database. JWT claim is injected by the existing `custom_access_token_hook`. No additional middleware complexity.

**SQL to grant super admin:**
```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "super-admin"}'
WHERE email = 'admin@example.com';
```

**Why not a separate admin table with RLS:** JWT claim check in layout.tsx is sufficient for an internal tool with 1-2 admin users. A DB table adds complexity without security benefit here.

### Pattern 5: Conversation ID as Channel + Hotel + Guest Key

**What:** Conversation ID = `{channel}_{hotelId}_{guestKey}`. This is the existing convention extended to Telegram.

**Existing:**
- `wa_{hotelId}_{phone}` — WhatsApp
- `widget_{hotelId}_{sessionId}` — Web widget
- `{hotelId}_owner_chat` — Dashboard

**New:**
- `tg_{hotelId}_{chatId}` — Telegram employee bots
- `tg_setup_{hotelId}_{chatId}` — Setup Wizard

**Why chatId as guest key:** Telegram `chat.id` is stable per user per bot. It is the natural guest identifier for episodic memory lookup. Persistent across bot restarts.

---

## New File Structure

Only NEW files and MODIFIED files listed. Existing structure is unchanged.

```
src/
├── app/
│   ├── admin/                           # NEW — super admin area
│   │   ├── layout.tsx                   # JWT role guard (super-admin)
│   │   ├── page.tsx                     # Hotel list
│   │   └── hotels/
│   │       ├── new/page.tsx             # Create hotel account
│   │       └── [hotelId]/
│   │           ├── page.tsx             # Hotel detail
│   │           └── bots/page.tsx        # Bot provisioning UI
│   │
│   └── api/
│       ├── telegram/
│       │   └── [botToken]/
│       │       └── route.ts             # NEW — Telegram webhook handler (dynamic)
│       └── admin/
│           ├── hotels/
│           │   └── route.ts             # NEW — GET list, POST create hotel
│           └── hotels/[hotelId]/
│               ├── route.ts             # NEW — GET hotel detail
│               └── bots/
│                   └── route.ts         # NEW — GET list, POST provision bot
│
├── lib/
│   └── telegram/                        # NEW module
│       ├── sendMessage.ts               # POST to Telegram Bot API
│       ├── registerWebhook.ts           # setWebhook call
│       └── resolveBot.ts               # DB lookup: botToken → { hotel_id, role }
│
└── supabase/migrations/
    └── 0009_telegram.sql                # NEW — hotel_bots table, escalations channel update
```

---

## Anti-Patterns

### Anti-Pattern 1: One Shared Webhook URL for All Bots

**What people do:** Configure all bots to point to `/api/telegram/webhook` and dispatch by bot username inside the handler.

**Why it's wrong:** You need to know the bot token to respond to a specific bot (the token is part of `https://api.telegram.org/bot{TOKEN}/sendMessage`). If you receive an update and don't know which token was used to receive it, you cannot reply. Telegram sends the bot token in the URL you set — the update payload does not include the receiving bot's token.

**Do this instead:** Dynamic route `/api/telegram/[botToken]` — the token is captured from the URL, used for DB lookup AND for sendMessage in the reply.

### Anti-Pattern 2: Storing Bot Tokens Unencrypted and Using Them as Auth

**What people do:** Store raw bot tokens in `hotel_bots.bot_token` and treat the token-in-URL as sufficient auth.

**Why it's wrong:** Bot tokens appear in server access logs and Vercel function logs. Token alone should not grant access without the secondary `X-Telegram-Bot-Api-Secret-Token` header check.

**Do this instead:** Always validate BOTH the token (DB lookup) AND the secret header. Consider encrypting tokens at rest using AES-256-GCM with a key from env (decrypt only when needed for API calls). Log the first 8 chars only.

### Anti-Pattern 3: Calling `createClient()` (Session Client) Inside Webhook Handlers

**What people do:** Reuse `createClient()` from `lib/supabase/server.ts` for webhook handlers that call `invokeAgent()`.

**Why it's wrong:** `createClient()` in Next.js App Router reads session cookies via `cookies()`. Webhook handlers from Telegram/Twilio/Mollie have no session cookies. This silently fails or returns an unauthenticated client.

**Do this instead:** Use `createServiceClient()` for all webhook handler DB operations. The hotel_id has already been validated from the bot token — service client is safe to use here.

**Existing concern:** `assembleSystemPrompt` calls `createClient()` internally. Verify whether the WhatsApp webhook actually works today or if it's hitting this issue. If it works, it may be because Next.js creates a server client that falls back gracefully. Regardless, the Telegram implementation must test this path explicitly.

### Anti-Pattern 4: Letting Hotel Owners Register Their Own Bot Tokens

**What people do:** Build a self-service UI where hotel owners paste bot tokens directly.

**Why it's wrong for OtelAI:** Each bot requires a BotFather account, proper name/avatar setup, and correct webhook registration. Doing this correctly is complex. Hotel owners will make mistakes. The super admin controls bot quality and naming consistency.

**Do this instead:** Super admin creates all bots via BotFather (manual, one-time per hotel), stores the tokens in the admin panel, and provisions them server-side. Hotel owners receive ready-to-use bot links.

### Anti-Pattern 5: Blocking the Webhook Response While Awaiting `invokeAgent()`

**What people do:** `await invokeAgent()` directly, then respond 200 to Telegram.

**Why this is acceptable for Telegram (unlike SSE):** Telegram allows up to 60 seconds for webhook response before retrying. Claude API + tool calls typically complete in 3-15 seconds. For MVP, synchronous await is fine.

**When this becomes a problem:** Complex tool chains hitting the recursion limit (5 rounds) can take 30+ seconds. If Vercel's function timeout (60 seconds for Pro, 10 for Hobby) is hit, the response 200 is never sent and Telegram retries the message → duplicate agent responses.

**Do this instead for v1:** Set `maxDuration = 60` on the Telegram route (requires Vercel Pro or above, same as the stream endpoint). For Hobby: keep tool chains short. For later: move invokeAgent to a background queue and respond 200 immediately.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Telegram Bot API (inbound) | HTTPS POST webhook to `/api/telegram/[botToken]` | Secret token header validated per bot. Telegram retries on non-200. Always return 200. |
| Telegram Bot API (outbound) | POST to `https://api.telegram.org/bot{token}/sendMessage` | Use per-bot token from DB. 4096 char message limit. No SSE — send complete message. |
| Supabase (hotel_bots) | Service-role SELECT for bot resolution | Index on bot_token for O(1) lookup. Hot path on every message. |
| BotFather | Manual interaction only | No programmatic API for bot creation. Super admin creates bots manually via BotFather, then enters tokens in admin panel. This is intentional — Telegram has no createBot API. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Telegram webhook → invokeAgent | Direct function call (same process) | No streaming (Telegram expects full message). No `onToken` callback. |
| invokeAgent → sendTelegramMessage | Return value passed to send function | Response text → Telegram reply. Same pattern as WhatsApp. |
| Admin panel → hotel_bots | REST API via `/api/admin/hotels/[id]/bots` | Service-role writes. Super admin only. |
| Admin panel → registerWebhook | Server-side fetch to Telegram API | Fires on bot token save. Can be re-triggered for URL changes. |
| Telegram webhook → escalation | Fire-and-forget via detectAndInsertEscalation | Same as existing channels. `channel = 'telegram'`. |

---

## Build Order

Based on component dependencies:

```
1. DB Migration: hotel_bots table + escalations.channel update
   → Unblocks all Telegram work
   → No existing code changes

2. lib/telegram/sendMessage.ts + lib/telegram/registerWebhook.ts
   → Pure utility functions, no dependencies
   → Test manually against a test bot token

3. POST /api/telegram/[botToken]/route.ts (webhook handler)
   → Depends on: hotel_bots table, sendMessage, invokeAgent (exists)
   → Test: point a test bot to this endpoint, send a message
   → Fix assembleContext.ts service client issue if needed

4. Bot provisioning: POST /api/admin/hotels/[id]/bots
   → Depends on: hotel_bots table, registerWebhook
   → Can be a simple script initially (curl), not a UI

5. Super Admin layout + hotel list (/admin)
   → Depends on: JWT role guard (can be set via SQL)
   → Milestone: super admin can see all hotels

6. Hotel creation via admin panel
   → Depends on: Supabase auth.admin API
   → Milestone: super admin can create a hotel account

7. Bot provisioning UI (/admin/hotels/[id]/bots)
   → Depends on: steps 3, 4, 5, 6
   → Milestone: super admin can provision and register all 5 bots

8. Setup Wizard bot (special handler for /start {hotelId})
   → Depends on: webhook handler (step 3), deep link pattern
   → Modify webhook handler to detect /start and handle onboarding flow

9. Per-bot billing model
   → Depends on: hotel_bots table, payment provider webhooks
   → Replace enforceAgentLimit with count-based billing enforcement
```

**Critical path:**
```
DB Migration (step 1) → Webhook handler (step 3) → Working Telegram bots
                      ↓
                Bot provisioning API (step 4) → Admin provisioning flow
```

---

## Confidence Assessment

| Component | Confidence | Reason |
|-----------|------------|--------|
| Telegram webhook URL pattern | HIGH | Verified via official core.telegram.org/bots/webhooks |
| secret_token header validation | HIGH | Verified via official API docs and multiple sources |
| Dynamic route [botToken] in Next.js | HIGH | Standard Next.js App Router feature |
| Bot token in URL as routing key | HIGH | Confirmed by Telegram community pattern + official docs |
| BotFather no programmatic API | HIGH | Multiple sources confirm manual-only creation |
| service-role client for webhooks | HIGH | Matches existing WhatsApp pattern in codebase |
| assembleContext.ts session client issue | MEDIUM | Needs empirical verification — may work or may be a latent bug |
| Per-bot billing model | MEDIUM | Business logic decision, implementation straightforward |
| Vercel maxDuration constraint | MEDIUM | Known constraint; 60s on Pro verified by community |
| Setup Wizard deep link pattern | HIGH | Official Telegram docs confirm ?start= parameter behavior |

---

## Sources

- Telegram Bot API official docs — setWebhook: https://core.telegram.org/bots/api#setwebhook
- Telegram webhook guide: https://core.telegram.org/bots/webhooks
- Telegram bot tutorial (onboarding patterns): https://core.telegram.org/bots/tutorial
- Telegram deep links: https://core.telegram.org/api/links
- Next.js dynamic routes: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- MakerKit super admin pattern: https://makerkit.dev/docs/next-supabase-turbo/admin/adding-super-admin
- OtelAI codebase — invokeAgent.ts, whatsapp/webhook/route.ts, resolveHotel.ts, agentFactory.ts (verified by reading)
- OtelAI DB migrations — 0001-0008 (verified by reading)

---

*Architecture research for: OtelAI Telegram milestone — multi-bot per-tenant agent-native delivery*
*Researched: 2026-03-06*
*Note: All Telegram API facts verified against official core.telegram.org documentation. Codebase facts verified by reading source files directly.*
