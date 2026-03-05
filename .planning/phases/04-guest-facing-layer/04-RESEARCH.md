# Phase 4: Guest-Facing Layer - Research

**Researched:** 2026-03-05
**Domain:** WhatsApp Business API (Twilio), embeddable web chat widget, next-intl i18n, rate limiting (Upstash), prompt injection protection, escalation notifications
**Confidence:** HIGH (core stack verified via npm + official docs; Twilio webhook pattern verified; next-intl 4.x docs verified; Upstash ratelimit docs verified)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DESK-02 | Guests can chat with Front Desk AI via WhatsApp | Twilio WhatsApp Business API webhook + message routing to `invokeAgent()`; 24-hour customer service window allows free-form replies; `twilio` npm v5.12.2 |
| DESK-03 | Guests can chat with Front Desk AI via embeddable web chat widget | Embeddable `<script>` snippet with hotel token; iframe or React SPA served from Next.js; Supabase Realtime Broadcast for delivery |
| DESK-04 | Front Desk AI answers hotel FAQs using hotel knowledge base | Already implemented — `assembleContext.ts` loads `hotel_facts` + `rooms` tables; Phase 3 delivered knowledge base; zero new agent work required |
| DESK-05 | Front Desk AI communicates in guest's language (EN, TR + 1 EU language minimum) | Claude language detection already in `agentFactory.ts` MULTILINGUAL SUPPORT behavioral block; verified against Anthropic docs (96-98% parity across languages) |
| DESK-06 | Front Desk AI escalates unhandled requests to hotel owner within 2 minutes | Supabase Database Webhook + pg_net HTTP POST to `/api/escalations` endpoint; Resend email already configured in project (RESEND_API_KEY in env) |
| DESK-07 | Front Desk AI maintains conversation context across multiple messages | Already implemented — `conversation_turns` table + `loadConversationTurns()` in `memory.ts`; guest conversations use unique `conversation_id` |
| WHAP-01 | WhatsApp Business API connection via gateway provider (Twilio/MessageBird) | **Twilio recommended** — transparent pay-as-you-go ($0.005/message platform fee + Meta rates), Node.js SDK mature (`twilio` v5.12.2), webhook validation built-in |
| WHAP-02 | Incoming guest messages routed to correct AI employee based on context | Webhook handler reads `From` (guest phone), resolves `hotel_id` from Twilio number mapping table, calls `invokeAgent()` with `AgentRole.FRONT_DESK` |
| WHAP-03 | AI responses sent back to guest via WhatsApp | `client.messages.create({ from: 'whatsapp:+1...', to: 'whatsapp:+guest', body: response })` within 24-hour session window |
| WHAP-04 | Conversation history persisted and viewable in owner dashboard | WhatsApp turns persist to `conversation_turns` same as web chat; dashboard queries by `conversation_id` |
| CHAT-01 | Embeddable web chat widget for hotel website | Standalone React app served at `/widget/[token]` or iframe-embeddable; hotel adds `<script>` tag to their site |
| CHAT-02 | Widget identifies hotel via token (no guest auth required) | Short-lived or permanent hotel widget token stored in `hotels` table; widget sends token on every request; server resolves `hotel_id` from token |
| CHAT-03 | Real-time message delivery via Supabase Realtime (client-direct) | Supabase Realtime Broadcast with anon key + channel topic scoped to conversation_id; public channel mode for anonymous guests |
| CHAT-04 | Widget supports hotel branding (colors, logo, welcome message) | `hotels` table extended with `widget_config` JSONB column; widget fetches config at init by hotel token |
| I18N-01 | Owner dashboard available in EN and TR | `next-intl` v4.8.3 without URL routing (cookie-based locale); messages in `messages/en.json` and `messages/tr.json` |
| I18N-02 | AI employees respond in guest's detected language | Already implemented in `agentFactory.ts` MULTILINGUAL SUPPORT behavioral block |
| I18N-03 | next-intl integration with Server Component support | `next-intl` v4.8.3 — `getTranslations()` for Server Components, `useTranslations()` for Client Components, `NextIntlClientProvider` wraps app |
| I18N-04 | Hotel knowledge base content servable in multiple languages | Claude translates at query time (Phase 3 decision KNOW-05 confirmed) — no schema change required |
| SAFE-04 | Rate limiting per hotel and per guest IP | `@upstash/ratelimit` v2.0.8 + `@upstash/redis` v1.36.3; sliding window per IP for public endpoints; fixed window per hotel_id for WhatsApp |
| SAFE-05 | Prompt injection protection on all guest-facing inputs | Input validation layer before `invokeAgent()`: strip injection patterns, length cap, Unicode normalization; structural defense via XML-tagged prompt sections already in place |
</phase_requirements>

---

## Summary

Phase 4 builds the two guest-facing channels (WhatsApp via Twilio and an embeddable web widget) on top of the agent core established in Phases 2-3. The `invokeAgent()` function already handles multi-turn context, multilingual responses, and knowledge base access — this phase is primarily about **channel integration** rather than agent changes.

