---
phase: 11-setup-wizard-bot
verified: 2026-03-06T12:35:51Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 11: Setup Wizard Bot Verification Report

**Phase Goal:** Hotel owner receives a deep link, opens the Setup Wizard bot in Telegram, completes conversational onboarding, and sees all four employee bots activate with a 14-day trial — with wizard state persisted so drop-off does not restart from zero
**Verified:** 2026-03-06T12:35:51Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Wizard state can be saved and retrieved from Redis with 7-day TTL | VERIFIED | `wizardState.ts:116` — `redis.set(key, state, { ex: 604800 })`; TTL_SECONDS constant = 604800; resets on every `setWizardState` call |
| 2 | Each wizard step stores user input to the hotels table or hotel_facts incrementally | VERIFIED | `wizardSteps.ts:85,114` — hotels.name and hotels.address updated via `.from('hotels').update()`; hotel_facts upserted at lines 41-43 for room_count, checkin_time, checkout_time |
| 3 | Wizard completion writes onboarding_completed_at and sends employee bot links | VERIFIED | `wizardActions.ts:349-353` — `.update({ onboarding_completed_at: new Date().toISOString() })`; `wizardActions.ts:359-363` — `.from('hotel_bots').select('role, bot_username').eq('is_active', true)`; links formatted and sent via `sendWizardMessage` |
| 4 | Inline keyboard confirmation callback is handled with answerCallbackQuery | VERIFIED | `wizardActions.ts:284-295` — `answerCallbackQuery` called first unconditionally before processing callback data; `wizard:confirm` and `wizard:restart` both handled |
| 5 | Resume after drop-off returns the owner to their current step | VERIFIED | `wizardActions.ts:166-176` — `/start` with same hotelId detects existing session via `getWizardState`, sends "You have an active setup session. Pick up where you left off:" + `getStepPrompt(existingState.step)` |
| 6 | Telegram wizard webhook receives updates and routes to handleWizardMessage or handleWizardCallback | VERIFIED | `wizard/route.ts:93-95` — inside `after()`, routes `hasValidMessage` to `handleWizardMessage` and `hasValidCallback` to `handleWizardCallback` |
| 7 | Webhook secret is validated via X-Telegram-Bot-Api-Secret-Token header | VERIFIED | `wizard/route.ts:54-59` — reads `x-telegram-bot-api-secret-token` header, compares against `SETUP_WIZARD_WEBHOOK_SECRET`, returns 403 on mismatch |
| 8 | HTTP 200 is returned before wizard processing begins (after() pattern) | VERIFIED | `wizard/route.ts:90,106` — `after(async () => { ... })` wraps all processing; `return new Response('', { status: 200 })` follows unconditionally |
| 9 | Admin can register the wizard bot webhook via a one-time API call | VERIFIED | `register-wizard-webhook/route.ts:92-107` — calls `https://api.telegram.org/bot${botToken}/setWebhook` with `allowed_updates: ['message', 'callback_query']`, `drop_pending_updates: true`; SUPER_ADMIN_EMAIL auth guard at lines 65-68 |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/telegram/types.ts` | TelegramCallbackQuery type and TelegramUpdate extension | VERIFIED | `TelegramCallbackQuery` interface defined (lines 21-30); `callback_query?: TelegramCallbackQuery` on `TelegramUpdate` (line 40) |
| `src/lib/telegram/wizard/wizardState.ts` | Redis-based wizard session CRUD | VERIFIED | Exports: `getWizardState`, `setWizardState`, `clearWizardState`, `isRedisAvailable`, `WizardState` type, `WizardStep` type; 153 lines of substantive implementation |
| `src/lib/telegram/wizard/wizardSteps.ts` | Step transition logic with incremental DB writes | VERIFIED | Exports `advanceWizard`; 273 lines covering all 6 WizardStep cases with DB writes and state transitions |
| `src/lib/telegram/wizard/wizardActions.ts` | Wizard message sending, callback handling, completion | VERIFIED | Exports `sendWizardMessage`, `handleWizardMessage`, `handleWizardCallback`; private `completeWizard`; 401 lines of substantive implementation |
| `src/app/api/telegram/wizard/route.ts` | Wizard bot webhook handler | VERIFIED | Exports `POST`; validates secret, uses `after()`, routes message and callback_query; 107 lines |
| `src/app/api/admin/register-wizard-webhook/route.ts` | One-time webhook registration endpoint | VERIFIED | Exports `POST`; SUPER_ADMIN_EMAIL auth guard, env var validation, calls Telegram setWebhook; 138 lines |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `wizardSteps.ts` | `wizardState.ts` | `setWizardState` after each step transition | WIRED | Called 5 times (lines 98, 127, 158, 193, 228) — once per data-collection step |
| `wizardSteps.ts` | hotels/hotel_facts tables | service client `.from('hotels')` / `.from('hotel_facts')` | WIRED | `from('hotels')` at lines 85, 114; `from('hotel_facts')` at line 41 |
| `wizardActions.ts` | `wizardState.ts` | `getWizardState` for resume, `clearWizardState` on completion | WIRED | `getWizardState` imported and called 4 times; `clearWizardState` called at line 400 in `completeWizard` |
| `wizardActions.ts` | Telegram Bot API | `sendMessage` + `answerCallbackQuery` fetch calls | WIRED | `api.telegram.org` at lines 56 and 286; responses handled; MarkdownV2 + plaintext fallback |
| `wizard/route.ts` | `wizardActions.ts` | `handleWizardMessage` and `handleWizardCallback` imports | WIRED | Imported at line 35; called at lines 93, 95 inside `after()` |
| `wizard/route.ts` | `next/server after()` | `after()` wraps all processing | WIRED | `after(async () => { ... })` at line 90; 200 returned at line 106 after `after()` registration |
| `register-wizard-webhook/route.ts` | Telegram Bot API setWebhook | fetch call with `allowed_updates: ['message', 'callback_query']` | WIRED | `setWebhook` call at line 92; `allowed_updates` at line 105 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| ONBT-01 | 11-01, 11-02 | Setup Wizard as separate Telegram bot — activates via deep link | SATISFIED | `/api/telegram/wizard` webhook handler with fixed route; `/start {hotelId}` deep link intake in `handleWizardMessage`; SETUP_WIZARD_BOT_TOKEN separate from employee bot tokens |
| ONBT-02 | 11-01 | Conversational info collection (hotel name, address, rooms, check-in/out times) | SATISFIED | 5-step state machine in `wizardSteps.ts`: collect_hotel_name, collect_address, collect_room_count, collect_checkin_time, collect_checkout_time — each prompts and persists |
| ONBT-03 | 11-01 | Team introduction — presents each employee bot with direct link | SATISFIED | `completeWizard` in `wizardActions.ts:359-388` fetches active hotel_bots, builds `t.me/{bot_username}` links with role labels, sends as completion message |
| ONBT-04 | 11-01 | Setup completion activates all employee bots with 14-day trial | SATISFIED | `completeWizard` writes `onboarding_completed_at`; completion message includes "Your 14-day trial has started. Enjoy!" (line 395); trial subscription pre-created by seed_hotel_defaults (Phase 10, intentionally not duplicated) |

All 4 requirement IDs from PLAN frontmatter are accounted for. No orphaned requirements found — REQUIREMENTS.md traceability table maps ONBT-01 through ONBT-04 to Phase 11 with status Complete.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `wizardActions.ts` | 201 | Comment contains word "placeholder" (code comment describing default hotel name check) | Info | Not a code stub — the word appears in a code comment: `// Pre-fill hotel name if it's been set and is not the default placeholder`. The code itself is fully implemented. No impact. |

