---
phase: 05-guest-experience-ai-and-owner-dashboard
plan: 04
subsystem: ui
tags: [react, supabase-realtime, sonner, sse, toast, chat, agent]

# Dependency graph
requires:
  - phase: 05-01
    provides: GUEST_EXPERIENCE AgentRole, agents table, escalations table with Realtime publication
  - phase: 05-03
    provides: Dashboard layout with Employees/Conversations/Audit nav links
  - phase: 02-04
    provides: useChatStream hook, ChatWindow component, /api/agent/stream SSE endpoint

provides:
  - /guest-experience chat page for Guest Experience AI (GUEST_EXPERIENCE role)
  - EscalationNotificationProvider: Supabase Realtime subscription for escalation INSERT events
  - Sonner Toaster in dashboard layout with real-time escalation toast alerts
  - useChatStream hook extended with configurable conversationId and role options
  - ChatWindow extended with streamOptions and emptyStateText props for reuse across roles

affects:
  - Phase 6 (any new AI employee chat pages can follow the same useChatStream + ChatWindow pattern)
  - Phase 7 (escalation notification pattern reusable for booking alerts)

# Tech tracking
tech-stack:
  added:
    - sonner@2.0.7 (toast notification library)
  patterns:
    - Parameterized useChatStream hook: pass {conversationId, role} to target any AgentRole
    - ChatWindow props pattern: streamOptions + emptyStateText for reuse across agent roles
    - EscalationNotificationProvider: Supabase Realtime client-side subscription as provider component
    - Role resolution in API route: roleStr from body maps to AgentRole enum, defaults to FRONT_DESK

key-files:
  created:
    - src/app/(dashboard)/guest-experience/page.tsx
    - src/components/dashboard/EscalationNotificationProvider.tsx
  modified:
    - src/hooks/useChatStream.ts
    - src/components/chat/ChatWindow.tsx
    - src/app/api/agent/stream/route.ts
    - src/app/(dashboard)/layout.tsx
    - package.json (sonner added)

key-decisions:
  - "useChatStream accepts optional {conversationId, role} options — backward compatible; existing /desk page unchanged as it uses default values"
  - "ChatWindow accepts optional streamOptions and emptyStateText props — existing /desk usage unchanged (no props = defaults)"
  - "API route role resolution: roleStr from body maps guest_experience -> GUEST_EXPERIENCE, anything else -> FRONT_DESK (safe default)"
  - "EscalationNotificationProvider uses void supabase.removeChannel(channel) in cleanup to satisfy TypeScript strict-mode promise handling"
  - "Toaster placed outside provider but inside layout div — renders notification container independently of provider subscription logic"

patterns-established:
  - "Multi-role chat: useChatStream({conversationId: 'X_chat', role: 'X'}) pattern for any future AgentRole chat page"
  - "Realtime provider pattern: client component wrapping children with useEffect Supabase subscription, cleanup on unmount"

requirements-completed:
  - DASH-01
  - DASH-03

# Metrics
duration: 14min
completed: 2026-03-05
---

# Phase 5 Plan 4: Guest Experience AI Chat and Escalation Notifications Summary

**Guest Experience AI chat page using parameterized useChatStream/ChatWindow, plus Supabase Realtime escalation toasts via sonner in the dashboard layout**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-03-05T10:00:00Z
- **Completed:** 2026-03-05T10:14:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Hotel owners can chat with the Guest Experience AI at /guest-experience using the GUEST_EXPERIENCE role and a dedicated `{hotelId}_guest_experience_chat` conversation ID
- useChatStream hook extended with optional `{conversationId, role}` options — existing /desk page unchanged (backward compatible)
- EscalationNotificationProvider subscribes to Supabase Realtime postgres_changes INSERT events on the escalations table, showing sonner toasts with guest message preview and a "View" action linking to the conversation
- Dashboard layout updated: EscalationNotificationProvider wraps children, Toaster renders top-right, Guest Experience nav link added between Front Desk and Knowledge

