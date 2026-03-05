---
phase: 04-guest-facing-layer
plan: 02
subsystem: api
tags: [twilio, whatsapp, webhook, rate-limiting, sanitization, supabase, agent]

# Dependency graph
requires:
  - phase: 04-01
    provides: checkHotelRateLimit, sanitizeGuestInput, middleware bypass for /api/whatsapp/*
  - phase: 02-agent-core
    provides: invokeAgent, AgentRole, InvokeAgentParams
  - phase: 04-03
    provides: service.ts Supabase service-role client, resolveHotel.ts (committed earlier in plan sequence)
provides:
  - POST /api/whatsapp/webhook — Twilio signature-validated WhatsApp message pipeline
  - src/lib/whatsapp/sendReply.ts — Twilio messages.create() wrapper for outbound WhatsApp
  - WhatsApp conversation persistence with wa_{hotelId}_{phone} ID pattern
affects: [05-03-owner-dashboard-conversation-history, any phase consuming conversation_turns]

# Tech tracking
tech-stack:
  added: [twilio@5.12.2]
  patterns:
    - "Twilio webhook always returns 200 — prevent retry storm; errors caught and logged, not re-thrown"
    - "Form-urlencoded body parsing via URLSearchParams (Twilio format, not JSON)"
    - "Conversation ID: wa_{hotelId}_{normalizedPhone} for cross-session WhatsApp persistence"
    - "Signature validation before any processing — twilio.validateRequest() at route entry"
    - "Non-streaming invokeAgent() for WhatsApp — channel needs complete message, not chunks"

key-files:
  created:
    - src/lib/whatsapp/sendReply.ts
    - src/app/api/whatsapp/webhook/route.ts
  modified:
    - package.json (added twilio@5.12.2)
    - pnpm-lock.yaml

key-decisions:
  - "twilio.validateRequest() used for X-Twilio-Signature validation — prevents spoofed webhook calls before any DB or agent work"
  - "Webhook always returns 200 — even on errors — to prevent Twilio's automatic retry mechanism from flooding the server"
  - "Non-streaming invokeAgent call for WhatsApp — WhatsApp channel requires a complete message; onToken callback omitted"
  - "Conversation ID pattern wa_{hotelId}_{phone} — persistent per guest phone number across sessions, wa_ prefix distinguishes from widget channels"
  - "sendWhatsAppReply catches and logs errors without re-throwing — 200 contract with Twilio must not be broken by send failures"
  - "TWILIO_WHATSAPP_NUMBER sandbox fallback — routes all sandbox traffic to first hotel in DB for MVP testing without requiring hotel_whatsapp_numbers entry"

patterns-established:
  - "Twilio webhook pattern: parse form-urlencoded → validate signature → resolve entity → rate limit → sanitize → invoke agent → send reply → return 200"
  - "WhatsApp conversation IDs use wa_ prefix to distinguish from widget_ prefix conversations in shared conversation_turns table"

requirements-completed: [DESK-02, DESK-07, WHAP-01, WHAP-02, WHAP-03, WHAP-04]

# Metrics
duration: 19min
completed: 2026-03-05
---

# Phase 4 Plan 02: WhatsApp Webhook Integration Summary

**Twilio WhatsApp webhook at /api/whatsapp/webhook — signature validation, hotel resolution, FRONT_DESK agent invocation, and persistent WhatsApp conversation turns with wa_ prefix**

## Performance

- **Duration:** 19 min
- **Started:** 2026-03-05T11:15:58Z
- **Completed:** 2026-03-05T11:35:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- POST /api/whatsapp/webhook validates Twilio X-Twilio-Signature before any processing; returns 403 on invalid signatures
- Hotel resolved from Twilio number via hotel_whatsapp_numbers table with sandbox MVP fallback to first hotel
- Front Desk AI agent invoked non-streaming (WhatsApp needs complete message); conversation persisted with wa_{hotelId}_{phone} ID
- sendWhatsAppReply wraps Twilio messages.create() with error catching — webhook always returns 200 to prevent retry storms
- Per-hotel rate limiting (429) and unknown number detection (404) applied before agent invocation

## Task Commits

Each task was committed atomically:

1. **Task 1: WhatsApp hotel resolution and reply helpers** - `3430511` (feat)
2. **Task 2: WhatsApp webhook route handler** - `f8009ae` (feat)

**Plan metadata:** (committed with docs commit below)

## Files Created/Modified
- `src/lib/whatsapp/sendReply.ts` - Twilio messages.create() wrapper; catches and logs errors without re-throwing
- `src/lib/whatsapp/resolveHotel.ts` - Queries hotel_whatsapp_numbers; sandbox MVP fallback to first hotel (previously committed in 04-03 as Rule 1 deviation, confirmed matching content)
- `src/app/api/whatsapp/webhook/route.ts` - Full Twilio webhook pipeline: validate signature → resolve hotel → rate limit → sanitize → invoke agent → send reply → return 200
- `package.json` / `pnpm-lock.yaml` - Added twilio@5.12.2

## Decisions Made
- Webhook always returns 200 on all paths — including error paths — to prevent Twilio's automatic retry mechanism from flooding the server on transient failures
- Non-streaming invokeAgent call — WhatsApp requires a complete response message; the onToken streaming callback is omitted
- Conversation ID `wa_{hotelId}_{normalizedPhone}` pattern — persistent across sessions per guest phone, wa_ prefix distinguishes from widget_ conversations in the shared conversation_turns table
- Signature validation runs first before any DB or agent work — prevents spoofed requests from consuming compute

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added .returns<T>() to resolveHotel.ts Supabase SELECT queries**
- **Found during:** Task 1 (TypeScript type check)
- **Issue:** `.maybeSingle()` returned type `never` for `hotel_id` field without `.returns<T>()`. postgrest-js v12 requires this workaround with manual Database types (documented in STATE.md).
- **Fix:** Added `.returns<{ hotel_id: string }[]>()` and `.returns<{ id: string }[]>()` before `.maybeSingle()` calls
- **Files modified:** src/lib/whatsapp/resolveHotel.ts
- **Verification:** `pnpm exec tsc --noEmit` passes with zero errors
- **Committed in:** 3430511 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 type bug)
**Impact on plan:** Essential for TypeScript correctness — consistent with documented project pattern. No scope creep.

## Issues Encountered
- Turbopack build race condition (ENOENT on `_buildManifest.js.tmp.*`) — intermittent issue with Turbopack parallel writes. Resolved by setting `NEXT_PRIVATE_DISABLE_TURBOPACK=1` to use webpack for builds. TypeScript was validated with `pnpm exec tsc --noEmit` in parallel.
- Background build process lock conflicts — previous session had left a Next.js build process running; resolved by waiting for it to finish before rebuilding.

## User Setup Required

**External services require manual configuration.** See plan frontmatter `user_setup` section for Twilio setup:

1. **Environment variables to add:**
   - `TWILIO_ACCOUNT_SID` — from Twilio Console -> Account Info -> Account SID
   - `TWILIO_AUTH_TOKEN` — from Twilio Console -> Account Info -> Auth Token
   - `TWILIO_WHATSAPP_NUMBER` — sandbox number e.g. `whatsapp:+14155238886`

2. **Dashboard configuration:**
   - Join Twilio WhatsApp Sandbox: Twilio Console -> Messaging -> Try it out -> Send a WhatsApp Message
   - Set webhook URL to `https://your-domain.com/api/whatsapp/webhook` (POST): Twilio Console -> Messaging -> Try it out -> WhatsApp Sandbox Settings -> When a message comes in

3. **WHAP-04 partial delivery note:** Conversation persistence is implemented (conversation_turns with wa_ prefix IDs). Owner dashboard view of WhatsApp conversations is deferred to Phase 5 Plan 05-03 (Owner Dashboard — conversation history view).

## Next Phase Readiness
- WhatsApp guest communication channel is fully operational
- Phase 4 Plan 03 (widget API) was already completed; Plan 05 (widget frontend) remains
- Conversation turns from WhatsApp are stored in conversation_turns with wa_ prefix — ready for Phase 5 owner dashboard

---
*Phase: 04-guest-facing-layer*
*Completed: 2026-03-05*
