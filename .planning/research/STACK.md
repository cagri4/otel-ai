# Stack Research

**Domain:** AI-powered SaaS — Telegram-first multi-bot hotel staff platform
**Researched:** 2026-03-06
**Confidence:** HIGH for grammY/Telegram mechanics, MEDIUM for billing per-seat model, HIGH for admin panel

---

## Scope

This document covers only **net-new additions** for the Telegram milestone. The existing validated stack (Next.js 16, Supabase, Claude API, Twilio, iyzico, Mollie, shadcn/ui, react-hook-form, next-intl, Upstash, Resend) is NOT re-researched.

Current `package.json` already includes: `@anthropic-ai/sdk`, `@supabase/ssr`, `@supabase/supabase-js`, `iyzipay`, `@mollie/api-client`, `twilio`, `shadcn`, `next-intl`, `@upstash/ratelimit`, `zod`, `react-hook-form`, `resend`, `lucide-react`, `date-fns`.

---

## New Stack Additions

### Telegram Bot Framework

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `grammy` | `^1.41.1` | Telegram Bot API client | TypeScript-first framework, active maintenance (v1.41.1 published March 5 2026), native `webhookCallback` for Next.js App Router, `secretToken` validation built-in, Vercel Serverless Function compatible |
| `@grammyjs/conversations` | `^2.1.1` | Multi-step onboarding flows | Enables wizard-like conversation sequences (ask name, assign role, confirm) without manual state machines; uses replay engine — no SSE, no polling |
| `@grammyjs/storage-supabase` | `^2.5.0` | Persist conversation/session state | Stores grammY session data in existing Supabase tables; same DB, no new infrastructure |
| `@grammyjs/auto-retry` | `^2.0.2` | Handle Telegram 429 rate limits | Auto-retries API calls after `retry_after` interval; essential for multi-bot environments hitting Telegram API limits |
| `@grammyjs/transformer-throttler` | `^1.2.1` | Outgoing message flood control | Prevents hitting Telegram's global/chat/group limits when broadcasting to many bots simultaneously |

**Why grammY over Telegraf:**
grammY is TypeScript-native from the ground up (Telegraf v4 migrated from JS and has inconsistent typing). grammY's `webhookCallback` function produces a standard `NextResponse`-compatible handler, making it drop-in for Next.js App Router Route Handlers. grammY v1.41.1 is actively maintained (published 2026-03-05); Telegraf is slower-moving. For serverless (Vercel), grammY's webhook-first design is the right fit — long polling requires a persistent process.

**Why NOT Telegraf:**
Telegraf v4 types are brittle (known community issue). The Telegraf NestJS integration `@grammyjs/nestjs` is the only multi-bot solution, which couples you to NestJS. grammY handles multi-bot via dynamic instantiation natively.

### Admin Panel (Super Admin)

No new UI library is needed. The project already has `shadcn` (v3.8.5) and `lucide-react`. For the super admin panel:

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@tremor/react` | `^3.18.7` | Charts/metrics for admin dashboard | Pre-built BarChart, LineChart, KPICard components for hotel subscription analytics; built on Radix + Tailwind (compatible with existing stack); no new CSS framework needed |
| Supabase service role client | existing `@supabase/supabase-js` | Bypass RLS for admin operations | `createClient(url, SERVICE_ROLE_KEY)` in Server Actions/Route Handlers only — never expose to client; list all hotels, override billing, inspect logs |

**Why Tremor over Recharts directly:**
Tremor wraps Recharts with pre-styled, accessible components that match Tailwind-first projects. Raw Recharts requires significant custom styling to look production-ready. Tremor v3.18.7 is the latest stable release.

**Why NOT a separate admin framework (AdminJS, Refine):**
AdminJS and Refine add significant bundle weight and opinionated routing that conflicts with Next.js App Router conventions. Since the project already has shadcn + Tailwind, composing admin UI from existing components is faster and more maintainable. The super admin panel is low-traffic internal tooling — it does not need a dedicated framework.

### Per-Employee (Per-Seat) Billing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@mollie/api-client` | `^4.4.0` (existing) | EU per-seat subscription | Mollie subscriptions support `quantity` in amount but NOT native per-seat quantity billing — implement by updating subscription `amount` on employee add/remove |
| `iyzipay` | `^2.0.65` (existing) | TR per-seat subscription | iyzico subscriptions are fixed-amount plans; per-seat requires same workaround: create new plan or update amount dynamically |

**Per-seat billing implementation pattern (both iyzico and Mollie):**

Neither iyzico nor Mollie has Stripe-style `quantity` × `unit_price` per-seat subscriptions. The correct pattern for both:

1. Define base plans: `starter_1_employee`, `starter_2_employees`, etc. OR use a single plan and bill seat additions as one-off charges.
2. When hotel owner adds/removes an AI employee via super admin or self-service, trigger a plan upgrade/downgrade API call.
3. Alternatively: calculate `seats × unit_price` server-side, create a new subscription amount for next billing cycle.

