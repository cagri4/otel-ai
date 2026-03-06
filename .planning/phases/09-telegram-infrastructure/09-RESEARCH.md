# Phase 9: Telegram Infrastructure - Research

**Researched:** 2026-03-06
**Domain:** Telegram Bot API webhooks, Supabase Vault encryption, Next.js async background processing
**Confidence:** HIGH (all critical claims verified via official docs)

## Summary

Phase 9 adds Telegram as a messaging channel by registering one bot per hotel-role combination, receiving webhook updates, validating them with a secret token, invoking the existing `invokeAgent()` pipeline, and sending MarkdownV2-formatted replies. The implementation is structurally analogous to the existing WhatsApp webhook at `/api/whatsapp/webhook/route.ts` — the same guard/process/reply pipeline applies, with three important differences: dynamic per-bot routing (`/api/telegram/[botToken]`), secret-header validation instead of HMAC signature, and Supabase Vault for encrypted token storage instead of environment variables.

The most critical architectural decision is **how to return HTTP 200 before the agent completes**. Telegram resends the update if it does not receive a 2xx within approximately 30 seconds, causing duplicate AI replies. Next.js 15.1+ ships a stable `after()` API (imported from `next/server`) that schedules work after the response is sent — this is the correct tool for async agent invocation without blocking the response. The project is on Next.js `^16.1.6`, so `after()` is available and stable.

The second critical area is **Supabase Vault** for bot token encryption. The pattern is: store the token in `vault.secrets` on creation (getting back a UUID), store that UUID in the `hotel_bots` table, and retrieve the plaintext token server-side via a `SECURITY DEFINER` SQL function that queries `vault.decrypted_secrets`. This ensures plaintext tokens never appear in DB query logs or table rows.

