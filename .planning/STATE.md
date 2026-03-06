# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-06)

**Core value:** Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.
**Current focus:** Milestone v2.0 — Agent-Native SaaS (Telegram-first) — Phase 14 complete

## Current Position

Phase: 14 (Fix callback_query Delivery) — Complete
Plan: 1 complete (14-01-PLAN.md done)
Status: Phase 14 complete — Fixed allowed_updates in provisionBots.ts (added callback_query), admin re-provision endpoint for existing bots
Last activity: 2026-03-06 — Phase 14 Plan 1 executed (provisionBots.ts fix, reprovision-employee-webhooks/route.ts)

```
v2.0 Progress: [====>     ] 31%
Phase 9:  [==] Complete (2/2 plans complete)
Phase 10: [===] Complete (3/3 plans complete)
Phase 11: [==] Complete (2/2 plans complete)
Phase 12: [===] Complete (3/3 plans complete)
Phase 13: [==] Complete (2/2 plans complete)
Phase 14: [=] Complete (1/1 plans complete)
```

## Performance Metrics

**Velocity:**
- Total plans completed: 21
- Average duration: 11.5 min
- Total execution time: 236 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | 23 min | 11.5 min |
| 02-agent-core | 4 | 56 min | 14 min |
| 03-knowledge-base | 3 | 30 min | 10 min |
| 04-guest-facing-layer | 5 | 103 min | 20.6 min |
| 05-guest-experience | 4 of 4 | 54 min | 13.5 min |
| 06-billing | 4 of 4 | 46 min | 11.5 min |
| 07-booking-ai | 3 of 3 | 20 min | 6.7 min |
| 08-housekeeping-coordinator | 1 of 1 | 13 min | 13 min |

**Recent Trend:**
- Last 5 plans: 12 min, 15 min, 4 min, 9 min, 13 min
- Trend: Stable

*Updated after each plan completion*

