# Project Research Summary

**Project:** OtelAI — AI Virtual Hotel Staff SaaS
**Domain:** Multi-agent AI SaaS for boutique hotel virtual staff management
**Researched:** 2026-03-01
**Confidence:** MEDIUM (stack HIGH via official docs; features/architecture/pitfalls MEDIUM via training knowledge)

## Executive Summary

OtelAI is a multi-tenant SaaS platform that provides boutique hotels (10-50 rooms) with AI-powered virtual staff members — each with a defined role, persona, and scope — rather than a generic chatbot. The product's core differentiator is the employee metaphor: hotels get a named AI receptionist, booking assistant, and guest experience manager they can configure and "talk to," much like managing real staff. This framing is absent in all identified competitors (Asksuite, Quicktext, HiJiffy), which present as tools or widgets. Research confirms this positioning is technically achievable with the current Claude API and Supabase stack, and the boutique hotel segment has genuine unmet need for 24/7 staff coverage at sub-enterprise cost.

The recommended architecture is a stateless multi-tenant system: Next.js 16 on Vercel, Supabase PostgreSQL with Row Level Security (RLS) for tenant isolation, and Claude API (`claude-opus-4-6` for guest-facing, `claude-sonnet-4-6` for internal tasks) invoked on-demand with assembled context. Agents are not persistent processes — context is loaded from the database on each invocation and the Claude context window is the working memory for that turn. This is the correct pattern for Vercel's serverless infrastructure. WhatsApp Business API (via gateway) and web chat widget are the primary guest channels; Supabase Realtime delivers live updates to the owner dashboard. Stripe with tiered pricing (per number of active AI employees) handles subscription billing.

The most critical risks center on guest-facing AI behavior: hallucinating availability or prices without tool calls, multi-tenant data leakage between hotels, and insufficient human oversight for autonomous agent actions. These must be addressed in architecture before any guest-facing deployment — they are not polish items. Secondary risks include onboarding friction killing activation (boutique hotel owners are not technical; first value must come in under 5 minutes), context window management for long conversations, and timezone handling in a globally deployed booking system.

---

## Key Findings

### Recommended Stack

Supabase (PostgreSQL) wins decisively over Firebase for this use case: the data model is fundamentally relational (hotels, employees, guests, conversations, bookings), and RLS provides tenant isolation at the database layer rather than requiring application-level security reimplementation. The team already has Supabase familiarity from the `spplymarkt` project. One critical constraint from verified Next.js 16 official documentation: WebSockets do not work through Vercel Route Handlers (function closes on timeout) — Supabase Realtime must be subscribed to directly from the client, not proxied through Next.js API routes.

**Core technologies:**
- **Next.js 16 + React 19**: Full-stack framework; App Router Server Components reduce Claude API call latency; Vercel-native deployment — decided
- **Supabase (PostgreSQL + Auth + Realtime)**: Database with full JOIN support, RLS for multi-tenant isolation, Realtime for live chat — preferred over Firebase on 8/9 decision criteria
- **Claude API** (`claude-opus-4-6` / `claude-sonnet-4-6`): Guest-facing agents use Opus for quality; background/internal agents use Sonnet for cost efficiency
- **Tailwind CSS v4**: Default in Next.js 16 (v3 requires explicit downgrade); CSS-first config, Turbopack-compatible
- **`@supabase/ssr`**: Official Supabase auth package for Next.js App Router; integrates with RLS via `auth.uid()` in policy definitions; listed in Next.js official auth docs
- **`next-intl` v3**: Listed first in Next.js official i18n docs; Server Component-native; type-safe translation keys; supports EN/TR/DE/FR for target market
- **Stripe**: Subscription billing; use tiered plans (Starter: 2 agents, Pro: 5, Enterprise: unlimited) over per-seat pricing — simpler to implement and reason about
- **SSE via Next.js Route Handler**: Streams Claude token output to client; works on Vercel (unlike WebSockets)

**Do not use:** Firebase (relational data model mismatch), NextAuth (Supabase Auth already handles this), Socket.io (no persistent server on Vercel), LangChain/LangGraph (abstraction overhead with no benefit over direct Claude SDK), Prisma (overlap with Supabase migration tooling).

### Expected Features

Research defines 6 AI employee roles. Three are guest-facing (Receptionist, Booking AI, Guest Experience AI) and three are internal-only (Housekeeping Coordinator, Revenue Manager, Finance AI). The MVP must validate the core loop — hotel configures AI → guests interact → owner sees results — before building internal operational roles.