**Primary recommendation:** Model the Telegram webhook handler after the WhatsApp webhook (`/api/whatsapp/webhook/route.ts`), use `after()` from `next/server` for async agent invocation, and use Supabase Vault with a `SECURITY DEFINER` SQL function for bot token retrieval.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next/server` `after()` | Stable since Next.js 15.1 (project uses 16.1.6) | Return 200 before async agent runs | Built-in to Next.js; no external dep needed; runs post-response within serverless lifetime |
| Supabase Vault | Built into all Supabase projects | Encrypt bot tokens at rest | Transparent Column Encryption via pgsodium; tokens never appear in DB dumps or query logs |
| Native `fetch` | Runtime built-in | Call Telegram `sendMessage` API | No Telegram SDK needed; just one POST to `https://api.telegram.org/bot{token}/sendMessage` |
| `createServiceClient()` | Existing (`@/lib/supabase/service`) | Bypass RLS for webhook context (no user session) | Established project pattern; already used by WhatsApp and widget routes |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sanitizeGuestInput()` | Existing (`@/lib/security/sanitizeGuestInput`) | Prompt injection protection | All guest messages before `invokeAgent()` |
| `checkHotelRateLimit()` | Existing (`@/lib/security/rateLimiter`) | Per-hotel rate limiting | Same as WhatsApp and widget routes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `fetch` for sendMessage | `node-telegram-bot-api` or `grammy` | SDK adds dep for what is a single POST; the Grammy pattern (shown in launchfa.st) uses a single-bot `Bot` instance, which doesn't fit the multi-bot-per-hotel model |
| `after()` from `next/server` | `waitUntil` from `@vercel/functions` | `after()` is the idiomatic Next.js API; `waitUntil` is the lower-level Vercel primitive. `after()` uses `waitUntil` internally. Prefer `after()` — no additional dep, same semantics. |
| Supabase Vault | Store plaintext token in `hotel_bots.bot_token` | Plaintext tokens appear in DB query logs (SELECT logs), backups, and replication streams. Vault keeps ciphertext everywhere except the `vault.decrypted_secrets` view at query time. |
| Per-bot dynamic URL `/api/telegram/[botToken]` | Single URL + botToken in body | Telegram's `setWebhook` URL is set once per bot; embedding the token in the path is the documented pattern for multi-bot servers. Route param acts as a second-factor routing key. |

**Installation (no new packages needed):**
```bash
# No new npm packages required for Phase 9.
# after() is from next/server (already installed).
# Supabase Vault is a SQL-side feature (no JS package).
# Telegram sendMessage uses native fetch.
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/api/telegram/
│   └── [botToken]/
│       └── route.ts          # Webhook handler — validates, returns 200, invokes agent async
├── lib/telegram/
│   ├── resolveBot.ts          # Looks up hotel_bots row by bot_token (decrypted via SQL fn)
│   ├── sendReply.ts           # Calls Telegram sendMessage API with MarkdownV2 formatting
│   └── escapeMarkdownV2.ts    # Escapes all 18 special chars required by MarkdownV2
supabase/migrations/
└── 0009_telegram.sql          # hotel_bots table + Vault SQL fn + escalations channel update
```

### Pattern 1: Dynamic Route Handler (`/api/telegram/[botToken]`)

**What:** A Next.js App Router dynamic route that receives all Telegram updates for all registered bots. The `botToken` path segment is used to look up which hotel/role this update is for.

**When to use:** Required for multi-bot architecture where each hotel employee has its own bot.

**Important Next.js 16 note:** In Next.js 15+, the `params` object in route handlers is a `Promise` and must be awaited.

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/route
// src/app/api/telegram/[botToken]/route.ts

import { after } from 'next/server';
import { validateWebhookSecret } from '@/lib/telegram/validateSecret';
import { resolveBot } from '@/lib/telegram/resolveBot';
import { invokeAgent } from '@/lib/agents/invokeAgent';
import { sendTelegramReply } from '@/lib/telegram/sendReply';
import { sanitizeGuestInput } from '@/lib/security/sanitizeGuestInput';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ botToken: string }> }
): Promise<Response> {
  // Step 1: Await params (Next.js 15+ — params is a Promise)
  const { botToken } = await params;

  // Step 2: Validate X-Telegram-Bot-Api-Secret-Token header
  const secretToken = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  const body = await req.json() as TelegramUpdate;

  const botRow = await resolveBot(botToken);
  if (!botRow) {
    // Unknown bot — return 200 to suppress Telegram retries, log and discard
    console.warn('[Telegram webhook] Unknown botToken in URL');
    return new Response('', { status: 200 });
  }

  if (!validateWebhookSecret(secretToken, botRow.webhook_secret)) {
    console.warn('[Telegram webhook] Invalid secret token');
    return new Response('Forbidden', { status: 403 });
  }

  // Step 3: Extract message fields
  const message = body.message;
  if (!message?.text || !message?.chat?.id) {
    return new Response('', { status: 200 }); // Non-text updates (stickers, etc.) — discard
  }

  const chatId = message.chat.id;
  const userText = sanitizeGuestInput(message.text);
  const conversationId = `tg_${botRow.hotel_id}_${chatId}`;

  // Step 4: Return 200 IMMEDIATELY — invoke agent async via after()
  // This prevents Telegram from retrying due to slow agent response
  after(async () => {
    try {
      const response = await invokeAgent({
        role: botRow.role,
        userMessage: userText,
        conversationId,
        hotelId: botRow.hotel_id,
        guestIdentifier: String(chatId),
      });

      await sendTelegramReply({
        botToken,
        chatId,
        text: response,
      });
    } catch (error) {
      console.error('[Telegram webhook] Agent/reply error:', error);
    }
  });

  return new Response('', { status: 200 });
}
```

### Pattern 2: Supabase Vault — Encrypted Bot Token Storage

**What:** Bot tokens are stored encrypted in `vault.secrets`. The `hotel_bots` table stores a `vault_secret_id` (UUID reference) instead of the plaintext token. A `SECURITY DEFINER` SQL function retrieves the plaintext token for use in webhook registration or `sendMessage` calls.

**Critical design:** The `hotel_bots.bot_token` column should NOT exist as plaintext. Instead, store the vault secret UUID and the bot_username (safe to store plaintext).

```sql
-- Source: https://supabase.com/docs/guides/database/vault
-- supabase/migrations/0009_telegram.sql

-- Store encrypted bot token, return UUID reference
-- Called server-side when hotel owner adds a bot
SELECT vault.create_secret(
  'actual_bot_token_here',           -- the plaintext token (encrypted at rest)
  'hotel_bot_token_hotel123_fd',     -- unique name: hotel_bot_token_{hotelId}_{role}
  'Telegram bot token for hotel front_desk'
) AS vault_id;
-- Returns a UUID to store in hotel_bots.vault_secret_id

-- SQL function to retrieve decrypted token (service_role only)
CREATE OR REPLACE FUNCTION get_bot_token(p_vault_secret_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  SELECT decrypted_secret
  INTO v_token
  FROM vault.decrypted_secrets
  WHERE id = p_vault_secret_id;
  RETURN v_token;
END;
$$;

-- Restrict to service_role only — never expose to anon or authenticated
REVOKE EXECUTE ON FUNCTION get_bot_token FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_bot_token TO service_role;
```

