---
phase: 09-telegram-infrastructure
verified: 2026-03-06T10:30:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 9: Telegram Infrastructure Verification Report

**Phase Goal:** A Telegram message sent to any registered hotel bot reaches the correct AI employee and receives a formatted reply — with bot tokens encrypted, webhook secrets validated, and no Telegram retry storms
**Verified:** 2026-03-06T10:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A message sent to a registered employee bot arrives at the webhook handler, is validated, and triggers an AI response via the existing invokeAgent() pipeline without modification | VERIFIED | `route.ts` calls `resolveBot(slug)`, validates header, calls `invokeAgent()` with existing params interface — no modifications to invokeAgent |
| 2 | The webhook handler returns HTTP 200 before the agent completes — duplicate sends during Telegram retries do not produce duplicate AI replies | VERIFIED | `after(async () => { ... })` registered at line 140, `return new Response('', { status: 200 })` at line 181 — 200 returned after after() is scheduled but before it executes |
| 3 | Bot tokens are stored encrypted via Supabase Vault — plaintext tokens never appear in DB query logs or API responses | VERIFIED | `hotel_bots` table stores only `vault_secret_id UUID` — no token column. `get_bot_token()` is SECURITY DEFINER, revoked from PUBLIC/anon/authenticated, GRANT to service_role only |
| 4 | A webhook request with a missing or incorrect X-Telegram-Bot-Api-Secret-Token header is rejected with no agent invocation | VERIFIED | Lines 79-83 in `route.ts`: header extracted, compared to `botRow.webhook_secret`, returns 403 before any agent work. `after()` is not called on this path |
| 5 | AI responses sent to Telegram are correctly formatted — no unescaped characters cause silent sendMessage failures | VERIFIED | `escapeMarkdownV2()` escapes all 18 MarkdownV2 special characters via `/[_*[\]()~\`>#+\-=|{}.!]/g`. `sendTelegramReply()` falls back to plaintext on HTTP 400 |

**Score:** 5/5 success-criteria truths verified

### Must-Have Truths (from plan frontmatter)

#### Plan 01 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | hotel_bots table exists with all required columns and RLS policies | VERIFIED | `0009_telegram.sql` lines 14-57: all 9 columns present, RLS enabled, two policies (authenticated SELECT, service_role ALL) |
| 2 | Bot tokens stored encrypted via Vault — plaintext never in hotel_bots table | VERIFIED | No token column in table. `vault_secret_id UUID NOT NULL` stores the reference. `create_bot_token_secret()` is the only write path |
| 3 | `get_bot_token()` SECURITY DEFINER, restricted to service_role only | VERIFIED | Lines 93-116 of migration: SECURITY DEFINER, REVOKE from PUBLIC/anon/authenticated, GRANT to service_role |
| 4 | `resolveBot()` can look up a bot by webhook_path_slug and return required fields | VERIFIED | `resolveBot.ts` queries `hotel_bots` filtered by `webhook_path_slug` and `is_active = true`, returns `hotel_id, role, vault_secret_id, webhook_secret, is_active` |
| 5 | Escalation channel supports telegram — DB CHECK constraint, TypeScript type, escalation.ts all handle tg_ prefix | VERIFIED | Migration adds `'telegram'` to CHECK constraint; `EscalationChannel = 'whatsapp' \| 'widget' \| 'telegram'`; escalation.ts detects `tg_` prefix at line 84 |

#### Plan 02 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Webhook handler validates secret, invokes agent | VERIFIED | Full validation chain in route.ts steps 1-8 |
| 2 | Handler returns 200 before agent completes | VERIFIED | `after()` pattern confirmed — 200 at line 181, after() at line 140 |
| 3 | Invalid secret returns 403 with no agent invocation | VERIFIED | Lines 79-83: 403 returned before `after()` is ever called |
| 4 | AI responses formatted with MarkdownV2 — all 18 chars escaped | VERIFIED | `escapeMarkdownV2` regex: `/[_*[\]()~\`>#+\-=|{}.!]/g` — tested: all 18 chars correctly escaped |
| 5 | MarkdownV2 failure falls back to plain text | VERIFIED | `sendReply.ts` lines 54-76: checks `!res.ok`, logs error, sends second fetch with no `parse_mode` |

