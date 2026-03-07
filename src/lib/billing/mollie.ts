/**
 * Mollie payment client and subscription helpers.
 *
 * Used for EU market billing (country !== 'TR').
 * Mollie handles subscription billing via customer -> first payment -> mandate -> subscription flow.
 *
 * Security model: Webhook handler ALWAYS re-fetches payment from Mollie API.
 * Never trusts POST body directly. Classic Mollie webhooks do not include
 * X-Mollie-Signature — MOLLIE_WEBHOOK_SECRET validation is optional.
 *
 * Source: .planning/phases/06-billing/06-03-PLAN.md
 */

import { createMollieClient, SequenceType } from '@mollie/api-client';
import { createHmac, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Client singleton (lazy — avoids build crash when MOLLIE_API_KEY is unset)
// ---------------------------------------------------------------------------

type MollieClient = ReturnType<typeof createMollieClient>;
let _mollieClient: MollieClient | null = null;

export function getMollieClient(): MollieClient {
  if (!_mollieClient) {
    const apiKey = process.env.MOLLIE_API_KEY;
    if (!apiKey) throw new Error('MOLLIE_API_KEY must be set');
    _mollieClient = createMollieClient({ apiKey });
  }
  return _mollieClient;
}

/** @deprecated Use getMollieClient() — kept for existing imports */
export const mollieClient = new Proxy({} as MollieClient, {
  get(_target, prop) {
    return (getMollieClient() as Record<string | symbol, unknown>)[prop];
  },
});

// ---------------------------------------------------------------------------
// Customer creation
// ---------------------------------------------------------------------------

export interface CreateMollieCustomerParams {
  name: string;
  email: string;
  metadata: { hotelId: string };
}

/**
 * Creates a Mollie customer for a hotel.
 * Returns the customer object including the `id` (cst_xxx).
 */
export async function createMollieCustomer(params: CreateMollieCustomerParams) {
  return getMollieClient().customers.create({
    name: params.name,
    email: params.email,
    metadata: params.metadata as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// First payment (mandate setup)
// ---------------------------------------------------------------------------

export interface CreateMollieFirstPaymentParams {
  customerId: string;
  planName: string;
  redirectUrl: string;
  webhookUrl: string;
  trialEndsAt: string; // ISO 8601 date — passed as metadata for webhook use
}

/**
 * Creates the first payment that establishes a recurring mandate.
 *
 * - amount: EUR 0.01 (minimum required to establish a mandate)
 * - sequenceType: 'first' — this payment creates the mandate for future recurring charges
 *
 * The customer is redirected to payment._links.checkout.href to complete payment.
 * After payment, Mollie calls webhookUrl with the payment ID.
 * The webhook handler then creates the subscription using the mandate.
 */
export async function createMollieFirstPayment(params: CreateMollieFirstPaymentParams) {
  return getMollieClient().payments.create({
    amount: { currency: 'EUR', value: '0.01' },
    customerId: params.customerId,
    sequenceType: SequenceType.first,
    description: `OtelAI ${params.planName} - mandate setup`,
    redirectUrl: params.redirectUrl,
    webhookUrl: params.webhookUrl,
    metadata: {
      planName: params.planName,
      trialEndsAt: params.trialEndsAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Subscription creation
// ---------------------------------------------------------------------------

export interface CreateMollieSubscriptionParams {
  customerId: string;
  mandateId: string;
  planName: string;
  amountEur: string; // e.g. "29.00"
  startDate: string;  // ISO date string "YYYY-MM-DD" — when trial ends
  webhookUrl: string;
}

/**
 * Creates a recurring Mollie subscription after mandate is established.
 *
 * startDate should be set to trial_ends_at so billing begins after trial.
 * interval: '1 month' — monthly billing cycle.
 * mandateId: the mandate established by the first payment.
 */
export async function createMollieSubscription(params: CreateMollieSubscriptionParams) {
  return getMollieClient().customerSubscriptions.create({
    customerId: params.customerId,
    amount: { currency: 'EUR', value: params.amountEur },
    interval: '1 month',
    mandateId: params.mandateId,
    startDate: params.startDate,
    description: `OtelAI ${params.planName}`,
    webhookUrl: params.webhookUrl,
    metadata: { planName: params.planName },
  });
}

// ---------------------------------------------------------------------------
// Plan change
// ---------------------------------------------------------------------------

export interface ChangeMolliePlanParams {
  customerId: string;
  currentSubscriptionId: string;
  mandateId: string;
  newPlanName: string;
  newAmountEur: string; // e.g. "59.00"
  webhookUrl: string;
}

/**
 * Changes a hotel's Mollie subscription plan.
 *
 * Process:
 * 1. Cancel the current subscription immediately
 * 2. Create a new subscription with the new plan, starting next month
 *
 * The existing mandate (established by the first payment) is reused —
 * mandates persist for the customer across subscription changes.
 *
 * Returns the new subscription object.
 */
export async function changeMolliePlan(params: ChangeMolliePlanParams) {
  const client = getMollieClient();

  // Step 1: Cancel the current subscription
  await client.customerSubscriptions.cancel(params.currentSubscriptionId, {
    customerId: params.customerId,
  });

  // Step 2: Calculate next month start date (YYYY-MM-DD)
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(1); // First of next month
  const startDate = nextMonth.toISOString().slice(0, 10);

  // Step 3: Create new subscription with same mandate
  return client.customerSubscriptions.create({
    customerId: params.customerId,
    amount: { currency: 'EUR', value: params.newAmountEur },
    interval: '1 month',
    mandateId: params.mandateId,
    startDate,
    description: `OtelAI ${params.newPlanName}`,
    webhookUrl: params.webhookUrl,
    metadata: { planName: params.newPlanName },
  });
}

// ---------------------------------------------------------------------------
// Webhook signature validation
// ---------------------------------------------------------------------------

/**
 * Validates the X-Mollie-Signature HMAC header from a Mollie webhook.
 *
 * IMPORTANT: Classic Mollie webhooks (payment.id via form-urlencoded POST)
 * do NOT include X-Mollie-Signature. This function is provided for completeness
 * but may not be called in practice — the primary security model is re-fetching
 * the payment from the Mollie API to get authoritative status.
 *
 * If MOLLIE_WEBHOOK_SECRET is not set in env, skip validation entirely.
 *
 * @param rawBody - raw request body string
 * @param providedSignature - value from X-Mollie-Signature header
 * @returns true if signature is valid, false otherwise
 */
export function validateMollieSignature(rawBody: string, providedSignature: string): boolean {
  const secret = process.env.MOLLIE_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured — skip validation, rely on API fetch security
    return true;
  }

  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    const expectedBuf = Buffer.from(expectedHex, 'utf8');
    const providedBuf = Buffer.from(providedSignature, 'utf8');

    if (expectedBuf.length !== providedBuf.length) return false;

    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}
