/**
 * Mollie subscription plan change endpoint.
 *
 * POST /api/billing/mollie/change-plan
 *
 * Changes the authenticated hotel's Mollie subscription to a different plan.
 * Blocks downgrades when the hotel has more enabled agents than the target plan allows.
 *
 * Flow:
 *   1. Authenticate user
 *   2. Parse body: { newPlanName }
 *   3. Fetch current subscription — validate provider is 'mollie'
 *   4. If downgrading: check enabled agent count vs new plan's maxAgents
 *   5. List mandates to find valid one for the customer
 *   6. Call changeMolliePlan() — cancels current subscription, creates new one
 *   7. Update subscriptions row with new plan_name and new provider_subscription_id
 *   8. Return 200 with updated subscription info
 *
 * Downgrade policy: Block downgrade if enabled agents exceed new tier limit.
 * (per plan spec — do NOT auto-disable agents)
 *
 * Source: .planning/phases/06-billing/06-03-PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { mollieClient, changeMolliePlan } from '@/lib/billing/mollie';
import { PLAN_LIMITS, PLAN_NAMES, PLAN_PRICES, type PlanName } from '@/lib/billing/plans';
import type { Hotel, Subscription } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChangePlanRequestBody {
  newPlanName: 'starter' | 'pro' | 'enterprise';
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
  let body: ChangePlanRequestBody;
  try {
    body = (await request.json()) as ChangePlanRequestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { newPlanName } = body;

  const validPaidPlans = PLAN_NAMES.filter((p) => p !== 'trial') as Array<
    Exclude<PlanName, 'trial'>
  >;
  if (!newPlanName || !validPaidPlans.includes(newPlanName)) {
    return Response.json(
      { error: 'Invalid newPlanName. Must be starter, pro, or enterprise.' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Step 4: Fetch current subscription via service client
  // ---------------------------------------------------------------------------
  const serviceSupabase = createServiceClient();
  const supabaseCast = serviceSupabase as unknown as SupabaseClient;

  // Use SupabaseClient cast to avoid TypeScript never inference for manually-typed
  // subscriptions table (same pattern as enforcement.ts — Phase 6 Plan 1 decision)
  const { data: subscriptionData, error: subError } = await supabaseCast
    .from('subscriptions')
    .select('*')
    .eq('hotel_id', hotel.id)
    .single();

  const subscription = subscriptionData as Subscription | null;

  if (subError || !subscription) {
    return Response.json({ error: 'Subscription not found' }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // Step 5: Validate provider is mollie
  // ---------------------------------------------------------------------------
  if (subscription.provider !== 'mollie') {
    return Response.json(
      {
        error: 'This hotel is not on a Mollie subscription. Use the appropriate provider endpoint.',
        provider: subscription.provider,
      },
      { status: 400 },
    );
  }

  if (!subscription.provider_subscription_id) {
    return Response.json(
      { error: 'No active Mollie subscription found. Complete checkout first.' },
      { status: 400 },
    );
  }

  if (!subscription.provider_customer_id) {
    return Response.json(
      { error: 'No Mollie customer ID found. Complete checkout first.' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Step 6: Downgrade check — block if enabled agents exceed new plan limit
  // ---------------------------------------------------------------------------
  const currentPlanName = subscription.plan_name as PlanName;
  const currentPlanMaxAgents = PLAN_LIMITS[currentPlanName]?.maxAgents ?? 0;
  const newPlanMaxAgents = PLAN_LIMITS[newPlanName].maxAgents;

  const isDowngrade = newPlanMaxAgents < currentPlanMaxAgents;

  if (isDowngrade) {
    // Count currently enabled agents for this hotel
    const { count: enabledAgentCount, error: agentError } = await supabaseCast
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('hotel_id', hotel.id)
      .eq('is_enabled', true);

    if (agentError) {
      console.error('[mollie change-plan] Failed to count enabled agents:', agentError);
      return Response.json({ error: 'Failed to validate agent count' }, { status: 500 });
    }

    const agentCount = enabledAgentCount ?? 0;

    if (agentCount > newPlanMaxAgents) {
      const excess = agentCount - newPlanMaxAgents;
      return Response.json(
        {
          error: `Cannot downgrade to ${newPlanName}: you have ${agentCount} agents enabled but this plan only allows ${newPlanMaxAgents}. Please disable ${excess} agent${excess > 1 ? 's' : ''} before downgrading.`,
          agentsEnabled: agentCount,
          newPlanMaxAgents,
          agentsToDisable: excess,
        },
        { status: 400 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Step 7: Find valid mandate for this customer
  // ---------------------------------------------------------------------------
  const customerId = subscription.provider_customer_id;
  let mandateId: string | undefined;

  try {
    const mandatesPage = await mollieClient.customerMandates.page({ customerId });
    const validMandate = mandatesPage.find(
      (m) => m.status === 'valid' || m.status === 'pending',
    );
    mandateId = validMandate?.id;
  } catch (err) {
    console.error('[mollie change-plan] Failed to list mandates:', err);
    return Response.json({ error: 'Failed to retrieve payment mandate' }, { status: 502 });
  }

  if (!mandateId) {
    return Response.json(
      { error: 'No valid mandate found. Customer must complete a first payment before changing plans.' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Step 8: Get EUR amount for new plan
  // ---------------------------------------------------------------------------
  const newPlanPrices = PLAN_PRICES[newPlanName];
  const newAmountEur = newPlanPrices.eur.toFixed(2);

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mollie`;

  // ---------------------------------------------------------------------------
  // Step 9: Change the Mollie subscription
  // Cancels current subscription, creates new one with same mandate
  // ---------------------------------------------------------------------------
  let newSubscriptionId: string;
  try {
    const newSubscription = await changeMolliePlan({
      customerId,
      currentSubscriptionId: subscription.provider_subscription_id,
      mandateId,
      newPlanName,
      newAmountEur,
      webhookUrl,
    });
    newSubscriptionId = newSubscription.id;
  } catch (err) {
    console.error('[mollie change-plan] Failed to change subscription:', err);
    return Response.json({ error: 'Failed to change subscription plan' }, { status: 502 });
  }

  // ---------------------------------------------------------------------------
  // Step 10: Update subscriptions row with new plan_name and new subscription ID
  // ---------------------------------------------------------------------------
  const { error: updateError } = await supabaseCast
    .from('subscriptions')
    .update({
      plan_name: newPlanName,
      provider_subscription_id: newSubscriptionId,
    } as Partial<Subscription>)
    .eq('hotel_id', hotel.id);

  if (updateError) {
    console.error('[mollie change-plan] Failed to update subscription in DB:', updateError);
    // Non-fatal — Mollie was updated successfully; DB will sync via webhook
    // Log and continue to return success
  }

  return Response.json({
    status: 'success',
    planName: newPlanName,
    subscriptionId: newSubscriptionId,
  });
}
