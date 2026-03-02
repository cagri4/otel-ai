# Stack Research

**Domain:** AI-powered SaaS for boutique hotel virtual staff management
**Researched:** 2026-03-01
**Confidence:** MEDIUM-HIGH (core framework HIGH via official docs, AI/billing MEDIUM from training data + context)

---

## Executive Decision: Supabase over Firebase

**Recommendation: Supabase — no contest for this use case.**

Firebase (Firestore) uses a NoSQL document model. OtelAI is fundamentally relational: hotels have employees, employees have roles, conversations belong to employees and guests, billing ties to hotels. Trying to model this in Firestore means either duplication, N+1 fetches, or complex subcollection queries that become maintenance nightmares.

Supabase gives you:
- PostgreSQL with full JOIN support — essential for multi-tenant hotel + staff + conversation queries
- Row-Level Security (RLS) built into Postgres — tenant isolation at the DB layer, not application layer
- Realtime via WebSocket (postgres changes) — needed for live guest chat and internal agent status
- Auth that integrates with RLS policies — `auth.uid()` directly in policy definitions
- The user already has a working Supabase project (`spplymarkt`) — team familiarity exists
- `@supabase/ssr` package is explicitly listed in Next.js official auth docs

Firebase is appropriate for: simple document stores, mobile-first with offline sync, Google ecosystem integration. None of those apply here.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 16.1.6 | Full-stack framework | App Router is mature, Vercel-native deployment, Server Components reduce Claude API call latency, already decided |
| React | 19.x | UI runtime | Ships with Next.js 16, concurrent features improve streaming chat UX |
| TypeScript | 5.x | Type safety | Zod schema generation, Claude API response typing, RLS policy mismatches caught at compile time |
| Supabase | latest | Database + Auth + Realtime | PostgreSQL for relational hotel data, RLS for tenant isolation, Realtime for live chat — see decision above |
| Claude API (`claude-opus-4-6`) | current | AI agent engine | Already decided; Opus 4.6 for guest-facing chat (highest quality), Sonnet 4.6 for background/internal agent tasks (cost-efficient) |
| Tailwind CSS | v4 | Styling | Default in Next.js 16 (v3 requires a special guide); CSS-first config, faster builds with Turbopack |
| Stripe | latest | Subscription billing | Industry standard for SaaS; Webhooks via Next.js Route Handler; supports per-seat or per-hotel pricing |

### Authentication

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@supabase/ssr` | latest | Auth for Next.js App Router | Official Supabase package for cookie-based sessions; integrates with RLS; listed in Next.js official auth docs |
| `jose` | ^5.x | JWT verification in proxy/middleware | Edge-compatible; used in Next.js official auth docs for session encryption |

**Pattern:** Use `@supabase/ssr` for auth management. Supabase handles token refresh. In `proxy.ts` (Next.js middleware), read the Supabase session cookie and redirect unauthenticated users before route hits. Do NOT use NextAuth/Auth.js — it adds complexity without benefit when Supabase Auth already provides what's needed.

### Real-Time Chat Infrastructure

**Critical constraint from official Next.js docs (2026-02-27):** *"WebSockets won't work [on Vercel] because the connection closes on timeout, or after the response is generated."*

This means Supabase Realtime (WebSocket-based) must run **client-to-Supabase directly**, not through Next.js Route Handlers.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Supabase Realtime (client SDK) | latest | Guest chat delivery | Client subscribes directly to Supabase channel; bypasses Vercel function WebSocket limitation |
| SSE via Next.js Route Handler | built-in | Stream Claude API responses | `ReadableStream` response from Route Handler streams Claude token output to client; works on Vercel |
| `@supabase/supabase-js` | ^2.x | Client-side Supabase | Realtime subscriptions, row inserts |

**Chat flow:**
1. Guest sends message → POST to Next.js Route Handler (`/api/chat`)
2. Route Handler saves message to Supabase, calls Claude API with `stream: true`
3. Route Handler returns SSE stream (Claude tokens) to client
4. Other clients (hotel dashboard, other employees) see new messages via Supabase Realtime subscription

### Internationalization (i18n)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `next-intl` | ^3.x | Multi-language UI | Listed first in official Next.js i18n docs; App Router native; Server Component compatible (no bundle bloat); type-safe translation keys |

**Languages to support (minimum):** English, Dutch (NL), Turkish (TR) based on boutique hotel target market. `next-intl` handles locale routing via `app/[locale]/` convention.

**Do NOT use `i18next` + `react-i18next`:** Designed for client-side rendering. In Next.js App Router, translations shipped to client increase bundle size. `next-intl` runs on the server by default.

### Subscription Billing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `stripe` (Node SDK) | ^16.x | Subscription management | Server-side subscription creation, invoice retrieval, plan changes |
| Stripe Customer Portal | hosted | Self-serve billing management | Hotel owners can manage their own subscriptions without custom UI; saves months of dev time |
| Stripe Webhooks → Route Handler | built-in | Billing event processing | `POST /api/webhooks/stripe` handles `customer.subscription.updated`, `invoice.payment_failed`, etc. |

**Pricing model recommendation:** Per-hotel subscription, not per-AI-employee. Tiers based on number of active AI employees (e.g., Starter: 2 employees, Pro: 5, Enterprise: unlimited). This simplifies billing and aligns cost with value delivered.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sdk` | latest | Claude API client | All AI agent interactions; use streaming mode for guest-facing chat |
| `zod` | ^3.x | Schema validation | Validate Claude API outputs, form inputs, Stripe webhook payloads; used in Next.js official docs |
| `@tanstack/react-query` | ^5.x | Client-side async state | Guest chat UI polling fallback, hotel dashboard data fetching; mentioned in Next.js official docs |
| `shadcn/ui` | latest | UI component library | Hotel admin dashboard; built on Radix + Tailwind; no lock-in (components copied into project) |
| `lucide-react` | latest | Icons | Ships with shadcn/ui; consistent icon set |
| `react-hook-form` | ^7.x | Form management | Hotel onboarding, employee configuration forms |
| `date-fns` | ^3.x | Date formatting | Conversation timestamps, billing periods; locale-aware |
| `@formatjs/intl-localematcher` + `negotiator` | latest | Locale detection | Used in Next.js official i18n docs for Accept-Language header parsing |
| `drizzle-orm` | ^0.30.x | Type-safe DB queries | Optional — Supabase client is sufficient for most queries; use Drizzle only if complex migrations become frequent |

