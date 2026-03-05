# Feature Research

**Domain:** Telegram-first agent-native SaaS hotel platform — v2.0 milestone
**Researched:** 2026-03-06
**Confidence:** MEDIUM-HIGH (Telegram Bot API official docs verified; SaaS pricing patterns verified via multiple sources; hotel-specific Telegram patterns LOW confidence — thin public record)

> **Scope note:** This file covers ONLY new v2.0 features. The existing v1.0 feature set (web chat, WhatsApp, billing, knowledge base editor, dashboard, 4 AI employees) is complete and documented in the original FEATURES.md snapshot above. This research answers: "What does the Telegram-first, multi-bot, conversational-onboarding, per-employee-pricing layer look like?"

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features the hotel owner will assume exist once told "manage your hotel via Telegram." Missing these makes the product feel broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Each AI employee has its own dedicated Telegram bot | The "separate employee" mental model requires separate conversations — one unified bot breaks the metaphor | MEDIUM | BotFather creates unlimited bots; each gets unique token; each maps to one agent role |
| Deep-link account activation (t.me/bot?start=TOKEN) | Standard Telegram onboarding pattern since 2018 — users expect clicking a link to start a bot, not manual account entry | LOW | Telegram deep link spec: `t.me/<botusername>?start=<payload>` up to 64 chars; use base64url for hotel ID + auth token |
| Setup Wizard bot guides hotel owner through onboarding conversationally | If owner opens Telegram and sees a wall of form fields, it defeats the purpose of the channel; conversation is expected | HIGH | Multi-step state machine with inline keyboard buttons; progressive info collection; must not require web browser mid-flow |
| Inline keyboard buttons for all binary/multiple-choice decisions | Hotel owners on mobile; text command typing is friction; buttons are the Telegram-native interaction | LOW | `InlineKeyboardMarkup` on every message with options; no free-text unless unavoidable |
| Bot command menu (/start, /help, /status) | Telegram shows bot commands in the input bar; missing them makes bot feel amateur | LOW | `/setBotCommands` via BotFather or API; set per-scope (private chat) |
| Bot responds within 5 seconds or shows "typing" indicator | Telegram users abandon bots that feel laggy; 5s is the UX threshold | MEDIUM | `sendChatAction("typing")` before async LLM call; webhook pattern on Vercel serverless fits |
| Super admin can create hotel accounts and generate activation links | The provisioning loop must be admin-controlled (not self-serve signup) for controlled rollout | MEDIUM | Simple Next.js admin UI: create hotel record → generate JWT-signed token → produce deep link |
| Super admin can see all hotels, their trial status, and subscription state | Basic operational visibility; if admin can't see what's happening, support is impossible | LOW | Simple read-only table in admin panel; Supabase query over hotels + subscriptions tables |
| Trial countdown communicated via Telegram | Owner forgets web dashboard exists; if trial expiration only shows on web, they miss it | MEDIUM | Scheduled job: notify at day 7, day 12, day 13, day 14 of trial via the Setup Wizard bot or a dedicated bot |
| Trial-end employee selection happens in Telegram | If selection requires web browser, conversion rate drops; the whole point is Telegram-native | HIGH | Inline keyboard presenting each employee with price; owner taps to toggle; confirm button commits selection |
| Payment link sent via Telegram after employee selection | Owner should receive a clickable URL to the existing web checkout (iyzico/Mollie); do NOT rebuild payments in Telegram | MEDIUM | Bot sends message with inline URL button pointing to `/billing?token=...` web page |
| Owner can message each employee bot and get responses | The core interaction model; if bots don't respond to owner questions, the product doesn't work | HIGH | Each bot token → webhook endpoint → invokeAgent() with hotel context from Supabase |
| Employee bots are activated/deactivated based on subscription state | Free trial = all 4 bots respond; expired or not subscribed = bots reply "inactive, please subscribe" | MEDIUM | Subscription check middleware in each bot's webhook handler |

---

### Differentiators (Competitive Advantage)

