# Requirements: OtelAI

**Defined:** 2026-03-02
**Core Value:** Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [x] **FOUND-01**: Multi-tenant Supabase schema with RLS — every table has `hotel_id` and row-level security policy
- [x] **FOUND-02**: User can sign up and create a hotel account with email/password via Supabase Auth
- [x] **FOUND-03**: All timestamps stored as UTC (`timestamptz`), displayed in hotel-local timezone
- [ ] **FOUND-04**: Hotel owner can configure hotel basic info (name, address, timezone, contact)

### Agent Core

- [x] **AGENT-01**: Stateless agent orchestrator (`invokeAgent()`) that assembles context from DB and calls Claude API
- [x] **AGENT-02**: Layered system prompt assembly (role identity → hotel context → agent memory → behavioral instructions)
- [x] **AGENT-03**: Agent Factory with Role Registry — central registry maps role enum to prompt template, allowed tools, memory scope
- [x] **AGENT-04**: Three-tier memory system (semantic hotel facts, episodic guest history, working conversation turns)
- [x] **AGENT-05**: Tool-first policy enforced — agents cannot answer availability/price questions without successful tool call
- [x] **AGENT-06**: Streaming response (SSE) for all chat interactions — typing indicator on message send
- [x] **AGENT-07**: Agent-to-agent coordination via async tasks table (no synchronous inter-agent calls)

### Front Desk AI (Role 1)

- [x] **DESK-01**: User can chat with Front Desk AI from owner dashboard
- [x] **DESK-02**: Guests can chat with Front Desk AI via WhatsApp
- [x] **DESK-03**: Guests can chat with Front Desk AI via embeddable web chat widget
- [x] **DESK-04**: Front Desk AI answers hotel FAQs using hotel knowledge base
- [x] **DESK-05**: Front Desk AI communicates in guest's language (EN, TR + 1 EU language minimum)
- [x] **DESK-06**: Front Desk AI escalates unhandled requests to hotel owner within 2 minutes
- [x] **DESK-07**: Front Desk AI maintains conversation context across multiple messages

### Guest Experience AI (Role 3)

- [x] **GEXP-01**: Guest Experience AI sends pre-arrival info package (D-1 before check-in)
- [x] **GEXP-02**: Guest Experience AI sends checkout reminder (morning of checkout day)
- [x] **GEXP-03**: Guest Experience AI sends post-stay review request (24h after checkout)
- [x] **GEXP-04**: Guest Experience AI messages are milestone-triggered (automated based on booking dates)
- [x] **GEXP-05**: Hotel owner can customize message templates for each milestone

### Booking AI (Role 2)

- [x] **BOOK-01**: Booking AI handles availability inquiries over WhatsApp and web chat
- [x] **BOOK-02**: Booking AI retrieves real-time room availability via tool call (never hallucinated)
- [x] **BOOK-03**: Booking AI provides accurate pricing from hotel knowledge base
- [x] **BOOK-04**: Booking AI can soft-upsell room upgrades during inquiry
- [x] **BOOK-05**: Booking AI escalates complex/custom requests to hotel owner

### Housekeeping Coordinator (Role 4)

- [x] **HSKP-01**: Hotel owner can chat with Housekeeping Coordinator to manage room statuses
- [x] **HSKP-02**: Housekeeping Coordinator maintains room status board (clean, dirty, inspected, out of order)
- [x] **HSKP-03**: Housekeeping Coordinator generates daily cleaning priority queue based on checkouts/check-ins
- [x] **HSKP-04**: Housekeeping Coordinator can assign tasks to housekeeping staff (via notification)

### Hotel Knowledge Base

- [x] **KNOW-01**: Hotel owner can add/edit hotel FAQs (check-in time, WiFi, parking, policies)
- [x] **KNOW-02**: Hotel owner can add/edit room information (types, pricing, amenities, photos description)
- [x] **KNOW-03**: Hotel owner can add/edit local recommendations (restaurants, attractions, transport)
- [x] **KNOW-04**: Knowledge base feeds all AI employees as shared hotel context
- [x] **KNOW-05**: Knowledge base supports multi-language content (or auto-translation)