| Phase 09-telegram-infrastructure P02 | 16 | 2 tasks | 4 files |
| Phase 09-telegram-infrastructure P01 | 4 | 2 tasks | 5 files |
| Phase 08-housekeeping-coordinator P01 | 13 | 2 tasks | 11 files |
| Phase 07-booking-ai P03 | 10 | 2 tasks | 2 files |
| Phase 07-booking-ai P02 | 6 | 2 tasks | 5 files |
| Phase 07-booking-ai P01 | 4 | 2 tasks | 6 files |
| Phase 06-billing P04 | 9 | 2 tasks | 5 files |
| Phase 06-billing P03 | 17 | 2 tasks | 7 files |
| Phase 06-billing P02 | 16 | 2 tasks | 8 files |
| Phase 06-billing P01 | 4 | 2 tasks | 5 files |
| Phase 05 P04 | 14 | 2 tasks | 7 files |
| Phase 08-housekeeping-coordinator P02 | 8 | 2 tasks | 7 files |
| Phase 10-super-admin-panel-and-employee-bots P01 | 14 | 2 tasks | 3 files |
| Phase 10-super-admin-panel-and-employee-bots P02 | 8 | 2 tasks | 5 files |
| Phase 11 P02 | 2 | 2 tasks | 2 files |
| Phase 12-billing-model-migration P01 | 7 | 3 tasks | 6 files |
| Phase Phase 12-billing-model-migration P02 P02 | 4 | 2 tasks | 3 files |
| Phase 13-proactive-messaging-dashboard-readonly P02 | 5 | 1 tasks | 1 files |
| Phase 13 P01 | 3 | 2 tasks | 3 files |
| Phase 14-fix-callback-query-delivery P01 | 2 | 1 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Supabase chosen over Firebase — relational data model, RLS for multi-tenant isolation, existing team familiarity
- iyzico (TR) + Mollie (EU) for billing — Stripe replaced by market-appropriate payment gateways
- Stateless agent invocation — no persistent agent processes; context assembled from DB on every call (Vercel serverless constraint)
- claude-opus-4-6 for guest-facing, claude-sonnet-4-6 for internal/background tasks
- Tool-first policy enforced — agents cannot state availability or prices without a successful tool call
- NEXT_PUBLIC_SUPABASE_ANON_KEY (not publishable key) — project created before new Supabase key format
- Turbopack CSS workaround — used direct node_modules paths for CSS packages that use 'style' export condition
- Explicit TZDate type narrowing — TypeScript strict mode requires if/else narrowing for string|Date union with TZDate overloads
- refreshSession() required post-signup — initial JWT at signUp time does not contain hotel_id (trigger runs after token issuance); forced refresh triggers Custom Access Token Hook to embed hotel_id
- (auth)/(dashboard) route groups — Next.js parenthesis groups for layout segregation without URL path impact; src/app/page.tsx must be removed when (dashboard)/page.tsx claims the same / route
- SignOutButton extracted to client component — dashboard layout is Server Component; signOut() + useRouter require browser-side Supabase client
- Conversation turns limited to 20 per invocation — prevents context rot per research recommendation (Phase 2 Plan 1)
- .returns<T>() required for Supabase SELECT with manual Database types — postgrest-js v12 type inference requires this workaround until generated types are used (Phase 2 Plan 1)
- No service_role client in memory helpers — all queries respect RLS via anon key + session cookie (Phase 2 Plan 1)
- Anthropic SDK types used directly in types.ts — replaced placeholder types to eliminate compatibility issues between SDK and codebase (Phase 2 Plan 2)
- MessageStream imported from @anthropic-ai/sdk/lib/MessageStream — not re-exported from main SDK module (Phase 2 Plan 2)
- isToolRequired() errs on false positives — better to over-call tools than allow Claude to answer availability/pricing from training data (Phase 2 Plan 2)
- invokeAgentRecursive() uses tool_choice=auto — tools already called once, forcing again would be circular (Phase 2 Plan 2)
- AgentRole enum imported as value (not type) in registry.ts — TypeScript enum used in switch case must be imported as runtime value (Phase 2 Plan 3)
- delegate_task tool FRONT_DESK only — prevents circular delegation chains from non-front-desk roles (Phase 2 Plan 3)
- ToolContext always threaded through executeTool — future-proofs executor for hotel-scoped tools without signature changes (Phase 2 Plan 3)
- Node.js runtime (not Edge) on /api/agent/stream — supabase/ssr cookie auth breaks in Edge runtime (Phase 2 Plan 4)
- Fire-and-forget invokeAgent() in ReadableStream.start() — awaiting buffers full response before first SSE byte reaches client (Phase 2 Plan 4)
- Default conversationId is hotelId_owner_chat — one persistent conversation per hotel owner per research recommendation (Phase 2 Plan 4)
- Client-side chunked SSE buffer in useChatStream — ReadableStream reader returns arbitrary byte chunks; buffer until \n\n delimiter (Phase 2 Plan 4)
- onboarding_completed_at as dedicated column on hotels — explicit gate for onboarding wizard, not city check proxy (Phase 3 Plan 1)
- amenities submitted as comma-separated string from form, split to TEXT[] in Server Action — avoids complex array field in FormData (Phase 3 Plan 1)
- base_price_note as freeform text for agent display only — not structured pricing data; avoids premature booking engine assumptions (Phase 3 Plan 1)
- loadRoomContext returns empty string on error — matches loadSemanticFacts pattern; agent falls back gracefully (Phase 3 Plan 1)
- URL-persisted tab state (?tab=) prevents active tab reset when router.refresh() re-renders Server Component after CRUD operations (Phase 3 Plan 2)
- FactList/RoomList manage their own edit dialog state locally — no global state needed; each list is self-contained (Phase 3 Plan 2)
- react-hook-form useEffect reset() on prop change handles switching between edit targets without stale form values (Phase 3 Plan 2)
- Wizard step completion triggers onboarding_completed_at when city is provided — city is minimum signal that setup is meaningful (Phase 3 Plan 3)
- Dashboard home page does /onboarding redirect; layout only shows banner — avoids redirect loop from layout for all dashboard routes (Phase 3 Plan 3)
- update_hotel_info uses RLS-scoped server client — consistent with "no service_role in memory helpers" project decision (Phase 3 Plan 3)
- Progress component created manually from radix-ui — shadcn CLI not used; follows existing component pattern (Phase 3 Plan 3)
- Cookie-based locale (NEXT_LOCALE) without URL routing — no [locale] segment or createMiddleware needed for next-intl (Phase 4 Plan 4)
- export const dynamic = force-dynamic required for dashboard layout — Supabase auth.getUser() needs real request context; static prerendering fails at build time (Phase 4 Plan 4)
- LocaleSwitcher sets 1-year NEXT_LOCALE cookie + router.refresh() — re-renders Server Components with new locale without page reload (Phase 4 Plan 4)
- request.ip not available on NextRequest in Next.js 16 — use x-forwarded-for header only for IP extraction on Vercel (Phase 4 Plan 1)
- Graceful degradation for rate limiting — return success:true when UPSTASH_REDIS_REST_URL not set; prevents blocking all traffic if Redis is unavailable (Phase 4 Plan 1)
- Public route bypass in updateSession() not middleware.ts — auth module handles its own bypass; rate limiter only does rate limiting (Phase 4 Plan 1)
- Twilio webhook always returns 200 — even on errors — to prevent retry storm; errors are caught and logged, not re-thrown (Phase 4 Plan 2)
- Non-streaming invokeAgent for WhatsApp — channel requires complete message; onToken callback omitted (Phase 4 Plan 2)
- Conversation ID wa_{hotelId}_{phone} pattern — persistent per guest phone across sessions; wa_ prefix distinguishes from widget_ channels (Phase 4 Plan 2)
- TWILIO_WHATSAPP_NUMBER sandbox fallback — routes all sandbox traffic to first hotel for MVP testing without requiring hotel_whatsapp_numbers entry (Phase 4 Plan 2)
- [Phase 04-guest-facing-layer]: Service-role client in service.ts bypasses RLS for server-side ops where no user session exists (widget/WhatsApp) — token validation happens in code, not RLS (Phase 4 Plan 3)
- [Phase 04-guest-facing-layer]: hotelId parsed server-side from conversationId (widget_{hotelId}_{uuid}) — never accepted from client body to prevent hotel spoofing (Phase 4 Plan 3)
- [Phase 04-guest-facing-layer]: Supabase Realtime Broadcast used for AI response delivery to widget guests — agent runs to completion server-side then pushes to channel (Phase 4 Plan 3)
- [Phase 04-guest-facing-layer]: detectAndInsertEscalation() called without await in handleEndTurn — fire-and-forget with .catch() at call site plus internal try/catch (double safety net) (Phase 4 Plan 5)
- [Phase 04-guest-facing-layer]: EscalationChannel determined from conversationId prefix server-side (wa_ = whatsapp, else widget) — channel param ignored to prevent spoofing (Phase 4 Plan 5)
- [Phase 04-guest-facing-layer]: DESK-05 multilingual update — agentFactory MULTILINGUAL SUPPORT block explicitly lists English, Turkish, Dutch, German, French (Phase 4 Plan 5)
- [Phase 05-guest-experience]: SupabaseClient cast for new tables — (supabase as unknown as SupabaseClient).from() avoids TypeScript never inference for manually-typed tables in postgrest-js v12; same pattern as escalation.ts (Phase 5 Plan 1)
- [Phase 05-guest-experience]: Conservative ACT default in classifyAction — unknown/future tools default to ACT to prevent false permission assumptions; owner confirmation gate deferred until first ACT tool exists (Phase 5 Plan 1)
- [Phase 05-guest-experience]: is_enabled guard uses .maybeSingle() not .single() — graceful fallback for hotels created before Phase 5 migration (no agents row = treat as enabled) (Phase 5 Plan 1)
- [Phase 05-guest-experience]: seed_hotel_defaults extended via CREATE OR REPLACE FUNCTION in 0005 migration — inserts front_desk and guest_experience agent rows atomically on hotel creation (Phase 5 Plan 1)
- [Phase 05-guest-experience]: SupabaseClient cast applied to hotels partial select in cron — Pick<Hotel,...> type annotation on for-loop variable resolves never inference for column subset queries (Phase 5 Plan 2)
- [Phase 05-guest-experience]: Cron route returns 200 on fatal error — consistent with Twilio webhook pattern; Vercel cron single-attempt behavior; errors logged for debugging (Phase 5 Plan 2)
- [Phase 05-guest-experience]: WhatsApp review_request falls back to email when TWILIO_TEMPLATE_SID_REVIEW_REQUEST unset — post-stay messages outside 24h free-form window; graceful degradation without silent failure (Phase 5 Plan 2)
- [Phase 05-guest-experience]: Native HTML select for tone dropdown in /employees — shadcn Select not available; Tailwind-styled select matches existing input patterns (Phase 5 Plan 3)
- [Phase 05-guest-experience]: Conversation grouping in JS for /conversations — PostgREST lacks GROUP BY; fetch 200 turns and reduce by conversation_id is practical for MVP scale (Phase 5 Plan 3)
- [Phase 05-guest-experience]: Agent role derived from conversation_id pattern (contains guest_experience = GE, wa_* = WhatsApp FD, widget_* = Widget FD) — avoids cross-table join for display purposes (Phase 5 Plan 3)
- [Phase 05-guest-experience]: ?role= URL param filter on /conversations — stateless Server Component; no client-side state needed (Phase 5 Plan 3)
- [Phase 05-guest-experience]: useChatStream accepts optional {conversationId, role} options — backward compatible; existing /desk page unchanged
- [Phase 05-guest-experience]: API route role resolution: roleStr from body maps guest_experience -> GUEST_EXPERIENCE, anything else -> FRONT_DESK (safe default)
- [Phase 05-guest-experience]: EscalationNotificationProvider: Supabase Realtime client-side postgres_changes subscription as provider component with 15s toast duration
- [Phase 06-billing]: SubscriptionInfo named instead of SubscriptionStatus in trialStatus.ts to avoid clash with DB type
- [Phase 06-billing]: enforceAgentLimit uses service_role client — hotel_id already validated by session in calling server action
- [Phase 06-billing]: getProviderForHotel uses toUpperCase() for case-insensitive TR comparison
- [Phase 06-billing]: iyzipay library exposes subscription.upgrade directly — no raw fetch needed for upgrade endpoint
- [Phase 06-billing]: iyzipay ships no TypeScript types — handwritten declarations in src/types/iyzipay.d.ts covering only used SDK surface
- [Phase 06-billing]: Downgrade blocked (not auto-disabled) when enabled agents exceed new plan limit — consistent with research recommendation
- [Phase 06-billing]: Mollie client uses createMollieClient() factory (not new Client()) — SDK v4 exports factory, not class
- [Phase 06-billing]: validateMollieSignature returns true when MOLLIE_WEBHOOK_SECRET is unset — classic webhooks omit X-Mollie-Signature; security relies on API re-fetch model
- [Phase 06-billing]: Mollie payment.get() overload void inference — cast via 'as unknown as Payment' to avoid TypeScript picking callback overload
- [Phase 06-billing]: toggleAgent returns void (Server Action constraint) — enforcement errors communicated via redirect to /employees?error=X search param
- [Phase 06-billing]: PLAN_ORDER typed as Array<Exclude<PlanName, 'trial'>> — getPlanPrice only accepts paid plans; narrowing the array type avoids TypeScript error without casting
- [Phase 07-booking-ai]: hotel_id injected from ToolContext.hotelId in executor dispatch — never accepted from AI model input to prevent cross-hotel data leakage
- [Phase 07-booking-ai]: Overlap detection: .lt(check_in_date, check_out).gt(check_out_date, check_in) — standard half-open interval, excludes back-to-back reservations
- [Phase 07-booking-ai]: base_price_note returned as-is from getRoomPricing (freeform text, not computed price) — consistent with Phase 3 decision
- [Phase 07-booking-ai]: BOOKING_AI gets 3 tools (availability, pricing, reservation lookup) — no delegate_task prevents circular delegation chains from non-FRONT_DESK roles
- [Phase 07-booking-ai]: BOOKING_AI upsell instruction — offer upgrade once naturally then let guest respond (non-pressuring)
- [Phase 07-booking-ai]: SSE role resolution ternary chain: guest_experience → GUEST_EXPERIENCE, booking_ai → BOOKING_AI, else → FRONT_DESK (backward compatible)
- [Phase 07-booking-ai]: Rolling context window — RECENT_TURNS_N=10 (last N via DESC+reverse), SUMMARY_THRESHOLD=30, fire-and-forget summarizeOldTurns with service client and turns_summarized stale-check
- [Phase 07-booking-ai]: Conversation summary injected as first memoryParts entry in assembleSystemPrompt — model reads prior context before hotel knowledge base
- [Phase 08-housekeeping-coordinator]: HOUSEKEEPING_COORDINATOR uses claude-sonnet-4-6 (internal/owner-facing) and memoryScope=none (stateless — no per-guest history needed for room status management)
- [Phase 08-housekeeping-coordinator]: hotel_id NOT in housekeeping tool schemas — injected from ToolContext.hotelId in executor dispatch (same security pattern as Phase 7 booking tools)
- [Phase 08-housekeeping-coordinator]: StatusBoard polls every 5 seconds via setInterval — simplest approach ensuring board reflects agent tool changes within one polling window
- [Phase 08-housekeeping-coordinator]: StatusBoard extracts hotel_id from JWT access token payload via atob+JSON.parse — custom access token hook embeds hotel_id into JWT claims at login
- [Phase 08-housekeeping-coordinator]: ILIKE partial match for room resolution in updateRoomStatus: zero matches = error, multiple = disambiguation candidates list, single = upsert
- [Phase 08-housekeeping-coordinator]: [Phase 08-housekeeping-coordinator]: Cron idempotency via upsert with ignoreDuplicates=true — postgrest-js insert() lacks onConflict option; upsert equivalent to INSERT ON CONFLICT DO NOTHING
- [Phase 08-housekeeping-coordinator]: [Phase 08-housekeeping-coordinator]: assignCleaningTask uses maybeSingle() for queue update — optional assignment works even without today's queue entry; Resend graceful fallback when RESEND_API_KEY unset

