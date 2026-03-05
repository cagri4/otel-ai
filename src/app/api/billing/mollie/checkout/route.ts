/**
 * Mollie subscription checkout initialization endpoint.
 *
 * POST /api/billing/mollie/checkout
 *
 * Creates a Mollie customer and a first payment to establish a recurring mandate.
 * Returns the checkout URL for client-side redirect.
 *
 * Flow:
 *   1. Authenticate user
 *   2. Parse request body: { planName }
 *   3. Get hotel data (name) and owner profile (email) from DB
 *   4. Get subscription to check trial_ends_at
 *   5. Create Mollie customer
 *   6. Create first payment (EUR 0.01, sequenceType='first' for mandate setup)
 *   7. Update subscriptions row with provider='mollie' and provider_customer_id
 *   8. Return { checkoutUrl } for client-side redirect to Mollie payment page
 *
 * After the customer completes payment, Mollie calls /api/webhooks/mollie
 * which creates the recurring subscription using the established mandate.
 *
 * Source: .planning/phases/06-billing/06-03-PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createMollieCustomer, createMollieFirstPayment } from '@/lib/billing/mollie';
import type { Hotel, Profile, Subscription } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckoutRequestBody {
  planName: 'starter' | 'pro' | 'enterprise';
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
  // Step 3: Get owner profile for email
  // ---------------------------------------------------------------------------
  const { data: profileData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const profile = profileData as Profile | null;
  const ownerEmail = profile?.full_name
    ? user.email ?? ''
    : user.email ?? '';

  // ---------------------------------------------------------------------------
  // Step 4: Parse and validate request body
  // ---------------------------------------------------------------------------
  let body: CheckoutRequestBody;
  try {
    body = (await request.json()) as CheckoutRequestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { planName } = body;

  if (!planName || !['starter', 'pro', 'enterprise'].includes(planName)) {
    return Response.json(
      { error: 'Invalid planName. Must be starter, pro, or enterprise.' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Step 5: Get subscription to retrieve trial_ends_at
  // ---------------------------------------------------------------------------
  const serviceSupabase = createServiceClient();
  const supabaseCast = serviceSupabase as unknown as SupabaseClient;

  const { data: subData } = await supabaseCast
    .from('subscriptions')
    .select('trial_ends_at')
    .eq('hotel_id', hotel.id)
    .maybeSingle();

  const sub = subData as Pick<Subscription, 'trial_ends_at'> | null;

  // Calculate trial_ends_at: use DB value or default to 14 days from now
  let trialEndsAt: string;
  if (sub?.trial_ends_at) {
    trialEndsAt = sub.trial_ends_at;
  } else {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 14);
    trialEndsAt = fallback.toISOString();
  }

  // ---------------------------------------------------------------------------
  // Step 6: Create Mollie customer
  // ---------------------------------------------------------------------------
  let mollieCustomerId: string;
  try {
    const customer = await createMollieCustomer({
      name: hotel.name,
      email: ownerEmail,
      metadata: { hotelId: hotel.id },
    });
    mollieCustomerId = customer.id;
  } catch (err) {
    console.error('[mollie checkout] Failed to create Mollie customer:', err);
    return Response.json({ error: 'Failed to create payment customer' }, { status: 502 });
  }

  // ---------------------------------------------------------------------------
  // Step 7: Create first payment (mandate setup, EUR 0.01)
  // ---------------------------------------------------------------------------
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const redirectUrl = `${appUrl}/api/billing/mollie/callback`;
  const webhookUrl = `${appUrl}/api/webhooks/mollie`;

  let checkoutUrl: string;
  try {
    const payment = await createMollieFirstPayment({
      customerId: mollieCustomerId,
      planName,
      redirectUrl,
      webhookUrl,
      trialEndsAt,
    });

    if (!payment._links.checkout?.href) {
      console.error('[mollie checkout] Payment has no checkout URL:', payment.id);
      return Response.json({ error: 'No checkout URL returned by Mollie' }, { status: 502 });
    }

    checkoutUrl = payment._links.checkout.href;
  } catch (err) {
    console.error('[mollie checkout] Failed to create first payment:', err);
    return Response.json({ error: 'Failed to create payment' }, { status: 502 });
  }

  // ---------------------------------------------------------------------------
  // Step 8: Update subscriptions row with provider info
  // Status stays 'trialing' until webhook confirms successful payment.
  // Use service client — authenticated RLS client cannot write to subscriptions.
  // ---------------------------------------------------------------------------
  try {
    await supabaseCast
      .from('subscriptions')
      .update({
        provider: 'mollie',
        provider_customer_id: mollieCustomerId,
      } as Partial<Subscription>)
      .eq('hotel_id', hotel.id);
  } catch (err) {
    // Non-fatal — log and continue. Webhook will update the subscription state.
    console.error('[mollie checkout] Failed to update subscription row:', err);
  }

  // ---------------------------------------------------------------------------
  // Step 9: Return checkout URL for client-side redirect
  // ---------------------------------------------------------------------------
  return Response.json({ checkoutUrl });
}
