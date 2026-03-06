# Phase 12: Billing Model Migration and Trial-End Flow - Research

**Researched:** 2026-03-06
**Domain:** Per-employee billing pricing, Telegram cron notifications, multi-select inline keyboard, iyzico/Mollie payment link generation
**Confidence:** HIGH (codebase fully read; billing infrastructure from Phase 6 verified; Telegram Bot API patterns verified; payment APIs verified against official docs)

---

## Summary

Phase 12 replaces the tier-based billing model (Starter/Pro/Enterprise by agent count) with per-employee pricing where the monthly bill is the sum of prices for the owner's selected AI roles. The phase has three distinct sub-problems: (1) pricing model migration — redefining plan constants to price per role rather than per tier; (2) trial countdown notifications — sending Telegram messages at days 7, 12, 13, and 14 via Vercel cron; and (3) the trial-end selection flow — a Telegram inline keyboard where the owner selects which employees to keep, followed by a payment link with the correct total.

The critical infrastructure gap from Phase 11 is that the hotel owner's Telegram `chat_id` is never persisted to the database — the wizard only holds it in Redis during the onboarding session. Phase 12's cron-based notification system cannot send messages to owners unless their Telegram `chat_id` is stored in `hotels` or a new column. This must be addressed as the first plan in Phase 12.

Payment link generation for the trial-end flow differs from the subscription checkout flow built in Phase 6. The trial-end checkout does NOT create a recurring subscription automatically — instead it generates a one-time payment link (Mollie Payment Links API or iyzico Checkout Form with `paymentGroup: PRODUCT`) that the owner opens in a browser. The subscription is activated after payment confirmation via webhook, using the same webhook handlers already built in Phase 6.

**Primary recommendation:** Add `owner_telegram_chat_id BIGINT` to the `hotels` table (in a new migration `0011_billing_v2.sql`). Write this value in `completeWizard()` when Phase 11 already has `chatId` in scope. Then run a daily Vercel cron that queries all trialing hotels, computes days elapsed since `trial_ends_at`, and sends a Telegram message at days 7, 12, 13, and 14 remaining using the stored `owner_telegram_chat_id` — decrypting the front desk bot token from Vault to send from a known bot.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PRIC-01 | Per-employee pricing — each agent role has its own monthly price | Replace `PLAN_LIMITS`/`PLAN_PRICES` constants in `plans.ts` with `EMPLOYEE_PRICES` record keyed by role; subscription amount = sum of selected roles |
| PRIC-02 | 14-day trial with all employees active | Already implemented: `seed_hotel_defaults` trigger inserts `trial_ends_at = NOW() + INTERVAL '14 days'` at hotel creation; enforcement via `enforceAgentLimit()`; no changes needed |
| PRIC-03 | Trial-end notification via Telegram with employee selection prompt | Requires: (a) `owner_telegram_chat_id` in `hotels`, (b) Vercel cron at `0 6 * * *` querying trialing hotels at days 7/12/13/14 remaining, (c) `sendTelegramReply` for countdown messages, (d) multi-select inline keyboard at day-14 (trial end) |
| PRIC-04 | Selected employees' prices sum to monthly subscription amount | Store selection in Redis (key `trial_selection:{hotelId}`); compute total as `sum(EMPLOYEE_PRICES[role])` for selected roles; pass total to payment link generation |
| PRIC-05 | Payment via existing iyzico (TR) / Mollie (EU) web checkout link | Mollie: Payment Links API (`POST /v2/payment-links`) returns `_links.checkoutUrl`; iyzico: Checkout Form initialize with custom `paidPrice` returns `paymentPageUrl`; owner receives link as Telegram message |
</phase_requirements>

---

## Standard Stack

### Core (already installed — no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@upstash/redis` | ^1.36.3 | Trial selection state persistence in Redis | Already installed (Phase 11); TTL-based expiry; same pattern as wizard state |
| `iyzipay` | ^2.0.65 | iyzico Checkout Form initialization for TR market | Already installed (Phase 6) |
| `@mollie/api-client` | ^4.4.0 | Mollie Payment Links API for EU market | Already installed (Phase 6) — note: project uses `@mollie/api-client`, NOT `mollie-api-typescript` despite Phase 6 research recommending the latter |

### Supporting (already installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@upstash/ratelimit` | ^2.0.8 | Rate limiting (not needed for cron but already present) | N/A for this phase |
| Node `crypto` (built-in) | built-in | HMAC signature validation (existing webhook handlers) | N/A for this phase |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Redis for trial selection state | Supabase column (`selected_roles JSONB`) | Redis expires automatically; Supabase column persists and requires explicit cleanup. Redis is correct here — selection state is transient (only needed until payment) |
| Vercel cron for trial notifications | pg_cron or external cron service | Vercel cron is already used in this project (milestone-dispatch, housekeeping-queue); consistent pattern; zero extra service |
| Mollie Payment Links API for one-time payment | Creating a Mollie Payment + redirecting to `_links.checkout.href` | Payment Links API is designed for this exact use case — generates a shareable URL; simpler than creating a payment object and threading its checkout URL |
| iyzico Checkout Form (`paymentPageUrl`) | iyzico subscription checkout form | Subscription form creates a recurring plan; one-time checkout form generates a `paymentPageUrl` for a single charge; correct choice for trial conversion |