**TypeScript side — retrieving the token:**
```typescript
// Source: https://supabase.com/docs/guides/database/vault
// Called when registering a webhook or sending a message with a different bot token

const supabase = createServiceClient();
const { data, error } = await supabase
  .rpc('get_bot_token', { p_vault_secret_id: botRow.vault_secret_id });
const plainTextToken = data as string;
```

### Pattern 3: MarkdownV2 Escaping

**What:** Telegram's MarkdownV2 parse mode requires that 18 special characters be escaped with a backslash before every occurrence in plain text. Unescaped characters cause silent `sendMessage` failures (Telegram returns 400 but no error is surfaced to the user).

**The 18 characters that MUST be escaped in MarkdownV2 plain text:**
`_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`

```typescript
// Source: https://core.telegram.org/bots/api#markdownv2-style
// Verified by: https://github.com/telegraf/telegraf/issues/1242
// src/lib/telegram/escapeMarkdownV2.ts

/**
 * Escape all MarkdownV2 special characters in a plain text string.
 * Must be applied to ALL text that should render as plain text in Telegram.
 * Do NOT escape characters that are intentional MarkdownV2 formatting.
 */
export function escapeMarkdownV2(text: string): string {
  // All 18 special characters that Telegram MarkdownV2 requires escaped
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
```

**Sending with MarkdownV2:**
```typescript
// src/lib/telegram/sendReply.ts

export async function sendTelegramReply(params: {
  botToken: string;
  chatId: number;
  text: string;
}): Promise<void> {
  const escaped = escapeMarkdownV2(params.text);
  const url = `https://api.telegram.org/bot${params.botToken}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: escaped,
        parse_mode: 'MarkdownV2',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[sendTelegramReply] Telegram API error:', res.status, errBody);
      // Optionally retry with plain text (parse_mode omitted) on 400
    }
  } catch (error) {
    console.error('[sendTelegramReply] Network error:', error);
  }
}
```

### Pattern 4: `hotel_bots` Table Schema

```sql
-- supabase/migrations/0009_telegram.sql

CREATE TABLE public.hotel_bots (
  id               UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         UUID      NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  role             TEXT      NOT NULL,   -- AgentRole enum value: 'front_desk', 'booking_ai', etc.
  vault_secret_id  UUID      NOT NULL,   -- References vault.secrets.id (NOT a FK — vault is internal)
  bot_username     TEXT      NOT NULL,   -- e.g. "@OtelFrontDeskBot" (safe to store plaintext)
  webhook_secret   TEXT      NOT NULL,   -- Secret token for X-Telegram-Bot-Api-Secret-Token header
  is_active        BOOLEAN   NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, role)               -- One bot per hotel per role
);

-- Index: primary lookup — find bot by hotel_id + role
CREATE INDEX idx_hotel_bots_hotel_id ON public.hotel_bots(hotel_id);

-- RLS: hotel owners can manage their own bots
ALTER TABLE public.hotel_bots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can manage own bots"
  ON public.hotel_bots FOR ALL
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role manages webhook registration
CREATE POLICY "Service role can manage all bots"
  ON public.hotel_bots FOR ALL
  TO service_role
  WITH CHECK (true);
```

**Note on `vault_secret_id` FK:** Supabase Vault stores secrets in an internal schema. Do NOT add a `REFERENCES vault.secrets(id)` foreign key — the vault schema is managed by Supabase and direct FK references are not supported. Instead, store the UUID and manage lifecycle manually (delete vault secret when bot row is deleted, via a trigger or application code).

### Pattern 5: Telegram Webhook Registration

The webhook URL embeds the bot token in the path. The `secret_token` parameter is stored in `hotel_bots.webhook_secret` for validation on every incoming request.

```typescript
// Called once per bot during hotel onboarding or bot registration
// The botToken here is the PLAINTEXT token (decrypted via get_bot_token SQL fn)

