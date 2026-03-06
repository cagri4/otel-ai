---
phase: 09-telegram-infrastructure
plan: 02
subsystem: api
tags: [telegram, webhook, next-server-after, markdownv2, typescript, bot-api]

# Dependency graph
requires:
  - phase: 09-telegram-infrastructure plan 01
    provides: hotel_bots table, resolveBot() helper, get_bot_token() Vault function
  - phase: 04-guest-facing-layer
    provides: sanitizeGuestInput, checkHotelRateLimit, createServiceClient patterns
  - phase: 02-agent-core
    provides: invokeAgent(), AgentRole enum, InvokeAgentParams interface
provides:
  - TelegramUpdate/Message/User/Chat TypeScript types (types.ts)
  - escapeMarkdownV2 utility — all 18 MarkdownV2 special characters escaped
  - sendTelegramReply — Telegram Bot API wrapper with MarkdownV2 + plaintext fallback
  - /api/telegram/[slug] webhook handler with after() async agent invocation
affects:
  - 09-03 (bot registration wizard — depends on webhook handler existing)
  - 09-04 (Telegram UI — depends on tg_ conversationId prefix producing turns in DB)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - next/server after() pattern — return 200 immediately, schedule agent work post-response to prevent Telegram retry storms
    - MarkdownV2 escaping with plaintext fallback — primary MarkdownV2, fallback on HTTP 400 from Telegram
    - Vault token decryption inside after() — minimizes time plaintext token is in memory

key-files:
  created:
    - src/lib/telegram/types.ts
    - src/lib/telegram/escapeMarkdownV2.ts
    - src/lib/telegram/sendReply.ts
    - src/app/api/telegram/[slug]/route.ts

key-decisions:
  - "after() from next/server wraps invokeAgent() — returns HTTP 200 before agent completes, preventing Telegram retry storms on slow responses"
  - "Bot token Vault decryption inside after() callback — plaintext token only in memory during the post-response window, minimizing exposure time"
  - "Non-text Telegram updates (photos, stickers, voice) discarded silently with 200 — handler only processes text messages"
  - "Unknown slug returns 200 (not 404) — prevents Telegram from retrying deregistered bot URLs indefinitely"
  - "Rate-limited requests return 200 (not 429) — prevents Telegram retry storms on per-hotel rate limit hits"
  - "MarkdownV2 as primary format with plaintext fallback on HTTP 400 — ensures users always receive a reply even on edge-case escaping failures"

patterns-established:
  - "after() async invocation pattern: validate -> rate-limit -> sanitize -> return 200 -> after(async () => { decrypt token -> invoke agent -> send reply })"
  - "Telegram escaping: escapeMarkdownV2() applied to all agent response text before MarkdownV2 sendMessage call"
  - "All 200-return paths prevent Telegram retries; only 403 (invalid secret) is a non-200 response"

requirements-completed: [TGIF-01, TGIF-02, TGIF-03, EBOT-06]

# Metrics
duration: 16min
completed: 2026-03-06
---

# Phase 9 Plan 02: Telegram Webhook Handler Summary

**Telegram webhook handler at /api/telegram/[slug] with after()-based async agent invocation, MarkdownV2 escaping, and Vault-based bot token decryption**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-03-06T09:54:14Z
- **Completed:** 2026-03-06T10:10:00Z
- **Tasks:** 2
- **Files modified:** 4 (all created)

## Accomplishments
- Created TelegramUpdate/Message/User/Chat TypeScript types covering the minimal Telegram Update shape needed for message processing
- Created escapeMarkdownV2 that escapes all 18 MarkdownV2 special characters using a single regex pass
- Created sendTelegramReply with MarkdownV2 as primary format and automatic plaintext fallback on HTTP 400 — never throws (fire-and-forget safe)
- Created /api/telegram/[slug] webhook handler that validates X-Telegram-Bot-Api-Secret-Token, returns 200 immediately, and runs invokeAgent() + sendTelegramReply inside next/server after() to prevent Telegram retry storms

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Telegram types, escapeMarkdownV2, and sendReply helper** - `298caed` (feat)
2. **Task 2: Create Telegram webhook route handler with after() async invocation** - `9a8e3d4` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `src/lib/telegram/types.ts` - TelegramUpdate, TelegramMessage, TelegramUser, TelegramChat interfaces
- `src/lib/telegram/escapeMarkdownV2.ts` - escapeMarkdownV2() escapes all 18 MarkdownV2 special characters
- `src/lib/telegram/sendReply.ts` - sendTelegramReply() sends MarkdownV2 with plaintext fallback on HTTP 400
- `src/app/api/telegram/[slug]/route.ts` - Webhook handler: slug routing, secret validation, after() async agent invocation

## Decisions Made
- `after()` from `next/server` wraps the entire agent pipeline — HTTP 200 is returned before invokeAgent() starts, preventing Telegram retry storms on slow responses
- Bot token Vault decryption (`get_bot_token` RPC) placed inside the `after()` callback — plaintext token never loaded until request has passed all validation gates
- Non-text updates (photos, stickers, voice messages) return 200 silently — only `message.text` updates invoke the agent
- Unknown slug returns 200 (not 404) — Telegram would retry 404 responses indefinitely for deregistered bots
- Rate-limited requests return 200 (not 429) — consistent with Twilio webhook pattern, prevents retry amplification
- MarkdownV2 as primary format — current Telegram spec; escapeMarkdownV2 handles all 18 special characters
- Plaintext fallback on HTTP 400 from Telegram Bot API — ensures guests always receive a reply even if edge-case escaping issues occur

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Pre-existing build failure in iyzipay billing module (dynamic `require()` in `Iyzipay.js` incompatible with Turbopack). This is unrelated to Telegram code and was present before this plan's changes. TypeScript compilation (`pnpm exec tsc --noEmit`) passes with zero errors for all Telegram files.

## User Setup Required

None — no external service configuration required for the handler itself. Bot registration (calling Telegram's setWebhook API with the handler URL and a secret token) is a Phase 9 Plan 3 concern.

## Next Phase Readiness
- Webhook handler is complete and ready to receive Telegram updates once a bot is registered
- tg_{hotelId}_{chatId} conversationId pattern produces turns in conversation_turns table via invokeAgent()
- EscalationChannel 'telegram' detection in invokeAgent.ts and escalation.ts is live from Plan 01
- Plan 03 (bot registration wizard) can now register bots against this handler URL pattern

---
*Phase: 09-telegram-infrastructure*
*Completed: 2026-03-06*
