# Phase 11: Setup Wizard Bot - Research

**Researched:** 2026-03-06
**Domain:** Telegram Bot API (separate bot, deep link intake, wizard state machine, DB persistence, bot activation)
**Confidence:** HIGH (Telegram Bot API verified via official docs; codebase patterns verified by reading all relevant source files)

## Summary

Phase 11 adds a dedicated Setup Wizard bot — a fifth Telegram bot, separate from the four employee bots provisioned in Phase 10. The hotel owner receives a deep link from the admin panel (`https://t.me/{SETUP_WIZARD_BOT_USERNAME}?start={hotelId}`) and taps it to begin a short conversational onboarding flow. The wizard collects hotel name, address, room count, and check-in/check-out times over at most five questions. On completion, all four employee bots are activated (their `hotel_bots.is_active` is already `true` from Phase 10 provisioning; "activation" here means the subscription trial clock starts and `onboarding_completed_at` is written) and the owner receives direct `t.me/...` links to each.

The wizard's state must survive drop-off: if the owner closes Telegram and returns hours later, the wizard must resume from exactly the step where they stopped. The existing `@upstash/redis` dependency is already installed and configured in the project, making it the correct store for wizard state — fast reads, TTL-based expiry, zero extra migration. Supabase is the write target for the collected data (`hotels`, `hotel_facts`, `subscriptions`). The wizard bot webhook handler shares the same `after()` + service client pattern established for the four employee bots in Phase 9.

The wizard bot is a standalone bot with its own BotFather token, its own `SETUP_WIZARD_BOT_TOKEN` env var, and a fixed (non-slug) webhook URL because it is a single global bot, not per-hotel. Unlike employee bots (which use `hotel_bots` table rows and slug-based routing), the wizard bot webhook route is a fixed path: `/api/telegram/wizard`. The wizard route must handle both `message` updates (text input) and `callback_query` updates (inline keyboard button presses used for confirmation steps).

**Primary recommendation:** Use a fixed `/api/telegram/wizard` webhook route with Upstash Redis for wizard state (keyed by `wizard:{chatId}`), write collected data to Supabase `hotels` and `hotel_facts` tables via service client on each step, and finalize by writing `onboarding_completed_at` to `hotels` and confirming subscription status. No new Supabase migration needed.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@upstash/redis` | `^1.36.3` (already installed) | Wizard session state keyed by `wizard:{chatId}` | Already in project for rate limiting; Redis TTL handles session expiry automatically; no migration needed |
| `@supabase/supabase-js` service client | `^2.98.0` (already installed) | Write hotel data collected by wizard (no user session available in webhook) | Same pattern as all other webhook handlers; service client bypasses RLS |
| Native `fetch` | Runtime built-in | Telegram Bot API calls: `sendMessage`, `answerCallbackQuery` | Same pattern as `sendTelegramReply` in Phase 9; no SDK needed |
| `crypto.randomUUID()` | Node.js built-in | Generate wizard state keys or session tokens if needed | Already used throughout project |
| `after()` from `next/server` | Next.js built-in | Extend serverless lifetime for Telegram `sendMessage` call after 200 response | Same pattern as Phase 9 employee bot webhook handler |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `escapeMarkdownV2` | Existing (`@/lib/telegram/escapeMarkdownV2`) | Escape bot reply text for Telegram MarkdownV2 format | Every outbound message from the wizard bot |
| `createServiceClient` | Existing (`@/lib/supabase/service`) | DB writes for hotel fields, hotel_facts, subscription check | Every wizard step that persists data |
| `sanitizeGuestInput` | Existing (`@/lib/security/sanitizeGuestInput`) | Sanitize owner text before storing | All freetext answers (hotel name, address) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Upstash Redis for wizard state | Supabase `wizard_sessions` table | Redis is zero-migration, has TTL, and is already installed. Supabase table would require a new migration and has no native TTL. Redis is correct here. |
| Fixed `/api/telegram/wizard` route | Slug-based routing like employee bots | Wizard bot is a single global bot; slug routing is for per-hotel multi-bot scenarios. A fixed route is simpler and correct. |
| Inline keyboard for confirmations | Text-only Q&A | Inline keyboards provide a better UX for yes/no confirmation steps (< 6 total questions). They require handling `callback_query` updates alongside `message` updates. |
| Writing data incrementally (per step) | Writing all data on final step | Incremental writes to `hotels` table mean partial progress survives even if the wizard session expires. Correct approach. |

**Installation (no new packages needed):**
```bash
# All required packages already installed.
# @upstash/redis and @upstash/ratelimit are already in package.json.
# The Redis client pattern already exists in src/lib/security/rateLimiter.ts.
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/
│   └── api/
│       └── telegram/
│           ├── [slug]/          # Existing employee bot webhook (Phase 9)
│           │   └── route.ts
│           └── wizard/          # NEW: Setup Wizard bot webhook (Phase 11)
│               └── route.ts
├── lib/
│   └── telegram/
│       ├── escapeMarkdownV2.ts  # Existing
│       ├── resolveBot.ts        # Existing
│       ├── sendReply.ts         # Existing (sendTelegramReply)
│       ├── types.ts             # Existing — extend with CallbackQuery type
│       └── wizard/              # NEW
│           ├── wizardState.ts   # Redis read/write for wizard session
│           ├── wizardSteps.ts   # Step definitions and transition logic
│           └── wizardActions.ts # DB write helpers (hotel update, hotel_facts insert)
supabase/
└── migrations/
    └── (no new migration needed for phase 11)
