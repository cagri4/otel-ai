# Phase 14: Fix Callback Query Delivery for Trial Selection - Research

**Researched:** 2026-03-06
**Domain:** Telegram Bot API webhook configuration, `allowed_updates` field, server-side webhook update, admin re-provision endpoint
**Confidence:** HIGH (all findings verified against codebase source code and official Telegram Bot API docs)

---

## Summary

Phase 14 is a surgical gap-closure phase. The entire trial selection → payment → deactivation flow (PRIC-03, PRIC-04, PRIC-05) was implemented correctly in Phase 12 and verified by the Phase 12 VERIFICATION.md — but it is unreachable at runtime because `provisionBots.ts` registers employee bot webhooks with `allowed_updates: ['message']`, omitting `'callback_query'`. Telegram silently drops any `callback_query` update (i.e., inline keyboard button taps) that arrives for a bot registered without `'callback_query'` in its `allowed_updates`. The handler code (`handleTrialCallback`), the route dispatch logic in `[slug]/route.ts`, and the Redis state machinery are all correct; only the Telegram-side webhook filter is wrong.

The fix has two parts: (1) change the `allowed_updates` array in `provisionBots.ts` from `['message']` to `['message', 'callback_query']` — one character change — so all new provisions are correct; and (2) re-provision existing bots that are already registered with the wrong filter. Re-provisioning existing bots requires calling Telegram's `setWebhook` again with the same URL and secret but updated `allowed_updates`. Crucially, Telegram's `setWebhook` is idempotent and accepts a call with just the `url` and new `allowed_updates` without needing the bot token to be re-stored in Vault — the token is already in Vault and can be decrypted via `get_bot_token` RPC.

The admin re-provision mechanism should follow the exact pattern of `register-wizard-webhook/route.ts`: a protected API route (SUPER_ADMIN_EMAIL guard), reads all `hotel_bots` rows, decrypts each token via `get_bot_token` RPC, and calls `setWebhook` with updated `allowed_updates`. No Vault writes, no `hotel_bots` row mutations — just a Telegram API call per bot.

**Primary recommendation:** One plan (14-01) — fix `provisionBots.ts` in one line, add `POST /api/admin/reprovision-employee-webhooks` admin route to update existing bots, call the route once to fix all live bots.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PRIC-03 | Trial-end notification via Telegram with employee selection prompt | The keyboard is already sent correctly; fix `allowed_updates` so button taps reach the server and `handleTrialCallback` is called |
| PRIC-04 | Selected employees' prices sum to monthly subscription amount | `calculateMonthlyTotal` and the confirm handler are correct; fix delivery gap so `handleConfirm` runs |
| PRIC-05 | Payment via existing iyzico (TR) / Mollie (EU) web checkout link | `handleConfirm` already generates the correct payment link; fix delivery gap so it is reached |
</phase_requirements>

---

## Standard Stack

### Core
| Library/API | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| Telegram Bot API `setWebhook` | — | Update webhook registration incl. `allowed_updates` | Only mechanism to register/update a Telegram bot webhook |
| `get_bot_token` RPC | — (existing Supabase function) | Decrypt bot token from Vault without re-storing | Already used by all webhook handlers in this project |
| `createServiceClient` | existing | Service-role Supabase client for admin operations | All admin server actions use this pattern |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `hotel_bots` table | Source of all active bot rows needing re-provision | Admin endpoint reads this to get vault_secret_id per bot |
| Supabase `SupabaseClient` cast pattern | Required for custom tables/RPCs not in generated types | Used in all server-side Supabase calls in this project |

### No New Libraries Required
Phase 14 introduces zero new npm dependencies. All machinery exists: Supabase service client, `get_bot_token` RPC, `hotel_bots` table, `setWebhook` via native `fetch`.

---

## Architecture Patterns

### Recommended Project Structure

No new directories needed. Changes land in:

```
src/
├── lib/admin/
│   └── provisionBots.ts        # Fix: allowed_updates: ['message', 'callback_query']
└── app/api/admin/
    └── reprovision-employee-webhooks/
        └── route.ts            # New: admin endpoint to update existing bots
```

