/**
 * iyzico subscription checkout initialization endpoint.
 *
 * POST /api/billing/iyzico/checkout
 *
 * Initiates an iyzico subscription checkout form for the authenticated hotel owner.
 * Returns the checkout form HTML content (or token) that the client renders
 * to complete payment.
 *
 * Flow:
 *   1. Authenticate user
 *   2. Parse request body: { planName, customer }
 *   3. Resolve iyzico pricing plan reference code from planName
 *   4. Call iyzico subscriptionCheckoutForm.initialize()
 *   5. Update subscriptions row with provider info (status stays 'trialing'
 *      until webhook confirms successful payment)
 *   6. Return checkout form content / token to client
 *
 * Source: .planning/phases/06-billing/06-02-PLAN.md
 */

import { createClient } from '@/lib/supabase/server';
import { getIyzicoPlanRef, initSubscriptionCheckoutForm } from '@/lib/billing/iyzico';
import type { Hotel } from '@/types/database';
import type { CheckoutFormCustomer } from '@/lib/billing/iyzico';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckoutRequestBody {
  planName: 'starter' | 'pro' | 'enterprise';
  customer: CheckoutFormCustomer;
}

export async function POST(request: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Step 1: Authenticate user
  // ---------------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---------------------------------------------------------------------------
  // Step 2: Get hotel from authenticated session (RLS ensures single hotel)
  // ---------------------------------------------------------------------------
  const { data: hotelData, error: hotelError } = await supabase
    .from('hotels')
    .select('*')
    .single();

  const hotel = hotelData as Hotel | null;

  if (hotelError || !hotel) {
    return Response.json({ error: 'Hotel not found' }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // Step 3: Parse and validate request body
  // ---------------------------------------------------------------------------
  let body: CheckoutRequestBody;
  try {
    body = (await request.json()) as CheckoutRequestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { planName, customer } = body;

  if (!planName || !['starter', 'pro', 'enterprise'].includes(planName)) {
    return Response.json({ error: 'Invalid planName. Must be starter, pro, or enterprise.' }, { status: 400 });
  }

  if (!customer?.name || !customer?.surname || !customer?.email) {
    return Response.json(
      { error: 'Customer name, surname, and email are required.' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Step 4: Get iyzico pricing plan reference code
  // ---------------------------------------------------------------------------
  let pricingPlanReferenceCode: string;
  try {
    pricingPlanReferenceCode = getIyzicoPlanRef(planName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan configuration error';
    return Response.json({ error: message }, { status: 500 });
  }

  // ---------------------------------------------------------------------------
  // Step 5: Initialize iyzico subscription checkout form
  // ---------------------------------------------------------------------------
  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/billing/iyzico/callback`;

  let checkoutResult: Awaited<ReturnType<typeof initSubscriptionCheckoutForm>>;
  try {
    checkoutResult = await initSubscriptionCheckoutForm({
      pricingPlanReferenceCode,
      callbackUrl,
      customer,
    });
  } catch (err) {
    console.error('[iyzico checkout] initSubscriptionCheckoutForm error:', err);
    return Response.json({ error: 'Failed to initialize checkout form' }, { status: 502 });
  }

  if (checkoutResult.status !== 'success') {
    console.error('[iyzico checkout] iyzico returned failure:', {
      errorCode: checkoutResult.errorCode,
      errorMessage: checkoutResult.errorMessage,
    });
    return Response.json(
      {
        error: 'Checkout initialization failed',
        errorCode: checkoutResult.errorCode,
        errorMessage: checkoutResult.errorMessage,
      },
      { status: 502 },
    );
  }

  // ---------------------------------------------------------------------------
  // Step 6: Update subscriptions row with provider and customer info.
  // Status stays 'trialing' until iyzico webhook confirms successful payment.
  // Use service client here for the update — the authenticated RLS client
  // cannot write to subscriptions (write policy requires service_role).
  // ---------------------------------------------------------------------------
  try {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const serviceSupabase = createServiceClient();

    // Use SupabaseClient cast to avoid TypeScript never inference for manually-typed
    // subscriptions table (same pattern as enforcement.ts — Phase 6 Plan 1 decision)
    await (serviceSupabase as unknown as SupabaseClient)
      .from('subscriptions')
      .update({
        provider: 'iyzico',
        plan_name: planName,
        provider_customer_id: customer.email, // Use email as customer identifier pre-webhook
        // provider_subscription_id is set by the webhook after successful first payment
      })
      .eq('hotel_id', hotel.id);
  } catch (err) {
    // Non-fatal — log and continue. The webhook will update the subscription state.
    console.error('[iyzico checkout] Failed to update subscription row:', err);
  }

  // ---------------------------------------------------------------------------
  // Step 7: Return checkout form content to client
  // ---------------------------------------------------------------------------
  return Response.json({
    status: 'success',
    checkoutFormContent: checkoutResult.checkoutFormContent,
    token: checkoutResult.token,
    tokenExpireTime: checkoutResult.tokenExpireTime,
  });
}
