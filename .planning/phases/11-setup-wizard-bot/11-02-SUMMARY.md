---
phase: 11-setup-wizard-bot
plan: 02
subsystem: api
tags: [telegram, webhook, wizard, onboarding, after, nodejs-runtime]

# Dependency graph
requires:
  - phase: 11-setup-wizard-bot
    plan: 01
    provides: handleWizardMessage, handleWizardCallback, TelegramUpdate type
  - phase: 09-telegram-infrastructure
    provides: after() pattern, TelegramUpdate type, webhook secret validation
  - phase: 10-super-admin-panel-and-employee-bots
    provides: SUPER_ADMIN_EMAIL guard pattern from (admin)/layout.tsx
provides:
  - Wizard bot webhook handler at /api/telegram/wizard
  - One-time admin webhook registration at /api/admin/register-wizard-webhook
affects:
  - Complete setup wizard flow: admin registers webhook -> owner taps deep link -> wizard collects 5 answers -> confirms -> employee bots linked

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Fixed route (not slug-based) for global wizard bot vs per-hotel employee bots
    - after() wraps both message and callback_query handlers (same pattern as employee bot)
    - Response.json() for JSON API responses (not new Response with JSON.stringify)
    - SUPER_ADMIN_EMAIL auth guard in API route (vs layout redirect pattern)

key-files:
  created:
    - src/app/api/telegram/wizard/route.ts
    - src/app/api/admin/register-wizard-webhook/route.ts
  modified: []

key-decisions:
  - "Wizard webhook uses fixed route /api/telegram/wizard not slug-based — single global bot, no per-hotel routing needed"
  - "after() wraps both message and callback_query paths — wizard DB writes must complete after 200 response to prevent retry storms"
  - "Registration endpoint returns 401/403 as JSON (not redirects) — API route vs layout; callers are programmatic, not browser navigations"
  - "drop_pending_updates: true on setWebhook — discards any queued updates from before registration to prevent wizard state confusion"

# Metrics
duration: 2min
completed: 2026-03-06
---

# Phase 11 Plan 02: Setup Wizard Bot — Webhook Handler and Registration Summary

**Wizard bot webhook handler and admin registration endpoint completing the Setup Wizard bot infrastructure**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-06T12:29:38Z
- **Completed:** 2026-03-06T12:31:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Wizard bot webhook handler at /api/telegram/wizard: validates SETUP_WIZARD_WEBHOOK_SECRET, returns 200 before processing, routes message + callback_query via after()
- Admin webhook registration endpoint at /api/admin/register-wizard-webhook: SUPER_ADMIN_EMAIL auth guard, calls Telegram setWebhook with allowed_updates including callback_query
- TypeScript compiles with zero errors across both new files
- Completes Phase 11 Setup Wizard Bot end-to-end: wizard state machine (Plan 01) + webhook infrastructure (Plan 02)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create wizard bot webhook handler** - `29ab79d` (feat)
2. **Task 2: Create wizard webhook registration endpoint** - `6172f4a` (feat)

## Files Created/Modified

- `src/app/api/telegram/wizard/route.ts` - POST handler: validates SETUP_WIZARD_WEBHOOK_SECRET, returns 200 immediately, dispatches message/callback_query to wizard handlers via after()
- `src/app/api/admin/register-wizard-webhook/route.ts` - POST handler: SUPER_ADMIN_EMAIL auth guard, validates env vars, calls Telegram setWebhook with message+callback_query allowed_updates

## Decisions Made

- Wizard webhook uses a fixed route (`/api/telegram/wizard`) not slug-based routing, because the wizard is a single global bot — not per-hotel like employee bots
- after() wraps BOTH the message and callback_query handling paths, ensuring wizard DB writes complete after the 200 response is returned to Telegram
- Registration endpoint returns JSON error responses (401/403) rather than redirects, since it is an API route called programmatically by the super admin, not a browser navigation
- drop_pending_updates: true prevents stale queued updates from confusing wizard state on webhook re-registration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

After deployment, the super admin must:
1. Set env vars: `SETUP_WIZARD_BOT_TOKEN`, `SETUP_WIZARD_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`
2. Be logged in as the super admin account
3. POST to `/api/admin/register-wizard-webhook` to register the webhook with Telegram

The endpoint is idempotent — it can be called again to update the webhook registration.

## Phase 11 Complete

Both plans executed:
- Plan 01: Wizard state machine, Redis session CRUD, step transitions, inline keyboard, completion with bot links
- Plan 02: Webhook handler (fixed route, after() pattern), admin registration endpoint (SUPER_ADMIN_EMAIL guard)

End-to-end flow enabled: super admin registers webhook -> creates hotel with deep link -> owner taps link -> wizard collects hotel name/address/rooms/check-in/check-out -> owner confirms via inline keyboard -> onboarding_completed_at set -> employee bot links sent

---
*Phase: 11-setup-wizard-bot*
*Completed: 2026-03-06*