```

### Pattern 1: Wizard State in Upstash Redis

**What:** Each in-progress wizard session is a Redis key `wizard:{chatId}` storing a JSON object with the current step, collected data, and the `hotelId` extracted from the deep link payload.

**When to use:** On every inbound Telegram update to the wizard webhook.

**TTL:** 7 days (604800 seconds) — long enough for a slow owner; reset on each interaction so active sessions never expire mid-wizard.

```typescript
// Source: @upstash/redis official docs + existing rateLimiter.ts pattern
// src/lib/telegram/wizard/wizardState.ts

import { Redis } from '@upstash/redis';

const WIZARD_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type WizardStep =
  | 'collect_hotel_name'
  | 'collect_address'
  | 'collect_room_count'
  | 'collect_checkin_time'
  | 'collect_checkout_time'
  | 'confirm_complete';

export interface WizardState {
  hotelId: string;        // Extracted from /start payload
  step: WizardStep;       // Current wizard step
  hotelName?: string;     // Collected hotel name
  address?: string;       // Collected address
  roomCount?: number;     // Collected room count
  checkinTime?: string;   // e.g. "15:00"
  checkoutTime?: string;  // e.g. "11:00"
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function getWizardState(chatId: number): Promise<WizardState | null> {
  const redis = getRedis();
  if (!redis) return null;
  const key = `wizard:${chatId}`;
  const data = await redis.get<WizardState>(key);
  return data;
}

export async function setWizardState(chatId: number, state: WizardState): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const key = `wizard:${chatId}`;
  await redis.set(key, state, { ex: WIZARD_TTL_SECONDS });
}

export async function clearWizardState(chatId: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(`wizard:${chatId}`);
}
```

**Confidence:** HIGH — `@upstash/redis` is already installed and used. `Redis.set()` with `{ ex }` for TTL is verified in the official Upstash Redis docs.

### Pattern 2: Wizard Webhook Route — Fixed Path

**What:** A fixed route at `/api/telegram/wizard` handles all updates for the wizard bot. Unlike employee bots (slug-based routing), the wizard bot is a single global bot. The route validates the webhook secret from an env var, processes both `message` and `callback_query` updates, calls `after()` to handle async work, and returns 200 immediately.

**Critical difference from employee bots:** The wizard handler must process `callback_query` updates (from inline keyboard button presses) in addition to `message` updates. The `allowed_updates` for `setWebhook` must include both `['message', 'callback_query']`.

```typescript
// Source: Phase 9 /api/telegram/[slug]/route.ts pattern + Telegram API docs
// src/app/api/telegram/wizard/route.ts

import { after } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  // Step 1: Validate webhook secret
  const secretToken = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (secretToken !== process.env.SETUP_WIZARD_WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  // Step 2: Parse body — may contain message OR callback_query
  const body = await req.json();

  // Step 3: Extract update type
  const message = body.message;           // Text messages
  const callbackQuery = body.callback_query; // Inline keyboard presses

  // Step 4: Return 200 immediately, handle async via after()
  after(async () => {
    try {
      if (message?.text && message?.chat?.id) {
        await handleWizardMessage(message);
      } else if (callbackQuery?.id && callbackQuery?.data) {
        await handleWizardCallback(callbackQuery);
      }
    } catch (error) {
      console.error('[Wizard] Handler error:', error);
    }
  });

  return new Response('', { status: 200 });
}
```

### Pattern 3: Deep Link Intake — Extracting hotelId from /start

**What:** When the owner taps the deep link, Telegram sends a `message` update with `text = "/start {hotelId}"`. The handler extracts the payload, validates it as a valid UUID, and creates the initial wizard state in Redis.

**Verified:** UUID (36 chars with hyphens) is within the 64-char deep link payload limit. Hyphens are in the allowed character set (A-Z, a-z, 0-9, `_`, `-`).

```typescript
// Source: https://core.telegram.org/bots/features#deep-linking
// /start payload is delivered as message.text = "/start {payload}"

function extractStartPayload(text: string): string | null {
  const match = text.match(/^\/start\s+([A-Za-z0-9_-]{1,64})$/);
  return match ? match[1] : null;
}

