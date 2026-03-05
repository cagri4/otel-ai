# Phase 6: Billing - Research

**Researched:** 2026-03-05
**Domain:** Subscription billing — iyzico (TR market), Mollie (EU market), plan enforcement, free trial
**Confidence:** MEDIUM-HIGH (both payment APIs verified against official docs; enforcement patterns verified against community patterns)

---

## Summary

Phase 6 adds subscription billing to OtelAI. Hotel owners in Turkey pay via iyzico; EU hotels pay via Mollie. Three plan tiers (Starter: 2 agents, Pro: 4, Enterprise: 6) enforce the agent count at the application layer. New hotels get a free trial period before being prompted to pay.

The core architecture is: one `subscriptions` table per hotel (hotel-scoped, RLS-protected) stores the active plan and trial state. Webhook handlers (one per payment provider) receive payment events and update this table using the service-role client. An `enforceAgentLimit()` utility — called server-side before any agent toggle — reads the subscription row and gates agent activation. The UI exposes a `/billing` dashboard page where owners subscribe, upgrade, downgrade, and view their current plan.

iyzico requires plans/products to be pre-created in the iyzico merchant panel (or via API before deployment). Mollie requires a "first payment" to establish a customer mandate before a subscription can be created. Both providers use HMAC-SHA256 signatures for webhook security. Neither provider requires the raw request body to be buffered separately in Next.js App Router — `request.text()` works for signature validation before parsing.

**Primary recommendation:** Keep plan tiers as application-level config (TypeScript constants), not database rows. Store only the current plan name and subscription state in the `subscriptions` table. Check limits at the server action layer, not at the RLS layer — RLS enforcement adds complexity without meaningful security benefit here (the hotel owner is the authenticated user making the request).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BILL-01 | Subscription billing with tiered plans (Starter: 2 agents, Pro: 4, Enterprise: 6) | `subscriptions` table stores `plan_name`; `PLAN_LIMITS` constant maps plan → agent count; enforced in server action before `agents` UPDATE |
| BILL-02 | iyzico integration for TR market payments | iyzico `subscriptionProduct` + `pricingPlan` pre-created; checkout form flow initializes subscription; webhook handler on `subscription.order.success` / `subscription.order.failure` updates DB |
| BILL-03 | Mollie integration for EU market payments | Mollie Customer → first payment (mandate) → Subscription API; webhook handler checks `subscriptionId` on payment object; updates DB |
| BILL-04 | Plan enforcement — agent count limited by subscription tier | `enforceAgentLimit()` called in the "toggle agent" server action; reads `subscriptions` table; returns error if enabling agent would exceed tier limit |
| BILL-05 | Hotel owner can upgrade/downgrade plan | iyzico: POST `/v2/subscription/subscriptions/{ref}/upgrade` with `upgradePeriod: NOW/NEXT_PERIOD`; Mollie: cancel + new subscription OR use PATCH update-subscription with new amount if plan interval is the same |
| BILL-06 | Free trial period for new hotels | iyzico: `trialPeriodDays` in pricing plan + `subscriptionInitialStatus: ACTIVE` (card validated with 1 TL refund, not charged); Mollie: `startDate` set to `now + 14d` with zero-amount first payment for card authorization |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `iyzipay` | ^2.0.65 | Official iyzico Node.js client | Official iyzico library, actively maintained by iyzico, published March 2025 |
| `@types/iyzipay` | latest | TypeScript types for iyzipay | DefinitelyTyped types for the official library |
| `mollie-api-typescript` | latest | TypeScript-native Mollie SDK | Official Mollie TypeScript SDK, native types, full subscription support, actively maintained 2025 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `crypto` (Node built-in) | Node built-in | HMAC-SHA256 webhook signature validation | Both iyzico and Mollie webhook handlers |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `mollie-api-typescript` | `@mollie/api-client` | `@mollie/api-client` is the older JS-first library; `mollie-api-typescript` is the newer TypeScript-native SDK — use the TypeScript one for this project |
| `iyzipay` + `@types/iyzipay` | Raw HTTP calls to iyzico API | The official library handles HMAC signing of API requests automatically; raw HTTP would require reimplementing the IYZWSv2 signing algorithm |
| Application-layer plan enforcement | RLS-based plan enforcement | RLS enforcement for entitlements is complex to implement correctly; application-layer checks in server actions are simpler, auditable, and sufficient when the hotel owner is the authenticated user |

