/**
 * POST /api/escalations — Escalation notification endpoint.
 *
 * Receives an escalation record (inserted by detectAndInsertEscalation),
 * looks up the hotel's contact email, and sends a notification email to
 * the hotel owner via Resend.
 *
 * Also updates the escalation record with notified_at after email delivery.
 *
 * Called as fire-and-forget from detectAndInsertEscalation — this endpoint
 * must handle errors gracefully and never cause retries that harm the agent.
 *
 * Source: .planning/phases/04-guest-facing-layer/04-05-PLAN.md
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { Resend } from 'resend';
import { createServiceClient } from '@/lib/supabase/service';
import type { Hotel } from '@/types/database';

// =============================================================================
// POST Handler
// =============================================================================

export async function POST(req: Request): Promise<Response> {
  try {
    // Parse the escalation payload from the request body
    const body = (await req.json()) as {
      id: string | null;
      hotel_id: string;
      conversation_id: string;
      channel: string;
      guest_message: string;
      agent_response: string;
    };

    const { id, hotel_id, conversation_id, channel, guest_message, agent_response } = body;

    // Look up the hotel's contact email
    const supabase = createServiceClient();
    // .returns<T[]>() required for postgrest-js v12 type inference with manual Database types
    // See STATE.md decision: ".returns<T>() required for Supabase SELECT with manual Database types"
    const { data: hotels, error: hotelError } = await supabase
      .from('hotels')
      .select('name, contact_email')
      .eq('id', hotel_id)
      .returns<Pick<Hotel, 'name' | 'contact_email'>[]>();

    const hotel = hotels?.[0] ?? null;

    if (hotelError || !hotel) {
      console.error('[escalations] Failed to fetch hotel:', hotelError);
      return Response.json({ ok: false, error: 'Hotel not found' }, { status: 200 });
    }

    if (!hotel.contact_email) {
      // Cannot notify without a contact email — log and return 200
      // (returning 200 prevents infinite retry loops from the caller)
      console.warn('[escalations] Hotel has no contact_email, skipping notification:', hotel_id);
      return Response.json({ ok: true, skipped: 'no_contact_email' });
    }

    // Send escalation email via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'noreply@otelai.com',
      to: hotel.contact_email,
      subject: `[${hotel.name}] Guest needs assistance`,
      html: `
        <h2>Guest Escalation Alert</h2>
        <p><strong>Channel:</strong> ${channel}</p>
        <p><strong>Guest said:</strong></p>
        <blockquote>${guest_message}</blockquote>
        <p><strong>AI responded:</strong></p>
        <blockquote>${agent_response}</blockquote>
        <p><strong>Conversation ID:</strong> ${conversation_id}</p>
        <p>Please follow up with your guest as soon as possible.</p>
      `,
    });

    // Mark the escalation record as notified
    // Cast to ReturnType<typeof supabase.from> to work around postgrest-js v12 update type inference
    const notifiedAt = new Date().toISOString();

    if (id) {
      const { error: updateError } = await (supabase.from('escalations') as ReturnType<typeof supabase.from>)
        .update({ notified_at: notifiedAt } as Record<string, unknown>)
        .eq('id', id);

      if (updateError) {
        console.error('[escalations] Failed to set notified_at:', updateError);
        // Not fatal — email was already sent
      }
    } else {
      // No ID provided — try to update by conversation_id where notified_at is still null
      const { error: updateError } = await (supabase.from('escalations') as ReturnType<typeof supabase.from>)
        .update({ notified_at: notifiedAt } as Record<string, unknown>)
        .eq('conversation_id', conversation_id)
        .is('notified_at', null);

      if (updateError) {
        console.error('[escalations] Failed to set notified_at (by conversation_id):', updateError);
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[escalations] Unexpected error:', err);
    return Response.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