async function handleWizardMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const text = message.text ?? '';
  const botToken = process.env.SETUP_WIZARD_BOT_TOKEN ?? '';

  // Check for /start with payload → new wizard session
  const startPayload = extractStartPayload(text);
  if (startPayload && isValidUUID(startPayload)) {
    // startPayload IS the hotelId
    const hotelId = startPayload;

    // Validate hotelId exists in DB before starting wizard
    const hotel = await fetchHotelById(hotelId);
    if (!hotel) {
      await sendWizardMessage(botToken, chatId,
        'Invalid setup link. Please contact your administrator.');
      return;
    }

    // Initialize wizard state
    await setWizardState(chatId, {
      hotelId,
      step: 'collect_hotel_name',
      hotelName: hotel.name !== 'My Hotel' ? hotel.name : undefined,
    });

    await sendWizardMessage(botToken, chatId,
      `Welcome! I am your OtelAI setup assistant.\n\nLet\'s start with your hotel name. What is the full name of your hotel?`);
    return;
  }

  // Check for existing wizard session (owner resuming after drop-off)
  const state = await getWizardState(chatId);
  if (!state) {
    await sendWizardMessage(botToken, chatId,
      'No active setup session. Please use the setup link provided by your administrator.');
    return;
  }

  // Advance wizard with the owner's answer
  await advanceWizard(chatId, state, text, botToken);
}
```

### Pattern 4: Wizard Step Transition Machine

**What:** A simple explicit state machine. Each step sends one question, stores the answer, and transitions to the next step. At most 5 questions (hotel name, address, room count, check-in time, check-out time) plus one confirmation. This satisfies ONBT-01's requirement of fewer than 6 questions.

**Step order:**
1. `collect_hotel_name` — free text
2. `collect_address` — free text
3. `collect_room_count` — numeric
4. `collect_checkin_time` — free text ("3 PM", "15:00", etc.)
5. `collect_checkout_time` — free text
6. `confirm_complete` — inline keyboard Yes/No

**Write to DB on each step:** Update `hotels` table incrementally so partial progress is persisted even if the session expires. The `hotels` table already has `name`, `address`, `city`, `country`, `contact_email` columns. The wizard updates these via service client.

```typescript
// Source: Codebase analysis — hotels table schema from 0001_foundation.sql + 0003_knowledge_base.sql
// src/lib/telegram/wizard/wizardSteps.ts

import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function advanceWizard(
  chatId: number,
  state: WizardState,
  userInput: string,
  botToken: string,
): Promise<void> {
  const supabase = createServiceClient();
  const sanitized = sanitizeGuestInput(userInput);

  switch (state.step) {
    case 'collect_hotel_name': {
      const newState: WizardState = { ...state, hotelName: sanitized, step: 'collect_address' };
      // Write name to DB immediately
      await (supabase as unknown as SupabaseClient)
        .from('hotels')
        .update({ name: sanitized })
        .eq('id', state.hotelId);
      await setWizardState(chatId, newState);
      await sendWizardMessage(botToken, chatId,
        `Great! What is your hotel address?`);
      break;
    }

    case 'collect_address': {
      const newState: WizardState = { ...state, address: sanitized, step: 'collect_room_count' };
      await (supabase as unknown as SupabaseClient)
        .from('hotels')
        .update({ address: sanitized })
        .eq('id', state.hotelId);
      await setWizardState(chatId, newState);
      await sendWizardMessage(botToken, chatId,
        `How many rooms does your hotel have?`);
      break;
    }

    case 'collect_room_count': {
      const roomCount = parseInt(sanitized, 10);
      if (isNaN(roomCount) || roomCount <= 0) {
        await sendWizardMessage(botToken, chatId,
          'Please enter a valid number of rooms (e.g. 20).');
        return; // Don't advance — stay on same step
      }
      const newState: WizardState = { ...state, roomCount, step: 'collect_checkin_time' };
      // Store room count as a hotel_fact
      await upsertHotelFact(supabase, state.hotelId, 'policy',
        `The hotel has ${roomCount} rooms.`);
      await setWizardState(chatId, newState);
      await sendWizardMessage(botToken, chatId,
        `What time is check-in? (e.g. 3 PM or 15:00)`);
      break;
    }

    case 'collect_checkin_time': {
      const newState: WizardState = { ...state, checkinTime: sanitized, step: 'collect_checkout_time' };
      await upsertHotelFact(supabase, state.hotelId, 'policy',
        `Check-in time is ${sanitized}.`);
      await setWizardState(chatId, newState);
      await sendWizardMessage(botToken, chatId,
        `What time is check-out? (e.g. 11 AM or 11:00)`);
      break;
    }

    case 'collect_checkout_time': {
      const newState: WizardState = { ...state, checkoutTime: sanitized, step: 'confirm_complete' };
      await upsertHotelFact(supabase, state.hotelId, 'policy',
        `Check-out time is ${sanitized}.`);
      await setWizardState(chatId, newState);
      // Send confirmation with inline keyboard
      await sendConfirmationMessage(botToken, chatId, state, sanitized);
      break;
    }
  }
}
```

### Pattern 5: Inline Keyboard for Confirmation Step

**What:** The final step shows a summary and uses an inline keyboard with "Yes, activate!" and "Edit" buttons.

**Telegram inline keyboard payload format:**
```json
{
  "inline_keyboard": [[
    {"text": "Yes, activate!", "callback_data": "wizard:confirm"},
    {"text": "Start over", "callback_data": "wizard:restart"}
  ]]
}
```

**`callback_data` limit:** 64 bytes. `"wizard:confirm"` (14 bytes) and `"wizard:restart"` (14 bytes) are well within limit.

**`answerCallbackQuery` requirement:** Telegram requires bots to call `answerCallbackQuery` within a few seconds of receiving a callback query, or the button shows a "loading" spinner. Call it first (with an empty text) to dismiss the spinner, then process the action.

```typescript
// Source: Telegram Bot API official docs (core.telegram.org/bots/api)
// src/lib/telegram/wizard/wizardActions.ts