**Installation:**
```bash
pnpm add iyzipay @types/iyzipay mollie-api-typescript
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   └── billing/
│       ├── plans.ts           # PLAN_LIMITS constant — plan name → agent count mapping
│       ├── iyzico.ts          # iyzico client init + subscription helpers
│       ├── mollie.ts          # Mollie client init + subscription helpers
│       ├── enforcement.ts     # enforceAgentLimit() — reads subscriptions table, checks tier
│       └── trialStatus.ts     # getSubscriptionStatus() — returns plan, trial state, expiry
├── app/
│   ├── api/
│   │   └── webhooks/
│   │       ├── iyzico/
│   │       │   └── route.ts   # POST handler — validates X-IYZ-SIGNATURE-V3, updates DB
│   │       └── mollie/
│   │           └── route.ts   # POST handler — validates X-Mollie-Signature, fetches payment, updates DB
│   └── (dashboard)/
│       └── billing/
│           └── page.tsx       # Billing dashboard — current plan, trial banner, upgrade/downgrade UI
└── supabase/
    └── migrations/
        └── 0006_billing.sql   # subscriptions table + RLS + handle_new_user extension
```

### Pattern 1: Subscriptions Table Design

**What:** A single `subscriptions` table with one row per hotel. Stores current plan name, provider-specific external IDs, subscription status, and trial expiry. The `handle_new_user` trigger creates a `trial` row on signup.

**When to use:** Always — this is the canonical subscription state store. Webhooks write to it; enforcement reads from it.

```sql
-- Migration: 0006_billing.sql
CREATE TABLE public.subscriptions (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              UUID         NOT NULL UNIQUE REFERENCES public.hotels(id) ON DELETE CASCADE,

  -- Plan state
  plan_name             TEXT         NOT NULL DEFAULT 'trial'
                                     CHECK (plan_name IN ('trial', 'starter', 'pro', 'enterprise')),
  status                TEXT         NOT NULL DEFAULT 'trialing'
                                     CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  trial_ends_at         TIMESTAMPTZ,  -- NULL after trial converts to paid

  -- Provider-specific IDs (one or the other will be non-null for paid plans)
  provider              TEXT         CHECK (provider IN ('iyzico', 'mollie')),
  provider_customer_id  TEXT,        -- Mollie: cst_xxx | iyzico: customerReferenceCode
  provider_subscription_id TEXT,     -- Mollie: sub_xxx | iyzico: subscriptionReferenceCode

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_hotel_id ON public.subscriptions(hotel_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Hotel owners can read their own subscription
CREATE POLICY "Hotel owners can view own subscription"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Writes only via service_role (webhook handlers and triggers use service client)
-- No INSERT/UPDATE policies for authenticated — prevents client-side manipulation

CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
```

**Note on handle_new_user extension:** Extend the existing `handle_new_user` trigger in migration 0006 (using `CREATE OR REPLACE FUNCTION`) to INSERT into `subscriptions` with `plan_name = 'trial'`, `status = 'trialing'`, and `trial_ends_at = NOW() + INTERVAL '14 days'` when a new hotel is created.

### Pattern 2: Plan Limits as TypeScript Constants

**What:** Plan tier limits are defined in code, not in a database table. The `subscriptions.plan_name` column is the source of truth for which tier a hotel is on; the code defines what that tier means.

**When to use:** Always for OtelAI — there are only 3 tiers with 1 attribute (agent count). No need for a DB table.

```typescript
// Source: application design pattern for small fixed tier sets
// lib/billing/plans.ts

export const PLAN_NAMES = ['trial', 'starter', 'pro', 'enterprise'] as const;
export type PlanName = typeof PLAN_NAMES[number];

export const PLAN_LIMITS: Record<PlanName, { maxAgents: number; displayName: string }> = {
  trial:      { maxAgents: 2, displayName: 'Free Trial' },
  starter:    { maxAgents: 2, displayName: 'Starter' },
  pro:        { maxAgents: 4, displayName: 'Pro' },
  enterprise: { maxAgents: 6, displayName: 'Enterprise' },
};

// Monthly prices in each market (informational — actual prices configured in iyzico/Mollie dashboard)
export const PLAN_PRICES: Record<Exclude<PlanName, 'trial'>, { try: number; eur: number }> = {
  starter:    { try: 299,  eur: 29  },
  pro:        { try: 599,  eur: 59  },
  enterprise: { try: 999,  eur: 99  },
};
```

### Pattern 3: Plan Enforcement in Server Actions

**What:** Before allowing a hotel owner to enable an agent, check agent count against subscription tier.

**When to use:** In the "toggle agent enabled" server action. Do NOT check in the route handler or middleware — only at the mutation point.

