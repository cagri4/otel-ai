# Feature Research

**Domain:** AI Virtual Hotel Staff SaaS — boutique hotels (10-50 rooms)
**Researched:** 2026-03-01
**Confidence:** MEDIUM (domain knowledge + industry patterns; web research blocked — flag for validation)

---

## The 5-6 Essential AI Employee Roles

This is the core architectural decision of OtelAI. The roles below are derived from
the real operational bottlenecks in boutique hotels with 1-5 actual staff members.
Each role maps to a genuine pain point where limited staff creates either service
failures or owner burnout.

### Recommended 6 Starting Roles

| # | Role | Guest-Facing? | Primary Value | Priority |
|---|------|---------------|---------------|----------|
| 1 | Resepsiyonist (Front Desk AI) | YES | 24/7 guest communication — check-in, Q&A, requests | P1 |
| 2 | Rezervasyon Asistani (Booking AI) | HYBRID | Inquiry-to-booking conversion, channel sync | P1 |
| 3 | Misafir Deneyimi (Guest Experience AI) | YES | Pre-arrival, in-stay upsells, local recommendations | P1 |
| 4 | Housekeeping Koordinatoru | INTERNAL | Room status, cleaning schedules, maintenance alerts | P2 |
| 5 | Gelir Yoneticisi (Revenue Manager AI) | INTERNAL | Dynamic pricing, occupancy optimization, reports | P2 |
| 6 | Muhasebe Asistani (Finance AI) | INTERNAL | Invoice tracking, expense logging, daily P&L summary | P3 |

**Why this order:** Roles 1-3 are guest-facing and directly affect revenue and guest satisfaction — if they fail, the hotel loses money today. Roles 4-6 are internal efficiency and reduce owner workload over time. Start with 1-3 for MVP validation.

---

## Feature Landscape by Role

### Role 1: Resepsiyonist (Front Desk AI)
**Guest-facing via WhatsApp + web chat**

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| 24/7 message response | Guests message at all hours; no response = negative review | MEDIUM | LLM call per message; async queue |
| FAQ answering (WiFi, parking, check-in time) | Most repetitive hotel staff task — 40-60% of all inquiries | LOW | RAG over hotel knowledge base |
| Multi-language support (EN, TR, DE, FR, ES minimum) | International boutique hotel guests; mismatched language = poor impression | MEDIUM | LLM handles natively; need language detection |
| Escalation to human | AI can't handle everything; must gracefully hand off | MEDIUM | Notification to owner/staff via app or email |
| Conversation history per guest | Guests reference earlier messages; context loss is jarring | MEDIUM | Per-guest conversation thread storage |
| Response within 60 seconds | WhatsApp guests expect near-instant; slow AI = bad experience | MEDIUM | Async with streaming or fast model selection |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Tone/personality configuration | Each hotel can make the AI sound like their brand (formal luxury vs. casual boutique) | LOW | System prompt configuration per hotel |
| Proactive check-in day message | Sends "We're ready for you!" with parking/access info — guests love this | LOW | Cron job trigger on booking date |
| After-hours emergency routing | Fire, medical — AI recognizes urgency keywords and calls owner | HIGH | Intent classification + Twilio/WhatsApp call |
| Guest sentiment tracking | Flags negative sentiment mid-stay so owner can intervene before a bad review | HIGH | Sentiment scoring on each message |

---

### Role 2: Rezervasyon Asistani (Booking AI)
**Hybrid: guest-facing for inquiries, internal for channel management**

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Booking inquiry handling | Guests ask "do you have availability for X dates?" — must answer accurately | HIGH | Needs real-time availability data; calendar sync |
| Direct booking conversion | Turn WhatsApp inquiry into confirmed booking without human involvement | HIGH | Payment integration required |
| OTA channel awareness | Knows what's booked on Booking.com/Airbnb to avoid double-booking | HIGH | Channel manager API or manual sync |
| Cancellation policy communication | Clear, accurate policy explanation prevents chargebacks | LOW | Static knowledge base |
| Booking confirmation message | Auto-send summary with dates, price, access info | LOW | Triggered on booking creation |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Soft upsell during inquiry ("We also have a suite for €20 more") | Converts inquiries to higher-value bookings | MEDIUM | Prompt engineering + room data |
| Group booking handling | Boutique hotels get frequent group requests; AI can gather requirements | MEDIUM | Multi-step conversation flow |
| Waitlist management | "We're full but I'll notify you if a room opens" — builds good will | MEDIUM | State machine per guest |