**On Drizzle vs raw Supabase client:** For this project, start with the Supabase client (`supabase.from('conversations').select(...)`). Drizzle adds complexity for a team that may be building this solo or with a small team. Add it in a later phase if query complexity demands it.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Turbopack | Build tool (dev) | Default in Next.js 16 dev mode; ~5x faster than Webpack |
| `@next/bundle-analyzer` | Bundle size analysis | Use before each production deploy to catch large dependencies |
| Vitest | Unit testing | Faster than Jest; compatible with modern ESM; test Claude prompt templates and billing logic |
| Playwright | E2E testing | Test critical flows: hotel onboarding, guest chat, billing |
| ESLint + Prettier | Code quality | Next.js ships with eslint config; add `eslint-plugin-jsx-a11y` for accessibility |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Firebase / Firestore | NoSQL document model fights against relational hotel-employee-conversation data; no SQL JOINs; RLS must be reimplemented in application layer | Supabase (PostgreSQL) |
| NextAuth.js / Auth.js | Adds session complexity when Supabase Auth already handles tokens + refresh + RLS integration | `@supabase/ssr` |
| `i18next` + `react-i18next` | Client-side i18n increases bundle size; not designed for React Server Components | `next-intl` |
| WebSockets via Next.js Route Handlers | **Verified: Does not work on Vercel** (function closes connection on timeout) | Supabase Realtime client SDK (direct to Supabase) |
| Socket.io | Requires persistent Node.js server; incompatible with Vercel serverless; WebSocket constraint above applies | Supabase Realtime + SSE streaming |
| Prisma | Heavy for this stack; Supabase client + generated types already provide type safety; migration tooling overlap with Supabase migrations | Supabase client or Drizzle if complex queries grow |
| Langchain / LangGraph | Over-engineered abstraction for this use case; adds a moving dependency on top of Claude API; Anthropic SDK is sufficient for hotel-domain agents | `@anthropic-ai/sdk` directly with custom agent loop |
| OpenAI API | User has Claude API already decided; mixing LLM providers adds cost complexity and inconsistent behavior across agents | Claude API only |
| CSS-in-JS (styled-components, Emotion) | Next.js docs explicitly note CSS-in-JS has App Router limitations with Server Components | Tailwind CSS v4 |
| React Context for global state | Doesn't work in Server Components; causes unnecessary client-side rendering | Zustand (if needed) + Server Component data fetching |

---

## Stack Patterns by Variant

**If hotel needs custom domain (e.g., chat.hotelname.com):**
- Use Next.js multi-tenant subdomain routing via `proxy.ts`
- Vercel supports wildcard domains on Pro plan
- Reference: Vercel Platforms Starter Kit (linked from Next.js official multi-tenant guide)

**If AI employee needs to take autonomous actions (book reservations, send emails):**
- Implement as tool-use in Claude API (`tools` parameter)
- Each tool maps to a Supabase mutation or external API call
- Do NOT use background job queues for MVP — Server Actions are sufficient
- Add Inngest or similar for background jobs only when autonomous tasks exceed 60s Vercel timeout

**If guest chat needs to work offline / in poor connectivity:**
- Add optimistic UI updates with `@tanstack/react-query` mutations
- Store pending messages locally, sync when connection restores
- Supabase Realtime handles reconnection automatically