## Task Commits

1. **Task 1: Guest Experience AI chat page** - `59db6db` (feat)
2. **Task 2: Escalation notification provider with sonner toasts** - `c362b05` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/app/(dashboard)/guest-experience/page.tsx` - Guest Experience chat page (Server Component, uses ChatWindow with guest_experience role)
- `src/components/dashboard/EscalationNotificationProvider.tsx` - Supabase Realtime subscription provider showing sonner toast on escalation INSERT
- `src/hooks/useChatStream.ts` - Extended with UseChatStreamOptions (conversationId, role) — backward compatible defaults
- `src/components/chat/ChatWindow.tsx` - Extended with streamOptions and emptyStateText props — backward compatible defaults
- `src/app/api/agent/stream/route.ts` - Updated to read role from request body, maps to AgentRole enum
- `src/app/(dashboard)/layout.tsx` - Added EscalationNotificationProvider, Toaster, Guest Experience nav link
- `package.json` - Added sonner@2.0.7

## Decisions Made

- `useChatStream` accepts optional options object — maintains backward compatibility; /desk works unchanged
- `ChatWindow` accepts optional props — backward compatible; /desk usage unchanged
- API route role resolution defaults to FRONT_DESK — safe fallback for existing clients
- `void supabase.removeChannel(channel)` in cleanup satisfies TypeScript strict-mode promise handling
- Toaster placed outside EscalationNotificationProvider (sibling) — renders notification container independently

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Extended useChatStream and ChatWindow to support role/conversationId parameters**
- **Found during:** Task 1 (Guest Experience AI chat page)
- **Issue:** Existing `useChatStream` hardcoded `conversationId = 'owner_chat'` with no role parameter; `ChatWindow` had no props. The Guest Experience page needs different conversationId and role.
- **Fix:** Added `UseChatStreamOptions` interface with optional `conversationId` and `role` fields; updated `ChatWindow` to accept `streamOptions` and `emptyStateText` props. Both remain backward compatible.
- **Files modified:** src/hooks/useChatStream.ts, src/components/chat/ChatWindow.tsx
- **Verification:** Build passes; /desk page unchanged; /guest-experience page uses correct options
- **Committed in:** 59db6db (Task 1 commit)

**2. [Rule 1 - Bug] Updated API route to read role from request body instead of hardcoding FRONT_DESK**
- **Found during:** Task 1 verification
- **Issue:** /api/agent/stream POST handler hardcoded `role: AgentRole.FRONT_DESK`. Guest Experience page needs GUEST_EXPERIENCE role to route to the correct agent.
- **Fix:** Extract `roleStr` from request body; map `'guest_experience'` to `AgentRole.GUEST_EXPERIENCE`, everything else to `AgentRole.FRONT_DESK` (safe default).
- **Files modified:** src/app/api/agent/stream/route.ts
- **Verification:** Build passes with zero TypeScript errors
- **Committed in:** 59db6db (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — existing code bugs preventing new feature from working)
**Impact on plan:** Both fixes necessary for correctness. Backward compatible — no existing functionality changed.

## Issues Encountered

None — build passed on first attempt after auto-fixes.

## User Setup Required

None — no external service configuration required. The escalations table Realtime publication was added in Phase 5 Plan 1 migration (`ALTER PUBLICATION supabase_realtime ADD TABLE public.escalations`).

## Next Phase Readiness

- Phase 5 complete: all 4 plans executed (AI employees, milestone triggers, owner dashboard, guest experience chat + escalation notifications)
- Phase 6 (Booking Engine) can begin — Guest Experience AI ready for milestone message configuration testing via /guest-experience
- Future agent chat pages can follow the same `useChatStream({conversationId, role})` + `ChatWindow({streamOptions})` pattern

## Self-Check: PASSED

All files confirmed on disk. All commits confirmed in git history.

---
*Phase: 05-guest-experience-ai-and-owner-dashboard*
*Completed: 2026-03-05*