---

### Role 3: Misafir Deneyimi (Guest Experience AI)
**Guest-facing via WhatsApp + web chat; triggered at key stay milestones**

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Pre-arrival info package | Check-in time, parking, access code — reduces day-of calls | LOW | Template message on D-1 or D-2 |
| In-stay request handling | "Can I get extra towels?" — triage and route to housekeeping | MEDIUM | Needs internal team notification system |
| Local recommendations | Restaurants, attractions — the "knowledgeable concierge" experience | MEDIUM | RAG over curated local knowledge base per hotel |
| Post-stay review request | Automated follow-up asking for Google/TripAdvisor review | LOW | Trigger 24h after checkout; careful tone |
| Checkout reminder | Morning-of message with checkout time and process | LOW | Cron trigger |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Personalized recommendations based on guest profile | "You stayed with us before and enjoyed wine — here's a local vineyard" | HIGH | Guest history + preference tracking |
| In-stay upsell ("Late checkout available for €20") | Revenue from existing guests is cheapest revenue | MEDIUM | Rules-based or AI-triggered based on occupancy |
| Birthday/anniversary recognition | Boutique hotels compete on personal touch; this is the AI equivalent | LOW | Data field + trigger logic |
| Review response drafting for owner | Helps owner craft responses to public reviews (internal tool) | MEDIUM | One-shot prompt with review text |

---

### Role 4: Housekeeping Koordinatoru
**Internal only — works with hotel staff, not guests**

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Daily room status board | Which rooms need cleaning, are occupied, are vacant | MEDIUM | State machine per room; check-in/out triggers |
| Cleaning priority queue | Checkout rooms first, then due check-ins, then stay-overs | LOW | Sorting logic over room states |
| Maintenance issue logging | Staff reports broken item; AI logs and tracks to resolution | LOW | Simple ticket system per room |
| Task assignment to staff | Tells (or messages) cleaning staff which rooms to do in which order | MEDIUM | Notification dispatch |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Photo-based room inspection logging | Staff takes photo; AI acknowledges and logs | HIGH | Vision model integration |
| Supply reorder alerts | "Shampoo stock is low based on rooms cleaned" — flags to owner | MEDIUM | Consumption tracking per amenity |
| Cleaning time estimation | Predicts how long today's cleaning will take | MEDIUM | Historical data learning |

---

### Role 5: Gelir Yoneticisi (Revenue Manager AI)
**Internal only — owner-facing**

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Occupancy dashboard | Current + next 30/60/90 day fill rates at a glance | MEDIUM | Aggregated from booking data |
| Revenue-per-room reporting | Daily/weekly/monthly RevPAR — industry standard metric | MEDIUM | Calculation layer over booking data |
| Simple pricing recommendations | "Weekends are filling fast — consider raising Friday rate by €15" | HIGH | Demand signal analysis; risky if wrong |
| Seasonal pattern summary | "Last July was your best month — August bookings are currently 40% of that" | MEDIUM | Year-over-year comparison |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Competitor rate monitoring | Scrapes/monitors nearby hotel rates for context | HIGH | Legal gray area; external API or scraping |
| Automated rate adjustment | AI actually changes prices on OTAs without owner action | VERY HIGH | Channel manager write-API + risk of errors |
| Demand event alerts | "There's a local festival next month — rates should increase" | HIGH | External event data integration |

---

### Role 6: Muhasebe Asistani (Finance AI)
**Internal only — owner-facing**

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Daily revenue summary | "Today's revenue: X from Y bookings" — morning briefing | LOW | Aggregation query + formatted message |
| Expense logging via chat | Owner says "spent €200 on cleaning supplies" — AI logs and categorizes | MEDIUM | NLU expense parsing + ledger storage |
| Monthly P&L overview | Revenue vs. expenses vs. previous period | MEDIUM | Report generation from stored data |
| Invoice tracking | Who's been invoiced, who hasn't paid | MEDIUM | Simple AR tracking |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Tax preparation summary | Categorized expenses for accountant, exportable | MEDIUM | Category taxonomy + export format |
| Supplier bill management | Photo of bill → AI parses and logs | HIGH | Vision model + document parsing |
| Cash flow forecast | "Based on upcoming bookings, your next 30 days looks like..." | HIGH | Projection model over booking pipeline |

