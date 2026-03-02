# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 8 (Foundation)
Plan: 2 of 3 in current phase
Status: In progress
Last activity: 2026-03-02 — Completed 01-02-PLAN.md (auth flow: signup/login forms, dashboard layout, route protection)

Progress: [██░░░░░░░░] 8%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 11.5 min
- Total execution time: 23 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | 23 min | 11.5 min |

**Recent Trend:**
- Last 5 plans: 16 min, 7 min
- Trend: Faster

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Supabase chosen over Firebase — relational data model, RLS for multi-tenant isolation, existing team familiarity
- iyzico (TR) + Mollie (EU) for billing — Stripe replaced by market-appropriate payment gateways
- Stateless agent invocation — no persistent agent processes; context assembled from DB on every call (Vercel serverless constraint)
- claude-opus-4-6 for guest-facing, claude-sonnet-4-6 for internal/background tasks
- Tool-first policy enforced — agents cannot state availability or prices without a successful tool call
- NEXT_PUBLIC_SUPABASE_ANON_KEY (not publishable key) — project created before new Supabase key format
- Turbopack CSS workaround — used direct node_modules paths for CSS packages that use 'style' export condition
- Explicit TZDate type narrowing — TypeScript strict mode requires if/else narrowing for string|Date union with TZDate overloads
- refreshSession() required post-signup — initial JWT at signUp time does not contain hotel_id (trigger runs after token issuance); forced refresh triggers Custom Access Token Hook to embed hotel_id
- (auth)/(dashboard) route groups — Next.js parenthesis groups for layout segregation without URL path impact; src/app/page.tsx must be removed when (dashboard)/page.tsx claims the same / route
- SignOutButton extracted to client component — dashboard layout is Server Component; signOut() + useRouter require browser-side Supabase client

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2: Claude tool_use API syntax and streaming patterns should be verified at docs.anthropic.com before implementation
- Phase 4: WhatsApp Business API gateway selection (Twilio vs MessageBird vs others) needs current pricing/SLA research
- Phase 7: PostgreSQL atomic booking transactions and calendar sync options for boutique hotels without PMS need research

## Session Continuity

Last session: 2026-03-02
Stopped at: Completed 01-02-PLAN.md — Auth flow (signup/login forms, dashboard layout, route protection)
Resume file: None