async function handleWizardCallback(callbackQuery: TelegramCallbackQuery): Promise<void> {
  const botToken = process.env.SETUP_WIZARD_BOT_TOKEN ?? '';
  const chatId = callbackQuery.message?.chat.id;
  const callbackId = callbackQuery.id;
  const data = callbackQuery.data ?? '';

  if (!chatId) return;

  // MUST answer callback query first to dismiss loading spinner in Telegram client
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId }),
  });

  if (data === 'wizard:confirm') {
    const state = await getWizardState(chatId);
    if (!state || state.step !== 'confirm_complete') return;
    await completeWizard(chatId, state, botToken);
  } else if (data === 'wizard:restart') {
    const state = await getWizardState(chatId);
    if (!state) return;
    // Reset to first step, keep hotelId
    await setWizardState(chatId, { hotelId: state.hotelId, step: 'collect_hotel_name' });
    await sendWizardMessage(botToken, chatId,
      'No problem! Let\'s start again.\n\nWhat is the full name of your hotel?');
  }
}
```

### Pattern 6: Wizard Completion — Activate Bots and Start Trial

**What:** On confirmation, the wizard:
1. Writes `onboarding_completed_at = NOW()` to the `hotels` table
2. The subscription is already in `trialing` status with `trial_ends_at = NOW() + 14 days` (created by `seed_hotel_defaults` trigger at hotel creation time in Phase 10)
3. Fetches all four `hotel_bots` rows for the hotel and collects their `bot_username` values
4. Sends a completion message with direct `t.me/{bot_username}` links to each bot

**Critical insight:** The 14-day trial is ALREADY started at hotel creation (Phase 10's `seed_hotel_defaults` trigger inserts `status='trialing', trial_ends_at = NOW() + INTERVAL '14 days'`). The wizard does NOT need to create or modify the subscription row. ONBT-04's requirement that "the 14-day trial starts automatically on wizard completion" is interpreted as: the wizard completing marks onboarding as done, making the existing trial subscription visible and usable. No subscription modification is needed.

```typescript
// Source: Codebase analysis — seed_hotel_defaults in 0006_billing.sql creates subscription row
// src/lib/telegram/wizard/wizardActions.ts

async function completeWizard(chatId: number, state: WizardState, botToken: string): Promise<void> {
  const supabase = createServiceClient();

  // 1. Mark onboarding complete
  await (supabase as unknown as SupabaseClient)
    .from('hotels')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', state.hotelId);

  // 2. Fetch all four employee bot usernames
  const { data: bots } = await (supabase as unknown as SupabaseClient)
    .from('hotel_bots')
    .select('role, bot_username')
    .eq('hotel_id', state.hotelId)
    .eq('is_active', true);

  const botRows = (bots as { role: string; bot_username: string }[] | null) ?? [];

  // 3. Build bot links
  const roleLabels: Record<string, string> = {
    front_desk: 'Front Desk',
    booking_ai: 'Booking AI',
    guest_experience: 'Guest Experience',
    housekeeping_coordinator: 'Housekeeping',
  };

  const botLinks = botRows
    .map((b) => `• ${roleLabels[b.role] ?? b.role}: https://t.me/${b.bot_username}`)
    .join('\n');

  // 4. Send completion message with bot links
  const completionText = [
    'Setup complete! Your hotel AI team is ready.',
    '',
    'Your employee bots:',
    botLinks,
    '',
    'Your 14-day trial has started. Enjoy!',
  ].join('\n');

  await sendWizardMessage(botToken, chatId, completionText);

  // 5. Clean up wizard session
  await clearWizardState(chatId);
}
```

### Pattern 7: Sending Messages with Inline Keyboard

**What:** `sendMessage` with `reply_markup` for the confirmation step.

```typescript
// Source: https://core.telegram.org/bots/api#sendmessage
// https://core.telegram.org/bots/api#inlinekeyboardmarkup