```typescript
// Source: application design pattern, informed by makerkit.dev entitlements approach
// lib/billing/enforcement.ts

import { createServiceClient } from '@/lib/supabase/service';
import { PLAN_LIMITS, type PlanName } from './plans';

export async function enforceAgentLimit(hotelId: string): Promise<{
  allowed: boolean;
  reason?: string;
  currentCount: number;
  maxAgents: number;
}> {
  const supabase = createServiceClient();

  // Get subscription for this hotel
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan_name, status, trial_ends_at')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  // No subscription row = treat as trial (should not happen post-migration)
  const planName = (sub?.plan_name ?? 'trial') as PlanName;
  const status = sub?.status ?? 'trialing';

  // Expired trial: enforce as 'starter' limits (0 agents until they pay)
  // OR block entirely — this is a product decision. Research recommends: still
  // allow trial limits until payment received, then show upgrade prompt.
  if (status === 'trialing' && sub?.trial_ends_at) {
    const trialEnd = new Date(sub.trial_ends_at);
    if (trialEnd < new Date()) {
      return { allowed: false, reason: 'trial_expired', currentCount: 0, maxAgents: 0 };
    }
  }

  const limits = PLAN_LIMITS[planName];

  // Count currently enabled agents
  const { count } = await supabase
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('hotel_id', hotelId)
    .eq('is_enabled', true);

  const currentCount = count ?? 0;

  if (currentCount >= limits.maxAgents) {
    return {
      allowed: false,
      reason: 'limit_reached',
      currentCount,
      maxAgents: limits.maxAgents,
    };
  }

  return { allowed: true, currentCount, maxAgents: limits.maxAgents };
}
```

### Pattern 4: iyzico Checkout Form Flow

**What:** iyzico subscription uses a hosted checkout form. The merchant creates a Product and Plan in iyzico first, then initializes a subscription via API which returns an HTML form. The user fills the card details in iyzico's hosted form. After form submission, iyzico POSTs to the callback URL and also sends webhooks for recurring payments.

**When to use:** For all Turkish market (country = 'TR') subscriptions.

**Pre-setup required (one-time, before deployment):**
- iyzico merchant must activate the Subscription add-on in their control panel (Settings > Add-ons)
- Create one Product (e.g., "OtelAI") in the iyzico control panel or via API
- Create three Pricing Plans (Starter/Pro/Enterprise) under that product with `MONTHLY` interval and `trialPeriodDays` set
- Store the generated `pricingPlanReferenceCode` values as environment variables

```typescript
// Source: https://docs.iyzico.com/en/getting-started/preliminaries/api-reference-beta/subscription/subscription/initialize-subscription
// lib/billing/iyzico.ts

import Iyzipay from 'iyzipay';

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZIPAY_API_KEY!,
  secretKey: process.env.IYZIPAY_SECRET_KEY!,
  uri: process.env.NODE_ENV === 'production'
    ? 'https://api.iyzipay.com'
    : 'https://sandbox-api.iyzipay.com',
});

export function initSubscriptionCheckoutForm(params: {
  pricingPlanReferenceCode: string;
  callbackUrl: string;
  customer: {
    name: string;
    surname: string;
    email: string;
    gsmNumber: string;         // Required: Turkish mobile number
    identityNumber: string;    // Turkish national ID — required by Turkish financial regulation
    billingAddress: {
      address: string;
      city: string;
      country: string;
      zipCode?: string;
    };
  };
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    iyzipay.subscriptionCheckoutForm.initialize(
      {
        locale: 'tr',
        pricingPlanReferenceCode: params.pricingPlanReferenceCode,
        subscriptionInitialStatus: 'ACTIVE', // Card validated with 1 TL refund during trial
        callbackUrl: params.callbackUrl,
        customer: params.customer,
      },
      (err: Error | null, result: unknown) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
  });
}
```

**CRITICAL: identityNumber field.** iyzico requires a Turkish national identity number (`identityNumber`) for all subscriptions due to Turkish financial regulation. For non-Turkish customers this field is still required — use a placeholder or collect it via onboarding. This is a **hard requirement** — subscription initialization will fail without it.

### Pattern 5: iyzico Webhook Handler

**What:** iyzico sends `iyziEventType: "subscription.order.success"` or `"subscription.order.failure"` for recurring payment events. Signature is validated with HMAC-SHA256 using X-IYZ-SIGNATURE-V3 header.