async function registerTelegramWebhook(params: {
  plaintextBotToken: string;
  webhookSecret: string;
  appUrl: string;
}) {
  const webhookUrl = `${params.appUrl}/api/telegram/${params.plaintextBotToken}`;

  const res = await fetch(
    `https://api.telegram.org/bot${params.plaintextBotToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: params.webhookSecret,  // Stored in hotel_bots.webhook_secret
        drop_pending_updates: true,           // Discard backlog on registration
        allowed_updates: ['message'],         // Only receive text messages
      }),
    }
  );

  const result = await res.json();
  if (!result.ok) {
    throw new Error(`setWebhook failed: ${result.description}`);
  }
}
```

### Pattern 6: resolveBot — Lookup by URL botToken

Since the bot token in the URL IS the plaintext token, and the `hotel_bots` table does NOT store plaintext tokens, the lookup strategy needs care. Options:

**Option A (Recommended):** Store a hash of the bot token (SHA-256) in `hotel_bots.bot_token_hash` for URL routing. The URL uses the plaintext token, which is hashed on each request and compared. The Vault stores the original for `sendMessage` calls.

**Option B:** Store the bot token in the URL as a random webhook path slug (not the actual Telegram token). Generate a UUID or random string as the webhook path. Store this slug in `hotel_bots`. The actual bot token is retrieved from Vault when needed.

**Option B is preferred** because:
- The URL path never exposes the actual Telegram bot token
- Compromised URL logs don't leak bot credentials
- Matches the webhook_secret concept — the URL slug is just an opaque routing key
- Simpler: store `webhook_path_slug` (random UUID) in `hotel_bots`, use for routing

```typescript
// With Option B, the table has: webhook_path_slug TEXT UNIQUE NOT NULL
// The route becomes: /api/telegram/[slug]/route.ts
// resolveBot queries: WHERE webhook_path_slug = slug

// src/lib/telegram/resolveBot.ts
export async function resolveBot(slug: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('hotel_bots')
    .select('hotel_id, role, vault_secret_id, webhook_secret, is_active')
    .eq('webhook_path_slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  return data;
}
```

**Note:** This changes the requirement TGIF-01 slightly — the URL becomes `/api/telegram/[slug]` instead of `/api/telegram/[botToken]`. This is more secure. Recommend this approach.

### Anti-Patterns to Avoid

- **Awaiting `invokeAgent()` before returning 200:** Agent takes 3-30 seconds. Telegram's ~30s timeout will trigger retries, causing duplicate AI replies. Use `after()`.
- **Storing plaintext bot token in `hotel_bots` table:** It appears in DB query logs (`SELECT *` logs all columns). Use Vault.
- **Using `parse_mode: 'MarkdownV2'` without escaping:** Any unescaped `.`, `-`, `!`, etc. causes silent 400 from Telegram. Always escape.
- **Validating secret token after parsing heavy body:** Parse body once, validate early. Reject at the secret header check before any DB queries.
- **Embedding actual bot token in webhook URL path:** If access logs are compromised, attacker gets a working bot token. Use a random slug instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MarkdownV2 character escaping | Custom regex for specific chars | The 18-char regex: `/[_*[\]()~\`>#+\-=|{}.!]/g` | The full list includes non-obvious chars (`.`, `!`, `~`). Missing even one causes silent failures. |
| Bot token encryption | AES + custom key management | Supabase Vault (`vault.create_secret()`) | Key management is the hard part. Vault uses Supabase-managed keys you can't accidentally leak. |
| Async response after HTTP 200 | Manual Promise fire-and-forget | `after()` from `next/server` | Fire-and-forget without `after()` is unreliable in Vercel serverless — function may terminate before promise resolves. `after()` extends function lifetime. |
| Telegram update deduplication | Custom update_id tracking in Redis | Return 200 immediately + `after()` | If you always return 200 before the agent finishes, Telegram never retries. The deduplication problem disappears. |

**Key insight:** The "no Telegram retry storms" success criterion is solved entirely by the `after()` pattern — return 200 synchronously, process async. No deduplication logic needed.

---

## Common Pitfalls

### Pitfall 1: Telegram Retry Storms from Slow Handler

**What goes wrong:** Agent takes 5-30s. Telegram sends the same update repeatedly if it doesn't receive 2xx quickly. Result: multiple AI replies to one message.

**Why it happens:** `await invokeAgent()` blocks the route handler. Response returns after agent completes, exceeding Telegram's patience.

**How to avoid:** Use `after()` from `next/server`. Return `new Response('', { status: 200 })` synchronously. Agent runs in the post-response phase.

**Warning signs:** User reports receiving 2-3 identical replies in quick succession.

### Pitfall 2: Unescaped MarkdownV2 Characters Causing Silent Failures

**What goes wrong:** `sendMessage` returns HTTP 400 with `{"ok":false,"description":"Can't parse entities"}`. No reply is sent to the user. No visible error in the webhook handler (the reply was fire-and-forget).

**Why it happens:** Claude's responses naturally contain `.`, `-`, `!`, `(`, `)` etc. Even a price like "€120.00" has unescaped `.` which breaks MarkdownV2.

**How to avoid:** Always run `escapeMarkdownV2()` on the full response text before sending. Test with responses containing prices, lists, and punctuation.

**Warning signs:** Bot goes silent; checking `sendMessage` response body reveals 400 parse error.

### Pitfall 3: Plaintext Token in DB Query Logs

**What goes wrong:** `SELECT * FROM hotel_bots` logs include the plaintext bot token. DB audit logs, Supabase Studio query logs, and any monitoring tool captures the token.

**Why it happens:** Storing bot_token directly in the table column (even if the column "looks" secure).

**How to avoid:** Never store plaintext token in `hotel_bots`. Store `vault_secret_id` (UUID from `vault.create_secret()`). Retrieve via `SECURITY DEFINER` SQL function.

**Warning signs:** You can read a bot token by running `SELECT vault_secret_id FROM hotel_bots` — this is safe (just a UUID). If you can read a token by selecting directly from `hotel_bots`, you have a problem.

### Pitfall 4: Next.js Dynamic Params Not Awaited

**What goes wrong:** `TypeError: params.botToken is undefined` or similar at runtime.

**Why it happens:** In Next.js 15+, the second argument to route handlers has `params` as a `Promise`. Must be `await`ed.

**How to avoid:**
```typescript
// CORRECT
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;  // Must await

// WRONG (Next.js 14 style — breaks in 15+)
export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const { slug } = params;  // Missing await
```

### Pitfall 5: Missing `allowed_updates` in setWebhook

**What goes wrong:** The bot receives all update types (inline queries, callback queries, channel posts, etc.), most of which have no `message.text`. Handler must filter, but volume is higher.

**How to avoid:** Set `allowed_updates: ['message']` in `setWebhook` call. Optionally add `'text'` filtering.

### Pitfall 6: Escalation Channel Type Mismatch

**What goes wrong:** `detectAndInsertEscalation()` is called in `invokeAgent.ts` with channel auto-detected from conversationId prefix. The `escalations` table has `CHECK (channel IN ('whatsapp', 'widget'))`. A `tg_` prefixed conversationId would hit the fallback `'dashboard'` channel, but `'dashboard'` is not in the DB CHECK constraint either.

**How to avoid:**
1. Update the `escalations` table CHECK constraint to add `'telegram'`
2. Update `EscalationChannel` type in `database.ts` to add `'telegram'`
3. Update `invokeAgent.ts` escalation channel detection to handle `tg_` prefix

---

## Code Examples

Verified patterns from official sources:

### Telegram Update Payload Structure

```typescript
// Source: https://core.telegram.org/bots/api#update
// Minimal TypeScript types for Telegram webhook updates

interface TelegramUpdate {
  update_id: number;       // Monotonically increasing; use for dedup if needed
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;           // Only present for text messages
}

interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;              // 64-bit integer — use number (safe up to 2^53)
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  username?: string;
}
```

### Setting Webhook (with secret_token)

```typescript
// Source: https://core.telegram.org/bots/api#setwebhook

await fetch(`https://api.telegram.org/bot${plaintextToken}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `https://your-app.vercel.app/api/telegram/${webhookSlug}`,
    secret_token: webhookSecret,           // 1-256 chars: A-Z a-z 0-9 _ -
    drop_pending_updates: true,
    allowed_updates: ['message'],
  }),
});
```

### after() for Post-Response Processing

```typescript
// Source: https://nextjs.org/docs/app/api-reference/functions/after
// Stable since Next.js 15.1 — project uses 16.1.6