**Installation:** No new packages required. All dependencies already present from Phases 6 and 11.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   ├── billing/
│   │   ├── plans.ts                        # EXTEND: add EMPLOYEE_PRICES per role
│   │   ├── trialSelection.ts               # NEW: Redis CRUD for owner's employee selection
│   │   ├── trialNotification.ts            # NEW: sendTrialNotification(), buildSelectionKeyboard()
│   │   ├── paymentLink.ts                  # NEW: generateMolliePaymentLink(), generateIyzicoPaymentUrl()
│   │   ├── iyzico.ts                       # EXISTING — extend with checkout form init
│   │   ├── mollie.ts                       # EXISTING — extend with payment link creation
│   │   └── enforcement.ts                  # EXISTING — update to check selected_roles not agent count
├── app/
│   └── api/
│       ├── cron/
│       │   └── trial-notification/
│       │       └── route.ts                # NEW: cron handler for trial countdown + day-14 flow
│       └── telegram/
│           └── wizard/
│               └── route.ts                # NO CHANGE — wizard handler already exists
└── supabase/
    └── migrations/
        └── 0011_billing_v2.sql             # NEW: owner_telegram_chat_id column + trial_notification_sent columns
```

### Pattern 1: Database Schema Extension (migration 0011)

**What:** Add `owner_telegram_chat_id BIGINT` to `hotels`, and add notification tracking columns to `subscriptions` to prevent duplicate sends.

**When to use:** Always — without `owner_telegram_chat_id` no notification can be sent; without tracking columns the cron will re-notify every day.

```sql
-- Migration: 0011_billing_v2
-- Phase 12: Billing Model Migration and Trial-End Flow
-- Adds owner Telegram chat ID storage and trial notification tracking.

-- Store the hotel owner's Telegram chat ID for trial notifications.
-- Written by completeWizard() on wizard completion (Phase 11 already has chatId in scope).
-- NULL for hotels that completed onboarding before Phase 12 (graceful degradation).
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS owner_telegram_chat_id BIGINT;

-- Track which trial countdown notifications have already been sent.
-- Prevents duplicate sends when cron runs daily.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_notified_day7  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_notified_day12 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_notified_day13 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_notified_day14 BOOLEAN NOT NULL DEFAULT FALSE;
```

**Critical note:** `owner_telegram_chat_id` is a `BIGINT` because Telegram chat IDs for private chats are large integers that exceed JavaScript's `Number.MAX_SAFE_INTEGER` in some cases (though in practice most user IDs are < 2^53). Use `BIGINT` in SQL and `string` or `number` in TypeScript — prefer `number` since Telegram sends them as JSON numbers and all current user IDs fit in 53-bit precision.

### Pattern 2: Persist Owner Chat ID in completeWizard()

**What:** Modify `src/lib/telegram/wizard/wizardActions.ts` `completeWizard()` to write `owner_telegram_chat_id` to the `hotels` table. The function already has `chatId: number` in scope.

**When to use:** Only one change needed — insert this DB write alongside the existing `onboarding_completed_at` update.

```typescript
// Source: codebase — src/lib/telegram/wizard/wizardActions.ts (extension)
// Add alongside existing onboarding_completed_at update:

const { error: chatIdError } = await supabase
  .from('hotels')
  .update({
    onboarding_completed_at: new Date().toISOString(),
    owner_telegram_chat_id: chatId,
  })
  .eq('id', state.hotelId);

if (chatIdError) {
  console.error('[completeWizard] Failed to update owner_telegram_chat_id:', chatIdError);
}
```

### Pattern 3: Per-Employee Pricing Constants

**What:** Replace the tier-based `PLAN_PRICES` with per-role prices. The `PLAN_LIMITS` / `PLAN_NAMES` system becomes secondary — billing now tracks which roles are selected, not which tier.

**When to use:** Replace the constants in `plans.ts`; keep backward-compatible constants for the existing web billing dashboard (which may still reference `PLAN_LIMITS`).

```typescript
// src/lib/billing/plans.ts (extension)

// Per-employee monthly prices — Phase 12 pricing model
// These replace the tier-based PLAN_PRICES for v2.0 Telegram-first billing.
export const EMPLOYEE_ROLE_PRICES: Record<string, { try: number; eur: number; displayName: string }> = {
  front_desk:                { try: 149, eur: 15, displayName: 'Front Desk AI' },
  booking_ai:                { try: 149, eur: 15, displayName: 'Booking AI' },
  guest_experience:          { try: 99,  eur: 10, displayName: 'Guest Experience AI' },
  housekeeping_coordinator:  { try: 99,  eur: 10, displayName: 'Housekeeping Coordinator' },
};

// All four roles that can be selected
export const ALL_EMPLOYEE_ROLES = Object.keys(EMPLOYEE_ROLE_PRICES) as Array<keyof typeof EMPLOYEE_ROLE_PRICES>;

// Compute total monthly price for a set of selected roles
export function computeMonthlyTotal(
  selectedRoles: string[],
  currency: 'try' | 'eur',
): number {
  return selectedRoles.reduce((sum, role) => {
    const price = EMPLOYEE_ROLE_PRICES[role];
    return sum + (price ? price[currency] : 0);
  }, 0);
}
```

**Note on actual prices:** The prices above are illustrative. The planner should ask the user to confirm the actual per-employee monthly prices before implementing. The prices used in the code must match what is configured in the iyzico/Mollie dashboards for the first real payment.

### Pattern 4: Trial Selection State (Redis)

**What:** Store the owner's employee selection state during the day-14 inline keyboard interaction in Redis with a short TTL. Uses the same `@upstash/redis` client already initialized in `wizardState.ts`.

**When to use:** When the owner clicks employee toggle buttons on the day-14 notification keyboard.

```typescript
// Source: pattern derived from wizardState.ts (Phase 11) — same Redis client, same TTL pattern
// src/lib/billing/trialSelection.ts

