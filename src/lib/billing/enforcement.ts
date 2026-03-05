/**
 * Agent limit enforcement for billing plan tiers.
 *
 * enforceAgentLimit() is called server-side before any agent enable/disable toggle.
 * It reads the hotel's subscription row (via service client to bypass RLS) and
 * checks whether adding another enabled agent would exceed the tier's limit.
 *
 * Why service client: This runs inside server actions where the hotel_id is already
 * validated by the session. Using service client avoids the RLS "no active session"
 * problem while keeping enforcement server-side only.
 *
 * Source: .planning/phases/06-billing/06-RESEARCH.md — Pattern 3
 */

import { createServiceClient } from '@/lib/supabase/service';
import { PLAN_LIMITS, type PlanName } from './plans';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function enforceAgentLimit(hotelId: string): Promise<{
  allowed: boolean;
  reason?: string;
  currentCount: number;
  maxAgents: number;
}> {
  const supabase = createServiceClient();

  // Query subscription for this hotel.
  // Uses SupabaseClient cast to avoid TypeScript never inference for manually-typed tables
  // (same pattern as escalation.ts, audit.ts — Phase 5 decision).
  const { data: sub } = await (supabase as unknown as SupabaseClient)
    .from('subscriptions')
    .select('plan_name, status, trial_ends_at')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  // No subscription row = treat as trial (should not happen post-migration,
  // but graceful fallback for hotels created before 0006_billing.sql was applied)
  const planName = (sub?.plan_name ?? 'trial') as PlanName;
  const status = (sub?.status ?? 'trialing') as string;

  // Expired trial: block agent activation until payment is received
  if (status === 'trialing' && sub?.trial_ends_at) {
    const trialEnd = new Date(sub.trial_ends_at as string);
    if (trialEnd < new Date()) {
      return { allowed: false, reason: 'trial_expired', currentCount: 0, maxAgents: 0 };
    }
  }

  // Canceled subscription: block all agent activation
  if (status === 'canceled') {
    return { allowed: false, reason: 'subscription_canceled', currentCount: 0, maxAgents: 0 };
  }

  const limits = PLAN_LIMITS[planName];

  // Count currently enabled agents for this hotel
  const { count } = await (supabase as unknown as SupabaseClient)
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('hotel_id', hotelId)
    .eq('is_enabled', true);

  const currentCount = (count as number | null) ?? 0;

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