import { after } from 'next/server';

export async function POST(req: Request) {
  // ... validation ...

  after(async () => {
    // Runs AFTER response is sent to Telegram
    // Function lifetime is extended until this promise settles
    const response = await invokeAgent({ ... });
    await sendTelegramReply({ ... });
  });

  return new Response('', { status: 200 }); // Returned immediately
}
```

### Supabase Vault: Insert + Retrieve

```typescript
// Source: https://supabase.com/docs/guides/database/vault

// INSERT: When hotel owner registers a bot
const supabase = createServiceClient();

// 1. Store token in vault, get UUID back
const { data: vaultId } = await supabase
  .rpc('create_bot_token_secret', {
    p_token: plaintextBotToken,
    p_name: `hotel_bot_${hotelId}_${role}`,
  });
// vaultId is a UUID string

// 2. Store UUID in hotel_bots
await supabase.from('hotel_bots').insert({
  hotel_id: hotelId,
  role,
  vault_secret_id: vaultId,
  bot_username: botUsername,
  webhook_secret: webhookSecret,
  webhook_path_slug: crypto.randomUUID(),
});

// RETRIEVE: When sending a message
const { data: plaintextToken } = await supabase
  .rpc('get_bot_token', { p_vault_secret_id: botRow.vault_secret_id });
