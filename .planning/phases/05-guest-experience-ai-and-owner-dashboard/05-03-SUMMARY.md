---
phase: 05-guest-experience-ai-and-owner-dashboard
plan: 03
subsystem: ui, dashboard
tags: [nextjs, react, server-components, supabase, rls, typescript, shadcn, dashboard]

# Dependency graph
requires:
  - phase: 05-guest-experience-ai-and-owner-dashboard/05-01
    provides: agents table with RLS, agent_audit_log table with RLS, Agent type, AgentAuditLog type, ActionClass type
  - phase: 01-foundation
    provides: hotels table, timezone column, formatInHotelTz utility
  - phase: 02-agent-core
    provides: conversation_turns table, ConversationTurn type

provides:
  - /employees page — AI agent on/off toggle and behavior config editor (tone + custom instructions)
  - toggleAgent Server Action — flips agents.is_enabled via RLS-scoped update
  - updateAgentConfig Server Action — saves tone + custom_instructions to agents.behavior_config JSONB
  - /conversations page — grouped conversation list with agent role badge, preview, timestamp, message count
  - /conversations/[conversationId] page — full message thread with user/assistant bubbles and tool turn collapse
  - /audit page — last 100 agent_audit_log rows in table with OBSERVE/INFORM/ACT colored badges
  - Dashboard nav updated with Employees, Conversations, Audit Log links

affects:
  - 05-04 (any future dashboard pages use same layout nav and patterns)
  - future owner dashboard features that need conversation or audit data

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SupabaseClient cast for agents and agent_audit_log tables in Server Components (same as audit.ts)
    - Agent role derived from conversation_id pattern (no prefix = front_desk, contains guest_experience = guest_experience)
    - Tool turns rendered as collapsed <details> elements — no new component needed
    - URL-persisted filter (?role=) for conversations list — stateless Server Component filter

key-files:
  created:
    - src/app/(dashboard)/employees/actions.ts
    - src/app/(dashboard)/employees/page.tsx
    - src/app/(dashboard)/conversations/page.tsx
    - src/app/(dashboard)/conversations/[conversationId]/page.tsx
    - src/app/(dashboard)/audit/page.tsx
  modified:
    - src/app/(dashboard)/layout.tsx

key-decisions:
  - "Native HTML select for tone — no shadcn Select component available; styled with Tailwind border/ring classes to match existing inputs"
  - "Conversation grouping in JS (not SQL GROUP BY) — PostgREST client doesn't support GROUP BY natively; fetch 200 turns and reduce in JS is practical for MVP scale"
  - "Agent role derived from conversation_id pattern — prefix/substring matching (wa_=WhatsApp FD, widget_=Widget FD, guest_experience=GE, owner_chat=Owner) avoids cross-table join for display purposes"
  - "Filter by employee via ?role= URL param — keeps /conversations page a Server Component; no client state needed"
  - "Tool turns collapsed with <details> — avoids bloating the conversation view with raw JSON; user can expand if needed"

patterns-established:
  - "SupabaseClient cast in Server Component pages: (supabase as unknown as SupabaseClient).from('agents').select('*').returns<Agent[]>()"
  - "conversation_id prefix-based role detection: contains('guest_experience') = GE, startsWith('wa_') = WhatsApp FD, startsWith('widget_') = Widget FD"
  - "Action class badge colors: OBSERVE=blue-100, INFORM=yellow-100, ACT=red-100"

requirements-completed:
  - DASH-02
  - DASH-04
  - DASH-05

# Metrics
duration: 14min
completed: 2026-03-05
---

# Phase 5 Plan 03: Owner Dashboard — Employees, Conversations, and Audit Log Summary

**Three owner dashboard pages (AI employee management, conversation browser with drill-down, and audit log with OBSERVE/INFORM/ACT badges) plus updated navigation — built as Server Components with RLS-scoped Supabase queries**

## Performance

