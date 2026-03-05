/**
 * POST /api/widget/message — Receives a guest message, invokes the Front Desk agent,
 * and broadcasts the AI response via Supabase Realtime Broadcast.
 *
 * Security model:
 * - hotelId is parsed server-side from conversationId (format: widget_{hotelId}_{uuid})
 * - Never trust hotelId from the client request body
 * - Rate limiting applied per hotel before invoking the agent
 * - Input sanitized for prompt injection before reaching the agent
 *
 * Realtime delivery:
 * - Agent response is sent to `widget_responses:{conversationId}` broadcast channel
 * - The ChatWidget on the guest's browser subscribes to this channel
 * - This avoids HTTP long-polling and provides real-time delivery
 *
 * Source: .planning/phases/04-guest-facing-layer/04-03-PLAN.md
 */

import { invokeAgent } from '@/lib/agents/invokeAgent';
import { AgentRole } from '@/lib/agents/types';
import { sanitizeGuestInput } from '@/lib/security/sanitizeGuestInput';
import { checkHotelRateLimit } from '@/lib/security/rateLimiter';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Handles an inbound guest message from the widget.
 *
 * Request body: { message: string, conversationId: string }
 * Response: { ok: true } on success, or error with status code
 *
 * NOTE: hotelId is NOT accepted from the client. It is parsed server-side from
 * the conversationId (format: widget_{hotelId}_{uuid}) to prevent a malicious
 * client from spoofing a different hotel's context.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    // -------------------------------------------------------------------------
    // Step 1: Parse and validate request body
    // -------------------------------------------------------------------------
    let message: string;
    let conversationId: string;

    try {
      const body = await req.json();
      message = body.message;
      conversationId = body.conversationId;
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    if (!conversationId || typeof conversationId !== 'string' || conversationId.trim() === '') {
      return Response.json({ error: 'conversationId is required' }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // Step 2: Parse hotelId server-side from conversationId
    // Format: widget_{hotelId}_{uuid}
    // NEVER trust hotelId from the client request body.
    // -------------------------------------------------------------------------
    const parts = conversationId.split('_');
    if (parts.length < 3 || parts[0] !== 'widget') {
      return Response.json({ error: 'Invalid conversationId' }, { status: 400 });
    }
    const hotelId = parts[1];

    // -------------------------------------------------------------------------
    // Step 3: Apply per-hotel rate limiting
    // Returns { success: true } if Redis is unavailable (graceful degradation)
    // -------------------------------------------------------------------------
    const rateLimit = await checkHotelRateLimit(hotelId);
    if (!rateLimit.success) {
      return Response.json(
        { error: 'Rate limit exceeded. Please wait before sending another message.' },
        { status: 429 },
      );
    }

    // -------------------------------------------------------------------------
    // Step 4: Sanitize guest input (prompt injection protection)
    // -------------------------------------------------------------------------
    const sanitized = sanitizeGuestInput(message);

    // -------------------------------------------------------------------------
    // Step 5: Invoke the Front Desk agent (non-streaming)
    // Response will be broadcast via Supabase Realtime instead
    // -------------------------------------------------------------------------
    const response = await invokeAgent({
      role: AgentRole.FRONT_DESK,
      userMessage: sanitized,
      conversationId: conversationId.trim(),
      hotelId,
    });

    // -------------------------------------------------------------------------
    // Step 6: Broadcast response to guest via Supabase Realtime
    // Uses service-role client for server-side broadcast (no user session)
    // -------------------------------------------------------------------------
    const supabase = createServiceClient();
    const channel = supabase.channel(`widget_responses:${conversationId}`);

    await channel.send({
      type: 'broadcast',
      event: 'message',
      payload: {
        role: 'assistant',
        content: response,
        created_at: new Date().toISOString(),
      },
    });

    await supabase.removeChannel(channel);

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[widget/message] Error processing message:', err);
    return Response.json({ error: 'Failed to process message' }, { status: 500 });
  }
}
