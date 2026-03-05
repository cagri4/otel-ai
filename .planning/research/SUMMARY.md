# Project Research Summary

**Project:** OtelAI — Telegram-First Multi-Bot Hotel Staff Platform (v2.0 Milestone)
**Domain:** Agent-native SaaS — Telegram delivery layer on top of existing hotel AI platform
**Researched:** 2026-03-06
**Confidence:** HIGH

## Executive Summary

OtelAI v2.0 adds a Telegram-first delivery layer to an existing, working hotel AI SaaS platform. The core agent pipeline (`invokeAgent → Claude API → tools → persistTurn`) is already built and proven across WhatsApp and web widget channels. This milestone is fundamentally a channel extension, not a greenfield build: the primary engineering challenge is routing Telegram webhooks to the correct hotel and agent role, not building new AI capabilities. The recommended approach is to register a unique dynamic Next.js route per bot (`/api/telegram/[botToken]`), resolve hotel+role from a new `hotel_bots` DB table, and call the existing `invokeAgent()` function identically to the WhatsApp webhook pattern. The new product differentiator is the combination of one-dedicated-bot-per-AI-employee, conversational onboarding via a Setup Wizard bot, and per-employee pricing selection at trial end. No competitor in the hotel SaaS space operates owner management through Telegram.

The most significant hard constraint across all research: Telegram has no API for programmatic bot creation. Every bot must be created manually through @BotFather. This is not a limitation to engineer around — it is the intended Telegram platform design and must be reflected in all onboarding UX. The correct architecture response is a super admin panel where the admin creates bots via BotFather, stores the tokens, and registers webhooks server-side before sending the hotel owner a guided Setup Wizard deep link. A second major risk is the existing billing enforcement logic (`enforceAgentLimit()`) which uses tier-based agent caps incompatible with the new per-employee pricing model; this must be replaced before any per-seat billing is exposed to hotel owners.

Security and reliability require non-negotiable attention in the first phase: bot tokens must be encrypted at rest using Supabase Vault from day one (plaintext exposure would allow impersonation of every hotel's AI employees), and webhook handlers must return HTTP 200 before awaiting the agent response (Telegram's retry behavior causes duplicate AI responses and cascading Claude API costs if the handler blocks). Both patterns follow the existing WhatsApp webhook conventions in the codebase and do not require new infrastructure.

---

## Key Findings

### Recommended Stack

The project already contains everything needed except the Telegram bot framework. The existing validated stack (Next.js 16, Supabase, Claude API, Twilio, iyzico, Mollie, shadcn/ui, next-intl, Upstash, Resend) is unchanged. Net-new additions are minimal: `grammy` (TypeScript-native Telegram Bot API client, v1.41.1, published 2026-03-05) plus three grammY plugins for conversation state, rate limiting, and flood control. For the super admin dashboard charts, `@tremor/react` wraps Recharts with Tailwind-compatible pre-built components — though Tailwind v4 compatibility is unconfirmed and needs a test render before committing.

Neither iyzico nor Mollie has native per-seat quantity billing (unlike Stripe). Per-employee pricing is pure business logic: calculate `activeBots × unitPrice` server-side and update the subscription amount at activation/deactivation events. No new billing library is required.

**Core new technologies:**
- `grammy@^1.41.1`: Telegram Bot API client — TypeScript-native, webhook-first, Vercel serverless compatible; preferred over Telegraf due to cleaner types and native multi-bot support
- `@grammyjs/conversations@^2.1.1`: Multi-step Setup Wizard flows — replay-engine state machine; no manual state management needed
- `@grammyjs/storage-supabase@^2.5.0`: Session persistence — stores grammY state in existing Supabase DB, no new infrastructure
- `@grammyjs/auto-retry@^2.0.2`: Telegram 429 handling — automatic retry after `retry_after` interval, essential for multi-bot scale
- `@grammyjs/transformer-throttler@^1.2.1`: Outbound flood control — prevents hitting Telegram rate limits (30 msg/sec global, 1 msg/sec per chat) during proactive messaging
- `@tremor/react@^3.18.7`: Admin dashboard charts — KPI cards, bar charts, line charts for subscription analytics; Tailwind v4 compatibility needs verification before committing

