# Roadmap: OtelAI

## Overview

OtelAI ships in 8 phases, building from data foundation to full AI staff team. The order is dependency-driven: multi-tenancy and auth must exist before agents, agents must prove out owner-side before guests touch them, onboarding must populate the knowledge base before any guest channel goes live, and billing is introduced only after the product has demonstrated value. Each phase delivers a complete, verifiable capability — not a horizontal layer.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Multi-tenant Supabase schema, auth, and hotel configuration (completed 2026-03-03)
- [x] **Phase 2: Agent Core** - Stateless agent orchestrator, memory system, and first AI employee (owner-facing) (completed 2026-03-05)
- [ ] **Phase 3: Knowledge Base and Onboarding** - Hotel knowledge editor and guided setup to first working AI response
- [ ] **Phase 4: Guest-Facing Layer** - WhatsApp integration, web chat widget, multi-language, rate limiting
- [ ] **Phase 5: Guest Experience AI and Owner Dashboard** - Milestone-triggered guest messages, escalation, safety guardrails, dashboard
- [ ] **Phase 6: Billing** - iyzico (TR) and Mollie (EU) subscription billing with tiered plan enforcement
- [ ] **Phase 7: Booking AI** - Availability inquiry handling, tool-enforced pricing, upsell logic
- [ ] **Phase 8: Housekeeping Coordinator** - Room status board, cleaning priority queue, task assignment

## Phase Details

### Phase 1: Foundation
**Goal**: A hotel owner can sign up, create a hotel account, and configure their hotel — and the platform correctly isolates their data from all other hotels
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04
**Success Criteria** (what must be TRUE):
  1. A new hotel owner can sign up with email and password and land on their hotel dashboard
  2. Hotel owner can set hotel name, address, timezone, and contact information and save changes
  3. Two separate hotels cannot see each other's data under any operation (RLS enforced at DB layer)
  4. All timestamps display in the hotel's configured local timezone, not UTC
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Schema, RLS, Supabase clients, and timezone utility (Wave 1)
- [x] 01-02-PLAN.md — Auth flow: signup, login, session, route protection (Wave 2)
- [x] 01-03-PLAN.md — Hotel configuration UI with timezone picker (Wave 3)

### Phase 2: Agent Core
**Goal**: Hotel owner can have a real conversation with the Front Desk AI from their dashboard, with responses backed by the Claude API and tool-first policy enforced
**Depends on**: Phase 1
**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, AGENT-06, AGENT-07, DESK-01
**Success Criteria** (what must be TRUE):
  1. Hotel owner can open a chat with the Front Desk AI and receive a streaming response (typing indicator visible on send)
  2. The AI refuses to state room prices or availability unless it has retrieved them via a tool call in the same conversation
  3. Agent context is assembled fresh from the database on every invocation — no stale hotel data in responses
  4. Multiple AI employees can coordinate via the async tasks table without synchronous inter-agent calls
**Plans**: 4 plans

Plans:
- [x] 02-01-PLAN.md — Schema migration (memory tables + agent_tasks), TypeScript types, memory helpers (Wave 1)
- [x] 02-02-PLAN.md — Agent Factory, context assembly, invokeAgent() orchestrator, tool system (Wave 2)
- [x] 02-03-PLAN.md — Agent-to-agent coordination via async tasks helpers + delegate_task tool (Wave 2)
- [ ] 02-04-PLAN.md — SSE streaming route, Front Desk AI chat UI at /desk (Wave 3)

### Phase 3: Knowledge Base and Onboarding
**Goal**: A new hotel owner reaches a working AI conversation in under 5 minutes, and can populate the hotel knowledge base that all AI employees draw from
**Depends on**: Phase 2
**Requirements**: KNOW-01, KNOW-02, KNOW-03, KNOW-04, KNOW-05, ONBR-01, ONBR-02, ONBR-03, ONBR-04
**Success Criteria** (what must be TRUE):
  1. A new user who has never seen OtelAI can complete setup and receive a first AI response within 5 minutes
  2. Hotel owner can add and edit FAQs, room information, and local recommendations from the dashboard
  3. Pre-populated boutique hotel defaults (check-in 3pm, checkout 11am, standard policies) are in place before owner fills anything in
  4. The Front Desk AI draws answers from the hotel's knowledge base, not generic defaults
  5. Knowledge base content can be stored or served in multiple languages
**Plans**: TBD

Plans:
- [ ] 03-01: Knowledge base data model and CRUD API — FAQs, room info, local recommendations
- [ ] 03-02: Knowledge base editor UI — add/edit/delete entries, multi-language content support
- [ ] 03-03: Onboarding wizard — multi-step setup (hotel name, city, contact), pre-populated defaults, progressive AI first-shift

### Phase 4: Guest-Facing Layer
**Goal**: Guests can chat with the Front Desk AI via WhatsApp and a hotel website widget, in their own language, with rate limiting and injection protection in place before any guest traffic touches the system
**Depends on**: Phase 3
**Requirements**: DESK-02, DESK-03, DESK-04, DESK-05, DESK-06, DESK-07, WHAP-01, WHAP-02, WHAP-03, WHAP-04, CHAT-01, CHAT-02, CHAT-03, CHAT-04, I18N-01, I18N-02, I18N-03, I18N-04, SAFE-04, SAFE-05
**Success Criteria** (what must be TRUE):
  1. A guest can message the hotel on WhatsApp and receive a response from the Front Desk AI within a conversational timeframe
  2. A guest can open the embeddable web chat widget on the hotel website and have a continuous conversation without logging in
  3. The AI detects and responds in the guest's language (EN, TR, and at least one EU language)
  4. An unhandled guest request triggers an escalation notification to the hotel owner within 2 minutes
  5. Rate limiting prevents a single IP or hotel from flooding the system; prompt injection attempts from guest input are blocked