async function sendWizardMessage(
  botToken: string,
  chatId: number,
  text: string,
  replyMarkup?: object,
): Promise<void> {
  const { escapeMarkdownV2 } = await import('@/lib/telegram/escapeMarkdownV2');
  const escaped = escapeMarkdownV2(text);

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: escaped,
    parse_mode: 'MarkdownV2',
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Fallback to plain text — same pattern as sendTelegramReply in Phase 9
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  }
}

// Usage for confirmation step:
const confirmMarkup = {
  inline_keyboard: [[
    { text: 'Yes, activate!', callback_data: 'wizard:confirm' },
    { text: 'Start over', callback_data: 'wizard:restart' },
  ]],
};
await sendWizardMessage(botToken, chatId, summaryText, confirmMarkup);
```

### Pattern 8: Webhook Registration for Wizard Bot

**What:** The wizard bot uses the same `setWebhook` call pattern as employee bots (Phase 9/10), but with a fixed URL (no slug) and `allowed_updates: ['message', 'callback_query']`.

**ENV vars needed:**
- `SETUP_WIZARD_BOT_TOKEN` — plaintext BotFather token for the wizard bot (stored directly in env, not in Vault, because there is only one wizard bot)
- `SETUP_WIZARD_WEBHOOK_SECRET` — random string for `X-Telegram-Bot-Api-Secret-Token` validation
- `SETUP_WIZARD_BOT_USERNAME` — already needed in Phase 10 for deep link generation

```typescript
// Source: https://core.telegram.org/bots/api#setwebhook
// Webhook registration script (run once during deployment or admin setup):

