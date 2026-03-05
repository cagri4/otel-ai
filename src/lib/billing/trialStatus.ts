/**
 * Subscription status helper for billing UI and server-side checks.
 *
 * getSubscriptionStatus() returns a rich status object including trial days
 * remaining, expiry flag, and plan limits — suitable for rendering billing
 * dashboard pages and making plan-enforcement decisions in server components.
 *
 * Uses service client (bypasses RLS) because this is called from server-side
 * contexts (server actions, server components) where billing state is needed
 * regardless of the current user session scope.
 *
 * Note: Named SubscriptionInfo (not SubscriptionStatus) to avoid name clash
 * with the SubscriptionStatus DB column type defined in database.ts.
 *
 * Source: .planning/phases/06-billing/06-RESEARCH.md — Pattern, Subscription Status Helper
 */

import { createServiceClient } from '@/lib/supabase/service';
import { PLAN_LIMITS, type PlanName } from './plans';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SubscriptionInfo = {
  planName: PlanName;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null; // null when not in active trial
  maxAgents: number;
  isTrialExpired: boolean;
  provider: 'iyzico' | 'mollie' | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
};

export async function getSubscriptionStatus(hotelId: string): Promise<SubscriptionInfo> {
  const supabase = createServiceClient();

  // Uses SupabaseClient cast to avoid TypeScript never inference for manually-typed tables
  // (same pattern as escalation.ts, audit.ts — Phase 5 decision).
  const { data: sub } = await (supabase as unknown as SupabaseClient)
    .from('subscriptions')
    .select('plan_name, status, trial_ends_at, provider, provider_customer_id, provider_subscription_id')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  const planName = ((sub?.plan_name as string | null) ?? 'trial') as PlanName;
  const status = ((sub?.status as string | null) ?? 'trialing') as SubscriptionInfo['status'];
  const trialEndsAt = sub?.trial_ends_at ? new Date(sub.trial_ends_at as string) : null;

  const now = new Date();

  // Trial is expired when: status is still 'trialing' AND trial_ends_at is in the past
  const isTrialExpired = status === 'trialing' && trialEndsAt !== null && trialEndsAt < now;

  // Days remaining: only computed when trialing and not yet expired
  const trialDaysRemaining =
    trialEndsAt && !isTrialExpired
      ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

  return {
    planName,
    status,
    trialEndsAt,
    trialDaysRemaining,
    maxAgents: PLAN_LIMITS[planName].maxAgents,
    isTrialExpired,
    provider: ((sub?.provider as string | null) ?? null) as 'iyzico' | 'mollie' | null,
    providerCustomerId: (sub?.provider_customer_id as string | null) ?? null,
    providerSubscriptionId: (sub?.provider_subscription_id as string | null) ?? null,
  };
}