**Must have for v1 (table stakes):**
- Front Desk AI (Role 1): 24/7 WhatsApp + web chat, FAQ answering, escalation to human, multi-language (EN + TR + 1 EU language)
- Guest Experience AI (Role 3): Pre-arrival package, checkout reminder, post-stay review request (milestone-triggered)
- Hotel Knowledge Base: Owner-editable; feeds both guest-facing roles; must exist before any AI can respond meaningfully
- Owner Dashboard: Chat with AI employees, view conversation history, escalation notification inbox
- Onboarding Wizard: Guided setup that reaches first working AI response in under 5 minutes; populates knowledge base
- WhatsApp Business API integration (via gateway, not direct Meta API): Primary guest channel
- Escalation system: Unhandled requests notify owner within 2 minutes
- Stripe subscription: Monthly billing with tiered plans

**Should have for v1.x (differentiators after validation):**
- Booking AI (Role 2): Handles availability inquiries over WhatsApp (HIGH complexity — requires real-time calendar sync)
- Housekeeping Coordinator (Role 4): Internal room status and task dispatch
- Guest sentiment tracking: Flags negative sentiment mid-stay for proactive intervention
- Employee performance analytics: Answers "is this working?" for owners
- Proactive check-in day message, soft upsell during inquiry

**Defer to v2+:**
- Revenue Manager AI (Role 5): Requires 3+ months of booking data to be useful
- Finance AI (Role 6): Requires accounting integration and compliance research
- Direct booking with payment processing: Requires legal review and dispute-handling design
- PMS integration (Mews, Cloudbeds): High per-customer integration cost; wait for demand signal
- Cross-agent collaboration / inter-agent messaging: Validate simpler version first
- Autonomous rate changes pushed to OTAs: Legal and operational risk; owner-approval required

**Critical anti-features (never build):**
- Fully autonomous booking with payment (no human confirmation): Legal liability
- Automated public review responses posted by AI: One bad response goes viral
- Automated OTA rate changes without approval: Revenue loss risk
- Generic catch-all AI assistant: Kills the employee metaphor that is the core differentiator

### Architecture Approach

The system uses a stateless multi-agent architecture where each AI employee is invoked on-demand (never a persistent process), receives assembled context from the database at call time, and writes results back to the database. Tenant isolation is enforced via RLS at the Supabase layer — every tenant-scoped table has a `hotel_id` column and a RLS policy. Agent-to-agent coordination is asynchronous via a tasks table (never synchronous direct calls between agents). The layered system prompt (role identity → hotel context → agent memory → behavioral instructions) is assembled fresh on every invocation to prevent stale context.

**Major components:**
1. **Hotel Owner Dashboard** (Next.js authenticated area): Chat with AI staff, configure employees, monitor tasks, view reports
2. **Guest-Facing Layer**: Embeddable web chat widget + WhatsApp webhook handler; uses hotel token for tenant identification (no auth required from guest)
3. **API Layer** (Next.js Route Handlers): Routes messages to correct agent, enforces tenant isolation, handles rate limiting
4. **Agent Orchestration Layer** (`lib/agents/`): Stateless `invokeAgent()` function; assembles context, calls Claude API, parses tool_use blocks, persists responses, triggers notifications
5. **Agent Context Bus** (Supabase tables, not a runtime bus): Shared hotel knowledge and per-agent memory loaded at invocation time
6. **Notification Service**: Supabase Realtime for in-app push; Resend for transactional email escalations
7. **Stripe Billing**: Subscription management with Stripe Customer Portal for self-serve plan changes

**Key patterns to follow:**
- Agent Factory with Role Registry: Central `AGENT_REGISTRY` maps role enum to role definition (prompt template, allowed tools, memory scope, guest-facing flag)
- Streaming Response with Structured Action Extraction: Claude `tool_use` blocks for structured actions alongside natural language text — no fragile string parsing
- Hybrid Autonomous + Interactive Mode: Same `invokeAgent()` handles both; autonomous mode triggered by Vercel Cron every 15 minutes
- Three-Tier Memory: Semantic (hotel facts, loaded every call), Episodic (guest-specific history, loaded conditionally), Working (last 15-20 conversation turns)

### Critical Pitfalls