### Pattern 1: Fixing `provisionBots.ts` (One-Line Change)

**What:** Change `allowed_updates: ['message']` to `allowed_updates: ['message', 'callback_query']` at line 111 of `provisionBots.ts`.

**When to use:** Every new bot provisioned via the admin panel will automatically get the correct filter.

**Current code (WRONG):**
```typescript
// src/lib/admin/provisionBots.ts line 108-113
body: JSON.stringify({
  url: webhookUrl,
  secret_token: webhookSecret,
  drop_pending_updates: true,
  allowed_updates: ['message'],   // <-- BUG: missing 'callback_query'
}),
```

**Fixed code:**
```typescript
body: JSON.stringify({
  url: webhookUrl,
  secret_token: webhookSecret,
  drop_pending_updates: true,
  allowed_updates: ['message', 'callback_query'],  // <-- FIXED
}),
```

**Source:** Confirmed from `src/lib/admin/provisionBots.ts` read during research. The wizard bot's `register-wizard-webhook/route.ts` already uses `['message', 'callback_query']` — this proves the correct value is known and used elsewhere in the project.

---

### Pattern 2: Admin Re-Provision Endpoint

**What:** A protected `POST` route that iterates all `hotel_bots` rows, decrypts each token via `get_bot_token` RPC, and calls `setWebhook` with updated `allowed_updates`. No Vault writes. No `hotel_bots` row updates. Pure Telegram API call.

**When to use:** Called once by the super admin after deploying the `provisionBots.ts` fix, to update all already-provisioned bots.

**Auth pattern:** Identical to `register-wizard-webhook/route.ts` — check session via `createClient()`, verify `user.email === process.env.SUPER_ADMIN_EMAIL`.

**Re-provision logic (no new Vault writes needed):**
```typescript
// Source: pattern from register-wizard-webhook/route.ts + resolveBot.ts + trialNotification.ts

// 1. Fetch all hotel_bots rows (all hotels, all roles)
const supabase = createServiceClient() as unknown as SupabaseClient;
const { data: bots } = await supabase
  .from('hotel_bots')
  .select('hotel_id, role, vault_secret_id, webhook_path_slug, webhook_secret');

// 2. For each bot: decrypt token, call setWebhook
for (const bot of bots) {
  const { data: botToken } = await supabase.rpc('get_bot_token', {
    p_vault_secret_id: bot.vault_secret_id,
  });

  if (!botToken) continue;

  const webhookUrl = `${appUrl}/api/telegram/${bot.webhook_path_slug}`;

  await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: bot.webhook_secret,
      allowed_updates: ['message', 'callback_query'],
      // NOTE: do NOT use drop_pending_updates: true here — we don't want
      // to discard real pending updates from hotel guests during migration
    }),
  });
}
```

**Key insight:** Telegram's `setWebhook` is idempotent. Calling it with the same URL + secret but new `allowed_updates` is a supported operation — Telegram's own docs confirm this. Only `url` is required; all other fields are optional updates. This means the re-provision does not need the bot token to be re-created in Vault — only to be decrypted for the API call.

**Source:** Telegram Bot API official docs (verified via WebFetch): "changes don't affect updates created before the call — unwanted updates may arrive briefly." `allowed_updates` is listed as optional and updatable.

---

### Pattern 3: Return Value for Admin Endpoint

Follow the `register-wizard-webhook/route.ts` pattern — return structured JSON with success/error counts. This lets the super admin confirm how many bots were updated.

```typescript
return Response.json({
  success: true,
  total: bots.length,
  updated: successCount,
  failed: failedCount,
  details: results,   // array of { hotel_id, role, ok, error? }
});
```

---

### Anti-Patterns to Avoid

