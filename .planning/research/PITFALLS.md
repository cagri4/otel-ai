# Pitfalls Research

**Domain:** Telegram Bot API + Multi-Bot SaaS — Adding Telegram-first delivery to existing hotel AI platform (OtelAI)
**Researched:** 2026-03-06
**Confidence:** HIGH for Telegram API mechanics (official docs verified); MEDIUM for conversion/UX findings (multiple sources, no hotel-specific data); MEDIUM for billing patterns (general SaaS, not Telegram-specific)

---

## Critical Pitfalls

### Pitfall 1: BotFather Token Provisioning Cannot Be Automated — It's Always Manual

**What goes wrong:**
The platform assumes it can programmatically create Telegram bots for new hotel tenants via API. When a hotel signs up and activates their "AI receptionist," the system tries to call an API that provisions a new bot token. There is no such API. Bot creation requires a human to open Telegram, message @BotFather, run `/newbot`, choose a name, choose a username, and copy the token. This breaks any fully automated per-tenant bot provisioning flow.

**Why it happens:**
Developers assume that because Telegram has a rich Bot API, bot creation is also programmatic. It is not. Token generation lives exclusively in the BotFather chat interface. There is no HTTP endpoint to create a new bot. This is also a terms-of-service boundary: reselling bot tokens to third parties violates Telegram ToS 5.7 and triggers permanent token revocation.

**How to avoid:**
- Design the onboarding flow assuming bot token provisioning is always a manual step performed by the hotel owner.
- The Setup Wizard bot guides the hotel owner through creating their own bot in BotFather, then asks them to paste the resulting token into the wizard chat.
- Store the pasted token through Supabase Vault (encrypted at rest), never in plaintext columns.
- Make the wizard idempotent: if the owner drops off mid-step, they can resume from the token-paste step without re-creating a bot.
- Document this hard constraint in phase planning so it is not treated as a technical blocker to solve — it is the intended UX.

**Warning signs:**
- Phase plan mentions "auto-provisioning bot tokens" or "calling BotFather API."
- Onboarding design assumes a hotel owner never has to open Telegram manually.
- Bot token column in the database is `TEXT NOT NULL DEFAULT ''` (suggests the system may try to fill it automatically).

**Phase to address:**
Setup Wizard Bot / Per-Tenant Bot Provisioning phase. The constraint must be in the design before any wizard UX is mocked up.

---

### Pitfall 2: Webhook Routing Collapses When Multiple Bots Share One Route

**What goes wrong:**
The platform routes all bot webhooks to a single Next.js route handler, e.g., `/api/telegram/webhook`. Because each bot registers its own webhook URL with Telegram (via `setWebhook`), the system must differentiate which bot an incoming update belongs to. If the route uses a shared secret that is the same for all bots, or if bot identification is done by inspecting the update payload (which does not contain the bot token), the wrong agent is invoked for the wrong hotel.

**Why it happens:**
Developers implement the WhatsApp webhook pattern — one endpoint, identify hotel from the phone number — and apply it directly to Telegram. WhatsApp sends a `To` field identifying which number received the message. Telegram updates contain only the `update_id` and user info; there is no field indicating which bot token the message was sent to. Without path-based routing or per-bot secret tokens, the system cannot know which hotel's bot received the message.

**How to avoid:**
- Register a unique webhook URL per bot that embeds the hotel ID or a stable bot identifier:
  `https://yourdomain.com/api/telegram/webhook/{hotelId}` or `https://yourdomain.com/api/telegram/webhook/{botSlug}`
- Use Telegram's `secret_token` parameter in `setWebhook`: generate a unique secret per bot and store it alongside the bot token in Supabase Vault. On each incoming webhook, validate `X-Telegram-Bot-Api-Secret-Token` against the secret for that hotel's route.
- Never rely on the Telegram update payload to identify the receiving bot — the payload does not contain this information.
- This pattern also prevents cross-tenant spoofing: a request with the wrong secret for a given route is rejected at 403 before any agent is invoked.

**Warning signs:**
- Single `/api/telegram/webhook` endpoint with no path parameter.
- `secret_token` is hardcoded to one value for all bots.
- Route handler tries to find the bot/hotel by inspecting `update.message.chat.id` or similar payload fields.
- No test scenario: "send a message to Bot A, verify Bot B's hotel does not receive it."

**Phase to address:**
Telegram Webhook Infrastructure phase (must be correct before onboarding any second hotel).

---

### Pitfall 3: Not Returning HTTP 200 Immediately Causes Telegram Retry Storms