Features that make OtelAI the obvious choice for a hotel owner who uses Telegram vs. a generic hotel chatbot or a web dashboard.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Setup Wizard bot deactivates itself after onboarding | Clean UX: the "onboarding bot" disappears once setup is done; owner is left with only their employee bots — no clutter | LOW | After final onboarding step, bot sends "Your team is ready. This setup assistant is now retired." and stops responding to non-admin commands |
| Each employee bot has a distinct bot name and avatar | "Front Desk — Aria" with a concierge icon vs. "Booking — Max" with a calendar icon — reinforces the employee metaphor | LOW | BotFather allows name + profile photo per bot; super admin sets these during hotel provisioning |
| Morning briefing message from each active bot | Employee bots proactively push a daily status message to the owner (e.g., "Good morning! 3 check-ins today, 2 guest messages handled overnight") | MEDIUM | Scheduled job (cron via Vercel or Supabase pg_cron) sends one message per active employee bot per day |
| Owner can talk to any employee in natural language from Telegram | Hotel owner doesn't need to learn commands — just types "How many rooms are clean?" and the Housekeeping bot answers | HIGH | LLM parses intent; tool-first policy already built in v1.0; this is the channel adaptation |
| Trial-end selection shows ROI per employee ("handled 47 guest messages this week") | Instead of abstract pricing, owner sees concrete value before committing — reduces churn at conversion | MEDIUM | Aggregate stats per agent role over trial period; include in the selection message |
| Super admin sees per-hotel AI usage for cost management | Admin can spot hotels that are hammering the Claude API and costing money without paying | MEDIUM | Log token counts per hotel per agent call; admin dashboard shows monthly AI spend per hotel |
| Telegram as the escalation channel (not just email) | When an AI employee can't handle something, it pings the owner via Telegram (not just email); owner is already there | LOW | Escalation webhook → send Telegram message to hotel owner's chat ID via the relevant employee bot |
| Setup Wizard bot validates hotel name / location with Google Maps | Catches typos during setup, produces cleaner data for AI context | HIGH | Google Places API lookup during onboarding wizard step; optional, can defer |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Telegram Payments API (Stars or card) | Seems convenient — payment without leaving Telegram | OtelAI already has iyzico (TR) + Mollie (EU) with working tax/invoice flows; rebuilding in Telegram Stars requires separate compliance, no invoice support, and recurring billing is not natively supported | Send deep link to existing web billing page; one tap in Telegram opens browser for payment |
| Single "hotel management" Telegram group with all bots | Feels unified; owner adds one group | Group privacy mode means bots can't distinguish which employee is being addressed; message routing becomes ambiguous; group spam from multiple bots | Keep private 1:1 chats per bot; this is the correct Telegram pattern for distinct employees |
| Long-polling instead of webhooks | Easier to implement locally; no SSL needed | Long-polling on Vercel serverless is impossible (functions are stateless, no persistent process); long-polling also means higher latency and resource waste | Webhooks only; use ngrok or Vercel preview URLs for local dev |
| Conversation history synced from web dashboard to Telegram | "I want to see guest conversations in Telegram" | The guest-facing conversations belong in the web dashboard; piping them to Telegram creates a noisy, unactionable feed | Keep guest conversation history on web dashboard; employee bots handle owner-to-AI dialogue only |
| Bot username changes after launch | Branding refresh after hotels have added bots to contacts | Telegram does not allow username changes through the API; BotFather allows it but breaks existing `t.me/` links and bookmarks | Choose usernames carefully at provisioning; use hotel-specific suffixes (e.g., `@HotelAriaTR_FrontDeskBot`) |
| AI employee bots respond to guests directly on Telegram | Guests message the Front Desk bot on Telegram | Guest channel is WhatsApp (already built); adding Telegram as guest channel doubles the conversation surface area and creates routing complexity | Keep guests on WhatsApp; hotel owner uses Telegram; strict channel separation |
| Multiple super admins | Team management for the admin panel | Scope too large for current milestone; increases auth complexity; one person operates this for now | Single super admin; if needed, use Supabase role-based access in a future milestone |
| Telegram bot group chats for hotel staff | Staff could discuss rooms in a group with the Housekeeping bot | Adds group member management, privacy considerations, and role-based access within Telegram — too complex | Hotel staff coordination stays in the existing web dashboard / WhatsApp notifications |

---

## Feature Dependencies