### Onboarding

- [x] **ONBR-01**: New hotel owner reaches first working AI response in under 5 minutes
- [x] **ONBR-02**: Onboarding wizard collects minimum info (hotel name, city, contact) then starts AI
- [x] **ONBR-03**: Progressive onboarding — AI employees ask for missing info during first "shift"
- [x] **ONBR-04**: Pre-populated boutique hotel defaults (check-in 3pm, checkout 11am, standard policies)

### Owner Dashboard

- [x] **DASH-01**: Hotel owner can chat with each AI employee individually
- [x] **DASH-02**: Hotel owner can view all guest conversations per AI employee
- [x] **DASH-03**: Hotel owner receives escalation notifications (in-app + email)
- [x] **DASH-04**: Hotel owner can turn AI employees on/off
- [x] **DASH-05**: Hotel owner can configure each AI employee's behavior/tone

### WhatsApp Integration

- [x] **WHAP-01**: WhatsApp Business API connection via gateway provider (Twilio/MessageBird)
- [x] **WHAP-02**: Incoming guest messages routed to correct AI employee based on context
- [x] **WHAP-03**: AI responses sent back to guest via WhatsApp
- [x] **WHAP-04**: Conversation history persisted and viewable in owner dashboard

### Guest Web Chat

- [x] **CHAT-01**: Embeddable web chat widget for hotel website
- [x] **CHAT-02**: Widget identifies hotel via token (no guest auth required)
- [x] **CHAT-03**: Real-time message delivery via Supabase Realtime (client-direct)
- [x] **CHAT-04**: Widget supports hotel branding (colors, logo, welcome message)

### Billing

- [x] **BILL-01**: Subscription billing with tiered plans (Starter: 2 agents, Pro: 4, Enterprise: 6)
- [x] **BILL-02**: iyzico integration for TR market payments
- [x] **BILL-03**: Mollie integration for EU market payments
- [x] **BILL-04**: Plan enforcement — agent count limited by subscription tier
- [x] **BILL-05**: Hotel owner can upgrade/downgrade plan
- [x] **BILL-06**: Free trial period for new hotels

### Internationalization

- [x] **I18N-01**: Owner dashboard available in EN and TR
- [x] **I18N-02**: AI employees respond in guest's detected language
- [x] **I18N-03**: next-intl integration with Server Component support
- [x] **I18N-04**: Hotel knowledge base content servable in multiple languages

### Escalation & Safety

- [x] **SAFE-01**: All AI agent actions classified as OBSERVE / INFORM / ACT
- [x] **SAFE-02**: ACT-class actions require hotel owner confirmation
- [x] **SAFE-03**: All agent actions logged with audit trail
- [x] **SAFE-04**: Rate limiting per hotel and per guest IP
- [x] **SAFE-05**: Prompt injection protection on all guest-facing inputs

## v2.0 Requirements

Requirements for agent-native SaaS milestone. Each maps to roadmap phases 9+.

### Telegram Infrastructure

- [x] **TGIF-01**: Telegram Bot API webhook handler (`/api/telegram/[botToken]`) — per-bot endpoint with dynamic routing
- [x] **TGIF-02**: `X-Telegram-Bot-Api-Secret-Token` validation on every webhook request
- [x] **TGIF-03**: Webhook handler returns 200 immediately — agent invocation runs async (no Telegram retry storms)
- [x] **TGIF-04**: Bot tokens encrypted at rest via Supabase Vault
- [x] **TGIF-05**: `hotel_bots` table (hotel_id, role, bot_token, bot_username, is_active) with RLS

### Super Admin

- [x] **SADM-01**: Super admin panel — hotel list with status, create new hotel
- [x] **SADM-02**: Bot token entry per hotel (pasted from BotFather)
- [x] **SADM-03**: Automatic `setWebhook` registration when bot token is saved
- [x] **SADM-04**: Telegram deep link generation (`t.me/SetupWizardBot?start={hotelId}`)

### Telegram Onboarding