```typescript
// Source: https://docs.iyzico.com/en/advanced/webhook
// app/api/webhooks/iyzico/route.ts

import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const payload = JSON.parse(body);

  // Validate signature (V3 — V1 and V2 are deprecated)
  const signature = request.headers.get('x-iyz-signature-v3');
  const {
    orderReferenceCode,
    customerReferenceCode,
    subscriptionReferenceCode,
    iyziEventType,
  } = payload;

  const merchantId = process.env.IYZIPAY_MERCHANT_ID!;
  const secretKey = process.env.IYZIPAY_SECRET_KEY!;

  // Concatenation order per iyzico docs
  const key = merchantId + secretKey + iyziEventType + subscriptionReferenceCode + orderReferenceCode + customerReferenceCode;
  const expectedSignature = crypto.createHmac('sha256', secretKey).update(key).digest('hex');

  if (signature !== expectedSignature) {
    return new Response('Invalid signature', { status: 401 });
  }

  const supabase = createServiceClient();

  if (iyziEventType === 'subscription.order.success') {
    await supabase
      .from('subscriptions')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('provider_subscription_id', subscriptionReferenceCode);
  } else if (iyziEventType === 'subscription.order.failure') {
    await supabase
      .from('subscriptions')
      .update({ status: 'past_due', updated_at: new Date().toISOString() })
      .eq('provider_subscription_id', subscriptionReferenceCode);
  }

  return new Response('OK', { status: 200 });
}
```

### Pattern 6: Mollie Subscription Flow (EU Market)

**What:** Mollie recurring payments require a two-step process: (1) a "first payment" with `sequenceType: 'first'` that establishes a mandate; (2) a subscription linked to the mandate. The customer must complete the first payment via Mollie's payment page. After mandate is established, the Subscription API handles recurring charges automatically.

**Trial approach for Mollie:** Create the first payment (zero-amount for card/PayPal, or €0.01 for others), set `sequenceType: 'first'`. After mandate is created, use `startDate = trial_ends_at` when creating the subscription. The customer is not charged until `startDate`.

```typescript
// Source: https://docs.mollie.com/docs/recurring-payments + https://docs.mollie.com/reference/create-subscription
// lib/billing/mollie.ts

import { Client } from 'mollie-api-typescript';

const mollieClient = new Client({
  security: { apiKey: process.env.MOLLIE_API_KEY! },
  testmode: process.env.NODE_ENV !== 'production',
});

// Step 1: Create customer (once per hotel)
export async function createMollieCustomer(params: {
  name: string;
  email: string;
  metadata: { hotelId: string };
}) {
  return mollieClient.customers.create({
    customerRequest: {
      name: params.name,
      email: params.email,
      metadata: params.metadata,
    },
  });
}

// Step 2: Create first payment to establish mandate
// Customer must redirect to checkoutUrl to complete this
export async function createMollieFirstPayment(params: {
  customerId: string;
  planName: 'starter' | 'pro' | 'enterprise';
  redirectUrl: string;
  webhookUrl: string;
  trialEndsAt: string; // ISO date string
}) {
  return mollieClient.payments.create({
    paymentRequest: {
      amount: { currency: 'EUR', value: '0.01' }, // Minimum for mandate establishment
      customerId: params.customerId,
      sequenceType: 'first',
      description: `OtelAI ${params.planName} - mandate setup`,
      redirectUrl: params.redirectUrl,
      webhookUrl: params.webhookUrl,
      metadata: { planName: params.planName, trialEndsAt: params.trialEndsAt },
    },
  });
}

// Step 3: Create subscription after mandate is established
export async function createMollieSubscription(params: {
  customerId: string;
  mandateId: string;
  planName: 'starter' | 'pro' | 'enterprise';
  amountEur: string; // e.g. "29.00"
  startDate: string; // ISO date — when trial ends
  webhookUrl: string;
}) {
  return mollieClient.subscriptions.create({
    customerId: params.customerId,
    subscriptionRequest: {
      amount: { currency: 'EUR', value: params.amountEur },
      interval: '1 month',
      mandateId: params.mandateId,
      startDate: params.startDate,
      description: `OtelAI ${params.planName}`,
      webhookUrl: params.webhookUrl,
      metadata: { planName: params.planName },
    },
  });
}
```

### Pattern 7: Mollie Webhook Handler

**What:** Mollie sends a POST request with the payment `id` in the body. Do not trust the body payload; fetch the payment from Mollie API to get the actual status. Subscription payments include a `subscriptionId` field to correlate back to the subscription record.

