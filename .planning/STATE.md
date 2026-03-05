# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.
**Current focus:** Phase 6 — Billing

## Current Position

Phase: 6 of 8 (Billing) — IN PROGRESS
Plan: 1 of 4 completed
Status: In Progress — Completed 06-01-PLAN.md
Last activity: 2026-03-05 — Completed 06-01-PLAN.md (subscriptions table migration, TypeScript types, PLAN_LIMITS, enforceAgentLimit, getSubscriptionStatus)

Progress: [█████████████████████] 84%

## Performance Metrics

**Velocity:**
- Total plans completed: 17
- Average duration: 12.4 min
- Total execution time: 210 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | 23 min | 11.5 min |
| 02-agent-core | 4 | 56 min | 14 min |
| 03-knowledge-base | 3 | 30 min | 10 min |
| 04-guest-facing-layer | 5 | 103 min | 20.6 min |
| 05-guest-experience | 4 of 4 | 54 min | 13.5 min |
| 06-billing | 1 of 4 | 4 min | 4 min |

**Recent Trend:**
- Last 5 plans: 19 min, 21 min, 12 min, 15 min, 4 min
- Trend: Stable (4 min unusually fast — foundation/types plan)

*Updated after each plan completion*
| Phase 05 P04 | 14 | 2 tasks | 7 files |
| Phase 06-billing P01 | 4 | 2 tasks | 5 files |

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
- Client-side chunked SSE buffer in useChatStream — ReadableStream reader returns arbitrary byte chunks; buffer until \\n\\n delimiter (Phase 2 Plan 4)
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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 7: PostgreSQL atomic booking transactions and calendar sync options for boutique hotels without PMS need research

## Session Continuity

Last session: 2026-03-05
Stopped at: Completed 06-01-PLAN.md — subscriptions table migration (0006_billing.sql), TypeScript Subscription types, plans.ts (PLAN_LIMITS/getProviderForHotel), enforcement.ts (enforceAgentLimit), trialStatus.ts (getSubscriptionStatus). Phase 6 plan 1 of 4 complete.
Resume file: None