### Expected Features

**Must have (table stakes — without these, the product feels broken):**
- One dedicated Telegram bot per AI employee role (Front Desk, Booking, Housekeeping, Guest Experience)
- Deep-link account activation (`t.me/OtelAISetupBot?start={hotelId}`) — standard Telegram onboarding pattern since 2018
- Setup Wizard bot guiding hotel owner through conversational onboarding with inline keyboard buttons at every step
- Subscription state enforcement: trial or paid = bots respond; expired = "subscribe to reactivate" message with link
- Trial countdown notifications via Telegram at days 7, 12, 13, 14
- Trial-end employee selection flow: inline keyboard showing each employee with usage stats and price; owner taps to select
- Payment link sent via Telegram to existing web checkout (iyzico/Mollie) — do NOT rebuild payments in Telegram
- Super admin panel: create hotel accounts, provision bots, generate deep links, view all hotel trial/subscription status
- Escalation via Telegram (parallel to existing email escalation)

**Should have (competitive differentiators):**
- Trial-end selection shows per-employee ROI stats ("handled 47 guest messages this week") — reduces churn at conversion
- Morning briefing proactive messages from each active bot (daily summary pushed to owner)
- Per-hotel AI cost visibility in admin panel (token count per hotel for cost management)
- Setup Wizard bot self-deactivation after onboarding completes (clean UX, no clutter)
- Employee bots with distinct custom names and avatars reinforcing the employee metaphor

**Defer to v2+:**
- Telegram Mini App for richer checkout UI
- Hotel staff Telegram group integration
- Multi-language Setup Wizard (EN/TR sufficient for launch markets)
- AI employee bots responding directly to guests via Telegram (guest channel stays WhatsApp)
- Single hotel management group with all bots (technically broken — group privacy mode prevents bot identity differentiation)

### Architecture Approach

The Telegram milestone adds a new delivery layer that slots cleanly under the existing agent pipeline. The architecture follows the same pattern as the WhatsApp webhook: a dynamic Next.js route handler validates the incoming request, resolves hotel+role from the database, calls `invokeAgent()` (unchanged), and delivers the response via the channel's send API. The only new DB table is `hotel_bots`, which maps bot tokens to hotel+role with per-bot webhook secrets. The Setup Wizard bot is a special case (single shared bot, not per-hotel) that resolves hotel context from the `?start={hotelId}` deep link payload. The super admin panel is a new route group (`/admin`) protected by JWT `app_metadata.role = 'super-admin'`, built with existing shadcn/ui and Tremor components.

**Major components:**
1. `hotel_bots` table — maps bot token to hotel+role+webhook_secret; hot-path lookup on every Telegram message (indexed on `bot_token`)
2. `POST /api/telegram/[botToken]/route.ts` — dynamic webhook handler; validates secret header, resolves hotel, calls invokeAgent, sends reply; always returns 200
3. `lib/telegram/sendMessage.ts` + `lib/telegram/registerWebhook.ts` — thin utility layer mirroring existing `lib/whatsapp/sendReply.ts` pattern
4. `/admin` route group + `/api/admin/**` routes — super admin UI for hotel creation, bot provisioning, deep link generation; guarded by JWT role
5. Modified `escalation.ts` — add `tg_` channel prefix detection; add `'telegram'` to DB CHECK constraint on `escalations.channel`
6. Modified `billing/plans.ts` — replace tier-based `enforceAgentLimit()` with `checkBillingStatus()` for per-seat model

**Build order (from ARCHITECTURE.md):**
1. DB migration (`hotel_bots` table + escalations channel constraint)
2. `lib/telegram/` utilities (sendMessage, registerWebhook)
3. Webhook route handler (core of the channel)
4. Bot provisioning API (admin backend)
5. Super admin UI + hotel creation
6. Bot provisioning UI
7. Setup Wizard bot handler
8. Per-bot billing enforcement