---

## Platform-Level Features (Cross-Role)

These are not per-employee features but infrastructure the whole system needs.

### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Owner dashboard — team overview | See all AI employees, their status, recent activity | MEDIUM | Activity feed per employee |
| Chat with any AI employee | Owner talks to employees directly — the core UX metaphor | MEDIUM | Per-employee chat threads |
| Employee configuration | Set name, personality, language, working hours | LOW | Editable profile per AI employee |
| Notification system | AI escalates to owner via email/SMS/WhatsApp when it can't handle something | MEDIUM | Webhook + notification provider |
| Hotel knowledge base editor | Owner adds/edits info the AI knows: WiFi, parking, policies, rooms | MEDIUM | RAG document management UI |
| Multi-language interface (EN + TR minimum for v1) | Product needs own UI in owner's language | LOW | i18n on dashboard |
| Subscription & billing management | SaaS fundamentals — can't ship without | MEDIUM | Stripe integration |
| Onboarding wizard | Hotel must configure before any AI can work; guided setup is critical | MEDIUM | Multi-step form populating knowledge base |

### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI employee "performance reports" | "This week your Receptionist handled 47 guest inquiries, 3 escalated" | MEDIUM | Analytics aggregation per employee |
| Employee on/off scheduling | "Receptionist handles WhatsApp 24/7 but Revenue Manager only runs Monday morning" | MEDIUM | Cron schedule per employee |
| Cross-employee collaboration | Booking AI tells Housekeeping when new check-in confirmed | HIGH | Inter-agent message passing |
| White-label / branded guest experience | Hotel's name and logo on guest-facing chat widget | LOW | Theme configuration |
| API webhooks for PMS integration | Connect to existing property management systems | VERY HIGH | Per-PMS integration work |

---

## Guest-Facing vs Internal-Only: Feature Differences

| Dimension | Guest-Facing (Roles 1, 2, 3) | Internal-Only (Roles 4, 5, 6) |
|-----------|------------------------------|-------------------------------|
| Channel | WhatsApp, web chat widget | Owner dashboard chat, email digests |
| Response time requirement | <60 seconds (guest expectation) | Minutes to hours acceptable |
| Tone management | Critical — bad tone = bad review | Less critical; professional is fine |
| Error tolerance | Very low — guest-facing errors are public | Medium — owner can correct before harm |
| Language requirements | Multi-language mandatory | Owner's language only |
| Escalation path | Escalate to hotel staff | Escalate to owner |
| Conversation history | Per-guest (long-term, survives across stays) | Per-session or daily context |
| Privacy sensitivity | HIGH (guest PII) | MEDIUM (business data) |
| Proactive messaging | YES (check-in, checkout, review requests) | YES (daily briefings, alerts) |
| Output format | Natural conversational prose | Can use structured reports, tables |

**Critical distinction:** Guest-facing AI errors cause public damage (bad reviews, guest abandonment). Internal AI errors cause operational friction but are recoverable. Build guest-facing roles with higher guardrails, more conservative defaults, and mandatory human escalation paths.

---