const res = await fetch(
  `https://api.telegram.org/bot${process.env.SETUP_WIZARD_BOT_TOKEN}/setWebhook`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${process.env.NEXT_PUBLIC_APP_URL}/api/telegram/wizard`,
      secret_token: process.env.SETUP_WIZARD_WEBHOOK_SECRET,
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query'], // Must include callback_query for inline buttons
    }),
  }
);
```

**Design note:** The wizard bot token is stored as an env var (not in Vault) because there is exactly one wizard bot. Vault is for per-hotel per-role tokens (variable number). A single wizard bot token is a fixed infrastructure secret, appropriate for env var storage.

### Pattern 9: Telegram Type Extensions for CallbackQuery

**What:** The existing `TelegramUpdate` type in `src/lib/telegram/types.ts` only covers `message`. The wizard route needs `callback_query`. Extend the existing type file.

```typescript
// Source: https://core.telegram.org/bots/api#callbackquery
// Extension to src/lib/telegram/types.ts

export interface TelegramCallbackQuery {
  id: string;                    // Unique ID — required for answerCallbackQuery
  from: TelegramUser;
  message?: TelegramMessage;     // Message the button was attached to (if from bot message)
  data?: string;                 // callback_data from the button pressed (up to 64 bytes)
}

// Extend TelegramUpdate to include callback_query:
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery; // Add this
}
```

### Anti-Patterns to Avoid

- **Using slug-based routing for the wizard bot:** Wizard is one global bot. Slug routing is for per-hotel bots. Use a fixed route.
- **Storing wizard state in Supabase:** Redis TTL handles expiry automatically; Supabase tables don't. Use Redis.
- **Collecting all data before writing to DB:** Write incrementally on each step so drop-off doesn't lose progress. The `hotels` table update can happen on every step.
- **Forgetting `answerCallbackQuery`:** Telegram's inline keyboard buttons show a "loading" spinner until the bot answers the callback. Not calling `answerCallbackQuery` degrades UX significantly. Always call it first, before processing the action.
- **Trying to restart the trial subscription:** The subscription row and `trial_ends_at` are created at hotel creation time by `seed_hotel_defaults`. Do NOT modify the subscription row. Write only `onboarding_completed_at` to mark wizard completion.
- **Assuming Redis is available:** Gracefully degrade if `UPSTASH_REDIS_REST_URL` is missing (same pattern as rateLimiter.ts). If Redis is unavailable, wizard state cannot be stored — the bot should respond with an error rather than silently failing.
- **Storing bot token in Vault for the wizard bot:** The wizard is a single infrastructure bot. Vault is for per-hotel per-role tokens. Use `SETUP_WIZARD_BOT_TOKEN` env var directly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wizard session persistence with TTL | Custom Supabase table + cron-based expiry | `@upstash/redis` with `{ ex: TTL }` | Already installed; native TTL; sub-millisecond reads; no migration |
| Telegram message escaping | Custom regex | Existing `escapeMarkdownV2.ts` | Already handles all MarkdownV2 special chars; tested by employee bots |
| Hotel data validation | Custom validators | Parse directly, send friendly error and re-ask | Wizard is conversational — rejection IS the UX pattern |
| Inline keyboard button routing | URL params or custom encoding | Short `callback_data` strings like `"wizard:confirm"` | 64-byte limit is generous for simple wizard actions |
| Trial subscription creation | Any code at all | Already exists — `seed_hotel_defaults` created it at hotel creation | Writing a new subscription row would conflict with the UNIQUE constraint on `hotel_id` |

**Key insight:** The wizard is a thin orchestration layer on top of infrastructure already built in Phases 1–10. The heavy lifting (agent system, subscription billing, bot routing) is done. The wizard just collects 5 data points, persists them, and sends a completion message.

---

## Common Pitfalls

### Pitfall 1: Callback Queries Require a Separate Update Handler

**What goes wrong:** The wizard route only handles `message` updates but the `confirm_complete` step uses an inline keyboard. When the owner presses "Yes, activate!", Telegram sends a `callback_query` update — which the handler silently ignores if it only checks `body.message`.

**Why it happens:** The existing employee bot handler (Phase 9) only processes `message` updates (`allowed_updates: ['message']`). The wizard must also register `callback_query` in `setWebhook` and process `body.callback_query`.

**How to avoid:**
1. Set `allowed_updates: ['message', 'callback_query']` when registering the wizard webhook.
2. In the route handler, check both `body.message` and `body.callback_query`.
3. Always call `answerCallbackQuery` before processing callback data.

**Warning signs:** Owner taps "Yes, activate!" — button spinner never clears; wizard does not complete.

### Pitfall 2: `/start` Followed by a Second Message Before State Is Initialized

**What goes wrong:** The owner taps the deep link and the bot sends "What is your hotel name?" but due to Telegram update ordering, a second `message` update (from a quick tap) arrives before the first is processed. The second update finds no wizard state and sends "No active session."

**Why it happens:** Telegram webhook updates arrive sequentially but serverless functions may process them in parallel if two arrive within the same invocation window.

**How to avoid:** Use `after()` for all processing. Set wizard state atomically at the start of `/start` handling. If state is being created (step = `collect_hotel_name`) and a text message arrives, treat it as the answer to the hotel name question.

**Warning signs:** Owner reports seeing "No active session" immediately after tapping the deep link.

### Pitfall 3: hotelId Deep Link Payload Not Validated Against DB

**What goes wrong:** A malformed or spoofed deep link contains a valid UUID format but no matching hotel. The wizard starts and tries to write to a non-existent hotel, causing Supabase errors.

**Why it happens:** The wizard only validates UUID format, not existence.

**How to avoid:** After extracting `startPayload`, query the `hotels` table via service client to verify the hotel exists before initializing wizard state. Return an error message if the hotel is not found.

**Warning signs:** Supabase errors in logs with "foreign key constraint violation" during hotel_facts insert.

### Pitfall 4: Trial Already Started — Do Not Modify Subscription

**What goes wrong:** Developer reads ONBT-04 ("14-day trial starts automatically on wizard completion") and writes code to INSERT or UPDATE the subscription row. This conflicts with the UNIQUE constraint on `subscriptions(hotel_id)` (row already exists from `seed_hotel_defaults`).

**Why it happens:** Misreading the requirement — the trial was already started at hotel creation in Phase 10. "Activation" means writing `onboarding_completed_at`, not creating a subscription.

**How to avoid:** Do NOT touch the `subscriptions` table in Phase 11. Write only `hotels.onboarding_completed_at`. The existing subscription row with `status='trialing'` is already correct.

**Warning signs:** Supabase UNIQUE constraint error: `duplicate key value violates unique constraint "subscriptions_hotel_id_key"`.

### Pitfall 5: Redis Unavailable Causes Silent Failure

**What goes wrong:** `getWizardState()` returns `null` when Redis is unavailable. The handler sees no state and sends "No active session" to a new owner who just tapped the deep link. The owner sees a broken experience with no explanation.

**Why it happens:** The graceful-degradation pattern in `rateLimiter.ts` returns `null` for Redis — which is correct for rate limiting (pass-through). For wizard state, `null` means "session lost".

**How to avoid:** In the wizard handler, distinguish between "Redis unavailable" and "no session found". If Redis is `null` (not configured), send an error: "Setup service is temporarily unavailable. Please try again later." If Redis returns `null` for a known chatId, it means the session expired or never existed.

**Warning signs:** All wizard interactions return "No active session" in production despite valid deep links.

### Pitfall 6: MarkdownV2 Escaping in Bot Links

**What goes wrong:** The completion message includes URLs like `https://t.me/HotelFrontDeskBot`. The `.` in `https://` and the `/` in the URL are special characters in MarkdownV2 that break parsing.

**Why it happens:** MarkdownV2 requires escaping of `.`, `-`, `(`, `)`, `_`, `*`, etc. URLs sent as plain text (not as hyperlinks) break if they contain these characters.

**How to avoid:** Pass URL strings through `escapeMarkdownV2()` before including in messages, OR use MarkdownV2 hyperlink syntax: `[Front Desk](https://t.me/Bot)` — the URL inside `()` is NOT escaped in hyperlink syntax. Use hyperlinks for bot links in the completion message.

**Warning signs:** Completion message sends a 400 error from Telegram; fallback plain-text message is sent instead.

---

## Code Examples

Verified patterns from official sources:

### Deep Link Payload Extraction

```typescript
// Source: https://core.telegram.org/bots/features#deep-linking
// "/start {payload}" — payload up to 64 chars, A-Z a-z 0-9 _ - allowed
// UUID is 36 chars with hyphens — valid within 64-char limit

function extractStartPayload(text: string): string | null {
  // Match "/start" followed by optional whitespace and the payload
  const match = text.match(/^\/start\s+([A-Za-z0-9_-]{1,64})$/);
  return match ? match[1] : null;
}
```

### answerCallbackQuery

```typescript
// Source: https://core.telegram.org/bots/api#answercallbackquery
// MUST be called within a few seconds of receiving callback_query
// or Telegram client shows infinite loading spinner on the button.

async function answerCallback(botToken: string, callbackQueryId: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      // text: optional notification text shown to user
      // show_alert: false (default) = notification, true = alert popup
    }),
  });
}
```

### Inline Keyboard Message

```typescript
// Source: https://core.telegram.org/bots/api#inlinekeyboardmarkup
// inline_keyboard is array of arrays (rows of buttons)
// callback_data max 64 bytes

const inlineKeyboard = {
  inline_keyboard: [[
    { text: 'Yes, activate!', callback_data: 'wizard:confirm' },
    { text: 'Start over',     callback_data: 'wizard:restart' },
  ]],
};

await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text: 'Your setup summary:\n\n...',
    reply_markup: inlineKeyboard,
  }),
});
```

### Upstash Redis State Read/Write

```typescript
// Source: @upstash/redis official API + existing rateLimiter.ts pattern
// redis.set() with { ex: seconds } sets TTL
// redis.get<T>() returns typed value or null

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Write with 7-day TTL
await redis.set('wizard:123456789', { hotelId: '...', step: 'collect_hotel_name' }, { ex: 604800 });

// Read (returns null if key doesn't exist or expired)
const state = await redis.get<WizardState>('wizard:123456789');

// Delete on completion
await redis.del('wizard:123456789');
```

### setWebhook for Wizard Bot (includes callback_query)

```typescript
// Source: https://core.telegram.org/bots/api#setwebhook
// Note: allowed_updates MUST include 'callback_query' for inline keyboard to work

await fetch(`https://api.telegram.org/bot${SETUP_WIZARD_BOT_TOKEN}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `${APP_URL}/api/telegram/wizard`,
    secret_token: SETUP_WIZARD_WEBHOOK_SECRET,
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query'], // Both required for wizard
  }),
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bot frameworks (Telegraf, grammy) for conversation state | Plain webhook + Redis state machine | N/A (project choice) | No framework dependency; full control; consistent with existing Phase 9 approach |
| Polling-based bot updates | Webhooks with `after()` | Next.js 14+ | Serverless compatible; no retry storms |
| Separate state machine library | Explicit switch/case on step enum | Project decision | Simpler; fewer dependencies; wizard has only 6 states |
| Inline keyboard for complex navigation | Inline keyboard for simple Yes/No only | Project decision | Reduces UX complexity; all data collection is freetext |