**WhatsApp** uses Twilio's Programmable Messaging API. The integration is a webhook handler at `/api/whatsapp/webhook` that receives Twilio's `application/x-www-form-urlencoded` POST, validates the `X-Twilio-Signature`, resolves the hotel from the incoming Twilio number, calls `invokeAgent()`, and sends the response back via `client.messages.create()`. The 24-hour customer service window allows free-form replies; no WhatsApp message templates are required for reactive conversations.

**The embeddable widget** is served from Next.js and embedded via an `<iframe>` or `<script>` tag. Hotels identify themselves via a `widget_token` column in the `hotels` table — no guest authentication is required. Real-time delivery uses Supabase Realtime Broadcast on a public channel scoped to the conversation ID. The AI response is triggered from a Next.js API route (using the existing SSE pattern for widget-internal streaming), and a Realtime Broadcast event delivers the completed response to the widget.

**Security** is layered: `@upstash/ratelimit` handles per-IP rate limiting in Next.js middleware and per-hotel rate limiting at API route level; prompt injection protection is applied as a pre-processing step before any guest input reaches `invokeAgent()`. **Escalation** uses Supabase Database Webhooks (pg_net) to detect unhandled requests and fire an HTTP POST to a notification endpoint that sends email via the already-configured Resend integration.

**Primary recommendation:** Implement the WhatsApp webhook first (simplest channel, no frontend), validate the full pipeline end-to-end, then build the widget. Keep the widget stateless — no guest accounts, no persistent sessions beyond the current page load.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `twilio` | 5.12.2 | WhatsApp Business API — send/receive messages, webhook validation | Official Twilio Node.js SDK; `validateRequest()` handles `X-Twilio-Signature` verification; mature, well-documented |
| `next-intl` | 4.8.3 | Dashboard i18n (EN/TR) — Server Component support, cookie-based locale | Purpose-built for Next.js App Router; `getTranslations()` async server-side API; v4 is current stable |
| `@upstash/ratelimit` | 2.0.8 | Per-IP and per-hotel rate limiting | HTTP-based (connectionless), works in both Node.js and Edge runtimes; sliding window + token bucket algorithms |
| `@upstash/redis` | 1.36.3 | Redis client for Upstash (required by ratelimit) | HTTP-based Redis; works on Vercel serverless without persistent connections |
| `resend` | 6.9.3 | Transactional email for escalation notifications | Already configured in project (`RESEND_API_KEY` in env); `{ data, error }` API pattern consistent with project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | ^2.98.0 (already installed) | Supabase Realtime Broadcast for widget delivery | Widget subscribes to public Broadcast channel with anon key |
| `zod` | ^4.3.6 (already installed) | Validate webhook payloads and widget API request bodies | Validate Twilio webhook fields; validate widget message body |
| `twilio` (existing `validateRequest`) | 5.12.2 | Webhook signature validation | Import `validateRequest` from `twilio` package directly |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Twilio WhatsApp | MessageBird/Bird | Both add $0.005/msg; Twilio has more mature Node.js SDK and clearer documentation; MessageBird now plan-based pricing less predictable for early-stage |
| Upstash Ratelimit | Custom Redis rate limiter | Upstash is HTTP-based, works in serverless without connection pooling; custom Redis requires persistent connection or connection management |
| Supabase Realtime Broadcast | WebSockets (custom) | Realtime Broadcast is already available via `@supabase/supabase-js`; zero additional infrastructure |
| Supabase Realtime Broadcast | Polling `/api/widget/messages` | Realtime has lower latency; polling adds server load and 1-5s delay |
| Resend for escalation email | SendGrid | Resend already configured in project; consistent dev experience |
| next-intl without URL routing | next-intl with `[locale]` segment | URL routing changes current route structure significantly; cookie-based locale avoids restructuring `(dashboard)` route group |

**Installation:**
```bash
pnpm add twilio next-intl @upstash/ratelimit @upstash/redis resend
```
Note: `resend` is already installed in `spplymarkt` project env but **not in this project** — must be added. Verify with `cat package.json | grep resend`.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── api/
│   │   ├── whatsapp/
│   │   │   └── webhook/
│   │   │       └── route.ts      # POST — Twilio webhook handler
│   │   ├── widget/
│   │   │   ├── session/
│   │   │   │   └── route.ts      # POST — create widget session, returns conversation_id
│   │   │   └── message/
│   │   │       └── route.ts      # POST — receive widget message, invoke agent, broadcast via Realtime
│   │   └── escalations/
│   │       └── route.ts          # POST — internal endpoint triggered by DB webhook
│   └── widget/
│       └── [token]/
│           └── page.tsx          # Embeddable widget page (iframe target)
├── components/
│   └── widget/
│       ├── ChatWidget.tsx         # Client component — widget UI (anonymous, no auth)
│       └── EmbedScript.tsx        # <script> snippet generator for hotel website
├── i18n/
│   └── request.ts                 # next-intl locale resolution (cookie-based)
├── messages/
│   ├── en.json                    # Dashboard EN translations
│   └── tr.json                    # Dashboard TR translations
└── middleware.ts                  # Rate limiting (per IP) + next-intl (updated)
```

### Pattern 1: Twilio WhatsApp Webhook Handler

**What:** Route Handler that validates Twilio's signature, resolves hotel from Twilio number, calls `invokeAgent()`, and sends the WhatsApp reply.

**Critical constraint:** Twilio requires webhook responses within 15 seconds. `invokeAgent()` must complete within this window. For longer Claude responses, respond with 200 immediately and send the reply asynchronously — but Twilio's TwiML response approach can be used for direct inline replies.

**When to use:** Receive all incoming WhatsApp messages from guests.

**Example:**
```typescript
// src/app/api/whatsapp/webhook/route.ts
import twilio from 'twilio';
import { invokeAgent } from '@/lib/agents/invokeAgent';
import { AgentRole } from '@/lib/agents/types';