## Anti-Features (Do Not Build)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Fully autonomous booking with payment | Seems efficient | AI errors can double-book, overcharge, create disputes; legal liability | Human confirmation step for payment; AI prepares, human approves |
| Automated public review responses posted by AI | Saves time | One bad AI response goes viral; hotel reputation at stake | AI drafts response, owner approves before posting |
| Automated rate changes pushed to OTAs | Maximum automation | Wrong price change = revenue loss or OTA penalty; difficult to reverse | AI recommends, owner approves with one tap |
| Phone/voice AI reception | Modern feel | Voice AI quality inconsistent; accent handling poor; integration complexity | Text-first; voice is v3+ |
| IoT/smart lock integration | Full automation | Hardware dependency, device failure scenarios, security liability | Scope out; recommend Klevio/Nuki separately |
| Generic "AI assistant" catch-all | Simplifies product | Loses the employee metaphor; becomes just another chatbot | Keep role-specific — each AI has a defined job |
| Social media management | Natural adjacency | Different domain expertise; dilutes focus | Separate product or partner integration |
| Automated email marketing campaigns | Revenue expansion | Spam compliance (GDPR, CAN-SPAM) complexity; not core hotel ops | Manual send + AI content suggestion only |
| Real-time PMS sync (Mews, Cloudbeds, Opera) | Enterprise requirement | Each PMS has different API; massive integration work per target | Manual data entry for v1; webhooks for v2 |

---

## Feature Dependencies

```
[Hotel Knowledge Base]
    └──required by──> [Front Desk AI (Role 1)]
    └──required by──> [Guest Experience AI (Role 3)]
    └──required by──> [Booking AI (Role 2)]

[Booking / Reservation Data]
    └──required by──> [Housekeeping Coordinator (Role 4)]
    └──required by──> [Revenue Manager (Role 5)]
    └──required by──> [Finance AI (Role 6)]

[WhatsApp/Chat Integration]
    └──required by──> [Front Desk AI (Role 1)]
    └──required by──> [Booking AI (Role 2)]  [guest-facing portion]
    └──required by──> [Guest Experience AI (Role 3)]

[Notification System]
    └──required by──> ALL ROLES  [escalation path]

[Guest Profile / Conversation History]
    └──required by──> [Front Desk AI]
    └──enhances──> [Guest Experience AI]  [personalization]

[Stripe / Billing]
    └──required by──> [Platform Subscription]
    └──independent of──> [All AI Roles]  [build separately]

[Revenue Manager (Role 5)] ──enhances──> [Booking AI (Role 2)]
    (pricing signals inform what Booking AI quotes)

[Housekeeping (Role 4)] ──feeds──> [Front Desk AI (Role 1)]
    (room readiness status informs check-in responses)

[Finance AI (Role 6)] ──consumes──> [Booking Revenue Data from Role 2]
    (booking confirmations become revenue entries)
```

### Critical Dependency Chain for MVP
```
Onboarding Wizard
    → Hotel Knowledge Base populated
        → Front Desk AI can respond meaningfully
            → Guest satisfaction loop begins
                → Revenue tracking data available
                    → Revenue Manager AI has data to analyze
```

---

## Competitor Feature Analysis

Note: Research conducted from training knowledge (cutoff Aug 2025). Web verification blocked. Treat competitor details as MEDIUM confidence — validate before positioning decisions.

| Competitor | Type | Key Features | Weakness OtelAI Exploits |
|------------|------|--------------|--------------------------|
| **Asksuite** | Hotel chatbot + booking | Web chatbot, booking integration, WhatsApp, multi-language | Dashboard-centric, not employee metaphor; enterprise focus |
| **Quicktext** | Hotel AI messaging | WhatsApp/SMS, upselling, guest messaging automation | No "virtual team" concept; more tool than colleague |
| **Cloudbeds Amplify** | PMS-attached AI | Integrated with Cloudbeds PMS, messaging, revenue | Tied to Cloudbeds PMS; boutique hotels may not use it |
| **HiJiffy** | Guest comms AI | Multi-channel (WhatsApp, Instagram, web), booking, FAQ | No operational/internal roles; only guest-facing |
| **Apaleo / Mews** | PMS with AI features | Full PMS + AI automation built-in | Too complex, expensive, full system replacement |
| **Chekin** | Digital check-in | Online check-in, ID verification, payment | Single-purpose; not a staff platform |

**Gap OtelAI fills:** No competitor presents AI as a "virtual team member with a role." All present as tools, widgets, or modules. The employee metaphor — and the combination of guest-facing + internal roles in one "team" — is the differentiated position.

---

## MVP Definition

### Launch With (v1) — Validate the Core Concept

These features together constitute a complete loop: hotel configures AI → guests interact → owner sees it working.

