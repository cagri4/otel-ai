# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 8 (Foundation)
Plan: 0 of 3 in current phase
Status: Ready to plan
Last activity: 2026-03-02 — Roadmap created, ready to begin Phase 1 planning

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2: Claude tool_use API syntax and streaming patterns should be verified at docs.anthropic.com before implementation
- Phase 4: WhatsApp Business API gateway selection (Twilio vs MessageBird vs others) needs current pricing/SLA research
- Phase 7: PostgreSQL atomic booking transactions and calendar sync options for boutique hotels without PMS need research

## Session Continuity

Last session: 2026-03-02
Stopped at: Roadmap and STATE.md created. No plans yet.
Resume file: None