**Plans**: TBD

Plans:
- [ ] 04-01: WhatsApp Business API gateway integration — webhook handler, message routing, conversation persistence
- [ ] 04-02: Embeddable web chat widget — hotel token auth, Supabase Realtime delivery, branding config
- [ ] 04-03: Multi-language support — next-intl integration, owner dashboard EN/TR, AI language detection
- [ ] 04-04: Security layer — rate limiting per IP and per hotel, prompt injection protection on guest inputs
- [ ] 04-05: Escalation notification system — unresolved request detection, 2-minute owner alert via in-app and email

### Phase 5: Guest Experience AI and Owner Dashboard
**Goal**: Guests automatically receive the right message at the right moment (pre-arrival, checkout, review request), hotel owners have a complete dashboard to monitor conversations and manage AI employees, and all agent actions are classified and logged
**Depends on**: Phase 4
**Requirements**: GEXP-01, GEXP-02, GEXP-03, GEXP-04, GEXP-05, SAFE-01, SAFE-02, SAFE-03, DASH-01, DASH-02, DASH-03, DASH-04, DASH-05
**Success Criteria** (what must be TRUE):
  1. A guest with a booking receives a pre-arrival info package the day before check-in without any owner action
  2. A guest receives a checkout reminder on the morning of departure and a review request 24 hours after checkout, automatically
  3. Hotel owner can view the full conversation history for each AI employee from the dashboard
  4. Hotel owner receives an in-app and email notification when the AI escalates a guest request
  5. Every agent action is written to an audit log — hotel owner can see what each AI employee did and when
**Plans**: TBD

Plans:
- [ ] 05-01: Guest Experience AI role — pre-arrival, checkout reminder, post-stay review request triggers
- [ ] 05-02: Milestone trigger engine — cron-based booking date evaluation, message dispatch
- [ ] 05-03: Owner dashboard — per-employee chat, conversation history view, employee on/off toggle, behavior config
- [ ] 05-04: Safety and audit layer — OBSERVE/INFORM/ACT classification, ACT confirmation requirement, audit trail

### Phase 6: Billing
**Goal**: Hotel owners pay for OtelAI via a subscription plan, with plan tier enforced on agent count, and free trial available for new hotels
**Depends on**: Phase 5
**Requirements**: BILL-01, BILL-02, BILL-03, BILL-04, BILL-05, BILL-06
**Success Criteria** (what must be TRUE):
  1. A new hotel gets a free trial period before being asked to pay
  2. Hotel owner can subscribe via iyzico (TR market) or Mollie (EU market) depending on their region
  3. Agent count is hard-capped by subscription tier — a Starter-plan hotel cannot activate more than 2 agents
  4. Hotel owner can upgrade or downgrade their plan without contacting support
**Plans**: TBD

Plans:
- [ ] 06-01: iyzico integration — subscription checkout, webhook handler, plan state persistence
- [ ] 06-02: Mollie integration — subscription checkout, webhook handler, EU market routing
- [ ] 06-03: Plan enforcement and trial — agent count limits by tier, free trial logic, upgrade/downgrade flow

### Phase 7: Booking AI
**Goal**: Guests can inquire about room availability and pricing over WhatsApp and web chat, receiving accurate answers backed by real data and a soft upsell when appropriate
**Depends on**: Phase 4
**Requirements**: BOOK-01, BOOK-02, BOOK-03, BOOK-04, BOOK-05
**Success Criteria** (what must be TRUE):
  1. A guest asks "do you have a room for two nights next weekend?" and receives an accurate availability answer, not a hallucinated one
  2. Booking AI states room prices only after retrieving them from the hotel knowledge base via tool call
  3. A guest in a standard room inquiry is offered an upgrade option naturally within the conversation
  4. A guest with a complex or custom request (e.g., group booking, special rate) is escalated to the hotel owner
**Plans**: TBD

Plans:
- [ ] 07-01: Availability lookup tool — transactional room availability query, atomic read, hotel_id scoped
- [ ] 07-02: Booking AI role — availability handling, pricing retrieval, upsell logic, complex-request escalation
- [ ] 07-03: Rolling context management — last N turns raw, older turns compressed into structured summary

### Phase 8: Housekeeping Coordinator
**Goal**: Hotel owner can manage room cleaning status through a conversation with the Housekeeping Coordinator AI, which maintains a live room status board and generates a daily priority queue
**Depends on**: Phase 5
**Requirements**: HSKP-01, HSKP-02, HSKP-03, HSKP-04
**Success Criteria** (what must be TRUE):
  1. Hotel owner can tell the Housekeeping Coordinator "room 12 is clean" and see the room status board update
  2. Every morning, a cleaning priority queue is automatically generated based on that day's checkouts and check-ins
  3. Hotel owner can assign a cleaning task to a staff member via the Housekeeping Coordinator, who sends a notification
**Plans**: TBD

Plans:
- [ ] 08-01: Room status data model and Housekeeping Coordinator role — status board, chat-driven updates
- [ ] 08-02: Daily priority queue generation — cron trigger, checkout/check-in date logic, task dispatch notifications

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete    | 2026-03-03 |
| 2. Agent Core | 4/4 | Complete    | 2026-03-05 |
| 3. Knowledge Base and Onboarding | 0/3 | Not started | - |
| 4. Guest-Facing Layer | 0/5 | Not started | - |
| 5. Guest Experience AI and Owner Dashboard | 0/4 | Not started | - |
| 6. Billing | 0/3 | Not started | - |
| 7. Booking AI | 0/3 | Not started | - |
| 8. Housekeeping Coordinator | 0/2 | Not started | - |