- **Duration:** 14 min
- **Started:** 2026-03-05T13:54:20Z
- **Completed:** 2026-03-05T14:09:02Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created `/employees` page — hotel owner can toggle any AI employee on/off and save tone + custom_instructions behavior config, all persisted via RLS-scoped Server Actions
- Created `/conversations` page — lists distinct conversations grouped from last 200 turns, with agent role badge derived from conversation_id pattern, last message preview, timestamp, message count, and ?role= filter
- Created `/conversations/[conversationId]` page — full message thread with directional chat bubbles (user=left, assistant=right) and collapsed tool turn details
- Created `/audit` page — last 100 agent_audit_log entries in table with colored action class badges and expandable JSON input/result details
- Updated dashboard nav to include Employees, Conversations, Audit Log links between Knowledge and Settings

## Task Commits

Each task was committed atomically:

1. **Task 1: Employees page with on/off toggle and behavior config** - `1e2a5e3` (feat)
2. **Task 2: Conversations browser, conversation detail, audit log viewer, and nav links** - `1cd97ef` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `src/app/(dashboard)/employees/actions.ts` — toggleAgent and updateAgentConfig Server Actions (SupabaseClient cast, RLS-scoped)
- `src/app/(dashboard)/employees/page.tsx` — Agent card grid with status badge, toggle form, tone select, custom instructions textarea
- `src/app/(dashboard)/conversations/page.tsx` — Conversation list grouping 200 turns by conversation_id, ?role= URL filter
- `src/app/(dashboard)/conversations/[conversationId]/page.tsx` — Full message thread with directional bubbles and collapsed tool turns
- `src/app/(dashboard)/audit/page.tsx` — Audit log table with OBSERVE/INFORM/ACT badges and expandable JSON details
- `src/app/(dashboard)/layout.tsx` — Added Employees, Conversations, Audit Log nav links

## Decisions Made

- Native HTML select for tone dropdown — shadcn Select component not available in project; Tailwind-styled select matches existing input patterns
- Conversation grouping done in JS — PostgREST client lacks native GROUP BY; fetch 200 turns and reduce by conversation_id is practical for MVP-scale hotels
- Agent role derived from conversation_id string pattern — avoids cross-table join for what is purely a display concern; sufficiently accurate for MVP
- Filter by employee role via `?role=` URL param — stateless Server Component; no client-side state needed

## Deviations from Plan

None — plan executed exactly as written. The SupabaseClient cast for agents and agent_audit_log tables was anticipated in the plan instructions and applied as specified.

## Issues Encountered

- Initial `pnpm build` failed with ENOENT on a Turbopack .next tmp file — stale lock and partial cache from background TypeScript check. Resolved by deleting `.next` directory and running a fresh build (no code changes required). `pnpm tsc --noEmit` confirmed zero TypeScript errors throughout.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three owner dashboard pages are complete and linked from the main nav
- Hotel owner can fully manage AI employees from /employees and review all activity from /conversations and /audit
- Ready for 05-04: any remaining Phase 5 features (milestone messaging UI, etc.)
- Pre-existing TypeScript errors in `src/lib/cron/milestoneDispatch.ts` (from 05-02) are out of scope for this plan — logged to deferred-items

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/employees/actions.ts
- FOUND: src/app/(dashboard)/employees/page.tsx
- FOUND: src/app/(dashboard)/conversations/page.tsx
- FOUND: src/app/(dashboard)/conversations/[conversationId]/page.tsx
- FOUND: src/app/(dashboard)/audit/page.tsx
- FOUND: src/app/(dashboard)/layout.tsx (updated)
- FOUND: commit 1e2a5e3 (Task 1)
- FOUND: commit 1cd97ef (Task 2)
- BUILD: pnpm build passes — all 5 routes compiled (/employees, /conversations, /conversations/[conversationId], /audit, updated layout)

---
*Phase: 05-guest-experience-ai-and-owner-dashboard*
*Completed: 2026-03-05*