**If multi-language AI responses are needed (Claude responding in guest's language):**
- Pass detected locale into Claude system prompt: `"Respond in {locale} language"`
- Do not translate Claude outputs post-hoc — instruct language directly
- `next-intl` handles UI only; Claude handles content language

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Next.js 16.1.6 | React 19.x | React 19 is required for Next.js 16 |
| Tailwind CSS v4 | Next.js 16 | Default; v3 needs explicit `tailwindcss@^3` pin |
| `@supabase/ssr` latest | Next.js 16 App Router | Uses cookie API (`cookies()` from `next/headers`) |
| `next-intl` ^3.x | Next.js 16 App Router | `app/[locale]/` structure required |
| `jose` ^5.x | Edge Runtime | Required for proxy.ts session verification |
| `@anthropic-ai/sdk` latest | Node.js 18+ / Edge partial | Use in Route Handlers (Node runtime), not Edge runtime (streaming headers differ) |
| Stripe ^16.x | Node.js 18+ | Webhook signature verification requires Node runtime; mark Route Handler with `export const runtime = 'nodejs'` |

---

## Installation

```bash
# Create project
pnpm create next-app@latest otel-ai --typescript --tailwind --app --turbopack

# Core: Database + Auth
pnpm add @supabase/supabase-js @supabase/ssr

# AI
pnpm add @anthropic-ai/sdk

# Billing
pnpm add stripe

# i18n
pnpm add next-intl @formatjs/intl-localematcher negotiator

# UI + Forms
pnpm add @tanstack/react-query react-hook-form zod date-fns lucide-react

# shadcn/ui (installs incrementally per component)
pnpm dlx shadcn@latest init

# Session / JWT
pnpm add jose

# Dev dependencies
pnpm add -D @types/negotiator vitest @playwright/test @next/bundle-analyzer
```

---

## Supabase vs Firebase: Full Decision Matrix

| Criterion | Supabase | Firebase (Firestore) | Winner |
|-----------|----------|----------------------|--------|
| Data model fit | PostgreSQL — relational hotel/staff/conversation tables with JOINs | NoSQL documents — forces denormalization for relational data | Supabase |
| Multi-tenant isolation | Row-Level Security at DB layer — `hotel_id = auth.uid()` in policy | Application-layer security rules — more complex, more error-prone | Supabase |
| Real-time chat | Postgres changes → WebSocket → client (Supabase Realtime) | Firestore live queries — similar capability | Tie |
| Auth integration | Auth JWT → RLS policies directly (`auth.uid()`) | Firebase Auth → separate Firestore rules | Supabase |
| Next.js official support | Listed in Next.js 16 official auth docs | Not mentioned | Supabase |
| Team familiarity | Used in `spplymarkt` project — existing env vars, patterns | No | Supabase |
| Pricing at scale | Predictable PostgreSQL row/bandwidth pricing | Per-read/write costs can spike with chat volume | Supabase |
| SQL query power | Full PostgreSQL — analytics queries for hotel admins easy | Limited aggregation — dashboard queries require Cloud Functions | Supabase |
| Migrations | Supabase CLI migrations with version control | Firebase schema is schemaless — harder to track | Supabase |

**Verdict: Supabase wins on 8/9 criteria for this specific use case.**

---

## Sources

- `https://nextjs.org/docs/app/guides` — guides index, version 16.1.6, lastUpdated 2026-02-27 (HIGH confidence)
- `https://nextjs.org/docs/app/guides/authentication` — Supabase listed as recommended auth library, Session management with jose, Zod for validation (HIGH confidence)
- `https://nextjs.org/docs/app/guides/internationalization` — next-intl listed first, @formatjs/intl-localematcher + negotiator pattern (HIGH confidence)
- `https://nextjs.org/docs/app/guides/backend-for-frontend` — WebSockets don't work on Vercel lambda (Route Handlers); SSE streaming works (HIGH confidence)
- `https://nextjs.org/docs/app/guides/production-checklist` — Tailwind v4 default confirmed (v3 guide is the exception), @tanstack/react-query mentioned for client-side fetching (HIGH confidence)
- `https://nextjs.org/docs/app/guides/tailwind-v3-css` — Confirmed Tailwind v4 is default in Next.js 16; v3 requires explicit downgrade (HIGH confidence)
- `https://nextjs.org/docs/app/guides/multi-tenant` — Vercel Platforms Starter Kit referenced (HIGH confidence)
- Claude SDK and model information (claude-opus-4-6, claude-sonnet-4-6) — system context (HIGH confidence per project background)
- Supabase Realtime architecture, RLS, and PostgreSQL capabilities — training data + supabase.com docs referenced via user's existing project (MEDIUM confidence — verify current Supabase Realtime pricing tier limits)
- Stripe subscription billing patterns — training data (MEDIUM confidence — verify current Stripe SDK version)
- `@anthropic-ai/sdk` streaming patterns — training data (MEDIUM confidence — verify current SDK version before implementation)

---

*Stack research for: OtelAI — Hotel AI Virtual Staff SaaS*
*Researched: 2026-03-01*
