/**
 * iyzico subscription plan upgrade/downgrade endpoint.
 *
 * POST /api/billing/iyzico/upgrade
 *
 * Changes the authenticated hotel's iyzico subscription to a different
 * pricing plan. Blocks downgrades when the hotel has more enabled agents
 * than the target plan allows.
 *
 * Flow:
 *   1. Authenticate user
 *   2. Parse body: { newPlanName, upgradePeriod }
 *   3. Fetch current subscription — validate provider is 'iyzico'
 *   4. If downgrading: check enabled agent count vs new plan's maxAgents
 *   5. Call iyzico subscription.upgrade()
 *   6. Update subscriptions row with new plan_name
 *   7. Return 200 with updated subscription info
 *
 * Downgrade policy: Block downgrade if enabled agents exceed new tier limit.
 * (per research recommendation — do NOT auto-disable agents)
 *
 * Source: .planning/phases/06-billing/06-02-PLAN.md
 */

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getIyzicoPlanRef,
  upgradeIyzicoSubscription,
} from '@/lib/billing/iyzico';
import { PLAN_LIMITS, PLAN_NAMES, type PlanName } from '@/lib/billing/plans';
import type { Hotel, Subscription } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UpgradeRequestBody {
  newPlanName: 'starter' | 'pro' | 'enterprise';
  upgradePeriod?: 'NOW' | 'NEXT_PERIOD';
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
  let body: UpgradeRequestBody;
  try {
    body = (await request.json()) as UpgradeRequestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { newPlanName, upgradePeriod = 'NOW' } = body;

  const validPaidPlans = PLAN_NAMES.filter((p) => p !== 'trial') as Array<
    Exclude<PlanName, 'trial'>
  >;
  if (!newPlanName || !validPaidPlans.includes(newPlanName)) {
    return Response.json(
      { error: 'Invalid newPlanName. Must be starter, pro, or enterprise.' },
      { status: 400 },
    );
  }

  if (!['NOW', 'NEXT_PERIOD'].includes(upgradePeriod)) {
    return Response.json({ error: 'upgradePeriod must be NOW or NEXT_PERIOD' }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Step 4: Fetch current subscription via service client
  // ---------------------------------------------------------------------------
  const serviceSupabase = createServiceClient();

  // Use SupabaseClient cast to avoid TypeScript never inference for manually-typed
  // subscriptions table (same pattern as enforcement.ts — Phase 6 Plan 1 decision)
  const { data: subscriptionData, error: subError } = await (serviceSupabase as unknown as SupabaseClient)
    .from('subscriptions')
    .select('*')
    .eq('hotel_id', hotel.id)
    .single();

  const subscription = subscriptionData as Subscription | null;

  if (subError || !subscription) {
    return Response.json({ error: 'Subscription not found' }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // Step 5: Validate provider is iyzico
  // ---------------------------------------------------------------------------
  if (subscription.provider !== 'iyzico') {
    return Response.json(
      {
        error: 'This hotel is not on an iyzico subscription. Use the appropriate provider endpoint.',
        provider: subscription.provider,
      },
      { status: 400 },
    );
  }

  if (!subscription.provider_subscription_id) {
    return Response.json(
      { error: 'No active iyzico subscription reference found. Complete checkout first.' },
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
    // SupabaseClient cast for the same never-inference reason
    const { count: enabledAgentCount, error: agentError } = await (serviceSupabase as unknown as SupabaseClient)
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('hotel_id', hotel.id)
      .eq('is_enabled', true);

    if (agentError) {
      console.error('[iyzico upgrade] Failed to count enabled agents:', agentError);
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
  // Step 7: Get new pricing plan reference code
  // ---------------------------------------------------------------------------
  let newPricingPlanReferenceCode: string;
  try {
    newPricingPlanReferenceCode = getIyzicoPlanRef(newPlanName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan configuration error';
    return Response.json({ error: message }, { status: 500 });
  }

  // ---------------------------------------------------------------------------
  // Step 8: Call iyzico subscription upgrade API
  // ---------------------------------------------------------------------------
  let upgradeResult: Awaited<ReturnType<typeof upgradeIyzicoSubscription>>;
  try {
    upgradeResult = await upgradeIyzicoSubscription({
      subscriptionReferenceCode: subscription.provider_subscription_id,
      newPricingPlanReferenceCode,
      upgradePeriod,
    });
  } catch (err) {
    console.error('[iyzico upgrade] upgradeIyzicoSubscription error:', err);
    return Response.json({ error: 'Failed to upgrade subscription with iyzico' }, { status: 502 });
  }

  if (upgradeResult.status !== 'success') {
    console.error('[iyzico upgrade] iyzico returned failure:', {
      errorCode: upgradeResult.errorCode,
      errorMessage: upgradeResult.errorMessage,
    });
    return Response.json(
      {
        error: 'Subscription upgrade failed',
        errorCode: upgradeResult.errorCode,
        errorMessage: upgradeResult.errorMessage,
      },
      { status: 502 },
    );
  }

  // ---------------------------------------------------------------------------
  // Step 9: Update subscriptions row with new plan_name
  // ---------------------------------------------------------------------------
  const { error: updateError } = await (serviceSupabase as unknown as SupabaseClient)
    .from('subscriptions')
    .update({ plan_name: newPlanName })
    .eq('hotel_id', hotel.id);

  if (updateError) {
    console.error('[iyzico upgrade] Failed to update plan_name in DB:', updateError);
    // Non-fatal — iyzico was updated successfully; DB will sync via webhook
    // Log and continue to return success
  }

  return Response.json({
    status: 'success',
    planName: newPlanName,
    upgradePeriod,
    subscriptionReferenceCode: subscription.provider_subscription_id,
  });
}