import { Redis } from '@upstash/redis';

let _redis: Redis | null | undefined = undefined;

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { _redis = null; return null; }
  _redis = new Redis({ url, token });
  return _redis;
}

const SELECTION_KEY_PREFIX = 'trial_selection:';
const SELECTION_TTL_SECONDS = 3600 * 48; // 48 hours — selection persists until payment or expiry

export interface TrialSelectionState {
  hotelId: string;
  selectedRoles: string[]; // e.g. ['front_desk', 'booking_ai']
  messageId?: number;      // Telegram message ID of the selection keyboard — for editMessageReplyMarkup
}

export async function getTrialSelection(hotelId: string): Promise<TrialSelectionState | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get<TrialSelectionState>(`${SELECTION_KEY_PREFIX}${hotelId}`);
  } catch (error) {
    console.error('[trialSelection] get error:', error);
    return null;
  }
}

export async function setTrialSelection(hotelId: string, state: TrialSelectionState): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`${SELECTION_KEY_PREFIX}${hotelId}`, state, { ex: SELECTION_TTL_SECONDS });
  } catch (error) {
    console.error('[trialSelection] set error:', error);
  }
}

export async function clearTrialSelection(hotelId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(`${SELECTION_KEY_PREFIX}${hotelId}`);
  } catch (error) {
    console.error('[trialSelection] clear error:', error);
  }
}
```

### Pattern 5: Multi-Select Inline Keyboard with editMessageReplyMarkup

**What:** The day-14 notification sends an inline keyboard showing all four employee roles. Each button shows the role name and price. The owner toggles selections by tapping buttons — the bot updates the keyboard with checkmarks via `editMessageReplyMarkup`. A "Confirm Selection" button at the bottom triggers payment link generation.

**Callback data format:** `trial_toggle:{hotelId}:{role}` for toggle buttons; `trial_confirm:{hotelId}` for the confirm button.

**When to use:** Only for the day-14 trial-end notification. Earlier countdown messages (days 7, 12, 13) are plain text — no inline keyboard.

```typescript
// Source: Telegram Bot API — editMessageReplyMarkup + callback_query pattern
// src/lib/billing/trialNotification.ts

import { EMPLOYEE_ROLE_PRICES } from './plans';
import type { SupabaseClient } from '@supabase/supabase-js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Build inline keyboard for employee selection.
// selected: array of currently selected role strings.
function buildSelectionKeyboard(
  hotelId: string,
  selected: string[],
  currency: 'try' | 'eur',
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const roleRows = Object.entries(EMPLOYEE_ROLE_PRICES).map(([role, info]) => {
    const isSelected = selected.includes(role);
    const price = currency === 'try' ? `₺${info.try}` : `€${info.eur}`;
    const checkmark = isSelected ? '✅ ' : '';
    return [{
      text: `${checkmark}${info.displayName} — ${price}/mo`,
      callback_data: `trial_toggle:${hotelId}:${role}`,
    }];
  });

  const total = selected.reduce((sum, role) => {
    const p = EMPLOYEE_ROLE_PRICES[role];
    return sum + (p ? (currency === 'try' ? p.try : p.eur) : 0);
  }, 0);

  const currencySymbol = currency === 'try' ? '₺' : '€';
  const confirmText = selected.length > 0
    ? `Confirm (${currencySymbol}${total}/mo) →`
    : 'Select at least one employee';

  return {
    inline_keyboard: [
      ...roleRows,
      [{
        text: confirmText,
        callback_data: selected.length > 0 ? `trial_confirm:${hotelId}` : `trial_noop:${hotelId}`,
      }],
    ],
  };
}