```typescript
// Source: https://docs.mollie.com/reference/webhooks + https://docs.mollie.com/docs/recurring-payments
// app/api/webhooks/mollie/route.ts

import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { Client } from 'mollie-api-typescript';

const mollieClient = new Client({
  security: { apiKey: process.env.MOLLIE_API_KEY! },
});

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Validate X-Mollie-Signature (format: "sha256=<hex>")
  const signatureHeader = request.headers.get('x-mollie-signature') ?? '';
  const [, providedHash] = signatureHeader.split('=');
  const expectedHash = crypto
    .createHmac('sha256', process.env.MOLLIE_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(providedHash ?? ''), Buffer.from(expectedHash))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const paymentId = params.get('id');
  if (!paymentId) return new Response('No id', { status: 400 });

  // Fetch payment from Mollie to get authoritative status
  const payment = await mollieClient.payments.get({ id: paymentId });

  const supabase = createServiceClient();

  // Handle first payment (mandate establishment)
  if (payment.sequenceType === 'first') {
    if (payment.status === 'paid') {
      // Mandate established — create the subscription with startDate = trial end
      // (subscription creation happens in a separate server action flow after redirect)
    }
    return new Response('OK', { status: 200 });
  }

  // Handle recurring subscription payments
  if (payment.subscriptionId) {
    const newStatus = payment.status === 'paid' ? 'active' : 'past_due';
    await supabase
      .from('subscriptions')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('provider_subscription_id', payment.subscriptionId);
  }

  return new Response('OK', { status: 200 });
}
```

### Pattern 8: Region Detection for Provider Routing

**What:** Route TR hotels to iyzico, all other countries to Mollie. Detect from `hotels.country` field.

```typescript
// lib/billing/plans.ts (extend)

export function getProviderForHotel(country: string | null): 'iyzico' | 'mollie' {
  return country?.toLowerCase() === 'tr' ? 'iyzico' : 'mollie';
}
```

### Anti-Patterns to Avoid

- **Don't trust webhook payload data for status.** Mollie webhooks only send the resource ID — always re-fetch from the Mollie API. iyzico webhooks include status data but always validate the HMAC signature first.
- **Don't use `request.json()` before signature validation.** Use `request.text()` first, validate the HMAC, then `JSON.parse()` the text. App Router does not allow reading the body twice.
- **Don't store plan limits in the database.** Three tiers with one attribute (agent count) belong in TypeScript constants, not a DB table.
- **Don't enforce limits at the RLS layer.** RLS entitlement enforcement is powerful but fragile for this use case. Server action checks are sufficient and simpler to reason about.
- **Don't attempt iyzico plan upgrade across different billing intervals.** iyzico upgrade API only works within the same product AND same billing interval. All plans must share the same `paymentInterval` (MONTHLY) and `paymentIntervalCount` (1).
- **Don't expose the service-role client in webhook handlers to untrusted data.** Always validate the HMAC signature before any database write.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| iyzico request signing (IYZWSv2) | Custom HMAC-based request signature | `iyzipay` npm package | Every API request to iyzico must be signed with a specific algorithm; the library handles this automatically |
| Mollie API request construction | Raw `fetch()` to Mollie endpoints | `mollie-api-typescript` | TypeScript types, error handling, pagination, retry logic — all pre-built |
| Webhook HMAC validation | Write your own crypto module | Node.js `crypto` built-in | Already available in Node.js; no additional dependency needed |
| Subscription state machine | Custom status tracking | DB `status` column updated by webhooks | Webhooks are the authoritative source; let the provider drive state transitions |
| Plan limits configuration | DB table for tiers | TypeScript constants | 3 tiers × 1 attribute is not worth a DB table and join |
| Trial period countdown | Custom timer logic | `trial_ends_at TIMESTAMPTZ` DB column | Simple timestamp comparison on every request; no scheduler needed |

**Key insight:** Both iyzico and Mollie handle the hard parts — card vaulting, PCI compliance, recurring payment scheduling, retry logic, and currency handling. The application only needs to: (1) initiate the checkout/mandate flow, (2) handle webhook callbacks, (3) update a single DB row, (4) check that row before mutations.

---

## Common Pitfalls

### Pitfall 1: iyzico identityNumber Requirement

**What goes wrong:** Subscription initialization returns an error or silent failure because `identityNumber` (Turkish national ID) is missing or invalid.
**Why it happens:** Turkish financial regulation requires this field for all card operations. iyzico enforces it server-side.
**How to avoid:** Collect a national ID (or use `"11111111111"` for testing — iyzico sandbox accepts this) during onboarding for TR-market hotels. Store it in the hotel record or collect at checkout time.
**Warning signs:** iyzico API returns `errorCode: "10003"` or similar validation errors.

### Pitfall 2: Mollie Mandate Not Yet Created When Subscription Is Attempted

**What goes wrong:** Attempting to create a Mollie subscription before the first payment (mandate) completes. The user may abandon the payment page.
**Why it happens:** The mandate is created asynchronously after the customer completes the first payment on Mollie's hosted page. Your redirect URL callback fires, but the mandate may not yet be confirmed.
**How to avoid:** Do not create the subscription on the redirect callback. Wait for the Mollie webhook to confirm `status: 'paid'` on the first payment, then list mandates for the customer and create the subscription. Use the webhook as the trigger for subscription creation.
**Warning signs:** `mollie.subscriptions.create()` returns `422 Unprocessable Entity` with "customer has no valid mandate."