**Combined score:** 7/7 must-have groups verified

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0009_telegram.sql` | hotel_bots table, Vault functions, escalation extension | VERIFIED | 151 lines — all 5 sections present: table, RLS, create_bot_token_secret, get_bot_token, escalation CHECK |
| `src/lib/telegram/resolveBot.ts` | Bot lookup by webhook_path_slug | VERIFIED | 50 lines — exports `resolveBot`, queries hotel_bots, returns null if not found |
| `src/types/database.ts` | HotelBot interface, updated EscalationChannel | VERIFIED | `HotelBot` at line 374, `EscalationChannel` at line 168 includes 'telegram' |
| `src/lib/telegram/types.ts` | TelegramUpdate/Message/User/Chat types | VERIFIED | 38 lines — all 4 interfaces exported |
| `src/lib/telegram/escapeMarkdownV2.ts` | MarkdownV2 special character escaping | VERIFIED | 28 lines — exports `escapeMarkdownV2`, single-pass regex covers all 18 chars |
| `src/lib/telegram/sendReply.ts` | Telegram sendMessage wrapper with fallback | VERIFIED | 82 lines — exports `sendTelegramReply`, MarkdownV2 primary, plaintext fallback on !res.ok |
| `src/app/api/telegram/[slug]/route.ts` | Webhook handler with async agent invocation | VERIFIED | 183 lines — exports POST, uses after(), all validation steps present |

## Key Link Verification

### Plan 01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `resolveBot.ts` | hotel_bots table | Supabase service client `.from('hotel_bots').eq('webhook_path_slug', slug)` | WIRED | Line 37-41: explicit query with both filters confirmed |
| `escalation.ts` | escalations table | `conversationId.startsWith('tg_')` → `'telegram'` | WIRED | Lines 82-86: ternary chain with tg_ branch present |
| `invokeAgent.ts` | escalation.ts | `detectAndInsertEscalation()` with `tg_` → `'telegram'` | WIRED | Lines 327-330: tg_ branch before widget_ fallback |

### Plan 02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `route.ts` | `resolveBot.ts` | `resolveBot(slug)` call | WIRED | Line 34 import, line 67 call |
| `route.ts` | `invokeAgent.ts` | `invokeAgent()` inside `after()` callback | WIRED | Line 37 import, line 159 call inside after() |
| `route.ts` | `sendReply.ts` | `sendTelegramReply()` inside `after()` callback | WIRED | Line 35 import, line 169 call inside after() |
| `route.ts` | vault.decrypted_secrets | `.rpc('get_bot_token', { p_vault_secret_id })` inside after() | WIRED | Lines 147-150: cast pattern applied, RPC call confirmed |
| `sendReply.ts` | `escapeMarkdownV2.ts` | `escapeMarkdownV2()` applied to response text | WIRED | Line 20 import, line 41 call: `const escaped = escapeMarkdownV2(params.text)` |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TGIF-01 | 09-02 | Telegram webhook handler with per-bot dynamic routing | SATISFIED | `/api/telegram/[slug]/route.ts` — uses `[slug]` (random UUID) instead of `[botToken]` (security improvement documented in research at line 369: "This changes the requirement TGIF-01 slightly... more secure") |
| TGIF-02 | 09-02 | X-Telegram-Bot-Api-Secret-Token validation on every request | SATISFIED | `route.ts` lines 79-83: header extracted, compared, 403 on mismatch |
| TGIF-03 | 09-02 | Webhook returns 200 immediately, agent runs async | SATISFIED | `after()` pattern: 200 at line 181 before agent starts |
| TGIF-04 | 09-01 | Bot tokens encrypted at rest via Supabase Vault | SATISFIED | No plaintext token in hotel_bots; SECURITY DEFINER Vault functions with service_role-only grants |
| TGIF-05 | 09-01 | hotel_bots table with hotel_id, role, bot_token, bot_username, is_active and RLS | SATISFIED | Table has all these columns (plus webhook_secret, webhook_path_slug for security). RLS with SELECT for authenticated, ALL for service_role |
| EBOT-05 | 09-01 | Existing invokeAgent() pipeline handles Telegram channel (non-streaming) | SATISFIED | `invokeAgent()` called in route.ts with existing params — no modifications to invokeAgent. `tg_` conversationId produces 'telegram' channel in escalation detection |
| EBOT-06 | 09-02 | MarkdownV2 formatted responses (Telegram-compatible output) | SATISFIED | `escapeMarkdownV2()` escapes all 18 special chars; `sendTelegramReply` sends with `parse_mode: 'MarkdownV2'` |

**Note on TGIF-01:** REQUIREMENTS.md says `/api/telegram/[botToken]` but implementation uses `/api/telegram/[slug]`. This is a documented security improvement from research (using a random UUID slug instead of the actual bot token in the URL). The requirement intent — "per-bot endpoint with dynamic routing" — is fully satisfied. The research document explicitly recommends this deviation at line 369.

**Note on TGIF-05:** REQUIREMENTS.md description says "bot_token" column but the implementation stores `vault_secret_id` instead (no plaintext token). This is the correct implementation of TGIF-04 (encryption at rest). The requirement is satisfied at a higher security level than the description specified.

## Anti-Patterns Found

No anti-patterns detected.

Scanned files:
- `src/app/api/telegram/[slug]/route.ts` — no TODOs, no stub returns, no console-log-only handlers
- `src/lib/telegram/resolveBot.ts` — real DB query, real return
- `src/lib/telegram/escapeMarkdownV2.ts` — single-line implementation, no stubs
- `src/lib/telegram/sendReply.ts` — real fetch calls, real fallback logic
- `src/lib/telegram/types.ts` — type definitions, no implementation stubs
- `supabase/migrations/0009_telegram.sql` — complete SQL with all required constructs

## Human Verification Required

### 1. End-to-End Telegram Message Flow

**Test:** Register a bot token in the database via `create_bot_token_secret()`, insert a row into `hotel_bots` with a known `webhook_path_slug` and `webhook_secret`, then send a POST request to `/api/telegram/{slug}` with the correct `X-Telegram-Bot-Api-Secret-Token` header and a valid `TelegramUpdate` JSON body.
**Expected:** HTTP 200 returned immediately; after a few seconds, the Telegram chat receives an AI response from the correct role.
**Why human:** Requires a live Supabase Vault instance with seeded data and a real Telegram bot token. Cannot verify the full round-trip (Vault decrypt → invokeAgent → Telegram API response) programmatically in this environment.

### 2. Telegram Retry Storm Prevention

**Test:** Send a message to the webhook that takes 10+ seconds to process (slow agent). Observe Telegram's behavior — it should not send duplicate updates.
**Expected:** No duplicate AI responses in the Telegram chat.
**Why human:** Requires timing verification with a live Telegram bot and slow-responding agent. The `after()` pattern is correctly implemented in code, but the runtime behavior under real Telegram retry windows needs live testing.

### 3. MarkdownV2 Rendering in Telegram App

**Test:** Trigger a response containing formatting characters (asterisks for bold, underscores for italics, dots in URLs or prices).
**Expected:** Message renders correctly with proper formatting in the Telegram mobile/desktop app, no "can't parse entities" errors, and the fallback plain text is readable if it triggers.
**Why human:** MarkdownV2 rendering is visual and depends on real Telegram client behavior. The escaping logic is correct per the regex but edge cases in entity nesting cannot be fully verified without the live API.

## Gaps Summary

No gaps. All 7 must-have groups pass all three verification levels (exists, substantive, wired).

The two minor discrepancies between REQUIREMENTS.md descriptions and implementation (TGIF-01 using `[slug]` instead of `[botToken]`, TGIF-05 using `vault_secret_id` instead of plaintext `bot_token`) are intentional security improvements documented in the research file and SUMMARY. They satisfy the requirements at a higher security level than the descriptions specified.

---

_Verified: 2026-03-06T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