- **Do NOT use `drop_pending_updates: true` in the re-provision endpoint.** This would discard pending messages from hotel guests currently waiting for AI responses. Only use `drop_pending_updates: true` during initial provisioning (when there are no real guests yet). The `provisionBots.ts` fix should keep `drop_pending_updates: true` for new provisioning (correct), but the admin re-provision endpoint must NOT include it.
- **Do NOT re-store tokens in Vault.** The `create_bot_token_secret` RPC creates a NEW Vault secret and returns a new UUID. Re-provisioning should only call `get_bot_token` (read, not write) + `setWebhook` (Telegram API call, not Supabase). Calling `create_bot_token_secret` would leave orphaned Vault secrets.
- **Do NOT update `hotel_bots` rows.** The `webhook_path_slug`, `webhook_secret`, and `vault_secret_id` remain unchanged. Only Telegram's server-side webhook registration needs to be updated.
- **Do NOT bypass the SUPER_ADMIN_EMAIL guard.** The admin endpoint must gate behind the same auth as all other admin operations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token decryption | Custom Vault SQL | `get_bot_token` RPC | Already exists, SECURITY DEFINER, service_role only |
| Auth guard | Custom session logic | `createClient().auth.getUser()` + `SUPER_ADMIN_EMAIL` check | Same pattern as `register-wizard-webhook/route.ts` |
| Webhook update | New webhook registration code | Reuse `setWebhook` fetch pattern from `provisionBots.ts` | Identical API call, just different `allowed_updates` value |

---

## Common Pitfalls

### Pitfall 1: drop_pending_updates in Re-Provision
**What goes wrong:** Including `drop_pending_updates: true` in the admin re-provision endpoint causes all queued Telegram updates (guest messages, pending interactions) to be discarded silently.
**Why it happens:** Copy-pasting from `provisionBots.ts` which does use `drop_pending_updates: true` for new bots (correct there, wrong in re-provision).
**How to avoid:** Omit `drop_pending_updates` from the re-provision `setWebhook` calls. Only new provisioning should use it.
**Warning signs:** After calling the admin endpoint, owners report that pending messages from guests were lost.

### Pitfall 2: Creating New Vault Secrets During Re-Provision
**What goes wrong:** Calling `create_bot_token_secret` during re-provision creates orphaned secrets — new `vault_secret_id` not stored anywhere, old one still in `hotel_bots`.
**Why it happens:** Confusion between "provisioning" (full setup) and "re-provisioning" (webhook update only).
**How to avoid:** The re-provision endpoint must only call `get_bot_token` (read) + `setWebhook` (Telegram). No Vault writes.

### Pitfall 3: Forgetting `webhook_secret` in setWebhook
**What goes wrong:** Calling `setWebhook` without `secret_token` removes the webhook secret. Then the `[slug]/route.ts` handler rejects every inbound update with 403 because the `X-Telegram-Bot-Api-Secret-Token` header no longer matches.
**Why it happens:** Sending only `url` + `allowed_updates` and omitting `secret_token`.
**How to avoid:** Always include `secret_token: bot.webhook_secret` in the re-provision `setWebhook` call. The `webhook_secret` column is stored in `hotel_bots` and is available without Vault decryption.

### Pitfall 4: TypeScript Compilation Errors from `hotel_bots` Table Query
**What goes wrong:** Querying `hotel_bots` columns like `webhook_path_slug` or `webhook_secret` that are not in the auto-generated types causes TS errors.
**Why it happens:** The generated Supabase types may not include all columns.
**How to avoid:** Use the `as unknown as SupabaseClient` cast pattern consistently, same as `resolveBot.ts`, `trialCallback.ts`, and all other admin server code. Cast query results to inline interface types.

---

## Code Examples

### Complete `setWebhook` call for re-provision (verified pattern)
```typescript
// Source: pattern from src/app/api/admin/register-wizard-webhook/route.ts
const res = await fetch(
  `https://api.telegram.org/bot${botToken}/setWebhook`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: bot.webhook_secret,   // MUST include — preserves auth header
      allowed_updates: ['message', 'callback_query'],
      // NO drop_pending_updates — don't discard real guest messages
    }),
  },
);
const result = (await res.json()) as { ok: boolean; description?: string };
```

### SUPER_ADMIN_EMAIL guard (from `register-wizard-webhook/route.ts`)
```typescript
// Source: src/app/api/admin/register-wizard-webhook/route.ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();