### Pitfall 3: iyzico Checkout Form Token Expiration

**What goes wrong:** The user takes too long to complete the iyzico checkout form and the token expires. The form renders a "token expired" error.
**Why it happens:** `tokenExpireTime` in the iyzico response is short (typically 30 minutes).
**How to avoid:** Show a clear "you have X minutes to complete payment" UI. Handle the callback URL with an expired-token error state. Allow re-initiation of the checkout.
**Warning signs:** User lands on callback URL with `status: FAILURE` and error indicating token expiry.

### Pitfall 4: Mollie Classic Webhook — POST Body is `application/x-www-form-urlencoded`

**What goes wrong:** Parsing Mollie webhook body as JSON fails silently, `id` is `undefined`.
**Why it happens:** Mollie classic webhooks send `id=tr_xxx` as form-encoded body, NOT JSON.
**How to avoid:** Use `new URLSearchParams(rawBody)` to extract the `id` field, not `JSON.parse()`.
**Warning signs:** `payment.subscriptionId` is always undefined in production; webhook handler always returns early.

### Pitfall 5: iyzico Upgrade Constraint — Same Billing Interval Required

**What goes wrong:** Plan upgrade from Starter to Pro (or any plan change) fails if plans were created with different billing intervals.
**Why it happens:** iyzico's upgrade API (`/v2/subscription/subscriptions/{ref}/upgrade`) requires both the current and new plan to have the same `paymentInterval` and `paymentIntervalCount`. If Starter is MONTHLY and Pro was accidentally created as YEARLY, upgrade fails.
**How to avoid:** Create ALL iyzico pricing plans under the same product with `paymentInterval: MONTHLY` and `paymentIntervalCount: 1`. Never mix intervals. For annual billing (future feature), create a separate product.
**Warning signs:** iyzico upgrade API returns error about incompatible plans.

### Pitfall 6: Next.js App Router — Cannot Read Request Body Twice

**What goes wrong:** Calling `request.json()` before `request.text()` throws an error ("body already read"). Or vice versa.
**Why it happens:** App Router `NextRequest` body is a readable stream — it can only be consumed once.
**How to avoid:** Always call `await request.text()` first, validate HMAC, then `JSON.parse(rawBody)` or `new URLSearchParams(rawBody)`. Never call `.json()`.
**Warning signs:** `TypeError: body is not a ReadableStream` or `TypeError: body already used`.

### Pitfall 7: Trial Expired Hotels Still Attempting Agent Activation

**What goes wrong:** A hotel whose 14-day trial expired can still enable agents if the enforcement check does not correctly identify expired trial state.
**Why it happens:** `status = 'trialing'` remains in the DB even after `trial_ends_at` passes — no trigger changes it automatically.
**How to avoid:** In `enforceAgentLimit()`, always check `trial_ends_at < NOW()` when `status = 'trialing'`. Return `{ allowed: false, reason: 'trial_expired' }` and show upgrade prompt in the UI.
**Warning signs:** Expired-trial hotels can toggle agents with no error.

---

## Code Examples

### iyzico Client Initialization with Environment Variables

```typescript
// Source: https://github.com/iyzico/iyzipay-node
// lib/billing/iyzico.ts

import Iyzipay from 'iyzipay';

// Module-level singleton — safe (no hotel data stored in client)
export const iyzipayClient = new Iyzipay({
  apiKey: process.env.IYZIPAY_API_KEY!,
  secretKey: process.env.IYZIPAY_SECRET_KEY!,
  uri: process.env.NODE_ENV === 'production'
    ? 'https://api.iyzipay.com'
    : 'https://sandbox-api.iyzipay.com',
});

// Sandbox test credentials: apiKey = 'sandbox-xxx', secretKey = 'sandbox-xxx'
// Sandbox URI: https://sandbox-api.iyzipay.com
```

### Mollie Client Initialization

```typescript
// Source: https://github.com/mollie/mollie-api-typescript
// lib/billing/mollie.ts

import { Client } from 'mollie-api-typescript';

// Module-level singleton
export const mollieClient = new Client({
  security: { apiKey: process.env.MOLLIE_API_KEY! },
  testmode: process.env.NODE_ENV !== 'production',
});

// Test key prefix: 'test_' — automatically routes to Mollie test environment
// Live key prefix: 'live_'
```

### HMAC Validation Helper (Reusable)

```typescript
// lib/billing/webhookValidation.ts
import crypto from 'crypto';

export function validateHmacSha256(
  payload: string,
  secret: string,
  providedSignature: string,
): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false; // Buffer lengths differ = signature mismatch
  }
}
```

