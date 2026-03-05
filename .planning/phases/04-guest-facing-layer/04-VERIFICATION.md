---
phase: 04-guest-facing-layer
verified: 2026-03-05T12:30:00Z
status: passed
score: 20/20 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Open /widget/[token] in a browser and send a message"
    expected: "Hotel name appears in header, message is sent, AI response appears in real time via Realtime Broadcast"
    why_human: "Cannot programmatically verify Supabase Realtime delivery or visual branding in a browser context"
  - test: "Send a WhatsApp message to the Twilio sandbox number"
    expected: "AI agent responds within seconds; conversation turn persists in DB"
    why_human: "Requires live Twilio + WhatsApp environment; cannot be verified from static code"
  - test: "Switch dashboard language via LocaleSwitcher and reload"
    expected: "Dashboard nav and labels render in Turkish (TR) after switching"
    why_human: "Requires browser rendering of Server Components with cookie-based locale"
  - test: "Trigger escalation by prompting the AI with 'please contact reception'"
    expected: "Escalation record inserted to DB and email sent to hotel contact email via Resend"
    why_human: "Requires live Claude API + Resend + database in a real environment"
---

# Phase 4: Guest-Facing Layer Verification Report

**Phase Goal:** Guests can chat with the Front Desk AI via WhatsApp and a hotel website widget, in their own language, with rate limiting and injection protection in place before any guest traffic touches the system
**Verified:** 2026-03-05T12:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Guest-facing API routes are rate limited per IP (30 req/min sliding window) | VERIFIED | `src/middleware.ts` imports `checkIpRateLimit`, applies it on `/api/widget/*` and `/api/whatsapp/*` before any other processing. `rateLimiter.ts` uses `Ratelimit.slidingWindow(30, '60 s')` with graceful degradation. |
| 2  | Per-hotel rate limiting is available in route handlers (100 req/min fixed window) | VERIFIED | `checkHotelRateLimit` exported from `rateLimiter.ts`, uses `Ratelimit.fixedWindow(100, '60 s')`. Called in `webhook/route.ts` (line 99) and `widget/message/route.ts` (line 77). |
| 3  | Prompt injection patterns in guest input are detected and blocked before reaching the agent | VERIFIED | `sanitizeGuestInput.ts` defines 8 `INJECTION_PATTERNS` regexes. Returns fallback string on match. Called in `webhook/route.ts` (line 106) and `widget/message/route.ts` (line 88) before `invokeAgent`. |
| 4  | Input length is capped at 2000 characters with Unicode normalization | VERIFIED | `sanitizeGuestInput.ts` lines 47-58: `.slice(0, 2000)`, `.normalize('NFC')`, control char removal. |
| 5  | Database schema includes widget_token, widget_config on hotels, escalations table, hotel_whatsapp_numbers table | VERIFIED | `0004_guest_facing.sql` contains all four: `ALTER TABLE hotels ADD COLUMN widget_token`, `widget_config`, `CREATE TABLE escalations`, `CREATE TABLE hotel_whatsapp_numbers`. |
| 6  | Middleware allows unauthenticated access to /api/widget/*, /api/whatsapp/*, /widget/* routes | VERIFIED | `src/lib/supabase/middleware.ts` defines `PUBLIC_ROUTE_PREFIXES` = `['/api/widget', '/api/whatsapp', '/widget', '/api/escalations']` and returns `NextResponse.next()` before auth check. |
| 7  | Incoming WhatsApp messages are validated via Twilio X-Twilio-Signature before processing | VERIFIED | `webhook/route.ts` lines 57-70: `twilio.validateRequest()` called before any try/catch pipeline; returns 403 on failure. |
| 8  | Guest phone number and Twilio number are used to resolve hotel_id from the database | VERIFIED | `resolveHotel.ts` queries `hotel_whatsapp_numbers` by `twilio_number` (normalized), with sandbox fallback. |
| 9  | Guest message is sanitized and passed to invokeAgent() with FRONT_DESK role | VERIFIED | `webhook/route.ts` line 106 sanitizes, line 115 invokes `invokeAgent` with `role: AgentRole.FRONT_DESK`. |
| 10 | AI response is sent back to the guest via Twilio's messages.create() API | VERIFIED | `sendReply.ts` calls `client.messages.create({from, to, body})`. Called in `webhook/route.ts` line 125. |
| 11 | WhatsApp conversation turns are persisted with wa_ prefix conversation_id | VERIFIED | `webhook/route.ts` line 111: `conversationId = \`wa_${hotelId}_${normalizedPhone}\`` passed to `invokeAgent` which calls `persistTurn`. |
| 12 | A guest can open /widget/[token] and see a branded chat interface | VERIFIED | `src/app/widget/[token]/page.tsx` renders `ChatWidget`. `ChatWidget.tsx` calls `/api/widget/session`, displays `session.hotelName` and applies `primaryColor` from `widgetConfig.primary_color`. Welcome message from `widgetConfig.welcome_message` shown when message array is empty. |
| 13 | Widget resolves hotel from widget_token without guest authentication | VERIFIED | `/api/widget/session/route.ts` uses `createServiceClient()` to query `hotels` by `widget_token`; no auth session required. Middleware bypasses auth for `/api/widget/*`. |
| 14 | Guest messages are sent via /api/widget/message and the AI response is broadcast via Supabase Realtime | VERIFIED | `widget/message/route.ts` invokes agent then calls `supabase.channel(...).send({type:'broadcast', event:'message', ...})`. `ChatWidget.tsx` subscribes via `.on('broadcast', {event:'message'}, ...)`. |
| 15 | hotelId is parsed server-side from conversationId (widget_{hotelId}_{uuid}) — never trusted from client | VERIFIED | `widget/message/route.ts` lines 67-71: splits `conversationId` on `_`, extracts `parts[1]` as `hotelId`. No `hotelId` field accepted from request body. |
| 16 | next-intl is configured without URL routing (cookie-based locale via NEXT_LOCALE cookie) | VERIFIED | `src/i18n/request.ts` reads `NEXT_LOCALE` cookie, defaults to `'en'`. `next.config.ts` uses `withNextIntl(nextConfig)`. `src/app/layout.tsx` wraps with `NextIntlClientProvider`. |
| 17 | EN and TR message files exist with dashboard labels | VERIFIED | `messages/en.json` and `messages/tr.json` both exist with `Dashboard`, `Nav`, `FrontDesk`, `Knowledge`, `Settings`, `Onboarding`, `Common` sections. |
| 18 | Owner can switch dashboard language between EN and TR via locale switcher | VERIFIED | `LocaleSwitcher.tsx` sets `NEXT_LOCALE` cookie and calls `router.refresh()`. Imported and rendered in `src/app/(dashboard)/layout.tsx` line 123. |
| 19 | When the Front Desk AI cannot handle a request, an escalation record is inserted and the hotel owner is notified | VERIFIED | `escalation.ts` exports `detectAndInsertEscalation` with 8 ESCALATION_PHRASES. On match: inserts to `escalations` table, fires POST to `/api/escalations`. Route sends email via `resend.emails.send()` and sets `notified_at`. |
| 20 | Escalation detection is asynchronous and does not block the agent response flow | VERIFIED | `invokeAgent.ts` line 296: `detectAndInsertEscalation(...).catch(...)` — called without `await`. Double safety net: `.catch()` at call site + internal `try/catch` in `escalation.ts`. |

**Score:** 20/20 truths verified

---

### Required Artifacts

#### Plan 01 — Security Foundation

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0004_guest_facing.sql` | Schema additions: widget_token, widget_config, escalations, hotel_whatsapp_numbers | VERIFIED | File exists (70 lines). Contains `CREATE TABLE public.escalations` and `CREATE TABLE public.hotel_whatsapp_numbers`. RLS policies on both tables. |
| `src/lib/security/sanitizeGuestInput.ts` | Input sanitizer exporting `sanitizeGuestInput` | VERIFIED | File exists (69 lines). Exports `sanitizeGuestInput`. 8 injection patterns, 2000-char cap, NFC normalization, control char removal. |
| `src/lib/security/rateLimiter.ts` | Rate limiters exporting `ipRateLimiter`, `hotelRateLimiter`, `checkIpRateLimit`, `checkHotelRateLimit` | VERIFIED | File exists (152 lines). All four exports present. Graceful null degradation when Redis env vars absent. |
| `src/middleware.ts` | Updated middleware applying IP rate limiting on guest routes | VERIFIED | File exists. Imports `checkIpRateLimit`. Applies rate limit for `RATE_LIMITED_PREFIXES = ['/api/widget', '/api/whatsapp']`. |
| `src/types/database.ts` | Types including Escalation, HotelWhatsAppNumber, updated Hotel | VERIFIED | File exists (309 lines). `Escalation` interface (lines 165-175), `HotelWhatsAppNumber` (lines 183-188), `Hotel` with `widget_token` and `widget_config` (lines 30-44). |

#### Plan 02 — WhatsApp Webhook

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/api/whatsapp/webhook/route.ts` | POST handler with signature validation, hotel resolution, agent invocation, reply | VERIFIED | File exists (139 lines). Exports `POST`. Full 10-step pipeline with signature validation first (403), hotel resolution (404), rate limit (429), sanitize, `invokeAgent`, `sendWhatsAppReply`, returns 200. |
| `src/lib/whatsapp/resolveHotel.ts` | Exports `resolveHotelFromNumber` | VERIFIED | File exists (82 lines). Exports `resolveHotelFromNumber`. Queries `hotel_whatsapp_numbers` with sandbox fallback. |
| `src/lib/whatsapp/sendReply.ts` | Exports `sendWhatsAppReply` wrapping `client.messages.create()` | VERIFIED | File exists (50 lines). Exports `sendWhatsAppReply`. Calls `client.messages.create({from, to, body})`. Errors caught and logged, not re-thrown. |

#### Plan 03 — Web Chat Widget

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/supabase/service.ts` | Exports `createServiceClient` (service-role, bypasses RLS) | VERIFIED | File exists (34 lines). Exports `createServiceClient`. Uses `SUPABASE_SERVICE_ROLE_KEY`. JSDoc warns "NEVER expose this client to browser code." |
| `src/app/api/widget/session/route.ts` | POST handler resolving hotel from token, returning session | VERIFIED | File exists (83 lines). Exports `POST`. Uses `createServiceClient()`. Returns `conversationId`, `hotelId`, `hotelName`, `widgetConfig`, `channel`. |
| `src/app/api/widget/message/route.ts` | POST handler invoking agent and broadcasting via Realtime | VERIFIED | File exists (126 lines). Exports `POST`. Parses `hotelId` server-side from `conversationId`. Calls `checkHotelRateLimit`, `sanitizeGuestInput`, `invokeAgent`, then `channel.send({type:'broadcast', event:'message'})`. |
| `src/app/widget/[token]/page.tsx` | Public embeddable page rendering ChatWidget | VERIFIED | File exists (47 lines). Renders `<ChatWidget token={token} />` inside `<div className="h-screen w-full">`. Metadata `title: 'Chat with us'`. Not inside `(dashboard)` route group. |
| `src/components/widget/ChatWidget.tsx` | Client component with Realtime subscription, hotel branding | VERIFIED | File exists (332 lines). `'use client'`. Subscribes via `supabase.channel(...).on('broadcast', {event:'message'}, ...)`. Displays `session.hotelName`, applies `primaryColor`, shows `welcomeMessage`. |

#### Plan 04 — i18n Infrastructure

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/i18n/request.ts` | next-intl locale resolution reading NEXT_LOCALE cookie | VERIFIED | File exists (14 lines). Reads `NEXT_LOCALE` cookie, validates against `['en', 'tr']`, defaults to `'en'`. Dynamic imports message files. |
| `messages/en.json` | English translations with `Dashboard` key | VERIFIED | File exists. Contains `Dashboard`, `Nav`, `FrontDesk`, `Knowledge`, `Settings`, `Onboarding`, `Common` sections. |
| `messages/tr.json` | Turkish translations with `Dashboard` key | VERIFIED | File exists. Same key structure as `en.json`. |
| `src/components/LocaleSwitcher.tsx` | Client component setting NEXT_LOCALE cookie | VERIFIED | File exists (38 lines). Sets `NEXT_LOCALE` cookie, calls `router.refresh()`. |
| `next.config.ts` | Wrapped with `createNextIntlPlugin` | VERIFIED | File exists (13 lines). `import createNextIntlPlugin from 'next-intl/plugin'`. Exports `withNextIntl(nextConfig)`. |
| `src/app/layout.tsx` | Root layout with `NextIntlClientProvider` | VERIFIED | File exists (28 lines). `NextIntlClientProvider` wraps `{children}`. `getLocale()` and `getMessages()` called server-side. |

#### Plan 05 — Escalation Notification

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/agents/escalation.ts` | Exports `detectAndInsertEscalation` checking 8 fallback phrases | VERIFIED | File exists (122 lines). Exports `detectAndInsertEscalation`. `ESCALATION_PHRASES` array has 8 entries. Inserts to DB then fires POST to `/api/escalations`. |
| `src/app/api/escalations/route.ts` | POST handler sending email via Resend, updating notified_at | VERIFIED | File exists (114 lines). Exports `POST`. `new Resend(process.env.RESEND_API_KEY)`. Calls `resend.emails.send()` with guest message, AI response, channel, conversation ID. Updates `notified_at` after delivery. |
| `src/lib/agents/invokeAgent.ts` | Updated with `detectAndInsertEscalation` fire-and-forget in `handleEndTurn` | VERIFIED | File exists (418 lines). Imports `detectAndInsertEscalation` (line 37). Called without `await` at line 296 with `.catch()` error handler. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/middleware.ts` | `src/lib/security/rateLimiter.ts` | `checkIpRateLimit(ip)` | WIRED | Import at line 23, call at line 43 |
| `src/lib/security/rateLimiter.ts` | `@upstash/redis` | `new Redis({url, token})` | WIRED | Import at line 21, instantiation at line 39 |
| `src/middleware.ts` | `src/lib/supabase/middleware.ts` | `updateSession(request)` | WIRED | Import at line 22, call at line 58 |
| `src/app/api/whatsapp/webhook/route.ts` | `src/lib/agents/invokeAgent.ts` | `invokeAgent({role: AgentRole.FRONT_DESK})` | WIRED | Import line 30, call line 115 |
| `src/app/api/whatsapp/webhook/route.ts` | `src/lib/security/sanitizeGuestInput.ts` | `sanitizeGuestInput(body)` | WIRED | Import line 31, call line 106 |
| `src/app/api/whatsapp/webhook/route.ts` | `src/lib/security/rateLimiter.ts` | `checkHotelRateLimit(hotelId)` | WIRED | Import line 32, call line 99 |
| `src/lib/whatsapp/sendReply.ts` | `twilio` | `client.messages.create()` | WIRED | Import line 11, call line 38 |
| `src/app/api/widget/message/route.ts` | `src/lib/agents/invokeAgent.ts` | `invokeAgent({role: AgentRole.FRONT_DESK})` | WIRED | Import line 19, call line 94 |
| `src/app/api/widget/message/route.ts` | `@supabase/supabase-js` | `supabase.channel().send()` broadcast | WIRED | Lines 106-118: `createServiceClient().channel(...).send({type:'broadcast',...})` |
| `src/components/widget/ChatWidget.tsx` | `@supabase/supabase-js` | `.on('broadcast').subscribe()` | WIRED | Lines 112-126: `.channel(...).on('broadcast', {event:'message'}, ...).subscribe()` |
| `src/app/api/widget/session/route.ts` | `src/lib/supabase/service.ts` | `createServiceClient()` for hotel lookup | WIRED | Import line 17, call line 50 |
| `src/lib/agents/invokeAgent.ts` | `src/lib/agents/escalation.ts` | `detectAndInsertEscalation()` after `handleEndTurn` | WIRED | Import line 37, fire-and-forget call line 296 |
| `src/lib/agents/escalation.ts` | `src/lib/supabase/service.ts` | `createServiceClient()` to insert escalation record | WIRED | Import line 15, call line 81 |
| `src/app/api/escalations/route.ts` | `resend` | `resend.emails.send()` for email notification | WIRED | Import line 19, call line 68 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SAFE-04 | 04-01 | Rate limiting per hotel and per guest IP | SATISFIED | `checkIpRateLimit` in middleware (30/min IP sliding window), `checkHotelRateLimit` in route handlers (100/min fixed window). Both use Upstash Redis with graceful degradation. |
| SAFE-05 | 04-01 | Prompt injection protection on all guest-facing inputs | SATISFIED | `sanitizeGuestInput.ts` with 8 injection patterns, called in both WhatsApp webhook and widget message routes before `invokeAgent`. |
| DESK-02 | 04-02 | Guests can chat with Front Desk AI via WhatsApp | SATISFIED | `/api/whatsapp/webhook` POST handler: validates signature, resolves hotel, invokes `FRONT_DESK` agent, sends reply via Twilio. |
| DESK-03 | 04-03 | Guests can chat with Front Desk AI via embeddable web chat widget | SATISFIED | `/widget/[token]` page + `ChatWidget` + `/api/widget/session` + `/api/widget/message` — full channel implemented. |
| DESK-04 | 04-03 | Front Desk AI answers hotel FAQs using hotel knowledge base | SATISFIED | Widget invokes `invokeAgent({role: AgentRole.FRONT_DESK})` which calls `assembleSystemPrompt` loading hotel facts from DB (implemented in Phase 2, verified still wired). |
| DESK-05 | 04-05 | Front Desk AI communicates in guest's language (EN, TR + 1 EU language minimum) | SATISFIED | `agentFactory.ts` MULTILINGUAL SUPPORT block line 70: "Support at minimum: English, Turkish, Dutch, German, French." |
| DESK-06 | 04-05 | Front Desk AI escalates unhandled requests to hotel owner within 2 minutes | SATISFIED | `escalation.ts` detects 8 fallback phrases, inserts to DB, fires POST to `/api/escalations` which sends email via Resend within seconds (fire-and-forget, 5s timeout). |
| DESK-07 | 04-02 | Front Desk AI maintains conversation context across multiple messages | SATISFIED | WhatsApp uses `wa_{hotelId}_{phone}` conversation ID (persistent per guest phone), widget uses `widget_{hotelId}_{uuid}` (per session). Both use `invokeAgent` which loads last 20 turns from `conversation_turns`. |
| WHAP-01 | 04-02 | WhatsApp Business API connection via gateway provider (Twilio) | SATISFIED | `twilio@5.12.2` in `package.json`. `sendReply.ts` wraps Twilio `messages.create()`. Webhook validates `X-Twilio-Signature`. |
| WHAP-02 | 04-02 | Incoming guest messages routed to correct AI employee based on context | SATISFIED | `resolveHotelFromNumber` routes to hotel via `hotel_whatsapp_numbers` table. `invokeAgent` called with `AgentRole.FRONT_DESK`. |
| WHAP-03 | 04-02 | AI responses sent back to guest via WhatsApp | SATISFIED | `sendWhatsAppReply` called in `webhook/route.ts` line 125 with full AI response. |
| WHAP-04 | 04-02 | Conversation history persisted and viewable in owner dashboard | PARTIAL | Persistence implemented: `invokeAgent` persists turns with `wa_` prefix in `conversation_turns` table. Owner dashboard view deferred to Phase 5 plan 05-03 (documented in 04-02-SUMMARY.md as intended partial delivery). |
| CHAT-01 | 04-03 | Embeddable web chat widget for hotel website | SATISFIED | `/widget/[token]` page — hotels embed via `<iframe src="/widget/TOKEN">`. |
| CHAT-02 | 04-03 | Widget identifies hotel via token (no guest auth required) | SATISFIED | `/api/widget/session` resolves hotel from `widget_token`. Middleware bypasses auth for `/api/widget/*`. |
| CHAT-03 | 04-03 | Real-time message delivery via Supabase Realtime | SATISFIED | Server broadcasts via `supabase.channel(...).send({type:'broadcast',...})`. Client subscribes via `.on('broadcast', {event:'message'}, ...)`. |
| CHAT-04 | 04-03 | Widget supports hotel branding (colors, logo, welcome message) | SATISFIED | `ChatWidget.tsx` applies `widgetConfig.primary_color` to header and user bubbles; displays `widgetConfig.welcome_message` when no messages. |
| I18N-01 | 04-04 | Owner dashboard available in EN and TR | SATISFIED | `LocaleSwitcher` in dashboard header. `messages/en.json` and `messages/tr.json` cover Nav, Dashboard, FrontDesk, Knowledge, Settings, Onboarding, Common. |
| I18N-02 | 04-05 | AI employees respond in guest's detected language | SATISFIED | `agentFactory.ts` MULTILINGUAL SUPPORT block instructs Claude to detect and respond in guest's language. |
| I18N-03 | 04-04 | next-intl integration with Server Component support | SATISFIED | `next.config.ts` uses `createNextIntlPlugin`. `layout.tsx` calls `getLocale()` and `getMessages()` server-side. `NextIntlClientProvider` at root. |
| I18N-04 | 04-04 | Hotel knowledge base content servable in multiple languages | SATISFIED | No schema change needed — Claude translates knowledge base content at query time per MULTILINGUAL SUPPORT block. Documented as no-op in summaries. |

**Note on WHAP-04:** Conversation persistence is fully implemented. The "viewable in owner dashboard" aspect is intentionally partial — deferred to Phase 5 per documented plan decision (04-02-SUMMARY.md). This is an explicit architectural decision, not a gap.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/widget/ChatWidget.tsx` | 309, 311 | `placeholder=` attribute on HTML input | Info | These are HTML `<input placeholder>` attributes, not stub code. False positive on grep — no impact. |

No blockers or warnings found. All route handlers contain real implementations. No TODO/FIXME markers found in Phase 4 files.

---

### Human Verification Required

#### 1. Widget Chat End-to-End

**Test:** Open `/widget/[valid_hotel_token]` in a browser (obtain token from `hotels` table after migration applied). Send a message.
**Expected:** Hotel name appears in the blue header, primary color from `widget_config` applied, AI response appears within 5-10 seconds via Realtime Broadcast (no page reload).
**Why human:** Supabase Realtime delivery requires a live browser WebSocket connection. Cannot be verified from static code analysis.

#### 2. WhatsApp Message Pipeline

**Test:** Join Twilio sandbox, configure webhook URL to `/api/whatsapp/webhook`, send a message from a WhatsApp-enabled phone.
**Expected:** AI response received on the phone within 10-15 seconds.
**Why human:** Requires live Twilio sandbox + WhatsApp + deployed server environment.

#### 3. Dashboard Language Switching

**Test:** Log in to the dashboard, click the Globe/TR button in the header.
**Expected:** Nav labels switch to Turkish (Kontrol Paneli, Ön Büro, Bilgi Tabanı, Ayarlar). Clicking again switches back to English.
**Why human:** Server Component re-rendering with cookie-based locale requires a browser session.

#### 4. Escalation Email Notification

**Test:** Chat with the Front Desk AI and send a message like "This is an unusual request, please contact reception." (triggers phrase detection). Check hotel contact email inbox.
**Expected:** Email received with subject `[HotelName] Guest needs assistance`, containing the guest message and AI response.
**Why human:** Requires live Claude API, live Resend, and a configured hotel contact_email in the database.

---

### Gaps Summary

No gaps found. All 20 observable truths are verified. All 21 artifacts pass existence, substantive content, and wiring checks. All 14 key links are confirmed wired. All 20 requirement IDs (DESK-02, DESK-03, DESK-04, DESK-05, DESK-06, DESK-07, WHAP-01, WHAP-02, WHAP-03, WHAP-04, CHAT-01, CHAT-02, CHAT-03, CHAT-04, I18N-01, I18N-02, I18N-03, I18N-04, SAFE-04, SAFE-05) have verified implementation evidence.

The one partial item (WHAP-04 owner dashboard view) is an **intentional deferral** documented in 04-02-SUMMARY.md and 04-02-PLAN.md. The persistence half of WHAP-04 is complete. The presentation half is scoped to Phase 5.

---

_Verified: 2026-03-05T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