- [ ] **Role 1: Front Desk AI** — 24/7 WhatsApp + web chat with FAQ, escalation, multi-language (EN + TR + 1 European language)
- [ ] **Role 3: Guest Experience AI** — Pre-arrival, checkout reminder, post-stay review request (milestone-triggered messages)
- [ ] **Hotel Knowledge Base** — Owner-editable FAQs, room descriptions, local recommendations; feeds both Role 1 and 3
- [ ] **Owner Dashboard** — Chat with AI employees, view conversation history, notification inbox for escalations
- [ ] **Onboarding Wizard** — Guided setup that populates knowledge base and configures first two employees
- [ ] **WhatsApp Business API integration** — The primary guest channel; must work reliably
- [ ] **Escalation system** — Any unhandled request notifies owner via email/SMS within 2 minutes
- [ ] **Stripe subscription** — Monthly billing; per-employee or tiered plan

### Add After Validation (v1.x)
- [ ] **Role 2: Booking AI** (inquiry handling) — Trigger: "guests are asking for availability over WhatsApp"
- [ ] **Role 4: Housekeeping Coordinator** — Trigger: hotel owner requests internal operational tool
- [ ] **Guest sentiment tracking** — Trigger: owner wants proactive review risk management
- [ ] **Employee performance analytics** — Trigger: owner asks "is this working?"
- [ ] **Second European language** (DE or FR) — Trigger: market expansion signal

### Future Consideration (v2+)
- [ ] **Role 5: Revenue Manager AI** — Requires 3+ months of booking data to be useful; defer
- [ ] **Role 6: Finance AI** — Requires accounting integration research; complex compliance
- [ ] **Direct booking with payment** — Requires payment flow design + legal review
- [ ] **Cross-employee collaboration / inter-agent messaging** — Architecture complexity; validate simpler version first
- [ ] **PMS integration (Mews, Cloudbeds)** — High per-customer integration cost; wait for demand signal
- [ ] **API webhooks** — Defer until hotels have existing systems to connect
- [ ] **Competitor rate monitoring** — Legal and technical complexity; v2+ feature

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Front Desk AI (WhatsApp + FAQ) | HIGH | MEDIUM | P1 |
| Guest Experience AI (milestone messages) | HIGH | LOW | P1 |
| Hotel Knowledge Base editor | HIGH | MEDIUM | P1 |
| Owner dashboard + employee chat | HIGH | MEDIUM | P1 |
| Onboarding wizard | HIGH | MEDIUM | P1 |
| WhatsApp Business API | HIGH | MEDIUM | P1 |
| Escalation notifications | HIGH | LOW | P1 |
| Stripe subscription | MEDIUM | MEDIUM | P1 |
| Multi-language (EN+TR+1 EU) | HIGH | LOW | P1 |
| Booking AI (inquiry handling) | HIGH | HIGH | P2 |
| Housekeeping Coordinator | MEDIUM | MEDIUM | P2 |
| Guest sentiment tracking | MEDIUM | HIGH | P2 |
| Performance analytics | MEDIUM | MEDIUM | P2 |
| Revenue Manager AI | HIGH | VERY HIGH | P3 |
| Finance AI | MEDIUM | HIGH | P3 |
| Direct booking + payment | HIGH | VERY HIGH | P3 |
| PMS integration | MEDIUM | VERY HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Sources

- Project context: `/home/cagr/Masaüstü/otel-ai/.planning/PROJECT.md`
- Domain knowledge: Hotel operations patterns (training data, cutoff Aug 2025) — MEDIUM confidence
- Competitor knowledge: Asksuite, Quicktext, HiJiffy, Cloudbeds, Apaleo, Chekin — MEDIUM confidence (training data, web verification blocked)
- WhatsApp Business API patterns — MEDIUM confidence (training data)
- AI agent pattern research — MEDIUM confidence (training data + industry knowledge)

**Validation needed:** All competitor feature claims should be validated by visiting their official documentation. Web research was blocked during this session. Pricing, specific feature availability, and API capabilities of competitors may have changed since Aug 2025.

---
*Feature research for: OtelAI — AI Virtual Hotel Staff SaaS*
*Researched: 2026-03-01*
*Confidence: MEDIUM (web research unavailable; training knowledge applied)*