export const runtime = 'nodejs'; // Not Edge — needs cookie auth and full Node.js APIs
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  // Step 1: Read raw body for signature validation
  // Twilio sends application/x-www-form-urlencoded
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // Step 2: Validate Twilio signature
  const signature = req.headers.get('x-twilio-signature') ?? '';
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`;

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    params,
  );

  if (!isValid) {
    return new Response('Forbidden', { status: 403 });
  }

  // Step 3: Extract message fields
  const from = params['From']; // 'whatsapp:+905551234567'
  const body = params['Body'];
  const toNumber = params['To']; // Your Twilio WhatsApp number

  // Step 4: Resolve hotel from Twilio number
  // hotel_whatsapp_numbers table: { twilio_number, hotel_id }
  const hotelId = await resolveHotelFromNumber(toNumber);
  if (!hotelId) return new Response('Not found', { status: 404 });

  // Step 5: Sanitize input (injection protection)
  const sanitizedBody = sanitizeGuestInput(body);

  // Step 6: Derive conversation_id from guest phone + hotel
  const guestPhone = from.replace('whatsapp:', '');
  const conversationId = `wa_${hotelId}_${guestPhone}`;

  // Step 7: Invoke agent (not streaming — WhatsApp needs full response)
  const response = await invokeAgent({
    role: AgentRole.FRONT_DESK,
    userMessage: sanitizedBody,
    conversationId,
    hotelId,
    // No onToken callback — WhatsApp needs full message
  });

  // Step 8: Send reply via Twilio
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: toNumber,
    to: from,
    body: response,
  });

  // Step 9: Return 200 (Twilio needs acknowledgment)
  return new Response('', { status: 200 });
}
```

### Pattern 2: Widget Session + Message API

**What:** Two API routes for the widget. `/api/widget/session` creates a conversation session (returns `conversation_id` + Supabase channel name). `/api/widget/message` receives a guest message, calls `invokeAgent()`, then broadcasts the response via Supabase Realtime.

**When to use:** Widget guest sends a message.

**Example:**
```typescript
// src/app/api/widget/session/route.ts
export async function POST(req: Request): Promise<Response> {
  const { token } = await req.json();

  // Resolve hotel from widget token (anonymous — no auth)
  const supabase = createServiceClient(); // service role for hotel lookup
  const { data: hotel } = await supabase
    .from('hotels')
    .select('id, name, widget_config')
    .eq('widget_token', token)
    .single();

  if (!hotel) return Response.json({ error: 'Invalid token' }, { status: 404 });

  // Generate conversation_id for this widget session
  const conversationId = `widget_${hotel.id}_${crypto.randomUUID()}`;

  return Response.json({
    conversationId,
    hotelId: hotel.id,
    hotelName: hotel.name,
    widgetConfig: hotel.widget_config,
    // Supabase channel the widget should subscribe to for receiving responses
    channel: `widget_responses:${conversationId}`,
  });
}

// src/app/api/widget/message/route.ts
export async function POST(req: Request): Promise<Response> {
  const { message, conversationId, hotelId } = await req.json();

  const sanitized = sanitizeGuestInput(message);

  // Invoke agent (non-streaming — response delivered via Supabase Realtime)
  const response = await invokeAgent({
    role: AgentRole.FRONT_DESK,
    userMessage: sanitized,
    conversationId,
    hotelId,
  });

  // Broadcast response to widget via Supabase Realtime
  const supabase = createServiceClient();
  await supabase.channel(`widget_responses:${conversationId}`).send({
    type: 'broadcast',
    event: 'message',
    payload: { role: 'assistant', content: response },
  });

  return Response.json({ ok: true });
}
```

### Pattern 3: Widget Supabase Realtime Subscription

**What:** Widget client subscribes to a Supabase Broadcast channel with anon key. No auth required for public channels.

**When to use:** Widget UI — subscribe on mount, unsubscribe on unmount.

**Example:**
```typescript
// Widget client component
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// In useEffect:
const channel = supabase.channel(`widget_responses:${conversationId}`)
  .on('broadcast', { event: 'message' }, ({ payload }) => {
    setMessages(prev => [...prev, payload]);
  })
  .subscribe();

// Cleanup:
return () => { supabase.removeChannel(channel); };
```