1. **Guest-facing AI hallucinating prices/availability** — Enforce a "tool-first" policy: agent physically cannot answer availability or price questions without a successful tool call. Add to system prompt: "Never state room prices or availability unless retrieved from tools in this conversation." Test acceptance: disconnect DB tool, verify agent refuses to answer.

2. **Multi-tenant data leakage between hotels** — Every system prompt must be hotel-specific (never a shared constant). All tool calls require `hotel_id` as a non-optional parameter. RLS is the second layer (first layer is application filtering). Audit test: two test hotels with different pricing, verify zero cross-contamination.

3. **Agent autonomy without human oversight (runaway agent)** — Classify all agent actions as OBSERVE / INFORM / ACT. ACT-class actions (sends external communication, modifies booking, charges guest, affects multiple guests) require hotel owner confirmation or a pre-approved rule. Log all autonomous actions with 5-minute undo buffer. Design approval architecture before giving any agent write access to external systems.

4. **Context window exhaustion in long conversations** — Never dump raw full conversation history into every Claude call. Implement rolling context from day one: last N turns raw + older turns compressed into structured summary (`{ commitments, preferences, open_requests }`). Update summary after each exchange using a lightweight model call (Haiku).

5. **API latency making real-time chat feel broken** — Use streaming (SSE) for all guest-facing and owner-facing chat from the first day — it cannot be retrofitted without restructuring the response pipeline. Add typing indicator immediately on message send. Use `claude-haiku` for simple factual lookups; escalate to Opus/Sonnet only for complex reasoning.

6. **Onboarding friction killing activation** — Design for first value in under 5 minutes: hotel name, city, and contact is enough to start. Use progressive onboarding where AI staff ask for missing info during first "shift." Pre-populate boutique hotel defaults (check-in 3pm, check-out 11am). Track funnel step by step; any step with >20% drop-off gets redesigned before launch.

7. **Timezone handling disasters** — All timestamps stored as UTC in PostgreSQL (`timestamptz`). Convert to hotel-local time at display layer only. Pass explicit hotel timezone context (IANA string, e.g., `Europe/Istanbul`) in every agent call. Use `date-fns-tz` or `luxon` — never raw JavaScript Date for timezone-sensitive operations.

---

## Implications for Roadmap

Based on the architectural dependency chain and pitfall phase mapping, the following phase structure is recommended. Architecture research explicitly defines the build order; pitfalls map each risk to the phase where it must be prevented.

### Phase 1: Foundation — Database, Auth, Multi-Tenancy

**Rationale:** Everything else depends on the data model. RLS must be designed into the schema from day one — retrofitting it after second hotel is onboarded is a critical failure mode. Auth and tenant context extraction must exist before any API route is built. Timezone strategy, message sequencing, and data retention policy must be decided now.
**Delivers:** Supabase schema with RLS, `@supabase/ssr` auth, tenant context middleware, hotel CRUD, basic hotel knowledge base storage
**Addresses:** Platform-level features (subscription, hotel config)
**Avoids:** Multi-tenant data leakage (Pitfall 2), timezone disasters (Pitfall 6)
**Research flag:** Standard — well-documented Supabase RLS patterns; skip research-phase

### Phase 2: Agent Core + First AI Employee (Receptionist, Owner-Facing Only)

**Rationale:** Prove the agent pattern with one role before building five. The agent orchestrator, context builder, memory system, and layered system prompt assembly are the engine of the entire product. Owner-facing chat (no external channels yet) limits blast radius while the pattern is validated. Tool-first policy and least-privilege tool scoping must be implemented here.
**Delivers:** `invokeAgent()`, `context-builder`, `memory.ts`, agent factory/registry, Role 1 (Receptionist) working in owner dashboard chat
**Addresses:** Owner dashboard, chat with AI employees
**Avoids:** Guest-facing hallucination (Pitfall 1 — enforce tool-first before any guest exposure), prompt injection (Pitfall 4)
**Research flag:** Needs research-phase — Claude tool_use syntax, streaming response patterns, and prompt engineering for hotel domain require careful validation

### Phase 3: Onboarding Wizard + Hotel Knowledge Base Editor

