---
phase: 03-knowledge-base-and-onboarding
plan: 03
subsystem: ui
tags: [onboarding, wizard, server-actions, agent-tools, multilingual, progressive-onboarding]

# Dependency graph
requires:
  - phase: 03-01
    provides: onboarding_completed_at column on hotels table, default hotel facts seeded
  - phase: 02-04
    provides: Front Desk AI chat, agentFactory, tool registry and executor
provides:
  - 2-step onboarding wizard at /onboarding with hotel name, city, country, contact fields
  - completeOnboardingStep and skipOnboarding Server Actions
  - Dashboard home page redirect to /onboarding when onboarding_completed_at is null
  - Dashboard layout onboarding banner for non-root routes
  - update_hotel_info tool for agent progressive info gathering during conversation
  - FRONT_DESK behavioral instructions for progressive onboarding and multilingual responses
affects: [04-whatsapp-integration, 05-booking-engine, 02-agent-core]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - shadcn Progress component created from radix-ui Progress primitive (matching existing ui component style)
    - Multi-step wizard state managed with useState; hotel name preserved across steps via state
    - Server Action pattern: auth check -> RLS-scoped SELECT -> validate -> UPDATE -> revalidatePath

key-files:
  created:
    - src/lib/actions/onboarding.ts
    - src/app/(dashboard)/onboarding/page.tsx
    - src/components/knowledge/OnboardingWizard.tsx
    - src/components/ui/progress.tsx
  modified:
    - src/app/(dashboard)/page.tsx
    - src/app/(dashboard)/layout.tsx
    - src/lib/agents/agentFactory.ts
    - src/lib/agents/tools/registry.ts
    - src/lib/agents/tools/executor.ts

key-decisions:
  - "Wizard step completion triggers onboarding_completed_at when city is provided — city is the minimum signal that setup is meaningful (not just name confirmation)"
  - "Dashboard home page does the /onboarding redirect; layout only shows banner — avoids redirect loop from layout for all dashboard routes"
  - "update_hotel_info uses RLS-scoped server client (not service_role) — consistent with existing project decision"
  - "Progress component created manually from radix-ui — shadcn CLI not used in this project, consistent with existing component pattern"

patterns-established:
  - "Onboarding redirect pattern: home page checks onboarding_completed_at and redirects; onboarding page redirects back if already done"
  - "Progressive tool pattern: executor tools can dynamically import server modules (createClient) — enables hotel-scoped DB operations from agent tools"

requirements-completed: [ONBR-01, ONBR-02, ONBR-03, KNOW-05]

# Metrics
duration: 7min
completed: 2026-03-05
---

# Phase 3 Plan 3: Onboarding Wizard and Progressive AI First-Shift Summary

**2-step onboarding wizard at /onboarding with dashboard redirect, update_hotel_info agent tool for progressive info gathering, and multilingual FRONT_DESK behavioral instructions**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-05T09:49:15Z
- **Completed:** 2026-03-05T09:56:07Z
- **Tasks:** 2
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments
- 2-step onboarding wizard at /onboarding collects hotel name (pre-filled), city, country, contact email/phone — gets new owners to first AI conversation in under 2 minutes
- Dashboard home page (/) redirects new users to /onboarding when onboarding_completed_at is null; onboarding page redirects completed users back to /
- Dashboard layout shows top banner on non-root routes when setup is incomplete
- update_hotel_info tool added to FRONT_DESK agent — persists owner-provided hotel facts during conversation via RLS-scoped DB update
- FRONT_DESK behavioral prompt enhanced with PROGRESSIVE ONBOARDING and MULTILINGUAL SUPPORT instruction blocks

## Task Commits

Each task was committed atomically:

1. **Task 1: Onboarding wizard page, component, and Server Actions** - `49b606a` (feat)
2. **Task 2: Progressive onboarding tool and multilingual agent instructions** - `980fef5` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/lib/actions/onboarding.ts` - Server Actions: completeOnboardingStep (saves fields, sets onboarding_completed_at when city provided) and skipOnboarding
- `src/app/(dashboard)/onboarding/page.tsx` - Onboarding page Server Component; redirects to / if already completed
- `src/components/knowledge/OnboardingWizard.tsx` - 3-step wizard (welcome, details, complete) with auto-redirect to /desk
- `src/components/ui/progress.tsx` - shadcn-style Progress component using radix-ui (auto-created, was missing)
- `src/app/(dashboard)/page.tsx` - Added redirect('/onboarding') guard when onboarding_completed_at is null
- `src/app/(dashboard)/layout.tsx` - Added onboarding banner component for non-root dashboard routes
- `src/lib/agents/agentFactory.ts` - Added update_hotel_info to FRONT_DESK tools; added PROGRESSIVE ONBOARDING and MULTILINGUAL SUPPORT behavioral instructions
- `src/lib/agents/tools/registry.ts` - Added updateHotelInfoTool definition; added to TOOLS record and getToolsForRole FRONT_DESK case
- `src/lib/agents/tools/executor.ts` - Added update_hotel_info handler in TOOL_DISPATCH with RLS-scoped hotel update

## Decisions Made
- Wizard step completion triggers `onboarding_completed_at` when city is provided — city is the minimum signal that setup is meaningful beyond just name confirmation
- Dashboard home page does the /onboarding redirect; layout shows banner only — avoids redirect loop since layout renders for all dashboard routes including /onboarding
- `update_hotel_info` uses RLS-scoped server client (not service_role) — consistent with existing project decision "No service_role client in memory helpers"
- Progress component created manually from radix-ui following existing component pattern — shadcn CLI not used in this project

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created missing Progress UI component**
- **Found during:** Task 1 (OnboardingWizard component)
- **Issue:** `@/components/ui/progress` not found — Progress component referenced in plan but did not exist in project
- **Fix:** Created `src/components/ui/progress.tsx` following existing shadcn component pattern using `radix-ui` Progress primitive (already a project dependency)
- **Files modified:** src/components/ui/progress.tsx
- **Verification:** TypeScript passes with zero errors
- **Committed in:** `49b606a` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for the wizard to render. No scope creep.

## Issues Encountered
None beyond the missing Progress component (handled via Rule 3).

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Phase 3 complete: knowledge base schema, editor UI, and onboarding wizard all delivered
- Phase 4 (WhatsApp Integration): requires WhatsApp Business API gateway selection research (Twilio vs MessageBird noted in STATE.md blockers)
- Front Desk AI has all tools for both guest-facing conversations and owner progressive onboarding

---
*Phase: 03-knowledge-base-and-onboarding*
*Completed: 2026-03-05*
