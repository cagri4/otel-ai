---
phase: 13-proactive-messaging-dashboard-readonly
plan: 02
subsystem: ui
tags: [telegram, dashboard, banner, nextjs, server-component]

requires:
  - phase: 11-setup-wizard-bot
    provides: owner_telegram_chat_id set on hotels table after wizard completion

provides:
  - Telegram-first informational banner in dashboard layout for onboarded hotels

affects:
  - Any future dashboard layout changes
  - WDSH-01 requirement completion

tech-stack:
  added: []
  patterns:
    - Conditional blue informational banner (bg-blue-50/text-blue-700) for secondary-state notifications

key-files:
  created: []
  modified:
    - src/app/(dashboard)/layout.tsx

key-decisions:
  - "Banner is purely informational — no redirect, no modal, no write feature disabling (WDSH-01: dashboard is readonly optional view, not blocked)"
  - "Blue (bg-blue-50/text-blue-700) chosen for informational tone vs bg-primary (action-required) used by onboarding banner"

patterns-established:
  - "Informational banners use blue-50/blue-700; action-required banners use primary/primary-foreground"

requirements-completed: [WDSH-01]

duration: 5min
completed: 2026-03-06
---

# Phase 13 Plan 02: Dashboard Readonly View Summary

**Blue informational banner added to dashboard layout for Telegram-onboarded hotels, making the web dashboard a visually-labeled secondary view without disabling any features**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-06T00:00:00Z
- **Completed:** 2026-03-06T00:05:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added conditional blue informational banner to dashboard layout when `owner_telegram_chat_id` is set
- Banner renders between the onboarding banner and the top header (non-blocking, no redirect)
- All dashboard write features remain fully intact (employees, knowledge base, settings, billing)
- WDSH-01 satisfied: existing dashboard accessible as readonly optional view for Telegram-onboarded hotels

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Telegram-first informational banner to dashboard layout** - `96bd684` (feat)

## Files Created/Modified
- `src/app/(dashboard)/layout.tsx` - Added conditional Telegram-first informational banner block between onboarding banner and header

## Decisions Made
- Banner is purely informational: no redirects, no disabled forms, no blocking behavior. "Readonly optional view" in WDSH-01 means Telegram is the primary channel, not that dashboard writes must be blocked.
- Blue color scheme (bg-blue-50/border-blue-100/text-blue-700) distinguishes the informational banner from the action-required onboarding banner (bg-primary/text-primary-foreground).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- WDSH-01 complete: Telegram-onboarded hotels see dashboard labeled as secondary view
- Ready for Phase 13 Plan 03 (proactive messaging) or phase completion

---
*Phase: 13-proactive-messaging-dashboard-readonly*
*Completed: 2026-03-06*
