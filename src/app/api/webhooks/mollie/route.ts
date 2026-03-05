/**
 * Mollie payment webhook handler.
 *
 * POST /api/webhooks/mollie
 *
 * Security model:
 * - Body is parsed as application/x-www-form-urlencoded (NOT JSON)
 * - Payment ID is extracted from form body, then re-fetched from Mollie API
 * - Never trusts the POST body for payment status — always fetches authoritative state
 * - X-Mollie-Signature validation is optional (classic webhooks may not include it)
 * - Always returns 200 to prevent Mollie retry storms
 *
 * Flow:
 *   First payment (sequenceType === 'first', status === 'paid'):
 *     1. Extract mandate from payment
 *     2. Create Mollie subscription starting on trial_ends_at
 *     3. Update subscriptions row: provider, provider_customer_id, provider_subscription_id
 *
 *   Recurring payment (subscriptionId present):
 *     - status === 'paid' → set subscription status to 'active'
 *     - status === 'failed' | 'expired' → set status to 'past_due'
 *
 * Source: .planning/phases/06-billing/06-03-PLAN.md
 */

import { SequenceType } from '@mollie/api-client';
import type Payment from '@mollie/api-client/dist/types/data/payments/Payment';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mollieClient,
  createMollieSubscription,
  validateMollieSignature,
} from '@/lib/billing/mollie';
import { PLAN_PRICES } from '@/lib/billing/plans';
import { createServiceClient } from '@/lib/supabase/service';
import type { Subscription } from '@/types/database';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Step 1: Read raw body as text (MUST be done before any other parsing)
  // Form-urlencoded, not JSON — Mollie classic webhook pitfall
  // ---------------------------------------------------------------------------
  const rawBody = await request.text();

  // ---------------------------------------------------------------------------
  // Step 2: Optional signature validation
  // Classic Mollie webhooks may not include X-Mollie-Signature
  // If MOLLIE_WEBHOOK_SECRET is not set, validateMollieSignature returns true
  // ---------------------------------------------------------------------------
  const signature = request.headers.get('x-mollie-signature') ?? '';
  if (!validateMollieSignature(rawBody, signature)) {
    console.warn('[mollie webhook] Invalid signature — ignoring');
    return new Response(null, { status: 200 }); // Return 200 to avoid retry
  }

  // ---------------------------------------------------------------------------
  // Step 3: Parse body as form-encoded to extract payment ID
  // ---------------------------------------------------------------------------
  const params = new URLSearchParams(rawBody);
  const paymentId = params.get('id');

  if (!paymentId) {
    // No ID — could be a test ping from Mollie. Return 200 to not trigger retry.
    return new Response(null, { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // Step 4: Fetch authoritative payment state from Mollie API
  // NEVER trust the POST body for status — always re-fetch
  // ---------------------------------------------------------------------------
  let payment: Payment;
  try {
    payment = await mollieClient.payments.get(paymentId) as unknown as Payment;
  } catch (err) {
    console.error('[mollie webhook] Failed to fetch payment from API:', err);
    return new Response(null, { status: 200 }); // Return 200 — log error, don't retry
  }

  const serviceSupabase = createServiceClient();

  // ---------------------------------------------------------------------------
  // Step 5a: Handle first payment (mandate setup)
  // ---------------------------------------------------------------------------
  if (payment.sequenceType === SequenceType.first) {
    if (payment.status !== 'paid') {
      // First payment not yet paid — ignore (webhook may fire on status changes)
      return new Response(null, { status: 200 });
    }

    // Extract customer ID and mandate ID
    const customerId = payment.customerId;
    if (!customerId) {
      console.error('[mollie webhook] First payment has no customerId:', paymentId);
      return new Response(null, { status: 200 });
    }

    // List mandates to find the valid one established by this first payment
    let mandateId: string | undefined;
    try {
      const mandatesPage = await mollieClient.customerMandates.page({ customerId });
      const validMandate = mandatesPage.find(
        (m) => m.status === 'valid' || m.status === 'pending',
      );
      mandateId = validMandate?.id;
    } catch (err) {
      console.error('[mollie webhook] Failed to list mandates:', err);
      return new Response(null, { status: 200 });
    }

    if (!mandateId) {
      console.error('[mollie webhook] No valid mandate found for customer:', customerId);
      return new Response(null, { status: 200 });
    }

    // Extract plan info from payment metadata
    const metadata = payment.metadata as { planName?: string; trialEndsAt?: string } | null;
    const planName = metadata?.planName;
    const trialEndsAt = metadata?.trialEndsAt;

    if (!planName || !trialEndsAt) {
      console.error('[mollie webhook] Missing planName or trialEndsAt in metadata:', metadata);
      return new Response(null, { status: 200 });
    }

    // Resolve EUR amount for the plan
    const planPrices = PLAN_PRICES[planName as keyof typeof PLAN_PRICES];
    if (!planPrices) {
      console.error('[mollie webhook] Unknown planName in metadata:', planName);
      return new Response(null, { status: 200 });
    }

    const amountEur = planPrices.eur.toFixed(2);
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mollie`;

    // Create the recurring subscription starting on trial_ends_at
    // startDate must be in YYYY-MM-DD format
    const startDate = trialEndsAt.slice(0, 10);
    let subscriptionId: string;
    try {
      const subscription = await createMollieSubscription({
        customerId,
        mandateId,
        planName,
        amountEur,
        startDate,
        webhookUrl,
      });
      subscriptionId = subscription.id;
    } catch (err) {
      console.error('[mollie webhook] Failed to create subscription:', err);
      return new Response(null, { status: 200 });
    }

    // Update subscriptions table
    // Use SupabaseClient cast to avoid TypeScript never inference for manually-typed
    // subscriptions table (same pattern as enforcement.ts — Phase 6 Plan 1 decision)
    try {
      const supabaseCast = serviceSupabase as unknown as SupabaseClient;

      const { data: subData } = await supabaseCast
        .from('subscriptions')
        .select('hotel_id')
        .eq('provider_customer_id', customerId)
        .maybeSingle();

      if (subData) {
        await supabaseCast
          .from('subscriptions')
          .update({
            provider: 'mollie',
            provider_customer_id: customerId,
            provider_subscription_id: subscriptionId,
            plan_name: planName,
            status: 'trialing', // Still trialing until trial_ends_at passes
          } as Partial<Subscription>)
          .eq('hotel_id', (subData as { hotel_id: string }).hotel_id);
      }
    } catch (err) {
      console.error('[mollie webhook] Failed to update subscription in DB:', err);
    }

    return new Response(null, { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // Step 5b: Handle recurring payment (subscription payment)
  // subscriptionId is present on recurring payments
  // ---------------------------------------------------------------------------
  if (payment.subscriptionId) {
    const newStatus = payment.status === 'paid' ? 'active' : 'past_due';

    try {
      await (serviceSupabase as unknown as SupabaseClient)
        .from('subscriptions')
        .update({ status: newStatus } as Partial<Subscription>)
        .eq('provider_subscription_id', payment.subscriptionId);
    } catch (err) {
      console.error('[mollie webhook] Failed to update subscription status:', err);
    }

    return new Response(null, { status: 200 });
  }

  // Unknown payment type — return 200 to avoid retry
  return new Response(null, { status: 200 });
}