No blockers. No warnings. One informational note — the word "placeholder" appears only in a comment describing the default hotel name value `'My Hotel'`, not as a code stub.

---

### Human Verification Required

The following items cannot be verified programmatically and require human testing with a real Telegram bot and Redis instance:

#### 1. End-to-End Wizard Flow

**Test:** Create a hotel in the super admin panel. Copy the deep link. Open the link in Telegram. Follow the wizard through all 5 data-collection steps. Click "Yes, activate!" on the confirmation keyboard.
**Expected:** All 5 answers saved to hotels/hotel_facts tables; onboarding_completed_at set; message with employee bot t.me links sent; wizard state cleared from Redis.
**Why human:** Requires live Telegram bot, live Redis (Upstash), and live Supabase — cannot verify runtime network calls programmatically.

#### 2. Session Resume After Drop-Off

**Test:** Start the wizard, answer the first 2 questions, then close Telegram and reopen it after several minutes. Send `/start {same hotelId}` again.
**Expected:** Bot responds "You have an active setup session. Pick up where you left off:" followed by the question for step 3 (room count).
**Why human:** Requires live Redis session persistence across a real time gap; cannot simulate stateful multi-message flow programmatically.

#### 3. Invalid Room Count Validation

**Test:** When prompted for room count, type "abc" or "-5".
**Expected:** Bot sends "Please enter a valid number of rooms (e.g. 20)" and does not advance the wizard step. Subsequent valid input advances normally.
**Why human:** Requires live bot interaction; the validation logic exists in code (wizardSteps.ts:136-144) but the user experience must be confirmed.

#### 4. Restart Flow

**Test:** Complete all 5 steps, reach the confirmation keyboard, click "Start over".
**Expected:** Bot responds "No problem! Let's start again." and asks for hotel name. Previous answers NOT preserved in state.
**Why human:** Requires live keyboard interaction; the logic exists (wizardActions.ts:306-323) but must be confirmed in practice.

#### 5. 14-Day Trial Visibility

**Test:** Complete the wizard. Check the subscriptions table in Supabase.
**Expected:** Trial subscription row for this hotel exists (created by seed_hotel_defaults at hotel creation time in Phase 10) with a trial_end date 14 days from hotel creation. Wizard completion does not create a duplicate row.
**Why human:** Requires confirming the Phase 10 seed_hotel_defaults PostgreSQL function created the trial correctly — the wizard intentionally does not touch the subscriptions table.

---

### Gaps Summary

None. All 9 must-have truths verified. All 6 artifacts pass all three levels (exists, substantive, wired). All 7 key links confirmed present and active. All 4 requirement IDs (ONBT-01, ONBT-02, ONBT-03, ONBT-04) are satisfied with direct code evidence. TypeScript compilation passes with zero errors. All 4 commits (e722008, 812910d, 29ab79d, 6172f4a) verified in git history.

---

_Verified: 2026-03-06T12:35:51Z_
_Verifier: Claude (gsd-verifier)_
