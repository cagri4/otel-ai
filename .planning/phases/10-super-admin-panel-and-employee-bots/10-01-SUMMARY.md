---
phase: 10-super-admin-panel-and-employee-bots
plan: 01
subsystem: api
tags: [supabase, telegram, vault, server-actions, postgresql]

requires:
  - phase: 09-telegram-infrastructure
    provides: hotel_bots table, create_bot_token_secret RPC, get_bot_token RPC, Vault cleanup trigger, resolveBot, Telegram webhook handler with roleMap

provides:
  - delete_vault_secret SECURITY DEFINER SQL function for orphan cleanup (0010_admin.sql)
  - adminCreateHotel Server Action — programmatic hotel creation via auth.admin.createUser with trigger timing fallback
  - provisionBotForRole Server Action — single-role bot provisioning with Vault + setWebhook + cleanup
  - provisionAllBots Server Action — parallel provisioning for all four roles via Promise.all

affects:
  - 10-02 (admin UI — these Server Actions are the form submission handlers)
  - 11-setup-wizard (hotel creation pattern established here)

tech-stack:
  added: []
  patterns:
    - void async IIFE for fire-and-forget Supabase RPC calls (PostgrestFilterBuilder has no .catch())
    - auth.admin.createUser with trigger timing fallback — query profiles table if app_metadata.hotel_id missing
    - Upsert with onConflict for idempotent re-provisioning (handles token rotation without duplicate rows)
    - HTTPS validation before Telegram API calls (setWebhook rejects http:// outright)

key-files:
  created:
    - supabase/migrations/0010_admin.sql
    - src/lib/admin/createHotel.ts
    - src/lib/admin/provisionBots.ts
  modified: []

key-decisions:
  - "void async IIFE for Vault cleanup fire-and-forget — PostgrestFilterBuilder exposes no .catch() method; chaining .then().catch() fails at TS level; IIFE wraps await cleanly"
  - "Trigger timing fallback queries profiles table — auth.admin.createUser may return before handle_new_user trigger writes hotel_id to app_metadata; profiles row is always present after trigger"
  - "Upsert onConflict hotel_id,role for re-provisioning — handles token rotation without UNIQUE constraint violation; setWebhook overwrites existing webhook registration"
  - "HTTPS check before getMe call — reject http:// before any network call to Telegram to provide clear error message before confusing Telegram API errors"

patterns-established:
  - "Pattern: void async IIFE for fire-and-forget Supabase RPC — use when PostgrestFilterBuilder result is discarded after error logging"
  - "Pattern: trigger timing fallback — always query related table as fallback when reading trigger-written app_metadata from createUser response"

requirements-completed: [SADM-01, SADM-02, SADM-03, EBOT-01, EBOT-02, EBOT-03, EBOT-04]

duration: 14min
completed: 2026-03-06
---

# Phase 10 Plan 01: Admin Backend Foundation Summary

**Supabase Admin API hotel creation with trigger timing fallback, Vault-encrypted bot provisioning with setWebhook registration and orphan cleanup, and delete_vault_secret SQL function for all four Telegram employee bot roles**

## Performance

- **Duration:** 14 min
- **Started:** 2026-03-06T11:22:20Z
- **Completed:** 2026-03-06T11:36:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `0010_admin.sql` migration adding `delete_vault_secret` SECURITY DEFINER function restricted to service_role — enables Vault orphan cleanup in provisioning Server Action
- Created `adminCreateHotel` Server Action using `auth.admin.createUser()` which fires the existing `handle_new_user` trigger; includes trigger timing fallback and immediate `onboarding_completed_at` mark
- Created `provisionBotForRole` and `provisionAllBots` Server Actions with full Vault + setWebhook + upsert pipeline and fire-and-forget cleanup on every failure path

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 0010_admin.sql migration and adminCreateHotel Server Action** - `d0ab47e` (feat)
2. **Task 2: Create provisionBots Server Action with Vault + setWebhook + cleanup** - `40f1442` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `supabase/migrations/0010_admin.sql` — `delete_vault_secret(UUID)` SECURITY DEFINER function, REVOKE from PUBLIC/anon/authenticated, GRANT to service_role
- `src/lib/admin/createHotel.ts` — `adminCreateHotel` Server Action: auth.admin.createUser, trigger timing fallback (profiles query), onboarding_completed_at mark
- `src/lib/admin/provisionBots.ts` — `provisionBotForRole` (HTTPS check, getMe, Vault insert, setWebhook, upsert, cleanup) and `provisionAllBots` (Promise.all parallel)

## Decisions Made

- **void async IIFE for Vault cleanup:** `PostgrestFilterBuilder` has no `.catch()` method and chaining `.then().catch()` on it also fails TypeScript. Used `void (async () => { try { await rpc(...) } catch {...} })()` for fire-and-forget cleanup with error logging.
- **Trigger timing fallback:** `auth.admin.createUser()` may return before the `handle_new_user` trigger writes `hotel_id` to `raw_app_meta_data`. Fallback queries `profiles` table directly since that row is always present when the trigger has run.
- **Upsert for re-provisioning:** `hotel_bots` has UNIQUE `(hotel_id, role)`. Using upsert with `onConflict: 'hotel_id,role'` handles both initial provisioning and token rotation without needing a pre-check.
- **HTTPS check before getMe:** Validate URL protocol before any Telegram API call to provide clear error message ("must be HTTPS") rather than letting setWebhook fail with a confusing Telegram API error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Vault cleanup .catch() not available on PostgrestFilterBuilder**
- **Found during:** Task 2 (provisionBots implementation)
- **Issue:** Plan specified `.rpc('delete_vault_secret', ...).catch(e => ...)` but `PostgrestFilterBuilder` has no `.catch()` method — TypeScript error TS2551
- **Fix:** Replaced with `void (async () => { try { await rpc(...) } catch(e) { console.error(...) } })()` pattern — semantically identical fire-and-forget with error logging
- **Files modified:** `src/lib/admin/provisionBots.ts`
- **Verification:** `tsc --noEmit` exits 0 with zero errors
- **Committed in:** `40f1442` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Fix necessary for correct TypeScript compilation. Behavior is semantically identical to the plan's intent — fire-and-forget with error logging.

## Issues Encountered

None beyond the auto-fixed TypeScript issue above.

## User Setup Required

Two environment variables are needed before the admin UI (Plan 02) is functional:

| Variable | Source | Purpose |
|---|---|---|
| `SUPER_ADMIN_EMAIL` | Your own Supabase auth login email | Route guard in admin layout — only this email can access `/admin` |
| `SETUP_WIZARD_BOT_USERNAME` | BotFather — the @username of the Setup Wizard bot | Deep link generation (`t.me/{username}?start={hotelId}`); can be placeholder until Phase 11 |

Add both to `.env.local` and Vercel project settings before Plan 02 is executed.

## Next Phase Readiness

- Plan 02 (admin UI) can now import `adminCreateHotel` and `provisionBots` as Server Action form handlers
- All four employee bot roles (front_desk, booking_ai, guest_experience, housekeeping_coordinator) will be operational the moment `hotel_bots` rows are provisioned — the Phase 9 webhook handler already routes all four roles via `roleMap`
- The `delete_vault_secret` SQL function must be applied to the database via `supabase db push` or Supabase Dashboard SQL editor before provisioning is tested

---
*Phase: 10-super-admin-panel-and-employee-bots*
*Completed: 2026-03-06*