**Rationale:** No agent is useful without hotel context. The onboarding flow is the critical activation bottleneck — research explicitly warns it is commonly built last and should be built first. Progressive onboarding reduces time-to-first-value below 5 minutes. This phase also builds the knowledge base editor that feeds both guest-facing roles.
**Delivers:** Multi-step onboarding wizard (hotel name/city/contact → first working AI), hotel knowledge base UI (owner-editable FAQs, room info, local recommendations), pre-populated boutique hotel defaults
**Addresses:** Onboarding wizard (P1 feature), hotel knowledge base editor (P1 feature)
**Avoids:** Onboarding friction (Pitfall 10)
**Research flag:** Standard — form UX and data management are well-understood; skip research-phase

### Phase 4: Guest-Facing Layer + WhatsApp Integration

**Rationale:** After the agent pattern is proven with the owner, open the external guest channel. WhatsApp is the primary revenue-generating channel for guest interactions. Web chat widget serves hotels without WhatsApp setup. Rate limiting, input sanitization, and least-privilege guest tool scoping are mandatory before this goes live.
**Delivers:** Embeddable web chat widget, WhatsApp webhook handler (via gateway — not direct Meta API), hotel token-based tenant identification for unauthenticated guests, rate limiting per IP and per hotel, streaming SSE response pipeline, typing indicator
**Addresses:** Front Desk AI (Role 1) guest-facing features, multi-language support (EN + TR + 1 EU language)
**Avoids:** API latency UX failure (Pitfall 8 — streaming must be implemented here, not retrofitted), multi-language failures (Pitfall 7), prompt injection from guest input (Pitfall 4)
**Research flag:** Needs research-phase — WhatsApp Business API gateway options (Twilio vs MessageBird vs others), Meta Business verification requirements, current API pricing

### Phase 5: Guest Experience AI (Role 3) + Escalation System

**Rationale:** Guest Experience AI is lower complexity than Booking AI (no real-time calendar sync required) and delivers high guest satisfaction value through milestone-triggered messages. The escalation system is a prerequisite for any trust in the guest-facing layer — owners need confidence the AI will involve them when needed.
**Delivers:** Pre-arrival package trigger (D-1), checkout reminder (morning of), post-stay review request (24h post-checkout), escalation system (unresolved requests notify owner within 2 minutes via email), notification inbox in owner dashboard
**Addresses:** Guest Experience AI (P1), escalation system (P1)
**Avoids:** Runaway agent without oversight (Pitfall 9 — escalation is the human oversight mechanism for guest-facing roles)
**Research flag:** Standard — milestone-triggered messages and notification patterns are well-documented; skip research-phase

### Phase 6: Stripe Subscription Billing

**Rationale:** Billing is deferred until core value is proven — consistent with PITFALLS.md recommendation. Free/trial model for early hotels validates product fit before introducing payment friction. Tiered pricing (Starter/Pro/Enterprise by number of active agents) is simpler to implement than pure per-seat. Stripe Customer Portal eliminates need for custom billing UI.
**Delivers:** Stripe subscription checkout, tiered plan enforcement (agent count limits by tier), Stripe webhook handler (idempotent), Stripe Customer Portal integration, mid-cycle upgrade/downgrade handling, cancellation flow with data retention grace period
**Addresses:** Stripe subscription (P1 feature)
**Avoids:** Billing complexity and revenue leakage (Pitfall 11), idempotency failures on Stripe webhook re-delivery
**Research flag:** Standard — Stripe subscription billing with proration is well-documented; skip research-phase

### Phase 7: Booking AI (Role 2) + Conversation Management

**Rationale:** Booking AI is HIGH complexity (requires real-time calendar/availability data, potential double-booking race conditions, payment flow). Deferred until the guest communication foundation is stable. Conversation management (rolling context window, summarization) is also addressed here — Booking AI conversations about availability and pricing are high-stakes and multi-turn.
**Delivers:** Booking inquiry handling over WhatsApp, availability lookup tool (transactional, atomic), soft upsell during inquiry, rolling context with structured summary (`commitments`, `preferences`, `open_requests`), token budget monitoring
**Addresses:** Booking AI (P2 feature)
**Avoids:** Booking race conditions (Pitfall 5 — atomic SELECT + INSERT transactions), context window exhaustion (Pitfall 3), hallucinated availability (Pitfall 1 — reiterate tool-first policy)
**Research flag:** Needs research-phase — PostgreSQL transaction patterns for atomic booking, current calendar sync options for boutique hotels without PMS

### Phase 8: Internal Operations — Housekeeping + Autonomous Mode