### Critical Pitfalls

1. **BotFather is manual-only — design UX around it** — There is no API to create Telegram bots. Every token comes from a human running `/newbot` in BotFather. The wizard must guide the owner through this step with inline instructions. Attempting to automate it violates Telegram ToS. The wizard must be resumable at the token-paste step.

2. **Plaintext bot token storage causes catastrophic breach** — A single DB exposure lets an attacker impersonate every hotel's AI employees. Use Supabase Vault from day one. Log only the first 10 characters of any token. Never expose tokens to the browser-side client.

3. **Webhook handler must return 200 before awaiting the agent** — Blocking on `invokeAgent()` triggers Telegram retry storms: up to 3 retries, each triggering another Claude API call and potentially sending duplicate replies. Return 200 immediately after validating the secret header. Deduplicate by `update_id` to handle retries during outages.

4. **Per-bot routing requires per-bot URL and per-bot secret** — Sharing one webhook URL or one `secret_token` makes it impossible to identify which hotel received a message (Telegram update payloads do not include the receiving bot's token). Use `[botToken]` dynamic route + unique `webhook_secret` per bot. Validate both before invoking any agent.

5. **Existing tier-based billing enforcement blocks per-seat activations** — `enforceAgentLimit()` uses hard caps (2, 4, 6 agents) incompatible with unlimited per-seat billing. Replace with subscription-active check. Update iyzico and Mollie product catalogs before any trial-expiry email is sent. Null `hotels.country` breaks provider routing at the worst moment (trial end).

6. **MarkdownV2 escaping causes silent message failures** — Claude outputs standard Markdown; Telegram MarkdownV2 requires escaping of `.`, `!`, `(`, `)`, `-` and others. An unescaped character causes Telegram to reject the entire `sendMessage` call with a 400 error and the owner receives nothing. Build `formatForTelegram()` before connecting any agent to Telegram output. Prefer `parse_mode: "HTML"` for simpler escaping.

7. **Setup Wizard drop-off requires durable session state** — Conversational onboarding has 3x higher abandonment than form-based flows. Wizard state must persist in Supabase (`setup_wizard_sessions` table), not in-memory. Handle `/start` as a resume command at every step. Show the AI working after step 3, not step 7. Send a 24-hour re-engagement message on wizard stall.

---

## Implications for Roadmap

Based on research, the dependency graph is clear. The webhook infrastructure is the critical path blocker for all other Telegram work. Billing model changes must be completed before any trial-expiry flow is exposed to hotel owners. The Setup Wizard is the highest-complexity feature (stateful conversation, BotFather guidance, resumability) and should be built after the simple employee-bot webhook is proven working.

### Phase 1: Database Foundation + Telegram Webhook Infrastructure

**Rationale:** All Telegram work is blocked without the `hotel_bots` table. The webhook handler is the critical path. Security (Vault, per-bot secrets, MarkdownV2 escaping, async 200 response) must be established before any token is stored or any bot goes live. This phase has no UI — pure backend. Verifiable with a single test bot against the live endpoint.

**Delivers:** Working Telegram webhook that routes messages to `invokeAgent()` and responds. A test hotel owner can message a bot and get an AI reply. Escalations correctly categorized as `channel = 'telegram'`. Bot token storage via Supabase Vault confirmed.

**Addresses:** Employee bot responses (table stakes), subscription enforcement in bots, escalation channel

**Avoids:** Webhook routing collapse (per-bot URL + secret), plaintext token storage (Vault from day one), retry storms (async 200 return), escalation mismatch (`tg_` prefix detection), MarkdownV2 failures (`formatForTelegram` utility), conversation ID collision (`tg_` namespace)

**Research flag:** Standard patterns — mirrors existing WhatsApp webhook implementation; Telegram API official docs are comprehensive. Skip `/gsd:research-phase`.

### Phase 2: Super Admin Panel + Bot Provisioning

**Rationale:** Bot provisioning is currently a manual curl-command flow. The super admin UI turns it into a repeatable operation. Hotel creation triggers the existing `handle_new_user` Supabase trigger, so no new user-creation logic is needed — just an admin interface. This phase gates all downstream hotel onboarding.

**Delivers:** Super admin can create hotel accounts, provision 4+ employee bots per hotel (entering BotFather tokens + triggering `setWebhook`), generate Setup Wizard deep links, and view all hotels with trial/subscription status in a Tremor-powered dashboard.

**Uses:** shadcn/ui, `@tremor/react` (verify Tailwind v4 compatibility early), Supabase service-role client, `lib/telegram/registerWebhook.ts` (from Phase 1), JWT `app_metadata.role = 'super-admin'` guard

**Avoids:** BotFather-manual constraint (admin handles provisioning for v1, owners never need to touch BotFather), Vault token storage confirmed in workflow

**Research flag:** Standard patterns — Next.js admin route group, Supabase auth.admin API, MakerKit JWT role pattern all documented. Install Tremor early and test one chart render before committing; if Tailwind v4 incompatible, use `recharts` directly. Skip `/gsd:research-phase` but validate Tremor install in the first task.

### Phase 3: Setup Wizard Bot (Conversational Onboarding)

**Rationale:** Highest-complexity feature — stateful multi-step conversation with BotFather guidance, drop-off recovery, and hotel knowledge base seeding. Depends on Phase 1 (webhook infrastructure) and Phase 2 (hotel record exists before wizard links to it). Uses `@grammyjs/conversations` plugin for wizard state management over the replay engine.

**Delivers:** Hotel owner receives email with deep link, taps it, completes conversational onboarding via Telegram (hotel name, city, room count, language), sees all 4 employee bots activated with direct links. Trial starts. Knowledge base seeded via existing `update_hotel_info` tool. Wizard resumes after drop-off. Re-engagement message sent after 24-hour stall.

**Implements:** Setup Wizard bot handler (special `/start {hotelId}` detection), `setup_wizard_sessions` table for durable state, `@grammyjs/conversations` replay engine, BotFather token-entry guidance step with inline screenshot/instructions, 5-step-max-before-value constraint

**Avoids:** Wizard drop-off (Supabase-persisted sessions, resume on any message), BotFather UX confusion (step-by-step guide inline in wizard), all 7-step abandonment traps

**Research flag:** Needs `/gsd:research-phase` — `@grammyjs/conversations` v2.x has specific patterns for `conversation.external()` wrappers around Supabase calls; replay engine behavior on session resumption after days-long gap needs verification against current docs.

### Phase 4: Billing Model Migration + Trial-End Conversion Flow

**Rationale:** Per-employee pricing is a breaking change to existing billing enforcement. Must be completed before any trial-end flow is shipped. The trial-end Telegram selection flow (inline keyboard with ROI stats per employee) is the highest-stakes conversion moment; every friction point in the checkout flow costs approximately 3% conversion rate.

**Delivers:** `enforceAgentLimit()` replaced with subscription-active check. iyzico and Mollie product catalogs updated to per-employee pricing. Trial countdown notifications (days 7, 12, 13, 14) sent via Telegram. Trial-end employee selection flow with per-employee usage stats, pricing, and confirmation. Payment deep link to web checkout. Null `hotels.country` handled before checkout routing. Active/inactive bots updated based on selection.

**Implements:** Billing enforcement refactor, per-bot billing sync on activation/deactivation, Mollie `update-subscription` amount update pattern, iyzico plan tiering strategy (fixed plans vs dynamic amounts — requires support confirmation), `subscriptions` table extended with `price_per_bot_eur/try`, trial notification cron

**Avoids:** Tier-billing conflicts (replace enforceAgentLimit entirely), trial-to-paid drop-off (ROI stats, correct provider routing, country null guard), prorated mid-cycle billing surprises

**Research flag:** Needs `/gsd:research-phase` — iyzico's support for dynamic subscription amount updates is MEDIUM confidence and requires direct iyzico support confirmation before committing. Mollie `update-subscription` live amount change behavior needs a test against the Mollie sandbox. Prorated billing for both providers mid-cycle is not fully documented.

### Phase 5: Proactive Messaging + Operational Polish

**Rationale:** Proactive features (morning briefings, milestone dispatch via Telegram) extend the existing cron infrastructure. Rate limiting must be correct before scaling to multiple hotels simultaneously. These features add retention value but are not blocking for initial launch.

**Delivers:** Morning briefing messages from each active employee bot (daily summary). Rate-limited Telegram send queue replacing `Promise.all()` in cron jobs. Escalation delivery via Telegram (parallel to email). Per-hotel AI usage visibility in admin panel (Tremor charts for token costs).

**Implements:** `@grammyjs/transformer-throttler` integration, rate-limited queue (20 msg/sec global, 1 msg/sec per chat), 429 retry with `retry_after` plus jitter, `milestoneDispatch.ts` Telegram extension, admin panel AI cost dashboard, Telegram escalation send path alongside existing email

**Avoids:** Send rate limit 429 storms (throttler + queue replace `Promise.all()`), `update_id` deduplication during retry storms, bulk send failures

**Research flag:** Standard patterns for rate limiting and cron extension. Skip `/gsd:research-phase`.

### Phase Ordering Rationale

- **Infrastructure before UI:** Phase 1 (DB + webhook) unblocks all Telegram work. Phase 2 (admin UI) unblocks hotel onboarding. Phase 3 (wizard) unblocks owner self-service. This dependency chain is dictated by architecture.
- **Security from day one:** Bot token Vault encryption and per-bot webhook secrets are Phase 1 requirements, not retrofits. Retrofitting encryption after tokens are stored in plaintext requires a migration of live credentials — high-risk operation.
- **Billing before conversion:** Phase 4 must complete before any trial-expiry notification is sent. Sending owners to a checkout page with wrong pricing or wrong provider routing at trial end is a one-chance failure that cannot be recovered gracefully.
- **Proactive features last:** Phase 5 adds retention value but has no hard dependencies beyond Phase 1. It ships after the core owner-bot interaction loop is validated.

### Research Flags

**Needs `/gsd:research-phase` during planning:**
- **Phase 3 (Setup Wizard):** `@grammyjs/conversations` v2.x replay engine behavior on session resume after days-long gap; `conversation.external()` wrapping patterns for Supabase calls in the replay context; wizard state resumption mechanics need implementation verification against current grammY docs
- **Phase 4 (Billing Migration):** iyzico dynamic subscription amount support is MEDIUM confidence — needs iyzico support confirmation before committing to dynamic per-seat vs tiered fixed plans; Mollie `update-subscription` live amount change behavior needs sandbox test; prorated billing behavior for both providers

**Standard patterns — skip `/gsd:research-phase`:**
- **Phase 1 (Telegram Infrastructure):** Mirrors existing WhatsApp webhook; official Telegram API docs cover all patterns comprehensively; Next.js dynamic routes are standard
- **Phase 2 (Admin Panel):** Standard Next.js admin route group; Supabase auth.admin API is documented; JWT role guard pattern is established
- **Phase 5 (Proactive Messaging):** grammY throttler plugin documented; rate limiting is standard queue pattern

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | npm versions verified live (2026-03-06); grammY official docs comprehensive; only Tremor/Tailwind v4 is LOW confidence with a recharts fallback available |
| Features | MEDIUM-HIGH | Telegram API patterns HIGH; hotel-specific multi-bot SaaS is novel with no direct comparators; per-employee pricing UX patterns MEDIUM from general SaaS literature |
| Architecture | HIGH | Existing codebase read directly; Telegram API official docs verified for all patterns; dynamic route + per-bot secret pattern confirmed in community production use; one latent bug identified (assembleContext session client on webhooks) |
| Pitfalls | HIGH | Telegram API mechanics verified against official docs; codebase-specific pitfalls derived from reading actual source files (invokeAgent.ts, billing/plans.ts, whatsapp/webhook/route.ts); billing/UX conversion patterns MEDIUM from SaaS benchmarks |

**Overall confidence:** HIGH

### Gaps to Address

- **Tremor/Tailwind v4 compatibility:** Install `@tremor/react` early in Phase 2 and render a BarChart in isolation. If incompatible, use `recharts@^3.7.0` directly with shadcn styling — same underlying engine.
- **iyzico dynamic subscription amounts:** Contact iyzico support before Phase 4 design begins. Cannot be resolved by code alone. Determine: dynamic amount update vs tiered fixed plans. This is a billing architecture decision.
- **Vercel function timeout with Claude + tool chains:** Vercel Pro 60s timeout is assumed. If complex tool chains (5 recursion rounds) approach 60s, Phase 5 will need Upstash QStash for background processing. Monitor in Phase 1 with realistic agent calls.
- **`assembleContext.ts` session client behavior on webhook calls:** ARCHITECTURE.md flags a potential latent bug: `assembleContext.ts` calls `createClient()` (session-based) inside `invokeAgent()` which is called from webhook handlers with no session cookies. Phase 1 must test this explicitly and add `_serviceClient` param to `invokeAgent` if broken. May be an existing silent bug in the WhatsApp webhook.
- **BotFather flow UX validation:** Confirm whether hotel owners find the manual BotFather step acceptable in real usability testing. If it causes consistent drop-off, default to super-admin-creates-all-bots model for all hotels (admin handles BotFather, owners never touch it).

---

## Sources

### Primary (HIGH confidence)
- Telegram Bot API official docs (`core.telegram.org/bots/api`) — setWebhook, secretToken, rate limits, retry behavior, deep links
- Telegram webhook guide (`core.telegram.org/bots/webhooks`) — retry behavior, SSL requirements, 60-second timeout
- Telegram Bots FAQ (`core.telegram.org/bots/faq`) — rate limits (30 msg/sec global, 1 msg/sec per chat, 20 msg/min groups)
- grammY official docs (`grammy.dev`) — Vercel hosting, webhookCallback, conversations plugin, flood limits
- Supabase Vault docs (`supabase.com/docs/guides/database/vault`) — encrypted column storage, statement logging warning
- OtelAI codebase (direct file reads) — `invokeAgent.ts`, `whatsapp/webhook/route.ts`, `agentFactory.ts`, `billing/plans.ts`, `billing/enforcement.ts`, migrations 0001-0008
- npm registry (live `npm info` calls 2026-03-06) — grammy@1.41.1, @grammyjs/conversations@2.1.1, @tremor/react@3.18.7, recharts@3.7.0

### Secondary (MEDIUM confidence)
- SaaS per-seat pricing patterns (getmonetizely.com, metronome.com, schematichq.com) — per-employee pricing pitfalls and enforcement patterns
- Mollie subscriptions API docs — update-subscription amount changes, no native quantity multiplier confirmed
- iyzico subscription docs — fixed-amount plans, no per-seat quantity parameter confirmed
- Trial-to-paid conversion benchmarks (pulseahead.com) — 15-25% opt-in, 5-15% opt-out conversion rates
- MakerKit super admin pattern — JWT app_metadata.role approach for Next.js + Supabase
- Telegram conversational onboarding patterns (coincodecap.com, voiceflow.com/blog) — wizard design principles
- NN/g new AI user onboarding research — 3x higher abandonment for chatbot-only vs hybrid onboarding

### Tertiary (LOW confidence — needs validation)
- Tremor/Tailwind v4 compatibility — NOT confirmed; community reports mixed; needs live test install
- iyzico dynamic amount subscription support — official docs show no quantity parameter; direct support confirmation required
- Hotel-specific Telegram owner-management SaaS patterns — no direct comparators found; patterns inferred from general Telegram bot SaaS literature

---

*Research completed: 2026-03-06*
*Ready for roadmap: yes*