This is a business logic concern implemented in Server Actions — not a new library. No additional billing library is needed.

**iyzico constraint (verified):** iyzico subscriptions are credit-card-only and use fixed-interval/fixed-amount plans. No quantity parameter in the subscription product API. Per-seat means creating distinct plans (e.g., "1 Employee — 299 TRY/mo", "2 Employees — 499 TRY/mo") OR adjusting the charged amount each billing cycle. Confirm with iyzico support before committing to dynamic amounts.

**Mollie constraint (verified):** Mollie Subscriptions API `update-subscription` allows changing `amount` and `interval`, but no native `quantity` multiplier. Same pattern as iyzico — create tiered plans or update amount on seat change.

---

## Multi-Bot Architecture: Critical Constraint

**BotFather is mandatory — bots cannot be created programmatically.**

Telegram's API has no endpoint to create a new bot. BotFather (`@BotFather` in Telegram) is the only way to obtain a bot token. This is a hard platform constraint as of 2026-03-06.

**Implication for onboarding flow:**
The super admin (or hotel owner, depending on UX decision) must:
1. Open Telegram, go to @BotFather
2. Create a new bot for each AI employee (e.g., `/newbot` → name: "Otel Fatma Hanım" → username: `otel_fatma_bot`)
3. Paste the received token into OtelAI super admin panel

OtelAI then stores the token in Supabase `telegram_bots` table (encrypted at rest), registers the webhook via `https://api.telegram.org/bot{TOKEN}/setWebhook`, and the bot is live.

**There is no workaround for programmatic creation.** Design UX to make BotFather token entry as simple as possible (guided instructions, deep-link to BotFather, copy-paste field).

---

## Multi-Bot Webhook Routing

**Pattern: Dynamic Next.js Route Handler with token in path**

```
/api/telegram/[botToken]/route.ts
```

Each bot's webhook is registered as:
```
https://otelai.com/api/telegram/{ENCRYPTED_TOKEN_SLUG}/webhook
```

Using the token (or a hash of it) in the URL path:
1. Route Handler receives POST from Telegram
2. Looks up bot token from Supabase by path segment
3. Instantiates `new Bot(token)` for that specific bot
4. Processes update with `webhookCallback`

**Security:** Use `secretToken` parameter in `setWebhook` — grammY's `webhookCallback` validates `X-Telegram-Bot-Api-Secret-Token` header automatically when `secretToken` option is provided. Use a per-bot secret, not a global one.

**Vercel timeout constraint:**
- Free/Hobby: 10s function timeout
- Pro: 60s timeout
- Claude API responses for AI employees may exceed 10s on complex queries

**Mitigation:** Use Vercel Pro (60s) OR implement the "fire and forget" pattern:
1. Webhook handler acknowledges Telegram within 1-2s (200 OK)
2. Enqueues the actual AI processing to Upstash Redis / QStash
3. Background worker (separate Vercel function or Upstash QStash job) calls Claude and sends response via `bot.api.sendMessage()`

The project already has `@upstash/redis` — Upstash QStash (queue) can be added as the background job solution if needed.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Telegraf | TypeScript types are problematic; NestJS-coupled multi-bot solution | grammY |
| `node-telegram-bot-api` | Low-level, no TypeScript, no conversations plugin, unmaintained | grammY |
| GramIO | Newer alternative with smaller ecosystem, fewer plugins, less documentation | grammY (larger ecosystem, more plugins) |
| Long polling in production | Requires persistent Node.js process; incompatible with Vercel serverless | Webhooks via Next.js Route Handlers |
| Separate admin framework (AdminJS, Refine) | Conflicts with Next.js App Router; heavier than necessary for internal tooling | shadcn/ui + Tremor (already in stack) |
| Separate billing library for per-seat | Neither iyzico nor Mollie needs a new library — business logic only | Server Actions with existing `iyzipay`/`@mollie/api-client` |
| Upstash QStash (preemptive) | Only needed if Vercel Pro 60s timeout proves insufficient for Claude responses | Add in Phase 2+ if timeout issues emerge |
| Telegram MTProto client (telegram.js, gramjs) | MTProto is for user accounts, not bots — different API entirely, unnecessary complexity | Telegram Bot API via grammY |

---

## Installation

```bash
# Telegram bot framework + plugins
pnpm add grammy @grammyjs/conversations @grammyjs/storage-supabase @grammyjs/auto-retry @grammyjs/transformer-throttler

# Admin dashboard charts (super admin panel)
pnpm add @tremor/react
```

**No new dev dependencies required** — TypeScript types for grammY are bundled in the package itself.

---

## Integration Points with Existing Stack