**Rationale:** Internal roles (Housekeeping Coordinator) are lower urgency but add significant operational value once guest-facing roles are generating usage data. Autonomous mode (cron-triggered agent invocations) is introduced here — only after interactive mode is stable and the action approval architecture is in place.
**Delivers:** Housekeeping Coordinator (room status board, cleaning priority queue, task assignment), autonomous agent mode (Vercel Cron every 15 minutes), action classification system (OBSERVE / INFORM / ACT), approval queue for ACT-class actions, audit log for all agent actions, undo buffer (5-minute window)
**Addresses:** Housekeeping Coordinator (P2), employee on/off scheduling
**Avoids:** Runaway agent (Pitfall 9 — ACT-class approval architecture must be built before autonomous write access)
**Research flag:** Needs research-phase — Vercel Cron limitations and scheduling patterns, pg_cron vs Vercel Cron trade-offs

### Phase 9: Analytics + Dashboard Polish

**Rationale:** Analytics require data — they can only be built after multiple phases of production usage. Performance reports answer the owner's question "is this working?" and drive retention. Dashboard polish reduces churn by improving the day-to-day owner experience.
**Delivers:** AI employee performance reports (conversations handled, escalations, response times), sentiment tracking, guest conversation history view, mobile-responsive dashboard improvements, white-label / branded guest chat widget
**Addresses:** Employee performance analytics (P2), guest sentiment tracking (P2), white-label (differentiator)
**Avoids:** (no new pitfalls introduced — low risk phase)
**Research flag:** Standard — analytics aggregation and dashboard UX are well-understood; skip research-phase

### Phase 10: Revenue Manager + Finance AI (v2)

**Rationale:** Revenue Manager AI requires 3+ months of booking data to produce meaningful pricing recommendations. Finance AI requires accounting integration research and compliance validation. Both are explicitly scoped to v2+ in FEATURES.md. Build only after Phases 1-9 establish a stable, revenue-generating foundation.
**Delivers:** Revenue Manager AI (occupancy dashboard, RevPAR reporting, pricing recommendations requiring owner approval), Finance AI (daily revenue summary, expense logging via chat, monthly P&L)
**Addresses:** Revenue Manager AI (P3), Finance AI (P3)
**Avoids:** Automated rate changes without approval (anti-feature), autonomous financial actions without oversight (Pitfall 9)
**Research flag:** Needs research-phase — revenue management domain knowledge, accounting integration options, tax compliance by market (NL, TR)

### Phase Ordering Rationale

- **Foundation before agents:** Schema + RLS must exist before any API route or agent code is written. Adding multi-tenancy after the fact is one of the most expensive architectural retrofits.
- **Owner-facing before guest-facing:** Validating the agent pattern in a low-risk environment (owner talks to AI) before exposing it to external guests limits blast radius of early implementation errors.
- **Onboarding before channels:** The knowledge base must be populated before guest-facing channels go live. An AI receptionist with no hotel context is worse than no AI at all.
- **Billing after core value:** Introducing payment friction before the product has proven value kills early adoption. Free trial for first cohort is the right tradeoff.
- **Booking AI after guest communication:** Real-time calendar sync, atomic transactions, and booking race conditions add substantial complexity. Build on a stable foundation.
- **Autonomous mode after interactive:** Autonomous agents writing to external systems require an approval architecture that can only be validated after interactive mode is fully tested.
- **Analytics last:** Data must exist before it can be analyzed. Analytics built before usage data exists are engineering waste.

### Research Flags

