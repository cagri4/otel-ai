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
- [ ] **DESK-02**: Guests can chat with Front Desk AI via WhatsApp
- [ ] **DESK-03**: Guests can chat with Front Desk AI via embeddable web chat widget
- [ ] **DESK-04**: Front Desk AI answers hotel FAQs using hotel knowledge base
- [ ] **DESK-05**: Front Desk AI communicates in guest's language (EN, TR + 1 EU language minimum)
- [ ] **DESK-06**: Front Desk AI escalates unhandled requests to hotel owner within 2 minutes
- [ ] **DESK-07**: Front Desk AI maintains conversation context across multiple messages

### Guest Experience AI (Role 3)

- [ ] **GEXP-01**: Guest Experience AI sends pre-arrival info package (D-1 before check-in)
- [ ] **GEXP-02**: Guest Experience AI sends checkout reminder (morning of checkout day)
- [ ] **GEXP-03**: Guest Experience AI sends post-stay review request (24h after checkout)
- [ ] **GEXP-04**: Guest Experience AI messages are milestone-triggered (automated based on booking dates)
- [ ] **GEXP-05**: Hotel owner can customize message templates for each milestone

### Booking AI (Role 2)

- [ ] **BOOK-01**: Booking AI handles availability inquiries over WhatsApp and web chat
- [ ] **BOOK-02**: Booking AI retrieves real-time room availability via tool call (never hallucinated)
- [ ] **BOOK-03**: Booking AI provides accurate pricing from hotel knowledge base
- [ ] **BOOK-04**: Booking AI can soft-upsell room upgrades during inquiry
- [ ] **BOOK-05**: Booking AI escalates complex/custom requests to hotel owner

### Housekeeping Coordinator (Role 4)

- [ ] **HSKP-01**: Hotel owner can chat with Housekeeping Coordinator to manage room statuses
- [ ] **HSKP-02**: Housekeeping Coordinator maintains room status board (clean, dirty, inspected, out of order)
- [ ] **HSKP-03**: Housekeeping Coordinator generates daily cleaning priority queue based on checkouts/check-ins
- [ ] **HSKP-04**: Housekeeping Coordinator can assign tasks to housekeeping staff (via notification)

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

- [ ] **DASH-01**: Hotel owner can chat with each AI employee individually
- [ ] **DASH-02**: Hotel owner can view all guest conversations per AI employee
- [ ] **DASH-03**: Hotel owner receives escalation notifications (in-app + email)
- [ ] **DASH-04**: Hotel owner can turn AI employees on/off
- [ ] **DASH-05**: Hotel owner can configure each AI employee's behavior/tone

### WhatsApp Integration

- [ ] **WHAP-01**: WhatsApp Business API connection via gateway provider (Twilio/MessageBird)
- [ ] **WHAP-02**: Incoming guest messages routed to correct AI employee based on context
- [ ] **WHAP-03**: AI responses sent back to guest via WhatsApp
- [ ] **WHAP-04**: Conversation history persisted and viewable in owner dashboard

### Guest Web Chat

- [ ] **CHAT-01**: Embeddable web chat widget for hotel website
- [ ] **CHAT-02**: Widget identifies hotel via token (no guest auth required)
- [ ] **CHAT-03**: Real-time message delivery via Supabase Realtime (client-direct)
- [ ] **CHAT-04**: Widget supports hotel branding (colors, logo, welcome message)

### Billing

- [ ] **BILL-01**: Subscription billing with tiered plans (Starter: 2 agents, Pro: 4, Enterprise: 6)
- [ ] **BILL-02**: iyzico integration for TR market payments
- [ ] **BILL-03**: Mollie integration for EU market payments
- [ ] **BILL-04**: Plan enforcement — agent count limited by subscription tier
- [ ] **BILL-05**: Hotel owner can upgrade/downgrade plan
- [ ] **BILL-06**: Free trial period for new hotels

### Internationalization

- [x] **I18N-01**: Owner dashboard available in EN and TR
- [x] **I18N-02**: AI employees respond in guest's detected language
- [x] **I18N-03**: next-intl integration with Server Component support
- [x] **I18N-04**: Hotel knowledge base content servable in multiple languages

### Escalation & Safety

- [ ] **SAFE-01**: All AI agent actions classified as OBSERVE / INFORM / ACT
- [ ] **SAFE-02**: ACT-class actions require hotel owner confirmation
- [ ] **SAFE-03**: All agent actions logged with audit trail
- [ ] **SAFE-04**: Rate limiting per hotel and per guest IP
- [ ] **SAFE-05**: Prompt injection protection on all guest-facing inputs

## v2 Requirements

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
| Video/voice-based AI communication | Text-first approach — complexity too high for v1 |
| IoT/smart device integration | Not core to virtual employee value proposition |
| Mobile native app | Web-first, mobile later |
| Enterprise features for large hotel chains | Butik otel odağı — farklı segment |

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
| DESK-02 | Phase 4 | Pending |
| DESK-03 | Phase 4 | Pending |
| DESK-04 | Phase 4 | Pending |
| DESK-05 | Phase 4 | Pending |
| DESK-06 | Phase 4 | Pending |
| DESK-07 | Phase 4 | Pending |
| WHAP-01 | Phase 4 | Pending |
| WHAP-02 | Phase 4 | Pending |
| WHAP-03 | Phase 4 | Pending |
| WHAP-04 | Phase 4 | Pending |
| CHAT-01 | Phase 4 | Pending |
| CHAT-02 | Phase 4 | Pending |
| CHAT-03 | Phase 4 | Pending |
| CHAT-04 | Phase 4 | Pending |
| I18N-01 | Phase 4 | Complete |
| I18N-02 | Phase 4 | Complete |
| I18N-03 | Phase 4 | Complete |
| I18N-04 | Phase 4 | Complete |
| SAFE-04 | Phase 4 | Pending |
| SAFE-05 | Phase 4 | Pending |
| GEXP-01 | Phase 5 | Pending |
| GEXP-02 | Phase 5 | Pending |
| GEXP-03 | Phase 5 | Pending |
| GEXP-04 | Phase 5 | Pending |
| GEXP-05 | Phase 5 | Pending |
| SAFE-01 | Phase 5 | Pending |
| SAFE-02 | Phase 5 | Pending |
| SAFE-03 | Phase 5 | Pending |
| DASH-01 | Phase 5 | Pending |
| DASH-02 | Phase 5 | Pending |
| DASH-03 | Phase 5 | Pending |
| DASH-04 | Phase 5 | Pending |
| DASH-05 | Phase 5 | Pending |
| BILL-01 | Phase 6 | Pending |
| BILL-02 | Phase 6 | Pending |
| BILL-03 | Phase 6 | Pending |
| BILL-04 | Phase 6 | Pending |
| BILL-05 | Phase 6 | Pending |
| BILL-06 | Phase 6 | Pending |
| BOOK-01 | Phase 7 | Pending |
| BOOK-02 | Phase 7 | Pending |
| BOOK-03 | Phase 7 | Pending |
| BOOK-04 | Phase 7 | Pending |
| BOOK-05 | Phase 7 | Pending |
| HSKP-01 | Phase 8 | Pending |
| HSKP-02 | Phase 8 | Pending |
| HSKP-03 | Phase 8 | Pending |
| HSKP-04 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 69 total
- Mapped to phases: 69
- Unmapped: 0

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after roadmap creation*
