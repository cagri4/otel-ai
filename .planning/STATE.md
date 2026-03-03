# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.
**Current focus:** Phase 2 — Agent Core

## Current Position

Phase: 2 of 8 (Agent Core)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-03-03 — Completed 02-02-PLAN.md (Agent orchestration stack: invokeAgent(), agentFactory, assembleContext, tool registry/executor/stubs)

Progress: [████░░░░░░] 19%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 12.5 min
- Total execution time: 53 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | 23 min | 11.5 min |
| 02-agent-core | 2 | 30 min | 15 min |

**Recent Trend:**
- Last 5 plans: 16 min, 7 min, 19 min, 11 min
- Trend: Stable

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
- Conversation turns limited to 20 per invocation — prevents context rot per research recommendation (Phase 2 Plan 1)
- .returns<T>() required for Supabase SELECT with manual Database types — postgrest-js v12 type inference requires this workaround until generated types are used (Phase 2 Plan 1)
- No service_role client in memory helpers — all queries respect RLS via anon key + session cookie (Phase 2 Plan 1)
- Anthropic SDK types used directly in types.ts — replaced placeholder types to eliminate compatibility issues between SDK and codebase (Phase 2 Plan 2)
- MessageStream imported from @anthropic-ai/sdk/lib/MessageStream — not re-exported from main SDK module (Phase 2 Plan 2)
- isToolRequired() errs on false positives — better to over-call tools than allow Claude to answer availability/pricing from training data (Phase 2 Plan 2)
- invokeAgentRecursive() uses tool_choice=auto — tools already called once, forcing again would be circular (Phase 2 Plan 2)

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4: WhatsApp Business API gateway selection (Twilio vs MessageBird vs others) needs current pricing/SLA research
- Phase 7: PostgreSQL atomic booking transactions and calendar sync options for boutique hotels without PMS need research

## Session Continuity

Last session: 2026-03-03
Stopped at: Completed 02-02-PLAN.md — Agent orchestration stack (invokeAgent, agentFactory, assembleContext, tool system)
Resume file: None