```
[Super Admin Panel]
    └──creates──> [Hotel Record in DB]
        └──generates──> [Signed JWT Activation Token]
            └──produces──> [Telegram Deep Link (t.me/SetupWizardBot?start=TOKEN)]
                └──triggers──> [Setup Wizard Bot: Onboarding Flow]
                    └──populates──> [Hotel Knowledge Base] (existing v1.0)
                    └──records──> [Owner's Telegram chat_id]
                    └──activates──> [Employee Bots: webhook registration]
                        └──enables──> [Per-Employee Telegram Conversations]
                            └──blocked by──> [Subscription State Check]

[Trial Period (14 days)]
    └──triggers at day 7, 12, 13──> [Trial Warning Messages via Telegram]
    └──triggers at day 14──> [Employee Selection Flow via Telegram]
        └──produces──> [Payment Link to Web Billing Page]
            └──on payment success──> [Subscription Activated]
                └──unlocks──> [Selected Employee Bots]
                └──deactivates──> [Unselected Employee Bots]

[Employee Bot Webhook]
    └──requires──> [Bot Token (from BotFather)]
    └──requires──> [Webhook URL (Next.js /api/telegram/[botRole])]
    └──requires──> [Hotel lookup by chat_id]
    └──calls──> [invokeAgent() — existing v1.0]
    └──returns──> [Response via bot.sendMessage()]

[Morning Briefing Cron]
    └──requires──> [Owner chat_id stored in DB]
    └──requires──> [Active subscription]
    └──uses──> [Each employee bot's token to send from correct bot]

[Escalation via Telegram]
    └──requires──> [Owner chat_id stored in DB]
    └──enhances──> [Existing escalation system (v1.0 email)]
    └──sends via──> [Relevant employee bot (not a generic bot)]
```

### Critical Path for MVP
```
Super Admin Panel (create hotel + deep link)
    → Setup Wizard Bot (onboard owner, collect chat_id)
        → Hotel Knowledge Base populated (existing v1.0 UX still available)
            → Employee Bots activated (4 bots, all live)
                → 14-day trial begins
                    → Trial-end selection flow
                        → Payment link → web checkout (existing billing)
                            → Active subscription → selected bots stay live
```

### Dependencies on Existing v1.0 Systems

| v2.0 Feature | Depends On (v1.0) | Notes |
|---|---|---|
| Employee bot responses | `invokeAgent()` orchestrator | Call with roleType + hotelId; same as web dashboard |
| Hotel knowledge base | KB editor + Supabase schema | No changes needed; bots read same data |
| Subscription enforcement | `hotels.subscription_status` field | Add Telegram-specific check: "is this chat_id's hotel subscribed?" |
| Trial period tracking | `hotels.trial_ends_at` field | Already exists from v1.0 free trial; reuse |
| Billing / payment | iyzico + Mollie web flows | Send URL via Telegram; do not rebuild |
| Escalation | Email escalation system | Add Telegram send as parallel channel |

---

## MVP Definition

### Launch With (v1 of this milestone)

Minimum needed to demonstrate the Telegram-first concept end-to-end.

- [ ] **Super Admin Panel** — Create hotel account, generate Telegram deep link for Setup Wizard bot; list all hotels with trial/subscription status
- [ ] **Setup Wizard Bot** — Conversational onboarding: hotel name, city, owner name, collect Telegram chat_id; end-state: knowledge base seeded, owner linked
- [ ] **4 Employee Bots activated post-onboarding** — Front Desk, Booking, Housekeeping, Guest Experience each get a Telegram bot; owner can message each
- [ ] **Employee bot responses via existing invokeAgent()** — Bots call existing agent layer; hotel owner gets AI responses in Telegram
- [ ] **Subscription state enforcement** — Active trial or paid → respond; expired → "subscribe to reactivate" message with link
- [ ] **Trial countdown notifications** — Day 7, 12, 13, 14 messages via Setup Wizard bot or a dedicated notifications channel
- [ ] **Trial-end employee selection flow** — Inline keyboard in Telegram: each employee shown with price and trial stats; owner selects keepers; payment link generated
- [ ] **Escalation via Telegram** — When agent can't handle something, it messages owner via Telegram (parallel to existing email)

### Add After Validation (v1.x)

- [ ] **Morning briefing messages** — Trigger: hotel owners request daily summary; adds engagement loop and retention signal
- [ ] **Per-hotel AI usage in admin panel** — Trigger: admin needs cost visibility before scaling to 10+ hotels
- [ ] **Employee bot custom names/avatars** — Trigger: hotel owners complain bots feel generic; easy win once core works
- [ ] **Setup Wizard self-deactivation** — Trigger: cleanup polish; low value before core is proven
- [ ] **Google Maps validation in onboarding** — Trigger: bad data quality becoming a problem in practice

### Future Consideration (v2+)