**Deprecated/outdated:**
- Bot frameworks (Telegraf, grammy): Valid for complex bots, but add dependencies the project avoids. The wizard is simple enough for a plain state machine.
- Long-polling (`getUpdates`): Incompatible with Vercel serverless. The project uses webhooks exclusively.

---

## Open Questions

1. **Wizard bot token storage — env var vs admin UI provisioning**
   - What we know: Employee bot tokens are provisioned via the admin panel into Vault. The wizard bot is a single global infrastructure bot.
   - What's unclear: Should the admin provision the wizard bot token via the existing admin UI (stored in Vault), or as an env var (`SETUP_WIZARD_BOT_TOKEN`)?
   - Recommendation: Env var. The wizard bot is infrastructure, not per-hotel. Vault is for per-hotel tokens. Add `SETUP_WIZARD_BOT_TOKEN` and `SETUP_WIZARD_WEBHOOK_SECRET` to `.env.local` and Vercel project settings.

2. **What if hotel has no provisioned bots at wizard completion?**
   - What we know: The wizard completes and tries to show bot links. If Phase 10 provisioning was never done, `hotel_bots` returns zero rows.
   - What's unclear: Should wizard completion gate on bots being provisioned, or proceed regardless?
   - Recommendation: Proceed regardless. Show links only for provisioned bots. If none, show a message: "Your administrator will activate your employee bots shortly." This decouples the wizard from bot provisioning timing.

3. **Resume behavior: does "/start {hotelId}" restart or resume?**
   - What we know: If the owner taps the deep link again mid-wizard, Telegram sends `/start {hotelId}` again.
   - What's unclear: Should a second `/start` restart the wizard or resume the existing session?
   - Recommendation: Resume if an active session exists (compare `state.hotelId === startPayload`). Restart only if no session exists or `hotelId` differs. Send a message: "You have an active setup session. Pick up where you left off: [current question]."

