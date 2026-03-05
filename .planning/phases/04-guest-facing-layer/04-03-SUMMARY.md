---
phase: 04-guest-facing-layer
plan: 03
subsystem: api, ui
tags: [supabase, realtime, broadcast, chat-widget, iframe, next-js, typescript]

# Dependency graph
requires:
  - phase: 04-01
    provides: rate limiter (checkHotelRateLimit), sanitizeGuestInput, guest-facing SQL migration (widget_token, widget_config columns)
  - phase: 02-agent-core
    provides: invokeAgent, AgentRole, FRONT_DESK agent with tool-first policy and context assembly

provides:
  - Embeddable chat widget page at /widget/[token] — iframe target for hotel websites
  - POST /api/widget/session — resolves hotel from widget_token, returns conversationId + Realtime channel
  - POST /api/widget/message — sanitizes input, invokes FRONT_DESK agent, broadcasts response via Supabase Realtime
  - src/lib/supabase/service.ts — service-role Supabase client for server-side ops without RLS
  - ChatWidget client component — Supabase Realtime Broadcast subscription, hotel branding, optimistic UI

affects:
  - 04-02 (WhatsApp): also imports createServiceClient from service.ts
  - 04-05 (Escalation dashboard): reads widget conversations
  - Any future guest-facing channels using the same service-role pattern

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Service-role Supabase client for unauthenticated server-side queries (widget/WhatsApp)
    - hotelId parsed server-side from conversationId (widget_{hotelId}_{uuid}) — never trusted from client
    - Supabase Realtime Broadcast for async AI response delivery to guest browser
    - select('*') + TypeScript cast for Supabase partial-select type narrowing (consistent with existing pattern)

key-files:
  created:
    - src/lib/supabase/service.ts
    - src/app/api/widget/session/route.ts
    - src/app/api/widget/message/route.ts
    - src/app/widget/[token]/page.tsx
    - src/components/widget/ChatWidget.tsx
  modified:
    - src/lib/whatsapp/resolveHotel.ts (bug fix: partial-select type narrowing)

key-decisions:
  - "Service-role client in service.ts bypasses RLS for server-side ops where no user session exists (widget/WhatsApp) — token validation happens in code, not RLS"
  - "hotelId is parsed server-side from conversationId (widget_{hotelId}_{uuid}) — never accepted from client body to prevent hotel spoofing"
  - "Supabase Realtime Broadcast used for AI response delivery (not HTTP response streaming) — allows agent to be invoked fire-and-forget, client receives response asynchronously"
  - "Widget page placed at /widget/[token] (not inside (dashboard) route group) — inherits only root layout; no auth, no nav"

patterns-established:
  - "Pattern: Service-role client pattern — createServiceClient() in service.ts, used server-side only, never exposed to browser"
  - "Pattern: Server-side hotelId extraction — conversationId format widget_{hotelId}_{uuid} ensures hotel context cannot be spoofed by client"

requirements-completed: [DESK-03, DESK-04, CHAT-01, CHAT-02, CHAT-03, CHAT-04]

# Metrics
duration: 21min
completed: 2026-03-05
---

# Phase 4 Plan 03: Web Chat Widget Summary

**Embeddable chat widget at /widget/[token] with Supabase Realtime Broadcast delivery: hotels add one iframe tag, guests get AI-powered chat without authentication**

## Performance

- **Duration:** 21 min
- **Started:** 2026-03-05T~11:35Z
- **Completed:** 2026-03-05T~11:56Z
- **Tasks:** 2
- **Files modified:** 6 (5 created, 1 bug-fixed)

## Accomplishments
- Service-role Supabase client (`service.ts`) enabling server-side queries without user sessions
- Widget session API (`/api/widget/session`) that resolves hotel from `widget_token` and returns conversationId + Realtime channel
- Widget message API (`/api/widget/message`) that sanitizes input, invokes FRONT_DESK agent, and broadcasts response via Supabase Realtime Broadcast
- ChatWidget client component with Supabase Realtime subscription, hotel branding, optimistic UI, loading/error states
- Public embeddable page at `/widget/[token]` outside dashboard route group — no auth, no nav

## Task Commits

Each task was committed atomically:

1. **Task 1: Create service client and widget API routes** - `1e3df44` (feat)
2. **Task 2: Create widget page and chat component** - `61771ff` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/lib/supabase/service.ts` - Service-role Supabase client (bypasses RLS, server-only)
- `src/app/api/widget/session/route.ts` - POST: resolves hotel by widget_token, creates conversationId
- `src/app/api/widget/message/route.ts` - POST: sanitizes, invokes agent, broadcasts via Realtime
- `src/app/widget/[token]/page.tsx` - Public embeddable page (no dashboard layout)
- `src/components/widget/ChatWidget.tsx` - Client chat UI with Realtime subscription
- `src/lib/whatsapp/resolveHotel.ts` - Bug fix: partial-select TypeScript type narrowing

## Decisions Made
- Service-role client bypasses RLS for unauthenticated operations — validated by token, not user session
- hotelId parsed server-side from `conversationId` format `widget_{hotelId}_{uuid}` — prevents hotel spoofing
- Supabase Realtime Broadcast for async delivery — agent runs to completion server-side, pushes result to client channel
- `/widget/[token]` outside `(dashboard)` route group — inherits root layout only, no auth redirect

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed partial-select TypeScript type narrowing in resolveHotel.ts**
- **Found during:** Task 1 (build verification after creating service.ts)
- **Issue:** `src/lib/whatsapp/resolveHotel.ts` (created by plan 04-02) had TypeScript type error: `Property 'hotel_id' does not exist on type 'never'` due to partial-select without `.returns<T>()`. The file imported from `service.ts` which didn't exist until this plan created it, making the error surface during first build.
- **Fix:** Applied `.returns<T>()` pattern (then switched to `select('*') + cast` after finding the plan had already started applying `.returns<>()`) — final version uses `.returns<>()` on partial selects in resolveHotel.ts
- **Files modified:** `src/lib/whatsapp/resolveHotel.ts`
- **Verification:** Build passes with zero TypeScript errors
- **Committed in:** `1e3df44` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed TypeScript type error in session route (select cast)**
- **Found during:** Task 1 (first build attempt)
- **Issue:** Initial session route used `.returns<Pick<Hotel, ...>>()` after `.single()` which returned `never` type
- **Fix:** Changed to `select('*')` + TypeScript cast `as Hotel | null` (consistent with `/api/agent/stream` pattern in codebase)
- **Files modified:** `src/app/api/widget/session/route.ts`
- **Verification:** Build passes with zero TypeScript errors
- **Committed in:** `1e3df44` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug, TypeScript type narrowing)
**Impact on plan:** Both auto-fixes necessary for correctness. Consistent with existing `select('*') + cast` pattern from Phase 2 Plan 1 decision. No scope creep.

## Issues Encountered
- `.next/lock` file left by a crashed build process — cleared with `rm -f .next/lock` before retry
- Turbopack `.next/static/_buildManifest.js.tmp` race condition on first build — resolved by `rm -rf .next` clean build

## User Setup Required
None - no external service configuration required. Widget uses existing Supabase project (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY already in .env).

## Next Phase Readiness
- Widget channel (04-03) complete; WhatsApp channel (04-02) was already done
- Ready for plan 04-05 (Escalation Dashboard) — widget conversations are now stored in conversation_turns via invokeAgent
- Hotel owners can embed the widget with `<iframe src="/widget/[hotel_widget_token]" />`

---
*Phase: 04-guest-facing-layer*
*Completed: 2026-03-05*
