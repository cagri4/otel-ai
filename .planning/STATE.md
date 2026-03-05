# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.
**Current focus:** Phase 2 — Agent Core

## Current Position

Phase: 2 of 8 (Agent Core)
Plan: 4 of 4 in current phase
Status: Complete
Last activity: 2026-03-05 — Completed 02-04-PLAN.md (SSE streaming endpoint + Front Desk chat UI at /desk — Phase 2 complete)

Progress: [██████░░░░] 30%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 13 min
- Total execution time: 68 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | 23 min | 11.5 min |
| 02-agent-core | 4 | 56 min | 14 min |

**Recent Trend:**
- Last 5 plans: 7 min, 19 min, 11 min, 11 min, 15 min
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
- AgentRole enum imported as value (not type) in registry.ts — TypeScript enum used in switch case must be imported as runtime value (Phase 2 Plan 3)
- delegate_task tool FRONT_DESK only — prevents circular delegation chains from non-front-desk roles (Phase 2 Plan 3)
- ToolContext always threaded through executeTool — future-proofs executor for hotel-scoped tools without signature changes (Phase 2 Plan 3)
- Node.js runtime (not Edge) on /api/agent/stream — supabase/ssr cookie auth breaks in Edge runtime (Phase 2 Plan 4)
- Fire-and-forget invokeAgent() in ReadableStream.start() — awaiting buffers full response before first SSE byte reaches client (Phase 2 Plan 4)
- Default conversationId is hotelId_owner_chat — one persistent conversation per hotel owner per research recommendation (Phase 2 Plan 4)
- Client-side chunked SSE buffer in useChatStream — ReadableStream reader returns arbitrary byte chunks; buffer until \\n\\n delimiter (Phase 2 Plan 4)

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4: WhatsApp Business API gateway selection (Twilio vs MessageBird vs others) needs current pricing/SLA research
- Phase 7: PostgreSQL atomic booking transactions and calendar sync options for boutique hotels without PMS need research

## Session Continuity

Last session: 2026-03-05
Stopped at: Completed 02-04-PLAN.md — Phase 2 complete. SSE streaming + Front Desk chat UI at /desk. Ready for Phase 3 (Guest Communications).
Resume file: None
