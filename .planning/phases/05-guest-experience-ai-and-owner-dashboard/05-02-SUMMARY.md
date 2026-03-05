---
phase: 05-guest-experience-ai-and-owner-dashboard
plan: 02
subsystem: infra, api
tags: [vercel-cron, twilio, resend, whatsapp, email, date-fns-tz, milestone-messaging, typescript]

# Dependency graph
requires:
  - phase: 05-guest-experience-ai-and-owner-dashboard/05-01
    provides: bookings table, message_templates table, agents table (is_enabled), GUEST_EXPERIENCE role

provides:
  - vercel.json cron schedule (daily 06:00 UTC)
  - GET /api/cron/milestone-dispatch route secured by CRON_SECRET
  - runMilestoneDispatch() — timezone-aware batch milestone processor
  - Pre-arrival (D-1), checkout reminder (D+0), post-stay review (D+1) dispatch logic
  - Multi-channel dispatch: WhatsApp via Twilio, email via Resend
  - Custom template loading from message_templates table with variable substitution
  - Built-in default message bodies for all three milestones
  - Sent flag guards preventing duplicate milestone messages

affects:
  - 05-03 (owner dashboard — may surface messagesSent metrics from milestone dispatch)
  - 05-04 (any plan that depends on milestone dispatch being active)
  - ENV: CRON_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, TWILIO_TEMPLATE_SID_REVIEW_REQUEST (optional), RESEND_API_KEY, RESEND_FROM_EMAIL

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SupabaseClient cast for milestoneDispatch queries — same (supabase as unknown as SupabaseClient) pattern from Phase 5 Plan 1; applied to hotels, agents, message_templates, bookings queries in cron context
    - Promise.allSettled with BATCH_SIZE=10 — parallel dispatch within batches without aborting on individual failure
    - Per-hotel timezone date computation with TZDate — matches formatInHotelTz pattern from timezone.ts; computes today/tomorrow/yesterday in hotel local time
    - Return 200 on cron error — consistent with Twilio webhook pattern; prevents Vercel cron log noise and re-trigger concerns

key-files:
  created:
    - vercel.json
    - src/app/api/cron/milestone-dispatch/route.ts
    - src/lib/cron/milestoneDispatch.ts
  modified: []

key-decisions:
  - "SupabaseClient cast applied to hotels select in cron — partial select (id, name, timezone, contact_email) with manual Database types causes TypeScript never inference; cast + typed loop variable (Pick<Hotel, ...>) resolves it"
  - "Return 200 on fatal cron error — Vercel cron retries on 5xx are not desired; error is logged; consistent with Twilio webhook pattern"
  - "WhatsApp review_request falls back to email when TWILIO_TEMPLATE_SID_REVIEW_REQUEST is not set — post-stay messages are outside 24h free-form window; graceful degradation without crashing the batch"
  - "Batch size 10 with Promise.allSettled — parallel dispatch without exceeding Twilio/Resend API rate limits; individual booking failures do not abort the batch"

patterns-established:
  - "Cron route pattern: Node.js runtime, force-dynamic, maxDuration=300, CRON_SECRET header guard, runX() call, return 200 on errors"
  - "Milestone dispatch pattern: hotel loop -> timezone dates -> agent is_enabled check -> bookings query -> template load -> dispatch -> mark sent flag"
  - "WA review_request fallback: no template SID -> try email -> no email -> log warn and skip"

requirements-completed:
  - GEXP-01
  - GEXP-02
  - GEXP-03
  - GEXP-05

# Metrics
duration: 15min
completed: 2026-03-05
---

# Phase 5 Plan 02: Milestone Trigger Engine Summary

**Daily Vercel cron dispatches pre-arrival (D-1), checkout reminder (D+0), and post-stay review (D+1) messages via WhatsApp (Twilio) or email (Resend) using per-hotel timezone-aware date matching and custom message templates**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-05T13:54:01Z
- **Completed:** 2026-03-05T14:09:01Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments

- Built complete milestone trigger engine: cron config, secured route, and core dispatch logic
- Per-hotel timezone date computation ensures correct D-1/D+0/D+1 matching regardless of UTC offset
- Multi-channel routing: WhatsApp (Twilio) for WhatsApp bookings, Resend for email bookings
- Custom message_templates loaded per hotel with `{{guest_name}}`, `{{hotel_name}}`, `{{check_in_date}}`, `{{check_out_date}}` substitution; falls back to built-in defaults
- Sent flags (pre_arrival_sent, checkout_reminder_sent, review_request_sent) enforce exactly-once delivery
- guest_experience agent is_enabled guard skips disabled hotels without error

