# Phase 13: Proactive Messaging and Dashboard Readonly - Research

**Researched:** 2026-03-06
**Domain:** Telegram outbound messaging / rate limiting / Next.js dashboard readonly patterns
**Confidence:** HIGH

## Summary

Phase 13 has two loosely coupled goals: (1) proactive morning briefings from employee bots to hotel owners, and (2) preserving the existing web dashboard as an accessible readonly view. These are independent work streams that can be planned as separate plans.

The proactive messaging work builds directly on Phase 12's trial notification cron pattern. The existing `trialNotification.ts` cron already demonstrates the full pattern: query hotels, resolve bot tokens from Vault, call `sendTelegramReply()` per hotel. Morning briefings require the same infrastructure with new message content — a daily summary generated per bot role. The only new constraint is rate limiting: when many hotels receive briefings simultaneously, multiple bots may fire requests in the same second. Telegram's hard limit is ~30 messages/second per bot token, and since each hotel has separate bot tokens, the actual risk is lower than it appears — but sequential processing with a small delay between sends is the safe pattern.

The dashboard readonly goal (WDSH-01) requires research into what "readonly" means given the current dashboard. All interactive write operations in the dashboard are: employee on/off toggle, agent behavior config, hotel settings, knowledge base CRUD, housekeeping chat, and front desk/employee chats. The requirement says "accessible as readonly optional view" — meaning the data must remain visible, not that all interactions must be blocked. Since the existing dashboard already works (no data is being removed), WDSH-01 is likely satisfied by ensuring no dashboard routes break after Phase 13 changes and possibly adding a banner noting that the primary interface is now Telegram.

**Primary recommendation:** Build the morning briefing as a new Vercel cron using the exact same pattern as `trialNotification.ts`. Add a 40ms sleep between sends as a conservative rate-limit guard. For the dashboard, verify all routes still function and add a "Telegram is the primary interface" informational banner — no routes need to be disabled.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WDSH-01 | Existing dashboard remains accessible as readonly optional view | Dashboard is already fully functional. No routes have been removed. "Readonly" interpretation: keep all read views working; no write features need to be disabled. Add informational banner pointing to Telegram as the primary interface. |
</phase_requirements>

---

## Standard Stack

### Core (already in project — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next/server` `after()` | bundled | Async work after 200 response | Already used in webhook handler for agent invocation |
| `@supabase/supabase-js` service client | existing | Query hotels + hotel_bots without user session | Pattern established in trialNotification.ts |
| `sendTelegramReply()` | internal | Send message via Telegram Bot API | Already handles MarkdownV2 escaping + plaintext fallback |
| Vercel cron via `vercel.json` | platform | Schedule morning briefing at fixed UTC time | All 3 existing crons follow this pattern |
| `CRON_SECRET` bearer auth | env var | Secure cron endpoint | Already used by all 3 existing cron routes |

### Potentially New

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@grammyjs/auto-retry` | 2.0.2 | Automatic 429 retry with `retry_after` | Only if direct fetch-based sends are replaced with grammY Bot instance |

**Decision on auto-retry:** The existing `sendTelegramReply()` uses raw `fetch()` directly against the Bot API. grammY's auto-retry plugin requires a grammY `Bot` instance (`bot.api.config.use(autoRetry())`). Creating a Bot instance per send in a cron is unnecessary overhead. The simpler approach is: sequential sends with a 40ms gap between messages (stays well under 25/second safety ceiling) plus a try/catch per hotel that logs failures without stopping other sends. This matches exactly what `trialNotification.ts` already does.

**Installation (if auto-retry chosen):**
```bash
npm install @grammyjs/auto-retry
```

---

## Architecture Patterns

### Recommended Project Structure for Phase 13

```
src/
├── app/api/cron/
│   └── morning-briefing/         # New: one cron route (pattern identical to trial-notification)
│       └── route.ts
├── lib/cron/
│   └── morningBriefing.ts         # New: dispatch logic (mirrors trialNotification.ts structure)
└── app/(dashboard)/
    └── layout.tsx                  # Possibly add "Telegram-first" informational banner