4. **Wizard bot webhook registration — manual script or admin UI step?**
   - What we know: Phase 10 added a bot provisioning form in the admin panel for employee bots. The wizard bot also needs `setWebhook` called.
   - What's unclear: Where is this one-time setup done?
   - Recommendation: Create a one-time admin API route `/api/admin/register-wizard-webhook` (POST, guarded by `SUPER_ADMIN_EMAIL`). The admin calls it once after deployment. Alternatively, call it on startup (e.g., in `next.config.ts` instrumentation hook). Registration at startup is simpler and idempotent.

---

## Sources

### Primary (HIGH confidence)

- [Telegram Bot API — Deep Linking](https://core.telegram.org/bots/features#deep-linking) — payload characters (A-Z a-z 0-9 _ -), 64-char max, UUID with hyphens valid, `/start {payload}` delivery mechanism
- [Telegram Bot API — setWebhook](https://core.telegram.org/bots/api#setwebhook) — `allowed_updates` including `callback_query`, `secret_token` parameter, HTTPS requirement
- [Telegram Bot API — answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery) — required for inline keyboard button acknowledgment
- [Telegram Bot API — InlineKeyboardMarkup](https://core.telegram.org/bots/api) — `callback_data` 64-byte limit (verified via multiple sources)
- Existing codebase — `src/app/api/telegram/[slug]/route.ts` — `after()` pattern, webhook secret validation, 200-always response
- Existing codebase — `src/lib/telegram/sendReply.ts` — MarkdownV2 + plaintext fallback pattern
- Existing codebase — `src/lib/security/rateLimiter.ts` — `@upstash/redis` initialization pattern, graceful degradation
- Existing codebase — `supabase/migrations/0006_billing.sql` — `seed_hotel_defaults` inserts subscription row at hotel creation; subscription is NOT created at wizard completion
- Existing codebase — `supabase/migrations/0003_knowledge_base.sql` — `onboarding_completed_at` column on `hotels`
- Existing codebase — `supabase/migrations/0009_telegram.sql` — `hotel_bots` schema with `is_active`, `bot_username`, `role`
- Existing codebase — `src/lib/telegram/escapeMarkdownV2.ts` — existing escaping utility for wizard messages
- Existing codebase — `src/types/database.ts` — `Hotel` type, `HotelBot` type, all column names

### Secondary (MEDIUM confidence)

- [WebSearch: Telegram bot state machine wizard patterns 2025] — FSM pattern with database persistence confirmed across multiple sources; Redis as preferred state store for serverless bots
- [WebSearch: callback_data 64-byte limit 2024] — Verified by multiple sources: "data to be sent in a callback query must be UTF-8 1-64 bytes"

### Tertiary (LOW confidence)

- `answerCallbackQuery` timing requirement: "Must be called within a few seconds" — documented behavior but exact timeout not stated in official docs. Standard practice across all Telegram bot implementations.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ONBT-01 | Setup Wizard as separate Telegram bot — activates via deep link | Pattern 2 (fixed `/api/telegram/wizard` route) + Pattern 3 (extractStartPayload from `/start {hotelId}`). Separate bot with own `SETUP_WIZARD_BOT_TOKEN`. Deep link format: `https://t.me/{SETUP_WIZARD_BOT_USERNAME}?start={hotelId}` (36-char UUID payload is within 64-char limit, hyphens allowed). |
| ONBT-02 | Conversational info collection (hotel name, address, rooms, check-in/out times) | Pattern 4 (5-step wizard state machine). State stored in Upstash Redis (`wizard:{chatId}`) with 7-day TTL. Each step writes incrementally to `hotels` table or `hotel_facts` via service client. Fewer than 6 questions total — satisfies "fewer than 6 questions" success criterion. |
| ONBT-03 | Team introduction — presents each employee bot with direct link | Pattern 6 (completeWizard). On confirmation, fetches `hotel_bots` rows for the hotel and builds `https://t.me/{bot_username}` links. Sends as MarkdownV2 hyperlinks to avoid escaping pitfall. |
| ONBT-04 | Setup completion activates all employee bots with 14-day trial | Pattern 6 (completeWizard). Writes `hotels.onboarding_completed_at = NOW()`. The 14-day trial subscription is already in place (created by `seed_hotel_defaults` at hotel creation in Phase 10). No subscription modification needed. Employee bots are already `is_active = true` from Phase 10 provisioning. |
</phase_requirements>

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@upstash/redis` and all other packages already installed; Telegram Bot API patterns verified via official docs and existing Phase 9 codebase
- Architecture: HIGH — patterns follow established project conventions (service client, `after()`, MarkdownV2 fallback, `(supabase as unknown as SupabaseClient)` cast)
- Pitfalls: HIGH — callback_query handling requirement verified via Telegram API; trial subscription existence verified by reading `0006_billing.sql`; Redis graceful degradation verified by reading existing `rateLimiter.ts`

**Research date:** 2026-03-06
**Valid until:** 2026-06-06 (Telegram Bot API and Upstash Redis are stable; core patterns are unlikely to change)