**Security note:** Public Supabase Broadcast channels require "Allow public access" to be enabled in Realtime Settings, OR use `private: false` channel with `anon` key. The `conversation_id` acts as a random unguessable channel name — similar to a shareable link. This is sufficient for Phase 4; RLS-enforced private channels can be added in a later hardening phase.

### Pattern 4: Rate Limiting Middleware

**What:** Two-layer rate limiting:
1. **Per-IP** in Next.js middleware (for public endpoints: `/api/widget/*`, `/api/whatsapp/*`)
2. **Per-hotel** in API route handlers (prevent one hotel from consuming all quota)

**Example:**
```typescript
// src/middleware.ts — extended with rate limiting
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Per-IP: 30 requests per minute on guest-facing endpoints
const ipLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '60 s'),
  prefix: 'rl:ip',
});

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Apply rate limiting to guest-facing API routes only
  if (pathname.startsWith('/api/widget') || pathname.startsWith('/api/whatsapp')) {
    const ip = req.ip ?? req.headers.get('x-forwarded-for') ?? '127.0.0.1';
    const { success } = await ipLimiter.limit(ip);

    if (!success) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
  }

  // next-intl locale detection for dashboard routes
  const intlMiddleware = createMiddleware({
    locales: ['en', 'tr'],
    defaultLocale: 'en',
  });

  return intlMiddleware(req);
}

export const config = {
  matcher: [
    '/api/widget/:path*',
    '/api/whatsapp/:path*',
    '/(dashboard)/:path*',
  ],
};
```

**Per-hotel rate limiting in API routes:**
```typescript
// Inside /api/widget/message route
const hotelLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(100, '60 s'), // 100 msgs/min per hotel
  prefix: 'rl:hotel',
});

const { success } = await hotelLimiter.limit(hotelId);
if (!success) return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });
```

### Pattern 5: Prompt Injection Protection

**What:** A sanitization function that runs on all guest inputs before they reach `invokeAgent()`. Based on OWASP LLM01:2025 guidance.

**Defense approach:** Structural (Claude sees user input in a clearly-labeled XML section) + input validation (block known injection patterns).

**Example:**
```typescript
// src/lib/security/sanitizeGuestInput.ts

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /you\s+are\s+now\s+(in\s+)?developer\s+mode/i,
  /forget\s+(everything|all|your)\s+(you\s+)?(know|were\s+told)/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<\|system\|>/i,
  /act\s+as\s+if\s+you\s+(have\s+no|are\s+not)/i,
  /jailbreak/i,
];

const MAX_INPUT_LENGTH = 2000; // characters

export function sanitizeGuestInput(input: string): string {
  if (!input || typeof input !== 'string') return '';

  // 1. Length cap
  let sanitized = input.slice(0, MAX_INPUT_LENGTH);

  // 2. Normalize Unicode (prevent invisible character attacks)
  sanitized = sanitized.normalize('NFC');

  // 3. Remove null bytes and other control characters (keep newlines/tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 4. Check for known injection patterns (block rather than strip — preserves human errors)
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      // Return safe fallback — do not reveal why it was blocked
      return '[Message could not be processed. Please rephrase your question.]';
    }
  }

  return sanitized.trim();
}
```

**Structural defense** (already in place in Phase 2): The system prompt uses XML-tagged sections (`<instructions>`, `<hotel_context>`, etc.). User input is appended as `{ role: 'user', content: sanitized }` — a separate message, not interpolated into the system prompt. This structural separation is the primary defense; the pattern-matching is a secondary layer.

### Pattern 6: next-intl Setup (Without URL Routing)

**What:** next-intl v4.8.3 configured without URL routing (no `[locale]` segment). Locale read from cookie. Dashboard gets EN/TR without restructuring route groups.

**Why without URL routing:** The current `(dashboard)` route group structure would require adding a `[locale]` segment, which would break all existing page routes. Cookie-based locale avoids this.

**Files:**
```typescript
// src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = cookieStore.get('NEXT_LOCALE')?.value ?? 'en';
  const validLocales = ['en', 'tr'];
  const resolvedLocale = validLocales.includes(locale) ? locale : 'en';

  return {
    locale: resolvedLocale,
    messages: (await import(`../../messages/${resolvedLocale}.json`)).default,
  };
});
```

```typescript
// next.config.ts — wrap with next-intl plugin
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
export default withNextIntl({
  // existing config
});
```

```typescript
// src/app/layout.tsx — wrap with provider
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

export default async function RootLayout({ children }) {
  const messages = await getMessages();
  return (
    <html>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

```typescript
// Usage in Server Component:
import { getTranslations } from 'next-intl/server';
const t = await getTranslations('Dashboard');
return <h1>{t('title')}</h1>;