```

### Pattern 1: Morning Briefing Cron Route

**What:** Vercel cron route that fires at 07:00 UTC daily, queries all active hotels with a front_desk bot and an `owner_telegram_chat_id`, generates a per-role briefing, and sends via `sendTelegramReply()`.
**When to use:** For any proactive daily outbound Telegram message to hotel owners.

```typescript
// Source: mirrors /src/app/api/cron/trial-notification/route.ts
import type { NextRequest } from 'next/server';
import { runMorningBriefingDispatch } from '@/lib/cron/morningBriefing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Pro plan: up to 300s for batch processing

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await runMorningBriefingDispatch();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cron/morning-briefing] Fatal error:', message);
    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}
```

### Pattern 2: Rate-Limited Sequential Send Loop

**What:** In `morningBriefing.ts`, send one message per hotel sequentially with a 40ms delay between sends. At 40ms per send, 25 hotels = 1 second total — well within Telegram's 30/sec global limit.
**When to use:** Any cron that sends outbound Telegram messages to multiple hotels.

```typescript
// Source: derived from trialNotification.ts send loop pattern
const INTER_SEND_DELAY_MS = 40; // ~25 sends/sec, comfortable headroom below 30/sec hard limit

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const hotel of hotels) {
  try {
    await sendTelegramReply({ botToken, chatId, text: briefingText });
    sent++;
  } catch (err) {
    console.error(`[morningBriefing] Hotel ${hotel.hotel_id} send failed:`, err);
    errors++;
  }
  // Rate limit guard: 40ms between sends keeps us under 25/second across all hotels
  await sleep(INTER_SEND_DELAY_MS);
}
```

**Key insight on rate limits:** Each hotel has a distinct bot token. Telegram's 30/sec limit is per bot token. However, since all hotels' front desk bots are different tokens, the effective concern is "calls to the Telegram API from this server per second" rather than per token. 40ms between sequential sends means max 25 per second — safely under the 30/sec ceiling even if measured globally.

### Pattern 3: Per-Bot Morning Briefing Content

**What:** Each active employee bot sends a briefing relevant to its role. The briefing is a plain text message assembled from DB queries — no Claude API invocation needed. This is a summary push, not an AI-generated message.
**Content per role:**
- **Front Desk**: Today's check-in count, escalations since yesterday
- **Booking AI**: Pending reservation inquiries count
- **Guest Experience**: Milestone messages scheduled for today (pre-arrival, checkout, review request)
- **Housekeeping**: Today's checkout count (rooms needing cleaning), today's check-in count (rooms needing prep)

**When to use:** Keep briefings as DB-query-based summaries, not Claude API calls. Claude invocation would add cost and latency to a cron that may run for many hotels.

```typescript
// Source: internal pattern — simple DB query, no invokeAgent()
async function buildFrontDeskBriefing(
  supabase: SupabaseClient,
  hotelId: string,
  timezone: string,
): Promise<string> {
  // Query today's check-ins in hotel timezone
  const todayStr = getTodayInTimezone(timezone); // date-fns TZDate pattern from existing crons
  const { data: reservations } = await supabase
    .from('reservations')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('check_in_date', todayStr)
    .eq('status', 'confirmed');

  const checkInCount = reservations?.length ?? 0;

  return `Good morning! Today's summary:\n` +
    `- ${checkInCount} check-in${checkInCount !== 1 ? 's' : ''} expected today\n` +
    `- All systems running normally\n\n` +
    `Have a great shift!`;
}
```

### Pattern 4: Dashboard "Telegram-First" Banner

**What:** Non-blocking informational banner in `(dashboard)/layout.tsx` indicating that Telegram is now the primary interface.
**When to use:** When hotel has completed Telegram onboarding (`owner_telegram_chat_id` is not null).

```typescript
// Source: follows existing onboarding banner pattern in layout.tsx (line 77-82)
{typedHotel.owner_telegram_chat_id && (
  <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-center text-sm text-blue-700">
    Your primary interface is now Telegram. This dashboard shows all conversation
    history and hotel configuration in readonly view.
  </div>
)}
```

### Anti-Patterns to Avoid

- **Calling `invokeAgent()` from the briefing cron:** Adds Claude API cost + latency for every hotel every day. Briefings are factual summaries, not conversations. Use direct DB queries.
- **Firing all sends in parallel with `Promise.all()`:** Would hit Telegram rate limits immediately at scale. Use sequential sends with `await sleep(40)`.
- **Removing dashboard write features for "readonly":** WDSH-01 says "accessible as readonly optional view" — this means the dashboard should remain viewable, not that all writes must be blocked. The Telegram-first world simply means owners primarily use Telegram; the dashboard is the secondary view. No write features need to be disabled.
- **Creating a new `Bot` instance per cron send:** Wasteful. Use `sendTelegramReply()` which is already a raw fetch wrapper.
- **Sending briefings to hotels without `owner_telegram_chat_id`:** Skip silently (same pattern as trialNotification.ts line 241-244).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limit enforcement | Custom token bucket limiter | `await sleep(40)` between sends | Simple sequential delay is sufficient at current scale; token buckets add state complexity |
| 429 retry logic | Custom exponential backoff | Try/catch + log per hotel, skip on error | At 25/sec rate, 429s should not occur. If one hotel fails, continue to others. Don't retry in cron context. |
| Message text escaping | Custom Telegram markdown escaping | `sendTelegramReply()` already handles this | MarkdownV2 + plaintext fallback pattern already proven |
| Briefing timezone handling | Custom timezone logic | `TZDate` from `@date-fns/tz` | Same pattern as `housekeepingQueue.ts` and `milestoneDispatch.ts` |
| Bot token resolution | New vault function | `getFrontDeskBotToken()` logic from `trialNotification.ts` | Extract to shared helper or copy the pattern inline |

**Key insight:** The entire cron infrastructure already exists. Phase 13 is primarily composition of existing patterns, not new infrastructure.

---

## Common Pitfalls

### Pitfall 1: Sending to All Bots vs. Front Desk Bot Only

**What goes wrong:** Developer sends one briefing per active bot (4 messages per hotel), overwhelming owners with repeated morning messages.
**Why it happens:** Phase description says "each active employee bot sends a morning briefing" — but per-role briefings (housekeeping summary to the HK bot, booking summary to the booking bot) creates 4 messages per hotel per morning.
**How to avoid:** Decision required: either (a) send one consolidated briefing from the front desk bot, or (b) send per-role briefings only from the relevant bot. Option (a) is simpler and less spammy. The phase goal says "each active employee bot sends a morning briefing" which implies option (b). Plan accordingly but note this decision point.
**Warning signs:** Owners reporting "too many messages every morning" = option (b) was wrong for them.

### Pitfall 2: Cron Schedule Collision

**What goes wrong:** Morning briefing cron fires at same time as an existing cron, creating burst traffic.
**Why it happens:** Current schedule: milestone-dispatch at 06:00, housekeeping-queue at 07:00, trial-notification at 09:00. Adding morning-briefing at 07:00 collides with housekeeping-queue — both send Telegram messages at the same time.
**How to avoid:** Schedule morning-briefing at 08:00 UTC (slot is free). All sends from different crons use different bot tokens anyway, but avoiding simultaneous cron invocations is clean.
**Warning signs:** 429 errors appearing in logs exactly at housekeeping-queue run time.

### Pitfall 3: Dashboard "Readonly" Scope Creep

**What goes wrong:** Over-engineering WDSH-01 by actually disabling write capabilities, breaking the chat interfaces and employee toggles.
**Why it happens:** "Readonly view" sounds like UI write features should be disabled.
**How to avoid:** WDSH-01 says "accessible as readonly optional view" — the operative word is "optional." The dashboard was never the primary interaction mode in v2.0. It remains accessible and functional. No features need to be disabled. Add informational text if desired.
**Warning signs:** If planning tries to add `disabled` props to all forms, that's scope creep.

### Pitfall 4: `maxDuration` Not Set on Briefing Cron

**What goes wrong:** Briefing cron times out at default 10-15s when there are many hotels with sequential 40ms delays.
**Why it happens:** Default Vercel function duration is 10s (without fluid compute) or 300s (with fluid compute). If fluid compute is disabled or misconfigured, the default is too short.
**How to avoid:** Set `export const maxDuration = 300;` on the cron route — same as `trial-notification/route.ts`.
**Warning signs:** Cron function times out with Vercel timeout error log.

### Pitfall 5: Briefing Sent to Hotels with No Active Bots

**What goes wrong:** Query fetches all hotels but some have no active bots (bots deactivated post-trial). Vault RPC call fails or sends to wrong chat.
**Why it happens:** After trial-end selection (Phase 12), some bots are set `is_active = false`. The front desk bot may be among them for hotels that deactivated everything.
**How to avoid:** Query `hotel_bots WHERE is_active = true AND role = 'front_desk'` (same as `getFrontDeskBotToken()` in trialNotification.ts). Skip hotels where no active front desk bot exists.
**Warning signs:** "No active front desk bot found" warnings for hotels that completed trial but deactivated all bots.

---

## Code Examples

### Existing Pattern: How trialNotification.ts Fetches Hotels and Sends

```typescript
// Source: /src/lib/cron/trialNotification.ts — getFrontDeskBotToken()
async function getFrontDeskBotToken(
  supabase: SupabaseClient,
  hotelId: string,
): Promise<string | null> {
  const { data: bot } = await supabase
    .from('hotel_bots')
    .select('vault_secret_id')
    .eq('hotel_id', hotelId)
    .eq('role', 'front_desk')
    .eq('is_active', true)
    .maybeSingle();

  if (!bot?.vault_secret_id) return null;

  const { data: tokenData } = await supabase.rpc('get_bot_token', {
    p_vault_secret_id: (bot as { vault_secret_id: string }).vault_secret_id,
  });
  return (tokenData as string) ?? null;
}
```

### Existing Pattern: How housekeepingQueue.ts Uses TZDate for Hotel Timezone

```typescript
// Source: /src/lib/cron/housekeepingQueue.ts
import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';