**What goes wrong:**
The webhook handler invokes the AI agent synchronously before returning a response. Because the Claude API call takes 3–8 seconds, and sending the Telegram reply adds another 0.5–2 seconds, the total handler time can exceed Telegram's 60-second timeout. When this happens (or when an unhandled exception causes a non-200 response), Telegram retries the same update repeatedly — up to three times with exponential back-off. Each retry triggers another Claude API call, multiplying costs and potentially sending duplicate AI responses to the guest.

**Why it happens:**
The existing WhatsApp webhook pattern (in `src/app/api/whatsapp/webhook/route.ts`) processes synchronously and always returns 200 at the end — which works because Twilio has a generous timeout and the handler catches all errors before the final return. Developers copy this pattern to Telegram without accounting for two differences: (1) Claude calls can be slow enough to approach Telegram's 60-second limit, and (2) Telegram's retry behavior is more aggressive than Twilio's when it receives non-200 responses.

**How to avoid:**
- Return HTTP 200 to Telegram immediately upon validating the `secret_token` and parsing the update. Do not wait for the agent response.
- Process the update asynchronously: push the update to a queue (Supabase table `telegram_update_queue`, or an in-process async task) and return 200 within 200ms of receiving the request.
- Use `update_id` deduplication: before processing, check if this `update_id` has already been processed (store processed IDs in a Redis set or Supabase table with a 24-hour TTL). Telegram's duplicate rate is ~0.02% but retries during outages can cause 100% duplicate rate for a window.
- Send the AI response via a separate Telegram API call (`sendMessage`) asynchronously — do not attempt to return it in the webhook response body (Telegram supports this but it creates tight coupling).

**Warning signs:**
- Webhook handler `await`s `invokeAgent()` before returning any response.
- No `update_id` deduplication table or check.
- Logs show the same `update_id` being processed multiple times.
- Telegram Bot dashboard shows "webhook failed" retries.

**Phase to address:**
Telegram Webhook Infrastructure phase. The async-first pattern must be established before connecting any live agent.

---

### Pitfall 4: Telegram MarkdownV2 Formatting Breaks Agent Responses

**What goes wrong:**
The agent (Claude) produces a response with standard Markdown: `**bold**`, `- bullets`, tables, headings. These are sent to Telegram using `parse_mode: "MarkdownV2"`. MarkdownV2 has strict escaping rules — characters like `.`, `!`, `(`, `)`, `_`, `-` must be escaped with a backslash when they appear outside of formatting context. A single unescaped character causes Telegram to reject the entire `sendMessage` call with a 400 error, and the guest receives nothing.

**Why it happens:**
Claude's output format is designed for general Markdown rendering (web widgets, dashboards). Telegram's MarkdownV2 is a subset with different escaping rules. Additionally, Telegram has no native table support — tables must be rendered as monospace text using spaces, sent as images, or reformatted entirely. Developers test with simple messages and miss the escaping failures that appear in production with complex responses.

