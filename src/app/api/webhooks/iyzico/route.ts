/**
 * iyzico subscription webhook handler.
 *
 * POST /api/webhooks/iyzico
 *
 * Receives subscription lifecycle events from iyzico and updates the
 * subscriptions table accordingly. Called server-to-server by iyzico —
 * no user session is present, so a service-role client is used.
 *
 * Security: X-IYZ-SIGNATURE-V3 HMAC is validated before any DB write.
 * Always returns 200 — even on DB errors — to prevent iyzico retry storms.
 *
 * Supported events:
 *   subscription.order.success  → status = 'active', trial_ends_at = null
 *   subscription.order.failure  → status = 'past_due'
 *   subscription.cancel         → status = 'canceled'
 *
 * Source: .planning/phases/06-billing/06-02-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';
import { validateIyzicoSignature } from '@/lib/billing/iyzico';
import type { SubscriptionStatus } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

// crypto module requires Node.js runtime (not Edge)
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Step 1: Read raw body FIRST — must happen before any JSON parsing.
  // Signature validation requires the exact raw bytes; never call .json() first.
  // ---------------------------------------------------------------------------
  const rawBody = await request.text();

  // ---------------------------------------------------------------------------
  // Step 2: Parse JSON from raw text
  // ---------------------------------------------------------------------------
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.error('[iyzico webhook] Failed to parse JSON body');
    return new Response('Bad Request', { status: 400 });
  }

  const iyziEventType = typeof payload.iyziEventType === 'string' ? payload.iyziEventType : '';
  const subscriptionReferenceCode =
    typeof payload.subscriptionReferenceCode === 'string'
      ? payload.subscriptionReferenceCode
      : '';
  const orderReferenceCode =
    typeof payload.orderReferenceCode === 'string' ? payload.orderReferenceCode : '';
  const customerReferenceCode =
    typeof payload.customerReferenceCode === 'string' ? payload.customerReferenceCode : '';

  // ---------------------------------------------------------------------------
  // Step 3: Validate signature before any DB operation
  // ---------------------------------------------------------------------------
  const providedSignature = request.headers.get('x-iyz-signature-v3') ?? '';

  const isValid = validateIyzicoSignature(
    iyziEventType,
    subscriptionReferenceCode,
    orderReferenceCode,
    customerReferenceCode,
    providedSignature,
  );

  if (!isValid) {
    console.warn('[iyzico webhook] Invalid signature', { iyziEventType });
    return new Response('Unauthorized', { status: 401 });
  }

  // ---------------------------------------------------------------------------
  // Step 4: Map event type to subscription status update
  // ---------------------------------------------------------------------------
  let newStatus: SubscriptionStatus | null = null;
  let clearTrial = false;

  switch (iyziEventType) {
    case 'subscription.order.success':
      newStatus = 'active';
      clearTrial = true;
      break;
    case 'subscription.order.failure':
      newStatus = 'past_due';
      break;
    case 'subscription.cancel':
      newStatus = 'canceled';
      break;
    default:
      // Unknown event — acknowledge receipt but take no action
      console.log('[iyzico webhook] Unhandled event type:', iyziEventType);
      return new Response('OK', { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // Step 5: Update subscriptions table via service-role client (bypasses RLS)
  // Webhooks have no user session — service_role required.
  // Always return 200, even on DB error, to prevent iyzico retry storms.
  // ---------------------------------------------------------------------------
  const supabase = createServiceClient();

  try {
    // Build the update payload
    const updateData: Record<string, unknown> = { status: newStatus };
    if (clearTrial) {
      updateData.trial_ends_at = null;
    }

    // Use SupabaseClient cast to avoid TypeScript never inference for manually-typed
    // subscriptions table (same pattern as enforcement.ts — Phase 6 Plan 1 decision)
    const { error } = await (supabase as unknown as SupabaseClient)
      .from('subscriptions')
      .update(updateData)
      .eq('provider_subscription_id', subscriptionReferenceCode);

    if (error) {
      console.error('[iyzico webhook] DB update error:', {
        iyziEventType,
        subscriptionReferenceCode,
        error: error.message,
      });
    } else {
      console.log('[iyzico webhook] Subscription updated:', {
        iyziEventType,
        subscriptionReferenceCode,
        newStatus,
      });
    }
  } catch (err) {
    // Log but do NOT re-throw — must return 200 to prevent retry storm
    console.error('[iyzico webhook] Unexpected error:', err);
  }

  return new Response('OK', { status: 200 });
}