```

### Conversation ID Format

```
// Follows established project patterns:
// wa_{hotelId}_{guestPhone}    — WhatsApp
// widget_{hotelId}_{uuid}     — Web widget

// For Telegram:
tg_{hotelId}_{chatId}          // chatId is the Telegram chat.id (number, cast to string)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `waitUntil` from `@vercel/functions` for post-response work | `after()` from `next/server` | Next.js 15.1 (stable) | No extra dependency; same semantics; idiomatic Next.js |
| `params` as sync object in route handlers | `params` as `Promise` (must `await`) | Next.js 15 | Missed await = runtime undefined error |
| Markdown (legacy) for Telegram formatting | MarkdownV2 | Bot API v4.5 (2019) | Old Markdown is still supported but deprecated; MarkdownV2 is the current spec with stricter escaping |

**Deprecated/outdated:**
- `pgsodium` extension directly: Pending deprecation in Supabase; use Vault instead (Vault's internal implementation will migrate away from pgsodium transparently, with same interface)
- Grammy `webhookCallback` pattern: Works but ties handler to a single `Bot` instance — not suitable for multi-bot-per-hotel architecture

---

## Open Questions

1. **Vault FK lifecycle management**
   - What we know: Vault secret UUIDs cannot be referenced via a PostgreSQL FK to `vault.secrets`. If a `hotel_bots` row is deleted, the corresponding vault secret must be deleted manually.
   - What's unclear: Does the `ON DELETE CASCADE` on `hotel_bots.hotel_id → hotels.id` need to trigger vault cleanup? If so, we need a database trigger or application-level cleanup.
   - Recommendation: Write a `SECURITY DEFINER` trigger on `hotel_bots AFTER DELETE` that calls `vault.delete_secret(OLD.vault_secret_id)`. Verify if `vault.delete_secret()` exists in the Supabase Vault API during implementation.

2. **Webhook URL security: slug vs token in path**
   - What we know: TGIF-01 specifies `/api/telegram/[botToken]` but this exposes the live bot token in access logs.
   - What's unclear: Whether the requirement was written with a literal token or just a "per-bot routing key" in mind.
   - Recommendation: Implement as `/api/telegram/[slug]` with a random UUID slug. Describe this to the planner as a security improvement over the literal requirement.

3. **which AgentRole receives Telegram messages**
   - What we know: `hotel_bots` stores a `role` column. A hotel could have a Telegram bot for `front_desk`, another for `booking_ai`, etc.
   - What's unclear: Phase 9 success criteria say "any registered hotel bot" — no restriction on role. All existing AgentRole values are valid targets.
   - Recommendation: Allow any role. The `hotel_bots.role` field drives `invokeAgent({ role })`.

4. **Escalation channel for Telegram**
   - What we know: `escalations.channel` has a `CHECK (channel IN ('whatsapp', 'widget'))` constraint. Telegram conversations use `tg_` prefix.
   - What's unclear: Whether escalation detection should run for Telegram conversations.
   - Recommendation: Yes — add `'telegram'` to the CHECK constraint, the `EscalationChannel` type, and the `invokeAgent.ts` channel detection logic. This is a required migration change.

---

## Sources

### Primary (HIGH confidence)
- [Telegram Bot API — setWebhook](https://core.telegram.org/bots/api#setwebhook) — secret_token parameter, X-Telegram-Bot-Api-Secret-Token header behavior, allowed_updates
- [Telegram Bot API — MarkdownV2 Style](https://core.telegram.org/bots/api#markdownv2-style) — 18 special characters, escape rules
- [Next.js Docs — after()](https://nextjs.org/docs/app/api-reference/functions/after) — stable since 15.1, Route Handler usage, platform support
- [Supabase Docs — Vault](https://supabase.com/docs/guides/database/vault) — create_secret(), decrypted_secrets view, security model
- Existing codebase — WhatsApp webhook (`/src/app/api/whatsapp/webhook/route.ts`) as reference pattern
- Existing codebase — `invokeAgent.ts` — confirmed non-streaming path works for WhatsApp (no `onToken` callback)
- Existing codebase — `escalation.ts` — channel type constraint must be extended for Telegram

### Secondary (MEDIUM confidence)
- [Marvin's Marvellous Guide to All Things Webhook](https://core.telegram.org/bots/webhooks) — Telegram infrastructure requirements; retry behavior stated as ~30s timeout
- [telegraf/telegraf#1242](https://github.com/telegraf/telegraf/issues/1242) — Community-verified list of all 18 MarkdownV2 special characters
- [makerkit.dev — Supabase Vault](https://makerkit.dev/blog/tutorials/supabase-vault) — SECURITY DEFINER function pattern for per-row secret retrieval

### Tertiary (LOW confidence)
- Telegram retry count specifics: "reasonable amount of attempts" — no official count documented; behavior verified by community as multiple retries within ~24h window

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TGIF-01 | Telegram Bot API webhook handler (`/api/telegram/[botToken]`) — per-bot endpoint with dynamic routing | Pattern 1 (dynamic route handler) + Pattern 6 (resolveBot). Recommend using `[slug]` instead of `[botToken]` in URL for security; TGIF-01 intent is per-bot routing, achieved either way. |
| TGIF-02 | `X-Telegram-Bot-Api-Secret-Token` validation on every webhook request | Pattern 1 shows early validation. `hotel_bots.webhook_secret` stores the expected token. Validated via constant-time string comparison before any DB query. |
| TGIF-03 | Webhook handler returns 200 immediately — agent invocation runs async (no Telegram retry storms) | `after()` from `next/server` (stable since Next.js 15.1, available in project's 16.1.6). Pitfall 1 documents why this matters. |
| TGIF-04 | Bot tokens encrypted at rest via Supabase Vault | Pattern 2 (Vault SQL pattern). `vault.create_secret()` on insert, `get_bot_token()` SECURITY DEFINER function on read. `hotel_bots` stores `vault_secret_id` UUID, never plaintext. |
| TGIF-05 | `hotel_bots` table (hotel_id, role, bot_token, bot_username, is_active) with RLS | Pattern 4 (table schema). Modified: `bot_token` becomes `vault_secret_id` + `webhook_path_slug`. RLS policies provided. |
| EBOT-05 | Existing `invokeAgent()` pipeline handles Telegram channel (non-streaming) | `invokeAgent()` already supports non-streaming (no `onToken` callback) — WhatsApp uses this path. Telegram uses same path. Conversation ID prefix `tg_` added for channel detection. |
| EBOT-06 | MarkdownV2 formatted responses (Telegram-compatible output) | Pattern 3 (escapeMarkdownV2). All 18 special chars must be escaped. Applied to full agent response text before `sendMessage` call. |
</phase_requirements>

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `after()` verified in official Next.js docs; Vault verified in official Supabase docs; native fetch for Telegram verified via Telegram API docs
- Architecture: HIGH — patterns derived from existing codebase WhatsApp webhook (direct analogue) + verified official docs
- Pitfalls: HIGH — retry storm is documented Telegram behavior; MarkdownV2 escaping verified from official spec; Next.js params-as-Promise verified in official docs

**Research date:** 2026-03-06
**Valid until:** 2026-06-06 (stable APIs — `after()` is stable, Vault interface stable)