- [Phase 09-telegram-infrastructure]: after() from next/server wraps invokeAgent() in webhook handler — returns HTTP 200 before agent completes, preventing Telegram retry storms
- [Phase 09-telegram-infrastructure]: Bot token Vault decryption inside after() callback — plaintext token only in memory during post-response window
- [Phase 09-telegram-infrastructure]: Non-text Telegram updates (photos, stickers) return 200 silently — handler only processes message.text
- [Phase 09-telegram-infrastructure]: Unknown slug and rate-limited requests return 200 (not 404/429) — prevents Telegram retry amplification
- [Phase 09-telegram-infrastructure]: MarkdownV2 primary format with plaintext fallback on HTTP 400 — ensures guests always receive a reply
- [Phase 09-telegram-infrastructure]: webhook_path_slug is a random UUID (not bot token) as webhook URL path segment — prevents token exposure in URLs/logs/caches
- [Phase 09-telegram-infrastructure]: No FK constraint from vault_secret_id to vault.secrets — Supabase Vault schema is internal and not addressable via pg_catalog
- [Phase 09-telegram-infrastructure]: get_bot_token() SECURITY DEFINER with REVOKE from PUBLIC/anon/authenticated, GRANT to service_role only — plaintext token never accessible to frontend
- [Phase 09-telegram-infrastructure]: Vault cleanup trigger deletes vault secret on hotel_bots DELETE — prevents orphaned secrets accumulating
- [Phase 09-telegram-infrastructure]: detectAndInsertEscalation() channel param type changed from hardcoded union to EscalationChannel — stays in sync with DB constraint automatically
- [Phase 09-telegram-infrastructure]: invokeAgent.ts handleEndTurn fallback changed from 'dashboard' (invalid) to 'widget' — DB CHECK only allows whatsapp|widget|telegram
- [Phase 10-super-admin-panel-and-employee-bots]: void async IIFE for Vault cleanup fire-and-forget — PostgrestFilterBuilder has no .catch(); wraps await rpc() in IIFE for semantically identical fire-and-forget with error logging
- [Phase 10-super-admin-panel-and-employee-bots]: trigger timing fallback queries profiles table — auth.admin.createUser may return before handle_new_user writes hotel_id to app_metadata; profiles row is always present after trigger runs
- [Phase 10-super-admin-panel-and-employee-bots]: adminCreateHotel upserts onboarding_completed_at immediately — admin-created hotels skip onboarding wizard; hotel owner onboarded via Telegram Setup Wizard (Phase 11)
- [Phase 10-super-admin-panel-and-employee-bots]: provisionBotForRole uses upsert with onConflict hotel_id,role — handles token rotation without UNIQUE constraint violation; setWebhook call overwrites existing registration
- [Phase 10-super-admin-panel-and-employee-bots]: Client Component split for admin forms — (admin)/admin/[hotelId]/page.tsx stays Server Component for DB queries; BotProvisionForm and DeepLinkCopy extracted to separate Client Component files
- [Phase 10-super-admin-panel-and-employee-bots]: useTransition for Server Action call in BotProvisionForm — startTransition(async () => await provisionAllBots()) enables isPending for loading state with explicit result and token-clearing control
- [Phase 10-super-admin-panel-and-employee-bots]: searchParams and params as Promise in Next.js 15+ Server Components — await required before destructuring in dynamic route and search param pages
- [Phase 11-setup-wizard-bot]: sanitizeGuestInput applied at handleWizardMessage entry before advanceWizard — double sanitization layer at actions + steps boundary
- [Phase 11-setup-wizard-bot]: completeWizard skips subscriptions table — trial created by seed_hotel_defaults at hotel creation (Phase 10 Pitfall 4)
- [Phase 11-setup-wizard-bot]: answerCallbackQuery fired unconditionally first in handleWizardCallback — dismisses loading spinner before any async DB operations
- [Phase 11-setup-wizard-bot]: upsertHotelFact logs errors without throwing — wizard should not stall on non-critical hotel_facts write failure
- [Phase 11]: Wizard webhook uses fixed route /api/telegram/wizard not slug-based — single global bot vs per-hotel employee bots
- [Phase 11]: Registration endpoint returns JSON 401/403 (not redirects) — API route called programmatically, not browser navigation
- [Phase 11]: drop_pending_updates: true on wizard setWebhook — discards queued updates from before registration to prevent wizard state confusion
- [Phase 12]: EmployeeRoleKey uses 2-letter shortCode in Telegram callback_data — stays within 64-byte limit (fd/bk/ge/hk)
- [Phase 12]: All roles selected by default in sendTrialSelectionKeyboard — owner deselects, not selects
- [Phase 12]: trialSelect:{chatId} key with 1-hour TTL — selection is transient, shorter than wizard 7-day TTL
- [Phase 12]: enforcement.ts left unchanged — tier-based enforceAgentLimit coexists with per-employee model until fully wired in later phase
- [Phase 12]: else-if chaining ordered most-recent-first in trial notification cron — prevents batch catch-up sends when hotel crosses multiple thresholds before first check
- [Phase 12]: handleTrialCallback fetches TrialSelection before answerCallbackQuery — botToken only available from Redis state (not env), slight delay acceptable
- [Phase 12]: Mollie paymentLinks.create() + getPaymentUrl() helper — avoids _links access on Seal type which strips _links from PaymentLink
- [Phase 12]: iyzico confirm redirects to /billing?action=subscribe — Turkish national ID required by iyzico Checkout Form, cannot be collected via Telegram
- [Phase 12]: Unselected bots deactivated before payment link generation — ensures bots stop immediately regardless of payment status
- [Phase 13]: Telegram-first banner is purely informational (no disabled writes) — WDSH-01 "readonly optional view" means Telegram is primary channel, not that dashboard features must be blocked; blue-50/blue-700 used for informational tone vs bg-primary for action-required onboarding banner
- [Phase 13]: Morning briefing sends from each active bot role (not just front_desk) — hotel owner gets distinct message from each AI employee deployed
- [Phase 13]: ROLE_BRIEFING_BUILDERS dispatch map for per-role morning briefing — O(1) lookup, unknown roles logged and skipped without crashing loop
- [Phase 14]: Re-provision endpoint omits drop_pending_updates — preserves real pending guest messages on existing bots
- [Phase 14]: Re-provision queries ALL hotel_bots rows (no is_active filter) — inactive bots updated so reactivation works correctly
- [Phase 14]: Sequential bot iteration in re-provision loop — no Promise.all to respect Telegram API rate limits at scale