- [x] **ONBT-01**: Setup Wizard as separate Telegram bot — activates via deep link
- [x] **ONBT-02**: Conversational info collection (hotel name, address, rooms, check-in/out times)
- [x] **ONBT-03**: Team introduction — presents each employee bot with direct link
- [x] **ONBT-04**: Setup completion activates all employee bots with 14-day trial

### Employee Bots

- [x] **EBOT-01**: Front Desk AI as separate Telegram bot for hotel owner
- [x] **EBOT-02**: Booking AI as separate Telegram bot for hotel owner
- [x] **EBOT-03**: Housekeeping Coordinator as separate Telegram bot for hotel owner
- [x] **EBOT-04**: Guest Experience AI as separate Telegram bot for hotel owner
- [x] **EBOT-05**: Existing `invokeAgent()` pipeline handles Telegram channel (non-streaming)
- [x] **EBOT-06**: MarkdownV2 formatted responses (Telegram-compatible output)

### Pricing & Trial

- [x] **PRIC-01**: Per-employee pricing — each agent role has its own monthly price
- [x] **PRIC-02**: 14-day trial with all employees active
- [x] **PRIC-03**: Trial-end notification via Telegram with employee selection prompt
- [ ] **PRIC-04**: Selected employees' prices sum to monthly subscription amount
- [ ] **PRIC-05**: Payment via existing iyzico (TR) / Mollie (EU) web checkout link

### Web Dashboard

- [ ] **WDSH-01**: Existing dashboard remains accessible as readonly optional view

## v3 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Revenue Manager AI (Role 5)

- **REVM-01**: Occupancy dashboard with RevPAR reporting
- **REVM-02**: Pricing recommendations requiring owner approval
- **REVM-03**: Seasonal demand pattern analysis

### Finance AI (Role 6)

- **FINC-01**: Daily revenue summary via chat
- **FINC-02**: Expense logging via chat interface
- **FINC-03**: Monthly P&L report generation

### Advanced Features