**How to avoid:**
- Build a `formatForTelegram(text: string): string` utility that escapes all MarkdownV2 special characters before sending. Required escapes: `_ * [ ] ( ) ~ ` # + - = | { } . !`
- Instruct the Housekeeping Coordinator agent (internal, owner-facing) to avoid tables and use numbered lists instead when the delivery channel is Telegram.
- Use `parse_mode: "HTML"` as an alternative — it has simpler escaping (only `<`, `>`, `&` need escaping) and supports bold, italic, code, links. HTML mode is more forgiving than MarkdownV2.
- Test with messages containing: hotel names with dots/dashes (e.g., "Riva Hotel & Spa"), phone numbers, URLs, monetary amounts with symbols, Turkish characters with special orthography.
- Enforce a 4096-character message limit (Telegram's hard cap for text messages). For longer responses, split at natural paragraph boundaries.

**Warning signs:**
- `sendMessage` returns 400 errors in production but not in development.
- Agent prompts say "use Markdown tables" or "use bold headers."
- No `formatForTelegram` utility exists in the codebase.
- No test with special characters in hotel-specific data (property names, addresses, prices with currency symbols).

**Phase to address:**
Telegram Message Delivery layer, built before any agent is connected to Telegram output.

---

### Pitfall 5: Bot Token Stored in Plaintext — One DB Breach Exposes All Tenant Bots

**What goes wrong:**
Per-tenant bot tokens are stored in a `telegram_bots.token` column as plaintext text. A database breach, a SQL injection vulnerability, a misconfigured RLS policy, or a Supabase service-role key leak exposes every hotel's bot token. An attacker with all tokens can impersonate every bot, read message history via `getUpdates`, and send messages to every guest on the platform as the hotel's AI employee.

**Why it happens:**
Developers store tokens the same way they store other configuration strings. The catastrophic scope of a token leak is underestimated — unlike a password hash, a leaked bot token cannot be checked without also being usable as a credential.

**How to avoid:**
- Use Supabase Vault (`vault.secrets`) for all per-tenant bot tokens. Vault provides transparent column encryption using pgsodium. Tokens are encrypted at rest and decrypted only when accessed through the Vault view in server-side functions.
- Disable Postgres statement logging before inserting tokens into Vault (Supabase logs INSERT statements by default, which would store the plaintext token in logs).
- Add a token rotation flow: if a hotel suspects their bot token was compromised, they can regenerate it in BotFather, paste the new token into the platform, and the system re-registers the webhook.
- RLS on the `telegram_bots` table: bots are readable only by the owning hotel's user. Service-role client decrypts tokens only in webhook registration and message-send server actions.
- Never log the full bot token. Log the first 10 characters only for debugging (e.g., `7829301234:...`).

**Warning signs:**
- `telegram_bots` table has a `token TEXT` column with no encryption annotation.
- Bot token appears in any server log or Supabase query log.
- RLS is not enabled on the `telegram_bots` table.
- Token is accessible from browser-side Supabase client.

**Phase to address:**
Per-Tenant Bot Provisioning / Security Design phase. Vault integration must precede any token storage.

---

### Pitfall 6: Telegram Send Rate Limits Cause Silent Message Loss at Scale

**What goes wrong:**
The platform sends proactive messages to guests across multiple hotels simultaneously — for example, a scheduled milestone message (checkout reminder) fires at 10am and the system sends messages to 200 guests across 50 hotels. Because all bots share the same API infrastructure, the system exceeds Telegram's per-bot rate limit (30 messages/second globally, 1 message/second per chat). Telegram returns 429 Too Many Requests with a `retry_after` value. If the system does not respect `retry_after` and does not queue retries, messages are silently dropped.

**Why it happens:**
The existing milestone dispatch cron (`src/lib/cron/milestoneDispatch.ts`) was designed for WhatsApp via Twilio, which has different rate limiting mechanics. Parallel `Promise.all()` on many sends — a natural pattern in the existing codebase — works for WhatsApp but violates Telegram's rate limits when hotel counts grow.

**How to avoid:**
- Implement a Telegram send queue: instead of `Promise.all(sends)`, push each outbound message to a queue and process it at a controlled rate (≤ 20 messages/second globally, ≤ 1/second per chat).
- On receiving 429 from Telegram, extract `retry_after` from the response body, wait that duration plus a random jitter (0–25%), then retry. Log the retry event.
- For the per-chat limit (1 msg/sec): when proactive messages are sent to a guest who also has an active incoming conversation, throttle to avoid the 1/sec limit.
- Use the existing `milestoneDispatch.ts` pattern but replace bulk `Promise.all()` with a rate-limited queue (p-queue library or similar).
- Monitor: alert when 429 rate exceeds 1% of sends in any 5-minute window.

**Warning signs:**
- Cron job uses `Promise.all(hotels.map(hotel => sendToGuests(hotel)))`.
- No 429 retry logic in the Telegram send utility.
- No per-chat message rate tracking.
- Scaled test (50 hotels × 5 guests) produces "too many requests" errors.

**Phase to address:**
Proactive Messaging / Milestone Dispatch integration phase, specifically when extending existing cron logic to Telegram delivery.

---

### Pitfall 7: Conversational Onboarding Wizard Gets Stuck in Dead State After Drop-Off

**What goes wrong:**
A hotel owner starts the Setup Wizard bot, completes 3 of 7 steps (hotel name, city, timezone), then closes Telegram and returns 4 days later. They send "/start" to the wizard bot. The wizard has no memory of their previous session and starts over, asking for the hotel name again. The owner loses patience and abandons. Alternatively, the wizard is in a state waiting for "paste your bot token" and the owner sends "/start" again — the wizard treats "/start" as a token string and throws an error.

**Why it happens:**
Telegram bots are stateless by default. State management requires explicit storage. Developers build the happy path (owner completes all steps in one sitting) but do not handle: session resume after drop-off, unexpected commands during a wizard step, sending the wrong type of message, or starting over mid-flow. Research shows chatbot-only onboarding has 3x higher abandonment rates than hybrid approaches, and median completion rate is 10%.

**How to avoid:**
- Persist wizard state in Supabase: `setup_wizard_sessions` table with `(telegram_chat_id, hotel_id, current_step, step_data JSONB, updated_at)`. On every message, load the session first.
- When the owner sends any message to the wizard, check if an in-progress session exists. If yes, resume from `current_step`. If no, start fresh.
- Handle `/start` and `/cancel` as escape commands at every step, regardless of what step the wizard is on.
- Handle wrong-type input gracefully: if a step expects a bot token but receives a photo, reply "I was expecting your bot token — it looks like '1234567890:AAAA...'. Please paste it here." Do not throw an error.
- After step 3 (first genuine value: the assistant says "Your Front Desk AI is now connected. Try messaging your bot at @YourHotelBot"), declare a success milestone even if steps 4–7 are incomplete. This reduces the perceived onboarding cost.
- Add a re-engagement message: if a session has been inactive for 24 hours, send a follow-up: "You're 3 steps away from your AI receptionist. Ready to continue?"

**Warning signs:**
- Wizard state is stored in-memory (module-level variable or Redis without TTL).
- No handling for the user sending `/start` mid-wizard.
- No test scenario: "drop off at step 3, return 48 hours later, verify resume."
- Wizard has more than 5 steps before the owner sees the AI working.

**Phase to address:**
Setup Wizard Bot phase. State persistence architecture must be designed before any wizard step is implemented.

---

### Pitfall 8: Per-Employee Pricing Model Breaks Existing Plan-Limit Enforcement

**What goes wrong:**
The current billing model (`src/lib/billing/plans.ts`) is tier-based: Starter = 2 agents, Pro = 4 agents, Enterprise = 6 agents. The new model is per-employee pricing: each active Telegram bot (AI employee) costs a fixed amount per month. When a hotel owner activates a 3rd bot, the system checks `enforceAgentLimit()` which returns `allowed: false` for Starter plan — but the new pricing model should allow any number of bots and simply charge more per month. The enforcement logic blocks valid paid activations.

**Why it happens:**
The existing `enforceAgentLimit()` function is designed for tier-based caps, not usage-based metering. Migrating to per-employee pricing requires either (a) replacing the enforcement logic entirely, or (b) treating "unlimited" as the cap for metered plans. Neither is handled by the current code, and both the billing provider (iyzico/Mollie) and the enforcement layer need updates simultaneously.

**How to avoid:**
- Decide the pricing model before writing any code: "Flat monthly fee + per-bot add-on" vs. "Pure per-seat" vs. "Tiered with higher caps." Write this decision into a `DECISIONS.md` entry.
- For pure per-seat: the `enforceAgentLimit()` function should be replaced with `checkBillingStatus()` (is subscription active?) without any cap check. The billing provider handles quantity via subscription item quantity updates.
- For hybrid (flat + add-on): update `PLAN_LIMITS` to remove the `maxAgents` cap for plans that allow unlimited bots, using `Infinity` as the limit. Guard `enforceAgentLimit()` with a plan check before the count comparison.
- Proactive billing: when a hotel activates a new bot, immediately update the subscription quantity in the billing provider and charge the prorated amount for the current billing cycle. Do not wait for the next invoice.
- Test: activate bot 1, verify invoice shows 1 seat. Activate bot 3, verify invoice updates to 3 seats and prorated charge appears.

**Warning signs:**
- `enforceAgentLimit()` is called on Telegram bot activation without modification.
- `PLAN_LIMITS.maxAgents` is still a small integer (2, 4, 6) for plans that should allow unlimited bots.
- No webhook handler to sync bot-activation events with the billing provider's subscription quantity.
- Mid-cycle proration is not tested.

**Phase to address:**
Billing Migration phase, before per-employee pricing is exposed to any hotel owner.

---

### Pitfall 9: Trial-to-Paid Conversion Drop-Off at Payment Request Moment

**What goes wrong:**
A hotel owner completes the Setup Wizard, activates 2 AI bots, uses the platform for 12 days, sees genuine value, and then receives the trial-expiry email asking them to subscribe. The email links to a checkout page with a price in the wrong currency (EUR for a Turkish hotel), a confusing pricing page showing tier names instead of per-bot costs, and a Mollie checkout form that fails validation because the hotel's billing country is null (incomplete onboarding). The owner abandons the payment flow and the account converts to churned.

**Why it happens:**
The trial-to-paid moment is treated as a billing implementation task, not a conversion-critical UX moment. The existing billing system routes by `country` (`getProviderForHotel()` from `plans.ts`), but if onboarding was incomplete, `country` is null and the routing falls through to Mollie even for Turkish hotels. Additionally, the new per-employee pricing structure is not yet reflected in the billing provider's product catalog, so the checkout shows legacy tier prices.

**How to avoid:**
- Audit and fix the `country` null path in `getProviderForHotel()` before trial expiry flows. Add a fallback prompt: "To complete your subscription, please confirm your country" before routing to checkout.
- Update both iyzico and Mollie product catalogs to reflect per-employee pricing before any trial-expiry email is sent.
- The trial-expiry email must show: exactly how many bots are active, exactly what the monthly cost will be, and a direct one-click link to the appropriate checkout.
- Show pricing during onboarding — not a surprise at day 14. The Setup Wizard step that activates a bot should show "This bot costs €X/month after your free trial."
- B2B SaaS benchmarks: trial-to-paid conversion is 15–25% for opt-in trials, 5–15% for opt-out. Each extra friction point in the checkout flow drops conversion by ~3%.

**Warning signs:**
- `hotels.country` can be null at trial expiry.
- Billing provider product catalog still shows old tier pricing.
- Trial-expiry email doesn't mention the specific per-bot cost.
- No smoke test: complete onboarding → trial expiry → payment for both TR and EU hotels.

**Phase to address:**
Billing Migration phase AND Trial-to-Paid Conversion review sub-task within that phase.

---

### Pitfall 10: Escalation Channel Mismatch — Telegram Bots Not Recognized as Channel

**What goes wrong:**
The existing escalation detection (`src/lib/agents/escalation.ts`) uses the conversation ID prefix to identify the channel: `wa_` for WhatsApp, `widget_` for the web widget, `dashboard` for the owner dashboard. When Telegram is added and conversations use IDs like `tg_{hotelId}_{chatId}`, the escalation handler hits the `else` branch and logs the channel as `'dashboard'` — meaning Telegram escalations are miscategorized, misrouted, and not counted in the correct analytics bucket. Hotel owners see Telegram escalations in the wrong section of their dashboard.

**Why it happens:**
The channel detection logic (`handleEndTurn` in `invokeAgent.ts`) uses a simple prefix check with no extension point. Adding a new channel requires editing the core orchestrator — which is a likely oversight when Telegram is added as a new delivery layer.

**How to avoid:**
- Extend the channel detection logic before integrating Telegram. Add `tg_` as a recognized prefix in `invokeAgent.ts`'s `handleEndTurn` function.
- Refactor the prefix check into a `deriveChannel(conversationId: string)` utility function that is imported by `invokeAgent.ts` and any other code that needs channel identity. This makes future channel additions a single-location change.
- Add a TypeScript type for the channel enum that forces the compiler to error if an unhandled channel is added: `type Channel = 'whatsapp' | 'widget' | 'dashboard' | 'telegram'`.
- Test: trigger an escalation via a Telegram conversation, verify the escalations table shows `channel = 'telegram'` and the hotel dashboard displays it in the correct section.

**Warning signs:**
- Escalation query in the dashboard shows no Telegram escalations even after a Telegram conversation has triggered one.
- `escalation.channel` column contains `'dashboard'` for Telegram conversations.
- `handleEndTurn` in `invokeAgent.ts` has a hardcoded `startsWith('wa_')` / `startsWith('widget_')` check with an else-fallback to `'dashboard'`.

**Phase to address:**
Telegram Webhook Infrastructure phase — extend channel detection as part of the `invokeAgent` integration work, before any Telegram agent goes live.

---

### Pitfall 11: Conversation ID Collision Across Channels

**What goes wrong:**
A hotel guest with phone number `+905001234567` contacts the hotel via WhatsApp. Their WhatsApp conversation ID is `wa_{hotelId}_+905001234567`. The same guest also messages the hotel's Telegram bot; their Telegram chat ID is a large integer (e.g., `905001234567` — coincidentally close to their phone number). If conversation IDs are not carefully namespaced, a collision — or a query that accidentally loads cross-channel history — could inject WhatsApp conversation context into a Telegram session or vice versa.

**Why it happens:**
The current convention (`wa_{hotelId}_{phone}`, `widget_{hotelId}_{sessionId}`) was designed without a Telegram channel in mind. Telegram chat IDs are integers, not phone strings, but a developer might format the Telegram conversation ID as `tg_{hotelId}_{chatId}` where `chatId = 905001234567` — superficially similar to a phone number, risking confusion in logs and queries.

**How to avoid:**
- Establish a strict convention document for conversation ID formats before implementing Telegram:
  - WhatsApp: `wa_{hotelId}_{E164Phone}` (e.g., `wa_abc123_+905001234567`)
  - Widget: `widget_{hotelId}_{sessionUUID}` (e.g., `widget_abc123_uuid4`)
  - Telegram: `tg_{hotelId}_{telegramChatId}` (e.g., `tg_abc123_7290451982`)
- Telegram chat IDs are always integers. The `tg_` prefix and integer format is unambiguous. Add a DB CHECK constraint on `conversation_turns.conversation_id` that enforces prefix format.
- Never load conversation history without both the prefix match AND the hotel ID filter.

**Warning signs:**
- No formal convention document for conversation ID formats.
- `loadConversationTurns()` queries by `conversation_id` alone without a `hotel_id` filter.
- Telegram conversation ID format is not documented before implementation begins.

**Phase to address:**
Telegram Webhook Infrastructure phase — define the ID convention in the technical spec before writing any route handler.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Sync webhook handler (await agent before returning 200) | Simpler code, mirrors existing WhatsApp pattern | Telegram retry storms; duplicate AI responses; 429 errors from Claude API | Never — async return of 200 is mandatory for Telegram |
| Plaintext bot token in `telegram_bots.token` | Faster to implement | Single DB breach exposes all tenant bots; tokens can be used to impersonate every hotel | Never — Supabase Vault from day one |
| Single `/api/telegram/webhook` for all bots | Simpler routing | Cannot identify which hotel received a message; security boundary broken | Never — per-bot URL with unique `secret_token` is required |
| Copy WhatsApp channel detection logic without adding `tg_` prefix | Fast integration | Telegram escalations miscategorized; wrong analytics; channel-specific features broken | Never — update channel detection before first Telegram agent |
| Skip MarkdownV2 escaping, send raw Claude output | Saves one utility function | Silent 400 errors from Telegram; guest receives no reply | Never in production |
| Store wizard state in memory | Fast to prototype | State lost on server restart/cold start; onboarding not resumable | Prototype only, never staging/production |
| Reuse existing tier-based `enforceAgentLimit()` for per-seat pricing | No code changes needed | Blocks valid paid bot activations; revenue loss | Never — billing model change requires enforcement logic change |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Telegram `setWebhook` | Setting one shared secret for all bots | Generate unique `secret_token` per bot; store in Vault alongside token |
| Telegram `sendMessage` | Passing raw Claude Markdown output with `parse_mode: MarkdownV2` | Escape all MarkdownV2 special characters; or use `parse_mode: HTML` with simpler escaping |
| Telegram `sendMessage` | Not handling 429 with `retry_after` | Extract `retry_after` from response; queue retry with jitter; never use `Promise.all` for bulk sends |
| Telegram webhook | Returning non-200 (or timing out) on errors | Return 200 immediately after secret_token validation; process asynchronously |
| Telegram `update_id` | Processing the same update twice during retry storm | Deduplicate by `update_id` in Supabase or Redis before invoking agent |
| Supabase Vault | Inserting bot token with statement logging enabled | Disable `log_statement` before Vault INSERT; tokens appear in logs otherwise |
| BotFather provisioning | Expecting programmatic bot creation | Design wizard UX assuming owner must manually create the bot and paste the token |
| iyzico/Mollie | Routing by `country` field that may be null | Handle null country before checkout; prompt for country if missing |
| Escalation detection | `invokeAgent.ts` channel prefix check not extended | Add `tg_` prefix before first Telegram deployment; use `deriveChannel()` utility |
| Per-seat billing sync | Activating a bot without updating subscription quantity | Call billing provider's quantity update API atomically with bot activation |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Bulk milestone sends with `Promise.all()` | 429 errors from Telegram; guests miss scheduled messages | Rate-limited queue (≤ 20 msg/sec globally, ≤ 1/sec per chat) | 30+ simultaneous hotel sends |
| Synchronous webhook handler awaiting Claude | Telegram retries; duplicate responses; 60-second gateway timeout | Return 200 immediately; process in background | Every response taking >10 seconds |
| No `update_id` deduplication during retry storm | Same user message processed 3x; 3x Claude API cost; 3x Telegram replies | Redis/Supabase dedup with 24-hour TTL | Any time the server returns non-200 and Telegram retries |
| Setup wizard state in Redis without TTL | Memory leak; stale sessions never expire | TTL of 7 days on wizard sessions; periodic cleanup job | At > 500 concurrent onboarding sessions |
| Loading full conversation history across channels | Slow queries; wrong context if channel isn't filtered | Always filter `conversation_turns` by both `conversation_id` AND `hotel_id` | At > 10,000 total turns per hotel |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Bot token in plaintext DB column | Full bot hijack on any DB exposure | Supabase Vault for all tokens; encrypted at rest |
| No `X-Telegram-Bot-Api-Secret-Token` validation | Any HTTP client can spoof messages to any hotel's webhook | Validate header before any processing; 403 on mismatch |
| Logging full bot token in any log system | Tokens in Supabase logs, Vercel logs, or CloudWatch | Log only first 10 chars + `...`; disable statement logging during Vault inserts |
| Telegram chat IDs used as stable guest identifiers without verification | Telegram user can change their account; chat IDs can theoretically be recycled | Treat `chatId` as a session scoping key, not a permanent guest identity; do not store PII indexed by chatId alone |
| Setup wizard bot accessible without hotel ownership verification | A malicious actor sends `/start` to the wizard bot and provisions bots on other accounts | Wizard must authenticate the hotel owner before accepting a token paste; use Supabase session token exchange |
| Per-tenant webhook URL without secret validation | Token-in-URL obscurity is not security; URL can be enumerated | Always validate `secret_token` header, even when URL contains hotel ID |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Setup Wizard has 7+ steps before owner sees their bot working | 90%+ drop-off before activation | Show AI working after step 3 (hotel name, city, bot token); everything else is progressive enhancement |
| Wizard asks for the bot token without explaining what it is or where to find it | Owner confused; sends wrong string | Show a screenshot of BotFather token screen in the wizard message; provide a step-by-step "/newbot" mini-guide inline |
| Per-bot pricing revealed only at checkout | Owner feels ambushed; conversion drops | Show price per bot during activation, not just at billing time |
| Telegram formatting produces wall-of-text agent responses | Mobile users abandon; messages feel like spam | Configure agents to use shorter paragraphs for Telegram; avoid bullet lists >5 items; Telegram is a conversational channel not a document channel |
| Trial expiry email without specific cost and one-click checkout | Conversion drop-off; owner must navigate to find pricing | Email contains: number of active bots, total monthly cost, single CTA button → direct checkout |
| Wizard drop-off with no re-engagement | Owner forgets about the platform | Send a follow-up message 24h after wizard stall: "You're 2 steps from activating your AI receptionist. Continue here?" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Telegram webhook routing:** Each bot has its own URL and `secret_token` — verify by sending a request to Bot A's webhook URL signed with Bot B's secret; confirm it returns 403.
- [ ] **Async webhook response:** Webhook handler returns 200 before Claude responds — verify by adding an artificial 10-second delay to `invokeAgent()` and confirming Telegram does not retry.
- [ ] **MarkdownV2 escaping:** Agent sends a message containing `.`, `!`, `(`, `-` characters — verify it arrives correctly formatted in Telegram (not a 400 error that silently drops the message).
- [ ] **Bot token encryption:** `telegram_bots` table has no plaintext token — verify with `SELECT token FROM telegram_bots LIMIT 1` returns encrypted bytes, not a readable API token string.
- [ ] **update_id deduplication:** Replay the same update twice to the webhook endpoint — verify the agent is only invoked once and only one Telegram reply is sent.
- [ ] **Wizard resume:** Start onboarding wizard, complete 2 steps, wait 24 hours (or mock time), send any message — verify wizard resumes at step 3, not step 1.
- [ ] **Per-seat billing sync:** Activate a 3rd bot — verify the billing provider subscription quantity updates to 3 and a prorated charge appears on the account.
- [ ] **Escalation channel:** Trigger an escalation via Telegram — verify `escalation.channel = 'telegram'` in the database and the hotel dashboard shows it in the correct section.
- [ ] **Rate limit compliance:** Send 50 milestone messages simultaneously across 10 hotels — verify no 429 errors from Telegram and all messages delivered within 3 minutes.
- [ ] **Country null path:** Complete onboarding without setting country, reach trial expiry — verify checkout routing prompts for country rather than silently routing to wrong provider.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Bot token plaintext exposure discovered | CRITICAL | Immediately revoke all tokens via BotFather; re-register all webhooks with new tokens; migrate to Vault; notify affected hotels; audit access logs for token usage |
| Telegram retry storm (webhook returning non-200) | MEDIUM | Fix the handler to return 200 immediately; purge the duplicate `update_id`s from processing queue; audit conversation_turns for duplicate turns and remove |
| MarkdownV2 format errors in production | LOW | Deploy `formatForTelegram()` escape utility; affected messages are already sent (or not sent) — no guest impact beyond missed messages |
| Wrong billing model enforcement blocking activations | MEDIUM | Roll back `enforceAgentLimit()` to allow activations; audit missed billing events; manually sync subscription quantities with billing provider |
| Wizard state lost (server restart with in-memory state) | MEDIUM | Identify affected sessions from webhook logs; contact affected hotel owners; reset wizard sessions to last known completed step |
| Trial-to-paid conversion failure (wrong provider routing) | LOW-MEDIUM | Identify affected trial-expiry attempts from logs; re-send trial-expiry email with corrected checkout link after fixing country null path |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| BotFather not programmable — must be manual | Setup Wizard Design phase | Test: verify no code calls an API to create bots; wizard UX includes BotFather step |
| Webhook routing without per-bot URL + secret | Telegram Webhook Infrastructure | Test: two-hotel routing test; wrong-secret → 403 |
| Sync handler causing retry storms | Telegram Webhook Infrastructure | Test: artificial 10s delay, confirm Telegram does not retry |
| MarkdownV2 escaping failures | Telegram Message Delivery layer | Test: special characters in all agent response paths |
| Plaintext bot token storage | Per-Tenant Bot Provisioning / Security | Test: SELECT returns encrypted bytes, not readable token |
| Send rate limits / 429 storms | Proactive Messaging / Milestone Dispatch extension | Test: 50 simultaneous sends, confirm no 429 errors |
| Wizard drop-off with no resume | Setup Wizard Bot phase | Test: drop off at step 3, resume 24h later |
| Per-employee pricing breaks enforceAgentLimit | Billing Migration phase | Test: activate 5th bot on per-seat plan, confirm allowed |
| Trial-to-paid drop-off (null country) | Billing Migration phase | Test: null-country hotel reaches trial expiry, checkout works |
| Escalation channel mismatch | Telegram Webhook Infrastructure | Test: Telegram escalation shows `channel = 'telegram'` |
| Conversation ID collision | Telegram Webhook Infrastructure | Test: WhatsApp and Telegram sessions for same user in same hotel; verify separate history |

---

## Sources

- [Telegram Bot API official documentation](https://core.telegram.org/bots/api) — webhook requirements, rate limits, `setWebhook` parameters. HIGH confidence.
- [Marvin's Marvellous Guide to All Things Webhook](https://core.telegram.org/bots/webhooks) — Telegram's own webhook pitfall guide, retry behavior, SSL requirements. HIGH confidence.
- [Telegram Bots FAQ](https://core.telegram.org/bots/faq) — Rate limits (30 msg/sec global, 1 msg/sec per chat, 20 msg/min in groups). HIGH confidence.
- [grammY Flood Limits guide](https://grammy.dev/advanced/flood) — Production flood limit handling with retry_after and jitter. MEDIUM confidence.
- [GramIO rate limits documentation](https://gramio.dev/rate-limits) — 429 error patterns and retry strategies. MEDIUM confidence.
- [Supabase Vault documentation](https://supabase.com/docs/guides/database/vault) — Encrypted secret storage, statement logging warning. HIGH confidence.
- [GitGuardian: Telegram Bot Token leaks](https://www.gitguardian.com/remediation/telegram-bot-token) — Token leak risk assessment and remediation. MEDIUM confidence.
- [telegraf/telegraf issue #806: Processing same update multiple times](https://github.com/telegraf/telegraf/issues/806) — Real-world duplicate processing report. MEDIUM confidence.
- [python-telegram-bot ConversationHandler issues](https://github.com/python-telegram-bot/python-telegram-bot/issues/2388) — Wizard state drop-off patterns. MEDIUM confidence.
- [NN/g: New AI users onboarding](https://www.nngroup.com/articles/new-AI-users-onboarding/) — Onboarding drop-off rates and completion statistics. HIGH confidence.
- [PulseAhead: Trial-to-Paid Conversion Benchmarks](https://www.pulseahead.com/blog/trial-to-paid-conversion-benchmarks-in-saas) — 15–25% opt-in conversion, 5–15% opt-out conversion benchmarks. MEDIUM confidence.
- [Schematic: Seat-Based Pricing 101](https://schematichq.com/blog/seat-based-pricing-101-the-classic-saas-model-that-still-works-sometimes) — Per-seat pricing pitfalls. MEDIUM confidence.
- OtelAI source code analysis — `agentFactory.ts`, `invokeAgent.ts`, `whatsapp/webhook/route.ts`, `billing/enforcement.ts`, `billing/plans.ts`, `security/rateLimiter.ts` — integration-specific pitfalls derived from existing patterns. HIGH confidence (direct code inspection).

---
*Pitfalls research for: OtelAI — Telegram-first multi-bot milestone (adding Telegram delivery to existing hotel AI SaaS)*
*Researched: 2026-03-06*