// Compute today in hotel's IANA timezone
const nowInTz = new TZDate(new Date(), hotel.timezone);
const todayStr = format(nowInTz, 'yyyy-MM-dd');
const tomorrowStr = format(addDays(nowInTz, 1), 'yyyy-MM-dd');
```

### Morning Briefing Dispatch Skeleton

```typescript
// Source: internal pattern derived from trialNotification.ts + housekeepingQueue.ts
export async function runMorningBriefingDispatch(): Promise<{ sent: number; errors: number }> {
  const supabase = createServiceClient() as unknown as SupabaseClient;
  let sent = 0;
  let errors = 0;

  // Query hotels with at least one active bot and a known owner chat_id
  const { data: hotels } = await supabase
    .from('hotels')
    .select('id, name, timezone, owner_telegram_chat_id')
    .not('owner_telegram_chat_id', 'is', null);

  for (const hotel of hotels ?? []) {
    try {
      const chatId = hotel.owner_telegram_chat_id as number;
      const botToken = await getFrontDeskBotToken(supabase, hotel.id);
      if (!botToken) continue;

      const briefingText = await buildFrontDeskBriefing(supabase, hotel.id, hotel.timezone);
      await sendTelegramReply({ botToken, chatId, text: briefingText });
      sent++;
    } catch (err) {
      console.error(`[morningBriefing] Hotel ${hotel.id} failed:`, err);
      errors++;
    }
    // Rate limit guard: 40ms delay = ~25 sends/second
    await sleep(40);
  }

  return { sent, errors };
}
```

### vercel.json Cron Schedule Addition

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/milestone-dispatch",  "schedule": "0 6 * * *" },
    { "path": "/api/cron/housekeeping-queue",  "schedule": "0 7 * * *" },
    { "path": "/api/cron/morning-briefing",    "schedule": "0 8 * * *" },
    { "path": "/api/cron/trial-notification",  "schedule": "0 9 * * *" }
  ]
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual sleep timers for rate limiting | `retry_after` header from Telegram 429 response | Telegram Bot API 8.0 (Nov 2025) | Bot can now read exact wait time, but at 25/sec we should never hit 429 |
| grammY required for outbound sends | Raw fetch to Telegram Bot API works fine | Always true | sendTelegramReply() already proven; no grammY needed for proactive sends |
| Vercel function max 60s (no fluid compute) | Fluid compute default 300s | 2024 Vercel update | maxDuration=300 is achievable without special config; existing crons already use it |

**Deprecated/outdated:**
- Telegraf: Superseded by grammY for TypeScript-native bot work; but irrelevant here since we're not using a Bot library.
- `allow_paid_broadcast`: Paid feature requiring 100k MAU + Stars balance — irrelevant at current scale.

---

## Open Questions

1. **Single briefing from front desk bot vs. per-role briefings from each bot**
   - What we know: Phase description says "each active employee bot sends a morning briefing"
   - What's unclear: Does this mean all 4 bots send separate role-specific messages, or just the front desk bot sends one consolidated summary?
   - Recommendation: Implement per-role briefings (one from each active bot), each with role-specific content. This matches the phase goal literally and gives owners useful context in each bot's chat. Can be scoped to just front desk in a first plan iteration.

2. **What data to include in each role's briefing**
   - What we know: DB has reservations, room statuses (housekeeping_queue table), conversation_turns (for escalation count), bookings
   - What's unclear: Which metrics are most useful per role, how far back to look
   - Recommendation: Keep briefings minimal — 3-4 lines per bot. Front Desk: today's check-ins + any open escalations. Housekeeping: dirty rooms count + today's checkouts. Booking AI: pending reservation inquiries (conversation_turns with tg_* prefix from yesterday). Guest Experience: milestone messages firing today.

3. **Should dashboard write features be disabled for "Telegram-first" hotels?**
   - What we know: WDSH-01 says "accessible as readonly optional view"; no requirement to disable writes
   - What's unclear: Whether the product intention is to literally disable writes (knowledge base editing, employee toggles) or just keep the view accessible
   - Recommendation: Do NOT disable writes. Add informational banner only. The requirement says "optional view" — owners who still want to use the web dashboard should be able to.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `/src/lib/cron/trialNotification.ts` — exact pattern for hotel-fan-out Telegram sends
- Codebase: `/src/lib/cron/housekeepingQueue.ts` — TZDate timezone pattern
- Codebase: `/src/app/api/cron/trial-notification/route.ts` — cron route pattern with CRON_SECRET auth
- Codebase: `/src/lib/telegram/sendReply.ts` — existing Telegram send wrapper
- Codebase: `/src/app/(dashboard)/layout.tsx` — existing banner pattern for informational messages
- Codebase: `/vercel.json` — existing cron schedule (08:00 slot is free)

### Secondary (MEDIUM confidence)
- [Telegram Bot FAQ — rate limits](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this): 30 messages/second global limit; 1 message/second per chat
- [grammY Flood Control docs](https://grammy.dev/advanced/flood): Confirms ~30 msg/sec ceiling; recommends reactive retry, not proactive throttling
- [grammY auto-retry plugin](https://grammy.dev/plugins/auto-retry): Available as `@grammyjs/auto-retry@2.0.2` — intercepts 429 and waits `retry_after`
- [Vercel Function Duration docs](https://vercel.com/docs/functions/configuring-functions/duration): Pro plan fluid compute max 800s; `maxDuration=300` supported

### Tertiary (LOW confidence)
- Telegram Bot API 8.0 (Nov 2025) changes — `adaptive_retry` float in 429 payload; per-chat `retry_after` from layer 167 (Feb 2025). Mentioned in search results but not verified against official Telegram changelog.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries needed; existing patterns are clear
- Architecture: HIGH — morning briefing follows exact pattern of trialNotification.ts; dashboard readonly is a banner addition
- Pitfalls: HIGH — discovered from codebase analysis (schedule collision slot, bot deactivation state, maxDuration)
- Rate limits: MEDIUM — Telegram limits are documented but partially dynamic; 40ms delay is a conservative safe choice

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (Telegram rate limit details are stable; Vercel function limits change infrequently)