Phases likely needing `/gsd:research-phase` during planning:
- **Phase 2 (Agent Core):** Claude tool_use API syntax, streaming response patterns, prompt engineering for hotel domain — verify current SDK before implementation
- **Phase 4 (WhatsApp Integration):** Gateway options, Meta Business verification requirements, API pricing and limitations — external dependencies with frequent changes
- **Phase 7 (Booking AI):** PostgreSQL atomic booking transactions, calendar sync options for boutique hotels without PMS — complex domain with legal implications
- **Phase 8 (Autonomous Mode):** Vercel Cron constraints, pg_cron vs external scheduler trade-offs — infrastructure decisions with significant cost and reliability implications
- **Phase 10 (Revenue Manager + Finance AI):** Revenue management domain knowledge, accounting integration options, tax compliance by market — specialized domain outside training confidence

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Supabase RLS, Next.js App Router auth — extensively documented official patterns
- **Phase 3 (Onboarding):** Multi-step forms, data management UI — well-established UX patterns
- **Phase 5 (Guest Experience + Escalation):** Milestone-triggered messages, email notifications — standard patterns with established libraries
- **Phase 6 (Stripe Billing):** Stripe subscription billing with proration — official docs are comprehensive
- **Phase 9 (Analytics + Polish):** Dashboard analytics, UI refinement — well-understood patterns

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core framework (Next.js 16, Tailwind v4, Supabase auth pattern, WebSocket constraint) verified against official Next.js 16.1.6 documentation dated 2026-02-27. Claude models confirmed from system context. Stripe and `@supabase/ssr` from official Next.js auth docs. |
| Features | MEDIUM | Domain knowledge and competitor analysis from training data (cutoff Aug 2025); web verification unavailable. Hotel operations patterns are stable and unlikely to have changed significantly. Competitor feature claims need validation before positioning decisions. |
| Architecture | MEDIUM-HIGH | Multi-tenant RLS pattern is Supabase's documented recommended approach (HIGH). Stateless agent invocation on Vercel serverless is a fundamental platform constraint (HIGH). Agent memory taxonomy and prompt layering are well-established patterns (MEDIUM). Claude tool_use syntax needs verification against current API docs. |
| Pitfalls | MEDIUM | Core pitfalls (prompt injection, race conditions, context overflow, multi-tenant leakage) are universal to AI SaaS and well-documented across multiple sources. Specific rate limits and token limits for current Claude models need verification at docs.anthropic.com. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Claude API current rate limits and exact token context windows per model**: Verify at docs.anthropic.com before designing conversation management and caching strategy. Research used training data.
- **WhatsApp Business API gateway comparison (Twilio vs MessageBird vs Vonage vs direct Meta API)**: Pricing and SLA have likely changed since Aug 2025. Research-phase before Phase 4.
- **Supabase Realtime pricing tier limits**: Verify current connection and message limits on Supabase Pro before designing notification architecture at scale.
- **Stripe SDK version compatibility**: Research used `^16.x` — verify current version and any breaking changes before Phase 6.
- **Competitor feature verification**: All competitor capability claims (Asksuite, HiJiffy, Quicktext) should be validated against current product pages before finalizing positioning.
- **GDPR compliance specifics for hotel guest data in the Netherlands and Turkey**: Both are target markets with different compliance requirements. Needs legal review before any guest PII is stored.
- **WhatsApp Business API Meta verification timeline**: Direct Meta API requires business verification that can take 4-8 weeks. Plan accordingly; use gateway provider to bypass this for MVP.

---

## Sources

### Primary (HIGH confidence)
- `https://nextjs.org/docs/app/guides` — Next.js 16.1.6 guides index, verified 2026-02-27
- `https://nextjs.org/docs/app/guides/authentication` — Supabase as recommended auth, `@supabase/ssr`, `jose`, Zod
- `https://nextjs.org/docs/app/guides/internationalization` — `next-intl` listed first, locale routing pattern
- `https://nextjs.org/docs/app/guides/backend-for-frontend` — WebSocket constraint on Vercel confirmed
- `https://nextjs.org/docs/app/guides/production-checklist` — Tailwind v4 default confirmed, `@tanstack/react-query`
- `https://nextjs.org/docs/app/guides/tailwind-v3-css` — v4 is default; v3 requires explicit downgrade
- Claude model information (claude-opus-4-6, claude-sonnet-4-6) — confirmed via system context
- Supabase RLS multi-tenancy — Supabase's documented recommended approach for SaaS

### Secondary (MEDIUM confidence)
- Hotel operations domain knowledge — training data, cutoff Aug 2025; stable domain
- Competitor analysis (Asksuite, Quicktext, HiJiffy, Cloudbeds, Apaleo, Chekin) — training data; needs validation
- Claude API tool_use patterns and streaming — training data; verify at docs.anthropic.com
- Stripe subscription billing patterns — training data; verify current SDK
- Agent memory taxonomy (semantic/episodic/working) — established pattern in AI agent literature
- OWASP LLM Top 10 (prompt injection, least privilege) — established security framework

### Tertiary (LOW confidence — validate before use)
- WhatsApp Business API gateway options and pricing — training data; frequent API changes
- Supabase Realtime current pricing tier limits — training data; verify at supabase.com
- Competitor-specific pricing and feature availability — may have changed post-Aug 2025

---
*Research completed: 2026-03-01*
*Ready for roadmap: yes*