if (!user) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
if (!superAdminEmail || user.email !== superAdminEmail) {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
```

### `get_bot_token` RPC call (from `trialNotification.ts`)
```typescript
// Source: src/lib/cron/trialNotification.ts line 115
const { data: tokenData, error: tokenError } = await supabase.rpc('get_bot_token', {
  p_vault_secret_id: vaultSecretId,
});
// tokenData is string | null
```

### hotel_bots query for all bots (SupabaseClient cast pattern)
```typescript
// Source: pattern from src/lib/telegram/resolveBot.ts
const supabase = createServiceClient();
const { data: bots, error } = await (supabase as unknown as SupabaseClient)
  .from('hotel_bots')
  .select('hotel_id, role, vault_secret_id, webhook_path_slug, webhook_secret');
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| `allowed_updates: ['message']` in `provisionBots.ts` | `allowed_updates: ['message', 'callback_query']` | callback_query updates delivered to server |
| Existing bots silently drop inline keyboard taps | Admin endpoint calls `setWebhook` to update filter | All bots accept callback_query after single admin call |

**Contrast with wizard bot:** `register-wizard-webhook/route.ts` already uses `['message', 'callback_query']` correctly. The employee bot provisioning path missed this because Phase 10 predated the Phase 11/12 inline keyboard work.

---

## Open Questions

1. **Should `drop_pending_updates` be included in re-provision calls?**
   - What we know: `provisionBots.ts` uses it for initial provision (no guests yet); re-provision runs against live bots with real guests.
   - What's unclear: Are there pending updates at the time of re-provision that matter?
   - Recommendation: Omit `drop_pending_updates` from re-provision endpoint — risk of guest message loss is worse than risk of processing a stale callback.

2. **Should re-provision update inactive bots (`is_active = false`) too?**
   - What we know: `resolveBot.ts` only returns active bots (`.eq('is_active', true)`); inactive bots don't receive updates anyway.
   - What's unclear: An inactive bot's webhook is still registered with Telegram, it just won't respond to guests.
   - Recommendation: Update all bots (active and inactive) for completeness — if a bot is later reactivated, its `allowed_updates` should already be correct. Use no `is_active` filter in the admin endpoint.

3. **Is there a Telegram API rate limit concern for batch `setWebhook` calls?**
   - What we know: Each `setWebhook` call is one Telegram API request per bot. For a small SaaS with a handful of hotels this is trivial.
   - What's unclear: At large scale (hundreds of hotels), sequential calls could be slow.
   - Recommendation: Sequential calls for now (same pattern as `provisionAllBots`). No rate-limit concern at current scale.

---

## Sources

### Primary (HIGH confidence)
- `src/lib/admin/provisionBots.ts` — Confirmed `allowed_updates: ['message']` at line 111 (the bug)
- `src/app/api/admin/register-wizard-webhook/route.ts` — Reference implementation showing `['message', 'callback_query']` is the correct value, and the auth pattern
- `src/lib/cron/trialNotification.ts` — `get_bot_token` RPC call pattern (lines 115-120)
- `src/lib/telegram/resolveBot.ts` — `hotel_bots` query pattern with `SupabaseClient` cast
- `src/lib/telegram/trialCallback.ts` — Full callback handler (confirmed correct, just unreachable)
- `src/app/api/telegram/[slug]/route.ts` — Route dispatch for `callback_query` (confirmed correct)
- `.planning/v2.0-MILESTONE-AUDIT.md` — Root cause analysis confirming the exact bug

### Secondary (HIGH confidence — official docs)
- Telegram Bot API `setWebhook` (fetched via WebFetch): confirms `allowed_updates` is optional and updatable without changing URL/secret; confirms idempotent behavior
- Telegram Bot API `getWebhookInfo` (fetched via WebFetch): confirms `allowed_updates` field is returned and checkable

---

## Metadata

**Confidence breakdown:**
- Root cause identification: HIGH — codebase read confirmed exact line (provisionBots.ts:111)
- Fix strategy: HIGH — `setWebhook` idempotency and `allowed_updates` mutability confirmed via official docs
- Re-provision pattern: HIGH — identical patterns already exist in codebase (register-wizard-webhook, get_bot_token)
- Pitfalls: HIGH — all derived from code-reading the existing implementation

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable Telegram Bot API, no fast-moving dependencies)