### v2.0 Context

- grammy@1.41.1 chosen over Telegraf — TypeScript-native, webhook-first, Vercel serverless compatible, cleaner multi-bot support
- Webhook handler must return 200 before invokeAgent() — prevents Telegram retry storms and duplicate Claude API calls
- Bot tokens stored via Supabase Vault — plaintext token exposure would allow impersonation of every hotel's AI employees
- Per-bot dynamic route (/api/telegram/[botToken]) + per-bot webhook_secret — shared URL/secret makes hotel resolution impossible
- enforceAgentLimit() must be replaced before per-seat trial-end flow — tier caps (2/4/6) are incompatible with per-employee pricing
- iyzico dynamic subscription amounts: MEDIUM confidence — contact iyzico support before Phase 12 design commits to dynamic vs fixed tiers
- Conversation ID prefix tg_{hotelId}_{role} — consistent with existing wa_/widget_ namespace pattern
- parse_mode: "HTML" preferred over MarkdownV2 — simpler escaping rules, less risk of silent sendMessage failures
- super-admin panel: JWT app_metadata.role = 'super-admin' guard, /admin route group, Supabase auth.admin API
- Setup Wizard uses @grammyjs/conversations v2.x replay engine — session state stored in Supabase, not in-memory
- assembleContext.ts session client potential bug — test explicitly in Phase 9 (may be silent bug in WhatsApp webhook too)
- Tremor/Tailwind v4 compatibility unconfirmed — install @tremor/react early in Phase 10 and test one chart render before committing

### Pending Todos

- Contact iyzico support before Phase 12 begins: confirm whether dynamic subscription amount updates are supported or if fixed-tier workaround is needed
- Validate Tremor/Tailwind v4 compatibility in first Phase 10 task before committing to @tremor/react for admin dashboard

### Blockers/Concerns

- Phase 7: PostgreSQL atomic booking transactions and calendar sync options for boutique hotels without PMS need research
- Phase 11 (Setup Wizard): @grammyjs/conversations v2.x replay engine behavior on session resume after days-long gap needs research-phase before planning
- Phase 12 (Billing Migration): iyzico dynamic subscription amounts MEDIUM confidence — needs direct support confirmation before plan commits

## Session Continuity

Last session: 2026-03-06
Stopped at: Completed 14-01-PLAN.md — add callback_query to employee bot allowed_updates, admin re-provision endpoint
Resume file: None