// Usage in Client Component:
import { useTranslations } from 'next-intl';
const t = useTranslations('Dashboard');
return <button>{t('sendMessage')}</button>;
```

### Pattern 7: Escalation Detection and Notification

**What:** Detect when a guest conversation turn is unhandled (e.g., agent uses a fallback phrase like "please contact reception directly"). Send in-app + email notification to hotel owner within 2 minutes.

**Implementation approach:** An `escalations` table is polled by a Supabase Database Webhook (pg_net) that fires on INSERT to call `/api/escalations`. Alternatively, detect escalation signals inside `invokeAgent()` and INSERT to `escalations` table directly.

**Schema:**
```sql
CREATE TABLE public.escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp', 'widget')),
  guest_message   TEXT NOT NULL,       -- The message that triggered escalation
  agent_response  TEXT,                -- What agent said before escalating
  notified_at     TIMESTAMPTZ,         -- Set when notification sent
  resolved_at     TIMESTAMPTZ,         -- Set when owner marks resolved
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Escalation detection in `invokeAgent()`:**
```typescript
// After getting agent response, check for escalation signals
const ESCALATION_PHRASES = [
  'please contact reception',
  'please call us directly',
  'i cannot help with this',
  'outside my capabilities',
  'please speak with a staff member',
];

const needsEscalation = ESCALATION_PHRASES.some(phrase =>
  response.toLowerCase().includes(phrase)
);

if (needsEscalation) {
  // INSERT to escalations table — DB webhook fires within seconds
  await supabase.from('escalations').insert({
    hotel_id: params.hotelId,
    conversation_id: params.conversationId,
    channel: params.channel ?? 'widget',
    guest_message: params.userMessage,
    agent_response: response,
  });
}
```

**Notification endpoint** (`/api/escalations`):
```typescript
// Called by Supabase DB webhook on escalations INSERT
export async function POST(req: Request) {
  const { record } = await req.json(); // Supabase DB webhook payload

  // Get hotel owner email
  const { data: hotel } = await supabase
    .from('hotels')
    .select('name, contact_email')
    .eq('id', record.hotel_id)
    .single();

  // Send email via Resend
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: hotel.contact_email!,
    subject: `[${hotel.name}] Guest needs assistance`,
    react: EscalationEmailTemplate({ hotel, record }),
  });

  return Response.json({ ok: true });
}
```

### Anti-Patterns to Avoid

- **Streaming SSE to WhatsApp:** WhatsApp's API expects a single complete message. Do not use the SSE pattern for WhatsApp responses — call `invokeAgent()` without `onToken` and send the full response.
- **Putting `next-intl` middleware before rate limiting:** Middleware order matters. Run rate limiting first (fail fast); only then run i18n processing.
- **Trusting `req.ip` on Vercel without fallback:** On Vercel, the real IP may be in `x-forwarded-for`. Always `req.ip ?? req.headers.get('x-forwarded-for') ?? '127.0.0.1'`.
- **Using service_role key in browser widget:** Widget must use `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser clients.
- **Parsing Twilio webhook body with `req.json()`:** Twilio sends `application/x-www-form-urlencoded`, not JSON. Use `req.text()` then `new URLSearchParams(rawBody)`.
- **Bypassing signature validation in development:** Always validate `X-Twilio-Signature`. Use ngrok for local development to get a real public URL; Twilio cannot reach `localhost`.
- **Blocking on escalation notification in agent flow:** INSERT to `escalations` table and let the DB webhook handle notification asynchronously. Do not `await resend.emails.send()` inside `invokeAgent()`.
- **One Upstash Redis instance for both rate limit namespaces:** Use `prefix` option to namespace keys (`rl:ip`, `rl:hotel`) within the same Redis instance.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WhatsApp signature validation | HMAC-SHA1 from scratch | `twilio.validateRequest()` from `twilio` npm | Handles edge cases (URL encoding, parameter sorting, SSL termination) |
| Rate limiting state | In-memory counter (Map) | `@upstash/ratelimit` + Redis | Vercel serverless: no shared in-memory state between instances; Redis persists across cold starts |
| i18n string management | Custom translation context | `next-intl` | Server Component support, TypeScript type safety, ICU message format, cookie locale |
| Widget WebSocket/SSE | Custom WebSocket server | Supabase Realtime Broadcast | Already available via `@supabase/supabase-js`; no WebSocket server required on Vercel |
| Email formatting | Plain text emails | `resend` + React Email component | HTML emails with template components; delivery tracking; Resend already configured |
| Injection detection | Regex only | Regex + structural XML separation | Regex alone is insufficient; structural separation (user message as separate message, not injected into system prompt) is the primary defense |

**Key insight:** The hardest problems in this phase (message delivery guarantees, rate limiting at scale, i18n with Server Components) are already solved by well-maintained libraries. The custom work is wiring: resolving hotel_id from tokens/phone numbers, calling `invokeAgent()`, and routing responses back to the correct channel.

---

## Common Pitfalls

### Pitfall 1: Twilio Webhook 15-Second Timeout
**What goes wrong:** Twilio marks the webhook as failed and retries if your handler doesn't respond within 15 seconds. Claude responses can take 10-30 seconds for complex queries.
**Why it happens:** `invokeAgent()` assembles context from DB + calls Claude API — full round-trip can exceed 15s.
**How to avoid:** For most queries, 15 seconds is sufficient with claude-opus-4-6. But add a timeout safety valve: respond 200 to Twilio immediately, then send the WhatsApp reply asynchronously via `client.messages.create()`. Use `waitUntil()` (Vercel serverless) or a separate async task.
**Warning signs:** Twilio Console shows webhook delivery failures; guest receives duplicate replies (Twilio retry).

```typescript
// Using Vercel's waitUntil for async reply:
import { waitUntil } from '@vercel/functions';