- [ ] **Hotel staff Telegram integration** — Too complex; validate owner use case first
- [ ] **Telegram Mini App for richer UI** — Possible future upgrade path for selection/billing; defer
- [ ] **Multi-language Setup Wizard** — EN/TR sufficient for launch market; add DE/NL when expanding
- [ ] **Telegram-native analytics dashboard** — Web dashboard already serves this; don't duplicate

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Super Admin Panel (create hotel + deep link) | HIGH | LOW | P1 |
| Setup Wizard Bot (conversational onboarding) | HIGH | HIGH | P1 |
| Employee bots (4 bots calling invokeAgent) | HIGH | MEDIUM | P1 |
| Subscription enforcement in bots | HIGH | LOW | P1 |
| Trial countdown notifications | HIGH | LOW | P1 |
| Trial-end employee selection flow (inline keyboard) | HIGH | MEDIUM | P1 |
| Payment link via Telegram → web billing | HIGH | LOW | P1 |
| Escalation via Telegram | MEDIUM | LOW | P1 |
| Morning briefing per bot | MEDIUM | MEDIUM | P2 |
| Per-hotel AI cost in admin panel | MEDIUM | MEDIUM | P2 |
| Employee bot custom names/avatars | LOW | LOW | P2 |
| Setup Wizard self-deactivation | LOW | LOW | P2 |
| Google Maps validation in onboarding | LOW | HIGH | P3 |
| Telegram Mini App checkout | MEDIUM | VERY HIGH | P3 |

**Priority key:**
- P1: Must have for milestone launch
- P2: Should have, add when core works
- P3: Nice to have, future milestone

---

## Competitor Feature Analysis

| Feature | HiJiffy | Quicktext | OtelAI v2.0 Approach |
|---------|---------|-----------|----------------------|
| Hotel owner channel | Web dashboard | Web dashboard | Telegram (owner-native, no web required) |
| Employee metaphor | No (tool/module) | No (tool/module) | YES — each bot = one employee |
| Onboarding | Web form wizard | Web form wizard | Conversational Telegram bot |
| Pricing model | Flat SaaS tier | Flat SaaS tier | Per-employee selection; pay only for what you keep |
| Trial-to-paid flow | Web-only | Web-only | Telegram-native selection + web payment link |
| Guest channel | WhatsApp, web, Instagram | WhatsApp, SMS, web | WhatsApp + web chat widget (no change from v1) |
| Multi-bot architecture | Single integration | Single integration | One bot per AI employee role |

**Gap OtelAI fills:** No hotel SaaS competitor runs their owner management interface through Telegram. All are web-first dashboards. Boutique hotel owners in Turkey and EU are heavy Telegram users — meeting them in their preferred channel, with an employee metaphor, and a "pay only for who you keep" pricing model is a genuine triple differentiator.

---

## Technical Constraints That Shape Feature Decisions

These are not features but hard constraints that determine what is and isn't buildable in this milestone. (HIGH confidence — official Telegram docs + grammY docs verified.)

| Constraint | Impact on Features |
|---|---|
| Vercel serverless max duration: 10s (free), 60s (Pro) | Streaming responses impossible in webhook handler; bot must send message and ack within timeout; use sendMessage async, don't stream |
| Telegram webhook requires HTTPS with valid SSL | No localhost testing without ngrok/localtunnel; use Vercel preview deploys for testing |
| Each bot needs a unique token from BotFather | Super admin provisioning step must include bot token management; 4 employee bots + 1 wizard bot = 5 tokens per hotel (or shared pool with per-hotel routing — architecture decision) |
| Telegram deep link `start` param: 64 chars max | Hotel ID + auth token must fit; use short UUIDs or base64url-encoded short token |
| Bot messages cannot be silently delivered to users who haven't started the bot | Owner must click the deep link and press /start before any bot can message them; this is a known Telegram restriction |
| grammY `webhookCallback` is the correct pattern for Vercel | Must export from `api/telegram/[botRole].ts`; do not use long-polling |
| Telegram does not support native recurring billing | Payment must go through external web flow (iyzico/Mollie); no workaround |

---

## Setup Wizard Bot: Conversation Flow (Required for Clarity)

The Setup Wizard bot is the highest-complexity feature in this milestone. A concrete expected conversation flow:

```
[Owner clicks deep link: t.me/OtelAISetupBot?start=HOTEL_TOKEN]

Bot: "Welcome to OtelAI! I'm your Setup Assistant. Let's get your hotel ready in 5 minutes.
      What's your hotel's name?"

Owner: "Aria Boutique Hotel"

Bot: "Great! Which city is Aria Boutique Hotel in?"
     [Inline keyboard: Istanbul | Ankara | Izmir | Other]

Owner: [taps "Istanbul"]

Bot: "How many rooms does Aria Boutique Hotel have?"
     [Inline keyboard: 1-10 | 11-20 | 21-50 | 50+]

Owner: [taps "11-20"]

Bot: "What's the best language to communicate with your guests in?"
     [Inline keyboard: Turkish | English | German | Dutch | French | Multiple]

Owner: [taps "Multiple"]

Bot: "Perfect. Your AI team is almost ready.
      Here's a summary of what I've set up:
      - Hotel: Aria Boutique Hotel, Istanbul
      - Rooms: 11-20
      - Guest languages: Multi-language

      Your 14-day free trial starts now. All 4 employees are active:
      [Button: Meet your Front Desk AI]
      [Button: Meet your Booking AI]
      [Button: Meet your Housekeeping Coordinator]
      [Button: Meet your Guest Experience AI]

      Each button sends you a link to start chatting with that employee."

[Owner taps "Meet your Front Desk AI"]

Bot: "Here's your Front Desk AI: t.me/HotelAriaFrontDeskBot
      Click to start the conversation and say hello!"
```

**Key design decisions in this flow:**
- Never more than one open question at a time
- Inline keyboard for every multiple-choice question (no free-text commands)
- Summary + confirmation before activating bots
- Each employee introduced via direct bot link (not explained abstractly)
- Trial start confirmed in chat (not email)

---

## Per-Employee Pricing: Trial-End Flow

```
[Day 14 — Trial End Message]

SetupWizardBot (or dedicated notification bot):
"Your 14-day trial with OtelAI ends today. Here's what your team accomplished:

Front Desk AI — €29/month
 ✓ 84 guest messages answered
 ✓ 3 escalations handled

Booking AI — €39/month
 ✓ 12 availability inquiries handled
 ✓ 2 direct booking conversions

Guest Experience AI — €19/month
 ✓ 14 pre-arrival messages sent
 ✓ 11 review requests sent

Housekeeping Coordinator — €14/month
 ✓ 18 days of room status updates

Which employees do you want to keep?
(Select all that apply, then confirm)

[✓ Front Desk AI — €29/mo]
[  Booking AI — €39/mo]
[✓ Guest Experience AI — €19/mo]
[  Housekeeping — €14/mo]
[CONFIRM — Total: €48/month]"

[Owner confirms selection]

Bot: "Got it! Your monthly plan: Front Desk AI + Guest Experience AI = €48/month.
     To activate your subscription, complete payment here:
     [Pay Now — secure checkout]

     This link expires in 24 hours."
```

**Key design decisions:**
- Trial stats shown per employee (ROI justification, not abstract pricing)
- Toggle-style selection (tap to include/exclude; confirmation required)
- Total shown dynamically as selection changes
- Payment is a URL button → existing web checkout; no Telegram Payments API
- 24-hour expiry on payment link creates urgency without pressure
- Unselected bots deactivate automatically at payment

---

## Sources

- Telegram Bot API official docs (core.telegram.org/bots/api, core.telegram.org/bots/features) — HIGH confidence
- Telegram deep linking spec (core.telegram.org/api/links) — HIGH confidence
- grammY official docs on Vercel hosting (grammy.dev/hosting/vercel) — HIGH confidence
- grammY vs Telegraf comparison (grammy.dev/resources/comparison) — HIGH confidence
- SaaS per-seat pricing trends 2025 (multiple sources: getmonetizely.com, metronome.com, invespcro.com) — MEDIUM confidence
- Telegram conversational onboarding patterns (coincodecap.com, voiceflow.com/blog) — MEDIUM confidence
- Hotel Telegram bot examples (hijiffy.com, sendpulse.com, botpress.com) — MEDIUM confidence (general patterns, not hotel-specific multi-bot SaaS)
- Telegram onboarding kit (github.com/Easterok/telegram-onboarding-kit) — MEDIUM confidence (community library, validates pattern exists)
- InviteMember pattern for Telegram access control (invitemember.com) — LOW confidence (different use case, pattern applicable)
- Multi-bot webhook architecture (github.com/imdkbj/1f20dee8136a573f933a5130d906cc6e) — MEDIUM confidence

**Validation needed:**
- Verify BotFather allows 5+ bots per account without restriction (training data says "unlimited"; official FAQ confirms this but worth testing)
- Verify Vercel Pro function timeout is sufficient for Claude API call + bot response within 60s limit
- Confirm iyzico/Mollie allow deep-linked one-time checkout URLs (for the payment link pattern)

---

*Feature research for: OtelAI v2.0 — Telegram-first agent-native SaaS milestone*
*Researched: 2026-03-06*
*Confidence: MEDIUM-HIGH (Telegram API patterns HIGH; hotel-specific Telegram SaaS patterns MEDIUM; pricing flow UX MEDIUM)*
