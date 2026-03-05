/**
 * WhatsApp webhook route handler — /api/whatsapp/webhook
 *
 * Receives inbound WhatsApp messages from Twilio, validates the signature,
 * resolves the hotel, sanitizes input, invokes the Front Desk AI agent,
 * and sends the reply back to the guest via WhatsApp.
 *
 * Pipeline per message:
 * 1. Parse form-urlencoded body (Twilio always sends this format)
 * 2. Validate Twilio signature (403 on failure)
 * 3. Extract From, Body, To fields
 * 4. Resolve hotel from Twilio number (404 if unknown)
 * 5. Per-hotel rate limit (429 if exceeded)
 * 6. Sanitize guest input (injection blocking)
 * 7. Derive conversation ID: wa_{hotelId}_{guestPhone}
 * 8. Invoke Front Desk AI agent (non-streaming — WhatsApp needs full response)
 * 9. Send reply via Twilio
 * 10. Return 200 to Twilio (always, to prevent webhook retries)
 *
 * Anti-patterns avoided:
 * - NOT using req.json() — Twilio sends application/x-www-form-urlencoded
 * - NOT using SSE/streaming — WhatsApp expects a single complete message
 * - NOT throwing on send errors — Twilio must get 200 to prevent retries
 *
 * Source: .planning/phases/04-guest-facing-layer/04-02-PLAN.md
 */

import twilio from 'twilio';
import { AgentRole } from '@/lib/agents/types';
import { invokeAgent } from '@/lib/agents/invokeAgent';
import { sanitizeGuestInput } from '@/lib/security/sanitizeGuestInput';
import { checkHotelRateLimit } from '@/lib/security/rateLimiter';
import { resolveHotelFromNumber } from '@/lib/whatsapp/resolveHotel';
import { sendWhatsAppReply } from '@/lib/whatsapp/sendReply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/whatsapp/webhook
 *
 * Twilio webhook handler for inbound WhatsApp messages.
 * Always returns 200 on any path to prevent Twilio retry loops.
 */
export async function POST(req: Request): Promise<Response> {
  // --------------------------------------------------------------------------
  // Step 1: Parse form-urlencoded body
  // Twilio sends application/x-www-form-urlencoded, NOT JSON
  // --------------------------------------------------------------------------
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // --------------------------------------------------------------------------
  // Step 2: Validate Twilio signature
  // This must happen before any processing to prevent spoofed webhook calls
  // --------------------------------------------------------------------------
  const signature = req.headers.get('x-twilio-signature') ?? '';
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`;

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    webhookUrl,
    params,
  );

  if (!isValid) {
    console.warn('[WhatsApp webhook] Invalid Twilio signature — possible spoofed request');
    return new Response('Forbidden', { status: 403 });
  }

  // --------------------------------------------------------------------------
  // Steps 3-9: Full message pipeline wrapped in try/catch
  // On any error, log it and return 200 to prevent Twilio retries
  // --------------------------------------------------------------------------
  try {
    // Step 3: Extract fields from Twilio webhook payload
    const guestPhone = params.From ?? ''; // e.g. "whatsapp:+15551234567"
    const messageBody = params.Body ?? '';
    const twilioNumber = params.To ?? ''; // e.g. "whatsapp:+14155238886"

    if (!guestPhone || !messageBody || !twilioNumber) {
      console.error('[WhatsApp webhook] Missing required fields in Twilio payload', {
        hasFrom: Boolean(guestPhone),
        hasBody: Boolean(messageBody),
        hasTo: Boolean(twilioNumber),
      });
      return new Response('', { status: 200 });
    }

    // Step 4: Resolve hotel from Twilio number
    const hotelId = await resolveHotelFromNumber(twilioNumber);
    if (!hotelId) {
      console.warn('[WhatsApp webhook] No hotel found for Twilio number:', twilioNumber);
      return new Response('Not Found', { status: 404 });
    }

    // Step 5: Per-hotel rate limit
    const rateLimitResult = await checkHotelRateLimit(hotelId);
    if (!rateLimitResult.success) {
      console.warn('[WhatsApp webhook] Rate limit exceeded for hotel:', hotelId);
      return new Response('Too Many Requests', { status: 429 });
    }

    // Step 6: Sanitize guest input (injection blocking)
    const sanitizedBody = sanitizeGuestInput(messageBody);

    // Step 7: Derive conversation ID — persistent per guest phone + hotel
    // Format: wa_{hotelId}_{normalizedPhone}
    const normalizedPhone = guestPhone.replace(/^whatsapp:/i, '');
    const conversationId = `wa_${hotelId}_${normalizedPhone}`;

    // Step 8: Invoke Front Desk AI agent (non-streaming)
    // WhatsApp requires a complete message — no onToken callback
    const response = await invokeAgent({
      role: AgentRole.FRONT_DESK,
      userMessage: sanitizedBody,
      conversationId,
      hotelId,
      guestIdentifier: normalizedPhone,
      // No onToken — WhatsApp needs the complete message before sending
    });

    // Step 9: Send reply via Twilio
    await sendWhatsAppReply({
      from: twilioNumber,
      to: guestPhone,
      body: response,
    });
  } catch (error) {
    // Log the error but still return 200 to prevent Twilio retry storms
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[WhatsApp webhook] Unhandled error in message pipeline:', errorMessage);
  }

  // Step 10: Return 200 to Twilio on all paths
  return new Response('', { status: 200 });
}