- **ADVN-01**: PMS integration (Mews, Cloudbeds)
- **ADVN-02**: Direct booking with payment processing
- **ADVN-03**: Cross-agent collaboration / inter-agent messaging
- **ADVN-04**: Guest sentiment tracking with proactive intervention
- **ADVN-05**: Employee performance analytics and reports
- **ADVN-06**: Mobile-responsive dashboard improvements
- **ADVN-07**: White-label / branded guest chat widget

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fully autonomous booking with payment (no human confirmation) | Legal liability — AI cannot commit hotel to financial transactions without owner approval |
| Automated public review responses posted by AI | One bad response goes viral — reputation risk too high |
| Automated OTA rate changes without approval | Revenue loss risk — requires explicit owner confirmation |
| Generic catch-all AI assistant | Kills the employee metaphor that is the core differentiator |
| Video/voice-based AI communication | Text-first approach — complexity too high |
| IoT/smart device integration | Not core to virtual employee value proposition |
| Mobile native app | Telegram zaten mobil çalışıyor |
| Enterprise features for large hotel chains | Butik otel odağı — farklı segment |
| Telegram Payments API | Mevcut iyzico+Mollie web ödeme yeterli; Telegram Payments recurring desteklemiyor |
| Birden fazla süper admin | Şimdilik tek kişi yeterli |
| Per-hotel dedicated bot usernames | Shared bot pool kullanılıyor; hotel-specific bot names v3+ |
| Programmatic bot creation (BotFather bypass) | Telegram API buna izin vermiyor — hard constraint |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Pending |
| AGENT-01 | Phase 2 | Complete |
| AGENT-02 | Phase 2 | Complete |
| AGENT-03 | Phase 2 | Complete |
| AGENT-04 | Phase 2 | Complete |
| AGENT-05 | Phase 2 | Complete |
| AGENT-06 | Phase 2 | Complete |
| AGENT-07 | Phase 2 | Complete |
| DESK-01 | Phase 2 | Complete |
| KNOW-01 | Phase 3 | Complete |
| KNOW-02 | Phase 3 | Complete |
| KNOW-03 | Phase 3 | Complete |
| KNOW-04 | Phase 3 | Complete |
| KNOW-05 | Phase 3 | Complete |
| ONBR-01 | Phase 3 | Complete |
| ONBR-02 | Phase 3 | Complete |
| ONBR-03 | Phase 3 | Complete |
| ONBR-04 | Phase 3 | Complete |
| DESK-02 | Phase 4 | Complete |
| DESK-03 | Phase 4 | Complete |
| DESK-04 | Phase 4 | Complete |
| DESK-05 | Phase 4 | Complete |
| DESK-06 | Phase 4 | Complete |
| DESK-07 | Phase 4 | Complete |
| WHAP-01 | Phase 4 | Complete |
| WHAP-02 | Phase 4 | Complete |
| WHAP-03 | Phase 4 | Complete |
| WHAP-04 | Phase 4 | Complete |
| CHAT-01 | Phase 4 | Complete |
| CHAT-02 | Phase 4 | Complete |
| CHAT-03 | Phase 4 | Complete |
| CHAT-04 | Phase 4 | Complete |
| I18N-01 | Phase 4 | Complete |
| I18N-02 | Phase 4 | Complete |
| I18N-03 | Phase 4 | Complete |
| I18N-04 | Phase 4 | Complete |
| SAFE-04 | Phase 4 | Complete |
| SAFE-05 | Phase 4 | Complete |
| GEXP-01 | Phase 5 | Complete |
| GEXP-02 | Phase 5 | Complete |
| GEXP-03 | Phase 5 | Complete |
| GEXP-04 | Phase 5 | Complete |
| GEXP-05 | Phase 5 | Complete |
| SAFE-01 | Phase 5 | Complete |
| SAFE-02 | Phase 5 | Complete |
| SAFE-03 | Phase 5 | Complete |
| DASH-01 | Phase 5 | Complete |
| DASH-02 | Phase 5 | Complete |
| DASH-03 | Phase 5 | Complete |
| DASH-04 | Phase 5 | Complete |
| DASH-05 | Phase 5 | Complete |
| BILL-01 | Phase 6 | Complete |
| BILL-02 | Phase 6 | Complete |
| BILL-03 | Phase 6 | Complete |
| BILL-04 | Phase 6 | Complete |
| BILL-05 | Phase 6 | Complete |
| BILL-06 | Phase 6 | Complete |
| BOOK-01 | Phase 7 | Complete |
| BOOK-02 | Phase 7 | Complete |
| BOOK-03 | Phase 7 | Complete |
| BOOK-04 | Phase 7 | Complete |
| BOOK-05 | Phase 7 | Complete |
| HSKP-01 | Phase 8 | Complete |
| HSKP-02 | Phase 8 | Complete |
| HSKP-03 | Phase 8 | Complete |
| HSKP-04 | Phase 8 | Complete |
| TGIF-01 | Phase 9 | Complete |
| TGIF-02 | Phase 9 | Complete |
| TGIF-03 | Phase 9 | Complete |
| TGIF-04 | Phase 9 | Complete |
| TGIF-05 | Phase 9 | Complete |
| EBOT-05 | Phase 9 | Complete |
| EBOT-06 | Phase 9 | Complete |
| SADM-01 | Phase 10 | Complete |
| SADM-02 | Phase 10 | Complete |
| SADM-03 | Phase 10 | Complete |
| SADM-04 | Phase 10 | Complete |
| EBOT-01 | Phase 10 | Complete |
| EBOT-02 | Phase 10 | Complete |
| EBOT-03 | Phase 10 | Complete |
| EBOT-04 | Phase 10 | Complete |
| ONBT-01 | Phase 11 | Complete |
| ONBT-02 | Phase 11 | Complete |
| ONBT-03 | Phase 11 | Complete |
| ONBT-04 | Phase 11 | Complete |
| PRIC-01 | Phase 12 | Complete |
| PRIC-02 | Phase 12 | Complete |
| PRIC-03 | Phase 12 | Complete |
| PRIC-04 | Phase 12 | Pending |
| PRIC-05 | Phase 12 | Pending |
| WDSH-01 | Phase 13 | Pending |

**Coverage:**
- v1 requirements: 69 total
- Mapped to phases: 69
- v2.0 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-06 after v2.0 roadmap creation (phases 9-13)*