## Task Commits

Each task was committed atomically:

1. **Task 1: Vercel cron config and milestone dispatch route handler** - `d54cef0` (feat)
2. **Task 2: Milestone dispatch core logic with template loading and multi-channel send** - `6c20383` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `vercel.json` — Cron schedule: daily 06:00 UTC to /api/cron/milestone-dispatch
- `src/app/api/cron/milestone-dispatch/route.ts` — CRON_SECRET-secured GET handler; calls runMilestoneDispatch(); returns 200 on both success and error
- `src/lib/cron/milestoneDispatch.ts` — Core engine: hotel loop, timezone-aware dates, agent is_enabled guard, bookings query per milestone, template loading, WhatsApp/email dispatch, sent flag update, batch processing with Promise.allSettled

## Decisions Made

- Applied SupabaseClient cast to all cron queries (hotels, agents, message_templates, bookings) — partial column selects with manual Database types cause TypeScript never inference; same established project pattern from Phase 5 Plan 1
- Return 200 on fatal cron error — Vercel cron does not usefully retry on 5xx; consistent with project's Twilio webhook pattern (always return 200, log errors)
- WhatsApp review_request falls back to email when TWILIO_TEMPLATE_SID_REVIEW_REQUEST is unset — post-stay messages are outside the 24h free-form window; graceful degradation prevents silent failures
- Batch size 10 with Promise.allSettled — parallel without rate limit risk; individual booking failures isolated; summary counts errors vs successes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Applied SupabaseClient cast to hotels partial select in runMilestoneDispatch()**
- **Found during:** Task 2 (first build verification)
- **Issue:** TypeScript `never` inference on `.from('hotels').select('id, name, timezone, contact_email')` — partial column selects with manual Database types cause never inference for loop variable in postgrest-js v12
- **Fix:** Applied `(supabase as unknown as SupabaseClient)` cast to the hotels query; added `Pick<Hotel, 'id' | 'name' | 'timezone' | 'contact_email'>[]` type annotation on for-loop variable
- **Files modified:** src/lib/cron/milestoneDispatch.ts
- **Verification:** pnpm build passes with zero TypeScript errors
- **Committed in:** 6c20383 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - TypeScript compatibility bug)
**Impact on plan:** Auto-fix necessary for TypeScript compilation. Same established project pattern. No scope creep.

## Issues Encountered

- TypeScript never inference on partial hotel select — resolved by applying established SupabaseClient cast pattern with explicit Pick<Hotel, ...> type annotation on the for-loop variable (documented in Deviations above)

## User Setup Required

The following environment variables must be configured in Vercel project settings and local `.env.local` for cron to function:

| Variable | Required | Purpose |
|----------|----------|---------|
| `CRON_SECRET` | Yes | Authenticates Vercel cron invocations |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio API auth |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio API auth |
| `TWILIO_WHATSAPP_NUMBER` | Yes | Sender number (e.g. "+14155238886") |
| `TWILIO_TEMPLATE_SID_REVIEW_REQUEST` | Optional | WhatsApp template SID for post-stay review (outside 24h window); falls back to email if unset |
| `RESEND_API_KEY` | Yes | Email delivery |
| `RESEND_FROM_EMAIL` | Yes | Sender email address |

To test locally, invoke the cron endpoint directly:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/milestone-dispatch
```

## Next Phase Readiness

- Milestone trigger engine is fully operational; bookings in the database will receive messages automatically once CRON_SECRET and messaging credentials are configured
- Ready for 05-03: Owner dashboard (agents table for on/off toggle affects milestone dispatch via is_enabled guard)
- Ready for 05-04: Any remaining Phase 5 features

## Self-Check: PASSED

- FOUND: vercel.json (cron schedule at 0 6 * * *)
- FOUND: src/app/api/cron/milestone-dispatch/route.ts (CRON_SECRET guard + runMilestoneDispatch call)
- FOUND: src/lib/cron/milestoneDispatch.ts (exports runMilestoneDispatch)
- FOUND: commit d54cef0 (Task 1)
- FOUND: commit 6c20383 (Task 2)
- BUILD: pnpm build passes with zero TypeScript errors — /api/cron/milestone-dispatch route listed in build output

---
*Phase: 05-guest-experience-ai-and-owner-dashboard*
*Completed: 2026-03-05*