| Existing | New | Integration |
|----------|-----|-------------|
| `@supabase/supabase-js` | `@grammyjs/storage-supabase` | grammY sessions stored in Supabase `grammy_sessions` table; same DB connection |
| `@anthropic-ai/sdk` | grammY message handlers | Claude called inside grammY conversation handlers; `conversation.external(() => claude.messages.create(...))` to wrap side effects |
| `@upstash/ratelimit` | grammY middleware | Rate-limit Telegram users per bot using existing Upstash setup; `@grammyjs/ratelimiter` is an alternative but Upstash approach is already in project |
| `iyzipay` / `@mollie/api-client` | Supabase `telegram_bots` table | Employee count change triggers billing update via existing payment clients in Server Actions |
| `next-intl` | grammY message handlers | Hotel's locale stored in Supabase; inject into Claude system prompt for correct response language (Telegram messages are plain text, not i18n-routed) |
| Supabase service role | Super admin panel | Server Actions use `createClient(url, SERVICE_ROLE_KEY)` to read all hotels, override billing, manage bot tokens |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `grammy@^1.41.1` | Node.js 18+, Next.js 16 App Router | Use in Route Handlers with `export const runtime = 'nodejs'` (NOT Edge — grammY has Node-only dependencies for some plugins) |
| `@grammyjs/conversations@^2.1.1` | `grammy@^1.41.1` | Must use matching major versions; v2.x requires grammY v1.x |
| `@grammyjs/storage-supabase@^2.5.0` | `@supabase/supabase-js@^2.x` | Compatible with existing Supabase client version |
| `@tremor/react@^3.18.7` | Tailwind CSS v4, React 19 | Tremor v3 officially supports Tailwind v3; v4 compatibility needs verification — test with existing `tailwindcss@^4.2.1`. Fallback: use Recharts directly with shadcn styling. |
| `@grammyjs/auto-retry@^2.0.2` | `grammy@^1.41.1` | API transformer; no runtime conflicts |

**Tremor + Tailwind v4 risk (LOW-MEDIUM confidence):** Tremor v3.18.7 was built targeting Tailwind v3. The project uses Tailwind v4. Tremor may have styling issues. Verify by installing and rendering a BarChart in isolation before committing. Alternative: use Recharts (`recharts@^3.7.0`) directly with shadcn-compatible styling.

---

## Alternatives Considered

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| Bot framework | `grammy` | `telegraf` | If team has existing Telegraf codebase; not recommended for greenfield |
| Bot framework | `grammy` | `GramIO` | Newer, potentially faster — viable if grammY ecosystem gaps emerge in 2026 |
| Admin charts | `@tremor/react` | `recharts` directly | If Tremor/Tailwind v4 incompatibility confirmed; Recharts is the underlying engine |
| Session storage | `@grammyjs/storage-supabase` | `@grammyjs/storage-psql` (v2.5.1) | psql adapter is slightly newer; use if Supabase-specific adapter has bugs |
| Background jobs | Not added yet | Upstash QStash | Add if Vercel Pro 60s timeout insufficient for Claude + tool-use chains |

---

## Sources

- `npm info grammy version` — v1.41.1, verified 2026-03-06 (HIGH confidence)
- `npm info @grammyjs/conversations version` — v2.1.1 (HIGH confidence)
- `npm info @grammyjs/storage-supabase version` — v2.5.0 (HIGH confidence)
- `npm info @grammyjs/auto-retry version` — v2.0.2 (HIGH confidence)
- `npm info @tremor/react version` — v3.18.7 (HIGH confidence)
- `npm info recharts version` — v3.7.0 (HIGH confidence)
- [grammY Vercel hosting docs](https://grammy.dev/hosting/vercel) — webhook setup, 10s timeout constraint, streaming workaround (HIGH confidence)
- [grammY webhookCallback API ref](https://grammy.dev/ref/core/webhookcallback) — secretToken parameter confirmed (HIGH confidence)
- [grammY conversations plugin](https://grammy.dev/plugins/conversations) — replay engine, `conversation.external()` pattern, form APIs (HIGH confidence)
- [Telegram Bot API docs](https://core.telegram.org/bots/api) — setWebhook secretToken, Bot API v9.2 current (HIGH confidence)
- [Telegram BotFather mandatory](https://community.latenode.com/t/create-telegram-bot-programmatically-without-botfather/29160) — no programmatic bot creation API exists (HIGH confidence — community + official Telegram docs confirm)
- [iyzico subscription docs](https://docs.iyzico.com/en/products/subscription/subscription-implementation) — no quantity/per-seat parameter; fixed-amount plans only (MEDIUM confidence — official docs reviewed, no per-seat found)
- [Mollie subscriptions API](https://docs.mollie.com/reference/subscriptions-api) — update-subscription allows amount change; no native quantity multiplier (MEDIUM confidence — official docs reviewed)
- WebSearch: grammY vs Telegraf comparison — community sources, multiple consistent findings (MEDIUM confidence)
- WebSearch: Tremor Tailwind v4 compatibility — NOT confirmed; flagged as risk (LOW confidence — needs testing)

---

*Stack research for: OtelAI — Telegram-first multi-bot hotel staff milestone*
*Researched: 2026-03-06*