// Send the day-14 employee selection message.
// Returns the Telegram message_id for subsequent editMessageReplyMarkup calls.
export async function sendEmployeeSelectionMessage(params: {
  botToken: string;
  chatId: number;
  hotelId: string;
  currency: 'try' | 'eur';
}): Promise<number | null> {
  const allRoles = Object.keys(EMPLOYEE_ROLE_PRICES);
  const keyboard = buildSelectionKeyboard(params.hotelId, allRoles, params.currency);

  const url = `${TELEGRAM_API}${params.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: 'Your 14-day trial has ended. Select which AI employees to keep:',
        reply_markup: keyboard,
      }),
    });
    const json = await res.json() as { ok: boolean; result?: { message_id: number } };
    return json.ok ? (json.result?.message_id ?? null) : null;
  } catch (error) {
    console.error('[sendEmployeeSelectionMessage] error:', error);
    return null;
  }
}

// Update the keyboard in-place when the owner toggles a selection.
export async function editSelectionKeyboard(params: {
  botToken: string;
  chatId: number;
  messageId: number;
  hotelId: string;
  selectedRoles: string[];
  currency: 'try' | 'eur';
}): Promise<void> {
  const keyboard = buildSelectionKeyboard(params.hotelId, params.selectedRoles, params.currency);
  const url = `${TELEGRAM_API}${params.botToken}/editMessageReplyMarkup`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        message_id: params.messageId,
        reply_markup: keyboard,
      }),
    });
  } catch (error) {
    console.error('[editSelectionKeyboard] error:', error);
  }
}
```

### Pattern 6: Trial Countdown Cron

**What:** A daily Vercel cron at `0 6 * * *` queries all hotels in `trialing` status, computes days remaining until `trial_ends_at`, and sends countdown messages at days 7, 12, 13, and 14 remaining. Uses the `trial_notified_dayX` columns to prevent duplicate sends. At day 14 (trial end), sends the employee selection keyboard instead of a plain countdown message.

**When to use:** Add a new cron entry to `vercel.json` alongside the existing crons.

```typescript
// Source: Vercel cron pattern from /api/cron/milestone-dispatch/route.ts (Phase 5)
// src/app/api/cron/trial-notification/route.ts

import type { NextRequest } from 'next/server';
import { runTrialNotificationDispatch } from '@/lib/billing/trialNotification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const result = await runTrialNotificationDispatch();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cron/trial-notification] Fatal error:', message);
    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}
```

```json
// vercel.json — add this cron entry alongside existing ones:
{
  "crons": [
    { "path": "/api/cron/milestone-dispatch",   "schedule": "0 6 * * *" },
    { "path": "/api/cron/housekeeping-queue",   "schedule": "0 7 * * *" },
    { "path": "/api/cron/trial-notification",   "schedule": "0 8 * * *" }
  ]
}
```

**Bot selection for sending notifications:** The cron must send Telegram messages using a bot the hotel owner already knows. The correct bot is the **Front Desk bot** (`role = 'front_desk'`), because the owner is already in conversation with it. Query `hotel_bots` for each hotel to get the front desk bot's `vault_secret_id`, decrypt via `get_bot_token()` RPC, then send via `sendTelegramReply`.

```typescript
// Core dispatch logic — src/lib/billing/trialNotification.ts
// runTrialNotificationDispatch() pseudo-structure:

async function runTrialNotificationDispatch() {
  const supabase = createServiceClient() as unknown as SupabaseClient;

  // Fetch all hotels with active trials + owner_telegram_chat_id populated
  const { data: trialingHotels } = await supabase
    .from('subscriptions')
    .select(`
      hotel_id,
      trial_ends_at,
      trial_notified_day7,
      trial_notified_day12,
      trial_notified_day13,
      trial_notified_day14,
      hotels!inner(owner_telegram_chat_id, country)
    `)
    .eq('status', 'trialing')
    .not('hotels.owner_telegram_chat_id', 'is', null);

  for (const row of trialingHotels ?? []) {
    const trialEndsAt = new Date(row.trial_ends_at);
    const now = new Date();
    const daysRemaining = Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const chatId = row.hotels.owner_telegram_chat_id as number;
    const country = row.hotels.country as string | null;
    const currency = country?.toUpperCase() === 'TR' ? 'try' : 'eur';

    // Get front desk bot token for sending
    const { data: bot } = await supabase
      .from('hotel_bots')
      .select('vault_secret_id')
      .eq('hotel_id', row.hotel_id)
      .eq('role', 'front_desk')
      .maybeSingle();
    if (!bot) continue;

    const { data: token } = await supabase.rpc('get_bot_token', {
      p_vault_secret_id: bot.vault_secret_id,
    });
    if (!token) continue;

    // Send notification based on days remaining
    if (daysRemaining === 7 && !row.trial_notified_day7) {
      await sendCountdownMessage(token, chatId, 7);
      await supabase.from('subscriptions').update({ trial_notified_day7: true }).eq('hotel_id', row.hotel_id);
    } else if (daysRemaining === 2 && !row.trial_notified_day12) {
      // NOTE: day 12 means 2 days into trial (trial_ends_at - 12 days = trial day 2)
      // CLARIFICATION NEEDED: The spec says "days 7, 12, 13, and 14 of the trial"
      // This research interprets these as DAYS REMAINING: 7 days left, 2 days left, 1 day left, 0 days left
      // See Open Questions #1 below for clarification.
      await sendCountdownMessage(token, chatId, 12);
      await supabase.from('subscriptions').update({ trial_notified_day12: true }).eq('hotel_id', row.hotel_id);
    } else if (daysRemaining === 1 && !row.trial_notified_day13) {
      await sendCountdownMessage(token, chatId, 13);
      await supabase.from('subscriptions').update({ trial_notified_day13: true }).eq('hotel_id', row.hotel_id);
    } else if (daysRemaining <= 0 && !row.trial_notified_day14) {
      // Trial ended — send employee selection keyboard
      await sendEmployeeSelectionMessage({ botToken: token, chatId, hotelId: row.hotel_id, currency });
      await supabase.from('subscriptions').update({ trial_notified_day14: true }).eq('hotel_id', row.hotel_id);
    }
  }
}
```

### Pattern 7: Callback Handler for Employee Selection (inline keyboard toggling)

**What:** The trial-end inline keyboard sends `callback_query` updates to the **front desk bot**'s existing webhook handler at `/api/telegram/[slug]`. The existing handler at `src/app/api/telegram/[slug]/route.ts` currently discards `callback_query` updates (only processes `message.text`). The handler must be extended to route `callback_query` updates with `data.startsWith('trial_')` to a new `handleTrialCallback()` function.

**Critical design decision:** Do NOT modify the wizard webhook (`/api/telegram/wizard/route.ts`). The trial selection keyboard is sent via the front desk bot, so callback_query responses come back to the front desk bot's webhook endpoint.

```typescript
// Extension to /api/telegram/[slug]/route.ts
// Add callback_query handling alongside existing message.text handling:

const body = (await req.json()) as TelegramUpdate;
const message = body.message;
const callbackQuery = body.callback_query;

// Existing: message.text handling (unchanged)
const hasValidMessage = !!(message?.text && message?.chat?.id);
// New: trial callback handling
const hasValidCallback = !!(
  callbackQuery?.id &&
  callbackQuery?.data?.startsWith('trial_') &&
  callbackQuery?.message?.chat?.id
);

if (!hasValidMessage && !hasValidCallback) {
  return new Response('', { status: 200 });
}

after(async () => {
  try {
    // ... existing: decrypt bot token ...
    if (hasValidMessage && message) {
      // existing agent pipeline
    } else if (hasValidCallback && callbackQuery) {
      await handleTrialCallback(callbackQuery, botRow.hotel_id, plaintextToken);
    }
  } catch (error) { ... }
});
```

### Pattern 8: Payment Link Generation

**What:** After the owner confirms their selection, generate a web checkout URL (Mollie Payment Links API or iyzico Checkout Form) and send it as a Telegram message.

**For Mollie (EU hotels):**

```typescript
// Source: https://docs.mollie.com/reference/create-payment-link
// src/lib/billing/paymentLink.ts

import { createClient } from '@mollie/api-client';

export async function generateMolliePaymentLink(params: {
  totalEur: number;
  hotelId: string;
  selectedRoles: string[];
  redirectUrl: string;
  webhookUrl: string;
}): Promise<string | null> {
  const mollieClient = createClient({ apiKey: process.env.MOLLIE_API_KEY! });

  // POST /v2/payment-links
  const result = await mollieClient.paymentLinks.create({
    amount: { currency: 'EUR', value: params.totalEur.toFixed(2) },
    description: `OtelAI subscription — ${params.selectedRoles.join(', ')}`,
    redirectUrl: params.redirectUrl,
    webhookUrl: params.webhookUrl,
    metadata: { hotelId: params.hotelId, selectedRoles: params.selectedRoles.join(',') },
  });

  // _links.checkoutUrl is the URL to send to the owner
  return result._links?.checkoutUrl?.href ?? null;
}
```

**For iyzico (TR hotels):**

```typescript
// Source: https://docs.iyzico.com/en/payment-methods/checkoutform/cf-implementation/cf-initialize
// iyzico Checkout Form returns paymentPageUrl for a hosted payment page

export async function generateIyzicoPaymentUrl(params: {
  totalTry: number;
  hotelId: string;
  selectedRoles: string[];
  callbackUrl: string;
  buyer: {
    id: string; name: string; surname: string; email: string;
    identityNumber: string; // Turkish national ID — required
    gsmNumber: string;
    registrationAddress: string; city: string; country: string;
  };
}): Promise<string | null> {
  // Uses iyzipay.checkoutFormInitialize (not subscription form)
  // Returns result.paymentPageUrl — a hosted page URL suitable for sharing in Telegram
  // Implementation follows Phase 6 pattern (lib/billing/iyzico.ts)
  // New method: initPaymentCheckoutForm() using paymentGroup: 'PRODUCT'
  return null; // implemented in plan
}
```

**CRITICAL for iyzico:** The Checkout Form initialize requires buyer details including `identityNumber` (Turkish national ID). For the trial-end flow triggered via cron, the hotel owner's billing details may not be collected yet. Two options: (a) collect billing details in a separate wizard step at the time of trial-end selection, or (b) send the owner to the web dashboard billing page instead of generating the URL in Telegram. Option (b) is simpler and avoids collecting sensitive data via Telegram.

### Pattern 9: Bot Deactivation After Selection

**What:** Unselected employees' bots stop responding immediately after the owner confirms their selection. "Stop responding" means setting `hotel_bots.is_active = false` for unselected roles. The existing webhook handler already checks `botRow.is_active` and returns early if false (because `resolveBot` filters `.eq('is_active', true)`).

```typescript
// In handleTrialCallback() after payment link is sent:
const unselectedRoles = ALL_EMPLOYEE_ROLES.filter(
  (role) => !selectedRoles.includes(role)
);

await supabase
  .from('hotel_bots')
  .update({ is_active: false })
  .eq('hotel_id', hotelId)
  .in('role', unselectedRoles);
```

**Note:** Selected bots remain active (`is_active = true`) throughout — they never stopped. After payment is confirmed (via Mollie webhook), the `subscriptions` row transitions from `trialing` to `active`. The bots that were kept active continue uninterrupted.

### Anti-Patterns to Avoid

- **Don't send notifications from the wizard bot.** The wizard bot is for onboarding only. Send trial notifications from the front desk bot — the owner already has a conversation with it.
- **Don't try to send Telegram messages from a Vercel cron synchronously within the 60s function limit.** The cron's `maxDuration = 300` (Pro plan) gives 5 minutes — sufficient for a batch of hotels, but each `sendTelegramReply` call must not block indefinitely. Add per-hotel try/catch and move on.
- **Don't use Telegram Payments API.** This is explicitly out of scope per REQUIREMENTS.md: "Telegram Payments API — Mevcut iyzico+Mollie web ödeme yeterli; Telegram Payments recurring desteklemiyor."
- **Don't deactivate all bots at trial end before payment.** The requirement says "Unselected employees' bots stop responding immediately after selection; selected employees' bots continue uninterrupted after payment." Selected bots stay active through the payment period.
- **Don't use `editMessageReplyMarkup` when the keyboard hasn't changed.** Even if the Telegram API returns success, it wastes 200ms. Check the selected set before calling edit.
- **Don't confuse `callback_data` size.** Telegram allows 1–64 bytes in `callback_data`. The format `trial_toggle:{uuid}:{role}` is `14 + 36 + 1 + 25 = 76` bytes for the longest role name — this EXCEEDS 64 bytes. Use short role codes: `fd` for front_desk, `bk` for booking_ai, `ge` for guest_experience, `hk` for housekeeping_coordinator. Format: `trial_toggle:fd:{short_hotel_id}` — but hotel IDs are 36-char UUIDs so even `trial_toggle:fd:` + UUID = 51 bytes which fits. Verify: `trial_toggle:housekeeping_coordinator:{UUID}` = `14 + 26 + 1 + 36 = 77` — too long. Solution: use short role codes in callback_data and map back to full role names server-side.

```typescript
// callback_data role code mapping
const ROLE_SHORT_CODES: Record<string, string> = {
  front_desk: 'fd', booking_ai: 'bk',
  guest_experience: 'ge', housekeeping_coordinator: 'hk',
};
const SHORT_CODE_TO_ROLE: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_SHORT_CODES).map(([role, code]) => [code, role])
);
// callback_data: `trial_toggle:fd:{hotelId}` = 16 + 36 = 52 bytes — fits
// callback_data: `trial_confirm:{hotelId}` = 14 + 36 = 50 bytes — fits
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telegram message scheduling | Custom timer/queue for countdown sends | Vercel cron + DB tracking columns | Vercel cron already used for milestone-dispatch; tracking columns prevent double-sends |
| Multi-select checkbox state | Custom Telegram conversation flow for collecting selections | Inline keyboard + `editMessageReplyMarkup` + Redis | Industry-standard Telegram pattern; faster UX than typed responses |
| Payment URL generation | Custom payment redirect logic | Mollie Payment Links API / iyzico Checkout Form `paymentPageUrl` | Both APIs generate valid, expiring, secure checkout URLs; no custom redirect needed |
| Bot token retrieval in cron | Store bot tokens in env vars | Supabase Vault `get_bot_token()` RPC | Bot tokens already encrypted in Vault (Phase 9); same RPC used by webhook handler |

**Key insight:** The trial-end flow is an extension of existing patterns — the multi-select keyboard reuses the wizard's callback_query handling pattern, the payment link reuses the billing library, and the bot deactivation reuses the `hotel_bots.is_active` flag already checked by `resolveBot()`.

---

## Common Pitfalls

### Pitfall 1: No owner_telegram_chat_id for Pre-Phase-12 Hotels

**What goes wrong:** Cron queries trialing hotels but `owner_telegram_chat_id` is NULL for hotels that completed onboarding before Phase 12 was deployed (because Phase 11's `completeWizard()` didn't write this column).
**Why it happens:** The column is added by migration `0011_billing_v2.sql` but existing hotels' wizard sessions have already completed.
**How to avoid:** Filter cron query to `.not('hotels.owner_telegram_chat_id', 'is', null)`. Pre-Phase-12 hotels simply don't receive Telegram notifications — they can still subscribe via web dashboard.
**Warning signs:** Cron runs but no notifications sent; all hotels have NULL `owner_telegram_chat_id`.

### Pitfall 2: callback_data Exceeding 64-Byte Limit

**What goes wrong:** Telegram silently drops callback_query updates from buttons whose `callback_data` exceeds 64 bytes. The toggle buttons never fire.
**Why it happens:** `trial_toggle:housekeeping_coordinator:{36-char UUID}` = 77 bytes — 13 bytes over the limit.
**How to avoid:** Use 2-letter role codes (`fd`, `bk`, `ge`, `hk`) in callback_data. Map back to full role strings server-side.
**Warning signs:** Inline keyboard buttons appear but nothing happens when tapped; no callback_query updates reach the webhook.

### Pitfall 3: The Employee Selection Callback Reaches the Wizard Webhook, Not the Front Desk Webhook

**What goes wrong:** If the employee selection keyboard was sent from a different bot (e.g., the wizard bot), callback_query responses go back to that bot's webhook. The wizard webhook has no `handleTrialCallback` logic and ignores the update.
**Why it happens:** Telegram routes callback_query updates to the bot that sent the message with the keyboard.
**How to avoid:** ALWAYS send the trial selection keyboard using the front desk bot token. Do not use the wizard bot for trial flow messages.
**Warning signs:** answerCallbackQuery is never called; buttons stay in "loading" state.

### Pitfall 4: editMessageReplyMarkup Fails with "Message is not modified"

**What goes wrong:** Calling `editMessageReplyMarkup` with the same keyboard twice returns Telegram error 400 "Bad Request: message is not modified."
**Why it happens:** Telegram rejects edits that produce no visible change.
**How to avoid:** In `handleTrialCallback`, check if the toggled role is already in the same state before calling edit. This is defensive — the user pressing the same button twice causes this.
**Warning signs:** Occasional 400 errors in `editSelectionKeyboard` logs; these are harmless but noisy.

### Pitfall 5: Cron Sends Day-14 Notification Multiple Times

**What goes wrong:** The cron runs daily at 06:00 UTC. If `trial_ends_at` is noon UTC and the cron fires before the trial ends, `daysRemaining` might be 0 or 1 depending on rounding. The next day's cron run might also trigger day-14.
**Why it happens:** `Math.ceil()` on floating-point day differences can give ambiguous results near midnight.
**How to avoid:** Use the `trial_notified_day14` boolean column as the guard. Once it's `true`, never resend the day-14 notification regardless of days remaining. Also use `daysRemaining <= 0` (not `=== 0`) for the day-14 check to catch any delay where trial ended but cron hasn't run yet.
**Warning signs:** Owner receives two employee selection keyboards.

### Pitfall 6: Payment Webhook Not Updating subscriptions.status for New Per-Employee Model

**What goes wrong:** After the owner pays, the Mollie webhook fires and updates `subscriptions.status = 'active'` using the existing `provider_subscription_id` match. But for the trial-end flow using Payment Links (one-time, not subscription), there is no `subscriptionId` in the payment object — the webhook update logic silently skips the update.
**Why it happens:** Phase 6's Mollie webhook handler only updates status when `payment.subscriptionId` is present (recurring payment path). Payment Links use `payment.sequenceType === 'oneoff'` — this path has no subscription ID.
**How to avoid:** Extend the Mollie webhook handler to detect payment link payments via `payment.metadata.hotelId` and `payment.status === 'paid'`, then update `subscriptions` directly. Store `hotelId` in `metadata` when creating the payment link.
**Warning signs:** Mollie payment succeeds but hotel remains in `trialing` status; bots stop working because `enforceAgentLimit` still sees expired trial.

### Pitfall 7: iyzico Buyer Details Required for Checkout Form

**What goes wrong:** Generating an iyzico Checkout Form URL from the cron/Telegram flow fails because buyer details (name, address, `identityNumber`) are not available server-side during the trial-end selection.
**Why it happens:** iyzico Checkout Form requires a full buyer object including Turkish national ID (`identityNumber`). This data is not collected during the Telegram wizard.
**How to avoid:** For TR hotels, send a link to the web dashboard billing page instead of a direct iyzico checkout URL. The web dashboard billing flow (Phase 6) already has the iyzico customer data form. Example Telegram message: "Complete your payment at: {APP_URL}/billing" rather than generating a direct payment URL.
**Warning signs:** Checkout form initialization returns `errorCode: "10003"` (missing required fields).

---

## Code Examples

### Query Trialing Hotels for Cron Dispatch

```typescript
// Source: Supabase PostgREST join syntax — verified against codebase patterns
const { data: trialingHotels } = await (supabase as unknown as SupabaseClient)
  .from('subscriptions')
  .select(`
    hotel_id,
    trial_ends_at,
    trial_notified_day7,
    trial_notified_day12,
    trial_notified_day13,
    trial_notified_day14,
    hotels!inner(owner_telegram_chat_id, country)
  `)
  .eq('status', 'trialing')
  .not('hotels.owner_telegram_chat_id', 'is', null)
  .not('trial_ends_at', 'is', null);
```

### Decrypt Bot Token from Vault in Cron Context

```typescript
// Source: src/app/api/telegram/[slug]/route.ts — same Vault RPC pattern
const supabase = createServiceClient();
const { data: plaintextToken } = await (supabase as unknown as SupabaseClient).rpc(
  'get_bot_token',
  { p_vault_secret_id: bot.vault_secret_id },
);
```

### Send Plain Countdown Message (days 7, 12, 13)

```typescript
// Uses sendTelegramReply from lib/telegram/sendReply.ts
await sendTelegramReply({
  botToken: plaintextToken,
  chatId: ownerChatId,
  text: `Your OtelAI trial ends in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}. At trial end, you will choose which AI employees to keep.`,
});
```

### Mollie Payment Links API Call

```typescript
// Source: https://docs.mollie.com/reference/create-payment-link
// Uses @mollie/api-client (installed in project as @mollie/api-client 4.4.0)
import { createClient } from '@mollie/api-client';
const mollieClient = createClient({ apiKey: process.env.MOLLIE_API_KEY! });

const paymentLink = await mollieClient.paymentLinks.create({
  amount: { currency: 'EUR', value: '39.00' }, // computed from selected roles
  description: 'OtelAI monthly subscription',
  redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/billing?success=true`,
  webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mollie`,
  metadata: { hotelId, selectedRoles: selectedRoles.join(','), type: 'trial_conversion' },
});

const checkoutUrl = paymentLink._links.checkoutUrl.href;
```

### Mark Deactivated Bots After Selection

```typescript
// Deactivate unselected bots immediately after owner confirms selection
await (supabase as unknown as SupabaseClient)
  .from('hotel_bots')
  .update({ is_active: false })
  .eq('hotel_id', hotelId)
  .in('role', unselectedRoles);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tier-based billing (Starter/Pro/Enterprise) | Per-employee pricing — sum of selected roles | Phase 12 | Plans.ts constants change; enforcement logic changes from agent count to role set |
| Trial expires silently | Trial countdown notifications via Telegram | Phase 12 | Owner has 4 touchpoints (days 7, 12, 13, 14) before trial ends |
| Upgrade via web dashboard only | Trial conversion via Telegram inline keyboard | Phase 12 | Owner selects employees and gets payment link in Telegram |
| Web-based billing as primary flow | Telegram as primary billing touchpoint | Phase 12 | Web dashboard billing page remains (readonly/optional per Phase 13) |

**Deprecated/outdated after Phase 12:**
- `PLAN_PRICES` constants (Starter/Pro/Enterprise tier prices): replaced by `EMPLOYEE_ROLE_PRICES` per role
- `PLAN_LIMITS.maxAgents` enforcement: replaced by checking `hotel_bots.is_active` count for active bots

---

## Open Questions

1. **What are "days 7, 12, 13, and 14 of the trial" — days elapsed or days remaining?**
   - What we know: The spec says "Trial countdown notifications arrive in Telegram at days 7, 12, 13, and 14 of the trial."
   - What's unclear: "Days of the trial" could mean (a) when 7 days have elapsed (7 days remaining since trial is 14 days), or (b) notifications at days 7, 12, 13, and 14 remaining. Interpretation (a) means: notify on day 7 (half-way), day 12 (2 days left), day 13 (1 day left), day 14 (trial ends). Interpretation (b) matches exactly what "days remaining" would look like. Both give the same result.
   - Recommendation: Interpret as DAYS REMAINING: 7 remaining, 2 remaining, 1 remaining, 0 remaining (trial end). This is more user-friendly — notifications increase in frequency near the end.

2. **Which bot sends the trial notifications?**
   - What we know: The owner communicates with four employee bots. Any of them could send notifications. The wizard bot could also send them.
   - What's unclear: Should notifications come from all four bots, or just one? Which one is most recognizable to the owner?
   - Recommendation: Send from the **front desk bot** only — it is the primary bot and the owner is most likely to recognize it. Sending from all four would be spammy. Do NOT use the wizard bot — it's an onboarding tool, not an operational tool.

3. **What happens to hotels that were on the old tier-based billing (Phase 6 subscriptions)?**
   - What we know: Phase 6 built Starter/Pro/Enterprise tier billing via iyzico and Mollie subscriptions. Some hotels may be on these plans.
   - What's unclear: Do existing paid subscribers migrate to per-employee pricing? Or does per-employee pricing only apply to new trials?
   - Recommendation: Apply per-employee pricing only to new trials (hotels that go through the Telegram wizard, i.e., v2.0). Existing Phase 6 subscribers keep their tier-based plans. The `subscriptions.plan_name` CHECK constraint may need extending to support `null` or a new value like `'per_employee'` for the new model.

4. **iyzico trial-end payment URL: can it be generated without buyer details?**
   - What we know: iyzico Checkout Form requires full buyer details including Turkish national ID.
   - What's unclear: Whether the hotel owner's billing details are available server-side during the Telegram trial-end flow.
   - Recommendation: For iyzico (TR market), send a link to the web dashboard billing page (`/billing`) rather than a direct Checkout Form URL. The web dashboard collects the required billing details. For Mollie (EU market), Payment Links require no buyer details — generate the URL directly.

5. **Per-employee prices: what are the actual values?**
   - What we know: The research uses illustrative prices (Front Desk: ₺149/€15, etc.). These are not confirmed.
   - What's unclear: What are the actual monthly prices per employee role?
   - Recommendation: Confirm with the user before implementing. Prices must match what will be configured in iyzico and Mollie dashboards.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `/src/lib/telegram/wizard/wizardActions.ts` — `completeWizard()` has `chatId` in scope, never writes to DB
- Codebase: `/src/lib/telegram/wizard/wizardState.ts` — Redis CRUD pattern to replicate for `trialSelection.ts`
- Codebase: `/src/app/api/telegram/[slug]/route.ts` — webhook handler, `callback_query` not yet handled
- Codebase: `/src/lib/billing/plans.ts` — existing `PLAN_PRICES`, `PLAN_LIMITS`, `getProviderForHotel()`
- Codebase: `/src/lib/billing/trialStatus.ts` — `getSubscriptionStatus()` pattern
- Codebase: `/src/lib/billing/enforcement.ts` — `enforceAgentLimit()` pattern to update
- Codebase: `/src/lib/telegram/resolveBot.ts` — `.eq('is_active', true)` — confirms deactivation works
- Codebase: `/supabase/migrations/0006_billing.sql` — `subscriptions` table schema
- Codebase: `/supabase/migrations/0009_telegram.sql` — `hotel_bots` table, `get_bot_token()` RPC
- Codebase: `/vercel.json` — existing cron patterns
- `https://vercel.com/docs/cron-jobs/usage-and-pricing` — 100 cron jobs/project on Pro; per-minute minimum; UTC only
- `https://docs.mollie.com/reference/create-payment-link` — Payment Links API, `_links.checkoutUrl`, metadata support
- `https://docs.iyzico.com/en/payment-methods/checkoutform/cf-implementation/cf-initialize` — CF initialize, `paymentPageUrl` response field, buyer requirements including `identityNumber`

### Secondary (MEDIUM confidence)
- WebSearch: Telegram `callback_data` 64-byte limit (confirmed via multiple Bot API references; official docs URL truncated but constraint is well-documented)
- WebSearch: `editMessageReplyMarkup` for toggling inline keyboard checkmarks (multi-select pattern via Redis state — widely used community pattern)
- WebSearch: Mollie Payment Links API confirmed as one-time payment mechanism (official docs verified)

### Tertiary (LOW confidence)
- EMPLOYEE_ROLE_PRICES (illustrative prices): LOW — prices are hypothetical; must be confirmed with user before implementation
- Vercel cron firing time precision: MEDIUM — Pro plan gives per-minute precision; UTC timezone confirmed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all libraries already installed and in production use
- Database schema: HIGH — migration pattern identical to 0009_telegram.sql and 0006_billing.sql
- Trial notification cron: HIGH — identical pattern to milestone-dispatch cron (Phase 5)
- Multi-select keyboard: MEDIUM — pattern is well-documented in Telegram ecosystem; `editMessageReplyMarkup` confirmed functional; `callback_data` 64-byte limit confirmed
- Payment link generation: HIGH for Mollie (official docs verified); MEDIUM for iyzico (buyer details constraint confirmed, but exact workaround for Telegram context is a product decision)
- Bot token retrieval in cron: HIGH — same `get_bot_token()` RPC used by webhook handler

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable APIs; Telegram Bot API and Vercel cron rarely have breaking changes; Mollie/iyzico payment APIs stable)
