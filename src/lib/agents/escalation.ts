/**
 * Escalation detection and notification for the OtelAI system.
 *
 * Detects when the Front Desk AI cannot handle a guest request by checking
 * agent responses for known fallback phrases. When a fallback phrase is found:
 *   1. An escalation record is inserted into the escalations table.
 *   2. A POST notification is fired to /api/escalations (fire-and-forget).
 *
 * This module runs as a side effect after the agent responds — it MUST NOT
 * block or delay the guest-facing response flow.
 *
 * Source: .planning/phases/04-guest-facing-layer/04-05-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EscalationChannel } from '@/types/database';

// =============================================================================
// Fallback Phrase Dictionary
// =============================================================================

/**
 * Known phrases that indicate the AI could not handle the guest request.
 * All comparisons are case-insensitive (response is lowercased before check).
 */
const ESCALATION_PHRASES = [
  'please contact reception',
  'please call us directly',
  'i cannot help with this',
  'outside my capabilities',
  'please speak with a staff member',
  'i am unable to assist',
  'i recommend contacting the hotel directly',
  'this is beyond what i can do',
  // Booking-specific escalation triggers (Phase 7 — BOOKING_AI)
  // These match the phrases used in BOOKING_AI behavioral prompt escalation triggers.
  'group booking',
  'corporate rate',
  'special package',
  'extended stay',
  'negotiated rate',
  'contract required',
  'please contact reception directly for this',
  // Housekeeping-specific escalation triggers (Phase 8 — HOUSEKEEPING_COORDINATOR)
  // Situations beyond normal cleaning that require professional/maintenance attention.
  'please contact a maintenance team directly for this',
  'maintenance issue',
  'plumbing problem',
  'safety hazard',
] as const;

// =============================================================================
// Escalation Detection
// =============================================================================

/**
 * Detects if the agent response contains a fallback phrase and, if so,
 * inserts an escalation record and fires a notification to /api/escalations.
 *
 * Fire-and-forget: always called without await in invokeAgent.
 * Internal try/catch ensures this function never throws to the caller.
 *
 * @param params.response        - The agent's response text
 * @param params.userMessage     - The guest's original message
 * @param params.conversationId  - The conversation identifier (used for channel detection)
 * @param params.hotelId         - The hotel UUID
 * @param params.channel         - Source channel (whatsapp | widget | dashboard)
 */
export async function detectAndInsertEscalation(params: {
  response: string;
  userMessage: string;
  conversationId: string;
  hotelId: string;
  channel: EscalationChannel;
}): Promise<void> {
  const { response, userMessage, conversationId, hotelId } = params;

  // Determine channel from conversationId prefix for consistency.
  // Server-side detection prevents spoofing: channel param is ignored here.
  // wa_ = WhatsApp, tg_ = Telegram, default = widget.
  const channel: EscalationChannel = conversationId.startsWith('wa_')
    ? 'whatsapp'
    : conversationId.startsWith('tg_')
      ? 'telegram'
      : 'widget';

  // Check if agent response contains any known fallback phrase
  const lowerResponse = response.toLowerCase();
  const isEscalation = ESCALATION_PHRASES.some((phrase) => lowerResponse.includes(phrase));

  if (!isEscalation) {
    // No escalation needed — return early without any DB or network activity
    return;
  }

  try {
    // Insert escalation record into the database
    // Cast to bypass postgrest-js v12 Insert type inference issue with manual Database types.
    const supabase = createServiceClient();
    const { data: escalationRecord, error: insertError } = await (supabase as unknown as SupabaseClient)
      .from('escalations')
      .insert({
        hotel_id: hotelId,
        conversation_id: conversationId,
        channel,
        guest_message: userMessage,
        agent_response: response,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[escalation] Failed to insert escalation record:', insertError);
      return;
    }

    // Fire-and-forget notification to /api/escalations
    // AbortSignal.timeout(5000) prevents hanging requests; we do not await the response.
    const notificationPayload = {
      id: escalationRecord?.id ?? null,
      hotel_id: hotelId,
      conversation_id: conversationId,
      channel,
      guest_message: userMessage,
      agent_response: response,
    };

    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/escalations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notificationPayload),
      signal: AbortSignal.timeout(5000),
    }).catch((err) => {
      console.error('[escalation] Notification fetch failed:', err);
    });
  } catch (err) {
    // Must not throw — this is a side effect that must not crash the agent
    console.error('[escalation] Unexpected error in detectAndInsertEscalation:', err);
  }
}
