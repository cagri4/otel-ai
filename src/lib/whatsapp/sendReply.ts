/**
 * WhatsApp reply sender via Twilio API.
 *
 * Wraps Twilio messages.create() with error logging and graceful error handling.
 * Errors are caught and logged but NOT re-thrown — the Twilio webhook must always
 * receive a 200 response to prevent infinite retries.
 *
 * Source: .planning/phases/04-guest-facing-layer/04-02-PLAN.md
 */

import twilio from 'twilio';

/**
 * Parameters for sending a WhatsApp reply via Twilio.
 */
interface SendWhatsAppReplyParams {
  /** The Twilio WhatsApp number to send from (e.g. "whatsapp:+14155238886") */
  from: string;
  /** The guest's WhatsApp number to send to (e.g. "whatsapp:+15551234567") */
  to: string;
  /** The message body to send */
  body: string;
}

/**
 * Send a WhatsApp message reply via Twilio.
 *
 * Creates a Twilio client on every call (no module-level singleton needed —
 * env vars are stable; stateless per-request pattern matches Vercel serverless).
 *
 * @param params - from, to, and body for the outbound message
 * @returns void — errors are logged but not propagated
 */
export async function sendWhatsAppReply(params: SendWhatsAppReplyParams): Promise<void> {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

  try {
    const message = await client.messages.create({
      from: params.from,
      to: params.to,
      body: params.body,
    });

    console.log(`[sendWhatsAppReply] Message sent successfully. SID: ${message.sid}`);
  } catch (error) {
    // Log but do NOT throw — webhook must return 200 to prevent Twilio retries
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[sendWhatsAppReply] Failed to send WhatsApp message to ${params.to}: ${errorMessage}`);
  }
}