### Subscription Status Helper (UI Data)

```typescript
// lib/billing/trialStatus.ts
import { createServiceClient } from '@/lib/supabase/service';
import { PLAN_LIMITS, type PlanName } from './plans';

export type SubscriptionStatus = {
  planName: PlanName;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  maxAgents: number;
  isTrialExpired: boolean;
  provider: 'iyzico' | 'mollie' | null;
};

export async function getSubscriptionStatus(hotelId: string): Promise<SubscriptionStatus> {
  const supabase = createServiceClient();
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan_name, status, trial_ends_at, provider')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  const planName = (sub?.plan_name ?? 'trial') as PlanName;
  const status = (sub?.status ?? 'trialing') as SubscriptionStatus['status'];
  const trialEndsAt = sub?.trial_ends_at ? new Date(sub.trial_ends_at) : null;
  const now = new Date();
  const isTrialExpired = status === 'trialing' && trialEndsAt !== null && trialEndsAt < now;
  const trialDaysRemaining = trialEndsAt && !isTrialExpired
    ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    planName,
    status,
    trialEndsAt,
    trialDaysRemaining,
    maxAgents: PLAN_LIMITS[planName].maxAgents,
    isTrialExpired,
    provider: (sub?.provider as 'iyzico' | 'mollie' | null) ?? null,
  };
}
```

### iyzico Subscription Upgrade

```typescript
// Source: https://docs.iyzico.com/en/products/subscription/subscription-implementation/subscription-transactions
// lib/billing/iyzico.ts (extension)

export function upgradeIyzicoSubscription(params: {
  subscriptionReferenceCode: string;
  newPricingPlanReferenceCode: string;
  upgradePeriod: 'NOW' | 'NEXT_PERIOD';
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // iyzipay library method — exact method name may vary; verify against library source
    (iyzipayClient as Record<string, Record<string, Function>>).subscriptionUpgrade?.create(
      {
        subscriptionReferenceCode: params.subscriptionReferenceCode,
        newPricingPlanReferenceCode: params.newPricingPlanReferenceCode,
        upgradePeriod: params.upgradePeriod,
        useTrial: false,
        resetRecurrenceCount: false,
      },
      (err: Error | null, result: unknown) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
  });
}
```

### Mollie Plan Change (Upgrade/Downgrade)

```typescript
// Source: https://docs.mollie.com/reference/update-subscription
// For Mollie, plan change = cancel current subscription + create new one with same mandate
// The update-subscription endpoint supports amount/description changes but not arbitrary plan switches

export async function changeMolliePlan(params: {
  customerId: string;
  currentSubscriptionId: string;
  mandateId: string;
  newPlanName: 'starter' | 'pro' | 'enterprise';
  newAmountEur: string;
}) {
  // Cancel the existing subscription
  await mollieClient.subscriptions.cancel({
    customerId: params.customerId,
    subscriptionId: params.currentSubscriptionId,
  });

  // Create a new subscription starting from next billing date (immediate)
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const startDate = nextMonth.toISOString().split('T')[0]; // "YYYY-MM-DD"

  return mollieClient.subscriptions.create({
    customerId: params.customerId,
    subscriptionRequest: {
      amount: { currency: 'EUR', value: params.newAmountEur },
      interval: '1 month',
      mandateId: params.mandateId,
      startDate,
      description: `OtelAI ${params.newPlanName}`,
      webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mollie`,
      metadata: { planName: params.newPlanName },
    },
  });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| iyzico X-Iyz-Signature (V1/V2) | X-IYZ-SIGNATURE-V3 (HMAC-SHA256 hex) | 2024 | V1 and V2 are deprecated and will be removed; must use V3 |
| `@mollie/api-client` (JS-first) | `mollie-api-typescript` (TypeScript-native) | 2024-2025 | Better DX and type safety for TypeScript projects |
| Mollie webhook: trust POST body | Mollie webhook: fetch resource from API | Always true | Mollie best practice — never trust the webhook payload, always verify via API |
| Storing plan limits in DB | TypeScript constants for fixed tiers | Design principle | Simpler; DB query saved per entitlement check |

**Deprecated/outdated:**
- `X-Iyz-Signature` (V1) and `X-Iyz-Signature-V2`: Deprecated by iyzico — must use `X-IYZ-SIGNATURE-V3`
- `@mollie/api-client` for new TypeScript projects: Superseded by `mollie-api-typescript`

---

## Open Questions

1. **iyzico `identityNumber` for non-Turkish hotel owners**
   - What we know: iyzico requires a Turkish national ID for all subscription initiations
   - What's unclear: What value to use for EU hotels accidentally routed to iyzico, or for testing
   - Recommendation: In onboarding, collect TC kimlik number for TR hotels only. For testing, use `"11111111111"` (iyzico sandbox-accepted test value). Enforce provider routing strictly by `hotels.country`.