// Respond to Twilio immediately
waitUntil(
  invokeAgent({ ... }).then(response =>
    twilioClient.messages.create({ from, to, body: response })
  )
);
return new Response('', { status: 200 });
```

### Pitfall 2: Twilio Body Parsing with req.json()
**What goes wrong:** Webhook handler throws JSON parse error; `params` is empty.
**Why it happens:** Twilio sends `Content-Type: application/x-www-form-urlencoded`, not JSON.
**How to avoid:** Use `req.text()` then `Object.fromEntries(new URLSearchParams(rawBody))`.
**Warning signs:** 500 error on all WhatsApp messages; `params.Body` is `undefined`.

### Pitfall 3: Supabase Realtime Public Channel and CORS
**What goes wrong:** Widget on `hotel.com` domain cannot connect to Supabase Realtime; CORS errors in browser.
**Why it happens:** Supabase Realtime uses WebSockets which are not subject to CORS in the same way as HTTP, but the initial HTTP handshake may be blocked if the domain isn't allowed.
**How to avoid:** Supabase Realtime WebSocket connections are allowed from any origin by default with anon key. If issues arise, check Supabase project Auth settings > Allowed origins. Widget iframe served from your domain (`yourdomain.com/widget/[token]`) — Supabase sees requests from `yourdomain.com`, not the hotel's domain.
**Warning signs:** Widget loads but never receives messages; browser console shows WebSocket handshake failure.

### Pitfall 4: next-intl Middleware Conflicts
**What goes wrong:** next-intl middleware redirects API routes or interferes with widget routes.
**Why it happens:** Default `matcher` in next-intl middleware config is too broad.
**How to avoid:** Explicitly configure `matcher` to exclude `/api/*` routes and widget routes. The rate limiting check must run before the i18n middleware.

```typescript
export const config = {
  matcher: [
    // Only match dashboard routes for i18n
    '/((?!api|widget|_next|favicon.ico).*)',
  ],
};
```

### Pitfall 5: Widget Token Security
**What goes wrong:** Hotel's widget token is exposed in page source; attacker sends messages that appear to come from any hotel.
**Why it happens:** Token is in the `<script>` tag or iframe URL — publicly visible.
**How to avoid:** This is by design — the token identifies the hotel, not authenticates the guest. The token is analogous to a public API key. What matters is rate limiting per token and preventing the token from accessing other hotels' data. The token only allows reading that hotel's `widget_config` and sending messages to that hotel's agent.
**Warning signs:** N/A — token exposure is expected. Rate limiting is the guard.

### Pitfall 6: Supabase DB Webhook Not Firing Within 2 Minutes
**What goes wrong:** Escalation notification arrives late (>2 minutes after INSERT).
**Why it happens:** pg_net is asynchronous and subject to Supabase instance queue. Heavy DB load can delay webhook execution.
**How to avoid:** Insert escalation record AND set `notified_at` in a single transaction. Have the API endpoint re-query escalations older than 2 minutes as a fallback polling job via a cron route (`/api/cron/escalations`). Vercel Cron can run every minute.
**Warning signs:** Escalation emails delayed; `escalations.notified_at` is NULL long after `created_at`.

### Pitfall 7: Rate Limiter Cold Start — Upstash Connection
**What goes wrong:** First request after cold start fails; `@upstash/redis` throws connection error.
**Why it happens:** `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` not set.
**How to avoid:** Add env var check at startup; fail gracefully (log + pass through) rather than blocking requests if Redis is unavailable. Rate limiting failures should not bring down the primary flow.

---

## Code Examples

Verified patterns from official sources:

### Twilio WhatsApp Signature Validation
```typescript
// Source: https://www.twilio.com/en-us/blog/how-to-secure-twilio-webhook-urls-in-nodejs
import twilio from 'twilio';

const rawBody = await req.text();
const params = Object.fromEntries(new URLSearchParams(rawBody));

const isValid = twilio.validateRequest(
  process.env.TWILIO_AUTH_TOKEN!,
  req.headers.get('x-twilio-signature') ?? '',
  `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`,
  params,
);

if (!isValid) {
  return new Response('Forbidden', { status: 403 });
}
```

### Send WhatsApp Reply
```typescript
// Source: https://www.twilio.com/docs/whatsapp/api
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

await client.messages.create({
  from: 'whatsapp:+14155238886', // Your Twilio WhatsApp number
  to: 'whatsapp:+905551234567', // Guest's phone number
  body: agentResponse,
});
```

### Upstash Rate Limiting (Sliding Window)
```typescript
// Source: https://upstash.com/blog/edge-rate-limiting
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '60 s'),
  prefix: 'rl:ip',
});

const ip = request.ip ?? request.headers.get('x-forwarded-for') ?? '127.0.0.1';
const { success, limit, remaining } = await ratelimit.limit(ip);

if (!success) {
  return new NextResponse('Too Many Requests', { status: 429 });
}
```

### next-intl Server Component Usage
```typescript
// Source: https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing
import { getTranslations } from 'next-intl/server';

export default async function DashboardPage() {
  const t = await getTranslations('Dashboard');
  return (
    <div>
      <h1>{t('title')}</h1>
      <p>{t('welcome')}</p>
    </div>
  );
}
```

### Supabase Realtime Broadcast from Server
```typescript
// Source: https://supabase.com/docs/guides/realtime/broadcast
// Server-side broadcast (widget message delivery)
const supabase = createServiceClient(); // service_role for server-to-client push

await supabase.channel(`widget_responses:${conversationId}`)
  .send({
    type: 'broadcast',
    event: 'message',
    payload: { role: 'assistant', content: response },
  });
```

### Resend Escalation Email
```typescript
// Source: https://resend.com/docs/send-with-nextjs
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: process.env.RESEND_FROM_EMAIL!,
  to: hotelOwnerEmail,
  subject: `[${hotelName}] Guest needs assistance`,
  react: EscalationEmailTemplate({ guestMessage, conversationId }),
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WhatsApp Business API direct (Meta) | Via BSP (Twilio/MessageBird) | Ongoing | Meta requires BSP onboarding; direct API requires Meta Business verification which takes weeks |
| next-intl with `[locale]` URL segments | next-intl without URL routing (cookies) | next-intl v3+ | Cookie-based mode avoids restructuring existing route groups; suitable for dashboards where SEO on translated pages is not critical |
| next-intl v3 manual `NextIntlClientProvider` | next-intl v4 auto-inherits server config | next-intl 4.0 | Reduced boilerplate; provider required but messages auto-propagated |
| Per-request Redis connection (ioredis) | HTTP-based Upstash Redis | 2022+ | HTTP-based works in serverless without connection pooling overhead |
| Manual HMAC signature validation | `twilio.validateRequest()` | Twilio SDK v4+ | Handles URL encoding edge cases, parameter sorting |
| EventSource (GET-only SSE) for widget | Supabase Realtime Broadcast (WebSocket) | Supabase 2023+ | Bidirectional, works without Express WebSocket server, auth-aware |

**Deprecated/outdated:**
- Twilio Sandbox WhatsApp number (+1-415-523-8886): Still available for development testing; sandbox sessions expire after 3 days; not for production.
- next-intl v3: Still works but missing type safety improvements and auto-provider propagation in v4.

---

## Open Questions

1. **Twilio Account SID and phone number provisioning**
   - What we know: Twilio requires a WhatsApp Business Account and phone number registered with Meta before going live
   - What's unclear: Whether the hotel uses a shared Twilio number or a dedicated number per hotel; dedicated number requires Meta approval per number
   - Recommendation: Phase 4 use Twilio Sandbox (shared number `+1-415-523-8886`) for development; note in PLAN that production requires a dedicated WhatsApp number per hotel (or one shared number with hotel routing via database)

2. **Hotel widget token rotation**
   - What we know: Token is in the `hotels` table and publicly visible in hotel website source
   - What's unclear: Whether tokens should be rotatable and how that affects hotels that have already embedded the widget
   - Recommendation: Issue tokens as UUID v4 (random, unguessable); document that re-generating a token breaks embedded widgets — owners must update their `<script>` tag. No rotation in Phase 4.

3. **Supabase Realtime channel lifespan for widget sessions**
   - What we know: Supabase Realtime channels are ephemeral (in-memory); no persistence of channel subscribers
   - What's unclear: What happens to widget broadcast when server broadcasts to a channel with no subscribers (guest navigated away)
   - Recommendation: The broadcast is fire-and-forget; if no subscribers, the message is silently dropped. Widget polls on reconnect to fetch missed messages from `conversation_turns` table via a GET endpoint.

4. **Multi-hotel WhatsApp number routing**
   - What we know: Each Twilio WhatsApp number maps to one hotel; the webhook receives the `To` number
   - What's unclear: Whether all hotels share one Twilio number (routing by guest phone or hotel subdomain) or each hotel gets their own number (expensive)
   - Recommendation: Phase 4 use one Twilio number mapped to the first hotel (single-hotel MVP); add `hotel_whatsapp_numbers` table for multi-hotel routing in a later phase. Note this in plan as a known limitation.

5. **Upstash Redis billing and cold start**
   - What we know: Upstash Redis free tier is 10,000 commands/day; rate limiting uses 2 Redis commands per check
   - What's unclear: Whether free tier is sufficient for initial launch; cost at scale
   - Recommendation: Free tier handles ~5,000 rate-limit checks/day. Acceptable for MVP. Document upgrade path: Upstash Pay-as-you-go ($0.2/100K commands).

6. **`waitUntil` on Vercel for async WhatsApp reply**
   - What we know: Vercel serverless functions terminate after the Response is returned; `waitUntil()` from `@vercel/functions` extends execution
   - What's unclear: Whether `@vercel/functions` is available on the Vercel Hobby plan
   - Recommendation: Verify Vercel plan before implementing async reply. If `waitUntil` unavailable, respond to Twilio with TwiML `<Message>` tag inline (simpler, synchronous, but blocks the 15s window).

---

## New Schema Requirements

Phase 4 requires additions to the database schema:

```sql
-- Widget token on hotels table (add column)
ALTER TABLE public.hotels
  ADD COLUMN widget_token TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  ADD COLUMN widget_config JSONB DEFAULT '{}';

-- Index for widget token lookup (called on every widget session init)
CREATE UNIQUE INDEX idx_hotels_widget_token ON public.hotels(widget_token);

-- Escalations table
CREATE TABLE public.escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp', 'widget')),
  guest_message   TEXT NOT NULL,
  agent_response  TEXT,
  notified_at     TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escalations_hotel_id ON public.escalations(hotel_id, created_at);
CREATE INDEX idx_escalations_unnotified
  ON public.escalations(hotel_id)
  WHERE notified_at IS NULL;

-- Optional: WhatsApp number routing (for multi-hotel production use)
-- Defer to post-Phase 4 if single hotel MVP is acceptable
CREATE TABLE public.hotel_whatsapp_numbers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  twilio_number   TEXT NOT NULL UNIQUE,  -- e.g. 'whatsapp:+14155238886'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Sources

### Primary (HIGH confidence)
- `https://www.twilio.com/docs/whatsapp/api` — WhatsApp API overview, webhook payload format, 24-hour customer service window
- `https://www.twilio.com/en-us/blog/how-to-secure-twilio-webhook-urls-in-nodejs` — `twilio.validateRequest()` signature validation
- `npm view twilio version` → `5.12.2` (verified locally)
- `https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing` — without-routing setup, `getRequestConfig`, `getTranslations`, `useTranslations`
- `https://next-intl.dev/blog/next-intl-4-0` — v4 breaking changes, ESM-only, `NextIntlClientProvider` required
- `npm view next-intl version` → `4.8.3` (verified locally)
- `https://upstash.com/docs/redis/sdks/ratelimit-ts/algorithms` — slidingWindow, fixedWindow, tokenBucket APIs and tradeoffs
- `https://upstash.com/blog/edge-rate-limiting` — Middleware rate limiting code with `request.ip`
- `npm view @upstash/ratelimit version` → `2.0.8` (verified locally)
- `npm view @upstash/redis version` → `1.36.3` (verified locally)
- `https://supabase.com/docs/guides/realtime/broadcast` — Broadcast channel API, public vs private, RLS
- `https://supabase.com/docs/guides/realtime/authorization` — RLS on `realtime.messages`, public access setting
- `https://supabase.com/docs/guides/database/webhooks` — DB webhooks, pg_net, INSERT event payload
- `https://resend.com/docs/send-with-nextjs` — App Router Route Handler, `resend.emails.send()` pattern
- `npm view resend version` → `6.9.3` (verified locally)
- `https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html` — injection pattern detection, structural defense, OWASP LLM01:2025

### Secondary (MEDIUM confidence)
- `https://chatarmin.com/en/blog/twilio-whats-app-api` — Twilio pricing comparison, $0.005/msg platform fee (verified against Twilio pricing page)
- `https://help.twilio.com/articles/30304057900699` — July 2025 WhatsApp pricing changes (confirmed Meta's shift to per-message from per-conversation)
- `https://www.twilio.com/docs/whatsapp/sandbox` — Sandbox phone number (+1-415-523-8886), 3-day session expiry, 50 msg/day free trial limit
- `https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/` — Design patterns for prompt injection defense (Simon Willison, HIGH credibility in ML safety space)

### Tertiary (LOW confidence — flag for validation)
- Twilio Sandbox rate limit (1 msg/3s): from Twilio support article, not verified in official API docs
- Vercel `waitUntil()` availability by plan: mentioned in Vercel docs search but plan-specific limits not confirmed
- Supabase Realtime broadcast from server using service_role key: pattern inferred from client library docs; verify that `supabase.channel().send()` works server-side with service_role key

---

## Metadata

**Confidence breakdown:**
- WhatsApp / Twilio integration: HIGH — SDK verified (`twilio` v5.12.2), webhook validation pattern from official blog, payload format from official docs
- Widget / Supabase Realtime: MEDIUM-HIGH — Realtime Broadcast API verified from official docs; server-side broadcast pattern inferred (verify in implementation)
- next-intl without URL routing: HIGH — official docs fetched directly; v4.8.3 is latest per npm
- Upstash rate limiting: HIGH — algorithm docs fetched, middleware code from official blog
- Prompt injection protection: HIGH — OWASP LLM01:2025 directly fetched; structural defense (XML sections) verified in Phase 2 implementation
- Escalation (Supabase DB webhooks + Resend): HIGH — both verified via official docs; pattern is straightforward
- Schema changes: MEDIUM — new columns/tables are design decisions, not verified against existing migrations

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (30 days; Twilio pricing and WhatsApp policies change frequently — re-verify before implementation)