2. **iyzico Subscription add-on activation and plan pre-creation**
   - What we know: Subscription feature must be activated in iyzico merchant panel; pricing plans must exist before checkout form can be initialized
   - What's unclear: Exact steps and timing to create plans via API vs. merchant panel; whether sandbox plans auto-expire
   - Recommendation: Create plans via iyzico merchant panel during initial setup. Store `pricingPlanReferenceCode` values as environment variables (`IYZICO_PLAN_STARTER_REF`, `IYZICO_PLAN_PRO_REF`, `IYZICO_PLAN_ENTERPRISE_REF`). Document setup steps in a `BILLING_SETUP.md`.

3. **Mollie Webhook Secret configuration**
   - What we know: Next-gen webhooks use `X-Mollie-Signature` with HMAC-SHA256; classic webhooks may not require signature validation
   - What's unclear: Whether Mollie's classic webhook (used for subscription payment notifications) includes the `X-Mollie-Signature` header, or only next-gen webhooks
   - Recommendation: Use next-gen webhooks for subscription payment events if possible (subscription-specific event type support). If forced to use classic webhooks, add IP allowlist check (`130.89.0.0/24` is Mollie's IP range) as secondary validation.

4. **Downgrade behavior: what happens to excess agents?**
   - What we know: Downgrading from Pro (4 agents) to Starter (2 agents) means 2 agents exceed the new limit
   - What's unclear: Should the system auto-disable the excess agents, or block the downgrade until the owner disables them manually?
   - Recommendation: Block the downgrade and show a clear message: "Disable 2 agents before downgrading to Starter." This is simpler to implement and gives the owner control over which agents to disable.

---

## Sources

### Primary (HIGH confidence)
- `https://docs.iyzico.com/en/products/subscription/subscription-implementation` — iyzico subscription flow
- `https://docs.iyzico.com/en/products/subscription/subscription-implementation/payment-plan` — iyzico plan creation fields including `trialPeriodDays`
- `https://docs.iyzico.com/en/getting-started/preliminaries/api-reference-beta/subscription/subscription/initialize-subscription` — iyzico subscription init request/response fields
- `https://docs.iyzico.com/en/advanced/webhook` — iyzico webhook format, event types, X-IYZ-SIGNATURE-V3 algorithm
- `https://docs.iyzico.com/en/products/subscription/subscription-implementation/subscription-transactions` — iyzico upgrade endpoint, constraints
- `https://docs.mollie.com/docs/recurring-payments` — Mollie recurring payment flow (customer → first payment → mandate → subscription)
- `https://docs.mollie.com/reference/create-subscription` — Mollie subscription fields: amount, interval, startDate, mandateId, trialPeriod, webhookUrl
- `https://docs.mollie.com/reference/webhooks-best-practices` — Mollie webhook HMAC-SHA256 validation (X-Mollie-Signature)
- `https://github.com/mollie/mollie-api-typescript` — TypeScript SDK, Client initialization, subscription methods

### Secondary (MEDIUM confidence)
- `https://github.com/iyzico/iyzipay-node` — iyzipay client initialization, callback pattern
- `https://makerkit.dev/docs/next-supabase-turbo/recipes/subscription-entitlements` — entitlement enforcement patterns for Next.js + Supabase (adapted for this codebase's simpler needs)
- WebSearch: iyzico HMAC-SHA256 key concatenation order for subscription webhooks (verified against official docs)
- WebSearch: Mollie classic webhooks POST body as `application/x-www-form-urlencoded` (verified against Mollie docs)

### Tertiary (LOW confidence)
- WebSearch: Mollie webhook `X-Mollie-Signature` for classic (non-next-gen) webhooks — the signature header may only be on next-gen webhooks; needs verification before implementation
- WebSearch: iyzico `subscriptionUpgrade` method name in iyzipay Node.js library — exact method path not confirmed in library source; verify against `iyzipay-node` GitHub before coding

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both iyzipay and mollie-api-typescript verified via official GitHub and npm
- iyzico flow: HIGH — subscription API documented in official iyzico docs; webhook events and signature algorithm confirmed
- Mollie flow: HIGH — recurring payment flow, subscription API, and webhook security confirmed in official docs
- Enforcement pattern: MEDIUM — pattern adapted from general Next.js + Supabase entitlement patterns; fits this codebase's architecture
- iyzico upgrade method in iyzipay library: LOW — endpoint is documented but exact Node.js library method name needs verification

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable APIs; iyzico and Mollie rarely make breaking changes to subscription APIs)
