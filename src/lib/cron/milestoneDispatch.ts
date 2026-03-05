/**
 * Milestone dispatch core logic.
 *
 * Runs daily via Vercel cron (see vercel.json). Queries all hotels,
 * computes per-hotel dates using the hotel's IANA timezone, finds bookings
 * at each milestone (pre-arrival D-1, checkout D+0, post-stay D+1),
 * loads custom message templates or falls back to built-in defaults,
 * dispatches via WhatsApp (Twilio) or email (Resend), and marks sent flags.
 *
 * Each milestone is sent at most once per booking via the sent flag guards
 * (pre_arrival_sent, checkout_reminder_sent, review_request_sent).
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-02-PLAN.md
 */

import twilio from 'twilio';
import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Booking, MessageTemplate, MessageMilestone, BookingChannel, Hotel } from '@/types/database';

// =============================================================================
// Types
// =============================================================================

interface DispatchResult {
  hotelsProcessed: number;
  messagesSent: number;
  errors: number;
}

interface MilestoneDispatchParams {
  booking: Booking;
  milestone: MessageMilestone;
  hotelName: string;
  templates: MessageTemplate[];
}

// =============================================================================
// Template helpers
// =============================================================================

/**
 * Substitute {{variable}} placeholders in a template body.
 */
function applyTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/**
 * Find a matching template for the given milestone + channel, or return null.
 */
function findTemplate(
  templates: MessageTemplate[],
  milestone: MessageMilestone,
  channel: BookingChannel,
): MessageTemplate | null {
  return templates.find((t) => t.milestone === milestone && t.channel === channel) ?? null;
}

/**
 * Default message bodies when no custom template is configured.
 */
const DEFAULT_BODIES: Record<MessageMilestone, string> = {
  pre_arrival:
    'Dear {{guest_name}}, we\'re looking forward to welcoming you to {{hotel_name}} tomorrow! ' +
    'Check-in starts at 3:00 PM. If you need anything before your arrival, don\'t hesitate to reach out.',
  checkout_reminder:
    'Good morning {{guest_name}}! Just a friendly reminder that checkout at {{hotel_name}} ' +
    'is at 11:00 AM today. We hope you\'ve had a wonderful stay!',
  review_request:
    'Dear {{guest_name}}, thank you for staying with us at {{hotel_name}}! ' +
    'We hope you enjoyed your visit. We would love to hear about your experience.',
};

/**
 * Default email subjects when no custom template is configured.
 */
const DEFAULT_SUBJECTS: Record<MessageMilestone, string> = {
  pre_arrival: 'Your upcoming stay — we\'re looking forward to welcoming you!',
  checkout_reminder: 'Checkout reminder — today is your checkout day',
  review_request: 'Thank you for your stay — share your experience!',
};

/**
 * Build the final message body for a booking + milestone.
 * Uses custom template if available, falls back to built-in default.
 */
function buildMessageBody(
  booking: Booking,
  milestone: MessageMilestone,
  hotelName: string,
  template: MessageTemplate | null,
): string {
  const vars: Record<string, string> = {
    guest_name: booking.guest_name,
    hotel_name: hotelName,
    check_in_date: booking.check_in_date,
    check_out_date: booking.check_out_date,
  };
  const body = template?.body ?? DEFAULT_BODIES[milestone];
  return applyTemplate(body, vars);
}

/**
 * Build the email subject for a booking + milestone.
 * Uses custom template subject if available, falls back to default.
 */
function buildEmailSubject(
  milestone: MessageMilestone,
  template: MessageTemplate | null,
): string {
  return template?.subject ?? DEFAULT_SUBJECTS[milestone];
}

// =============================================================================
// WhatsApp sender (Twilio)
// =============================================================================

interface WhatsAppParams {
  to: string; // WhatsApp-formatted phone e.g. "+31612345678" (stored without prefix)
  body: string;
  milestone: MessageMilestone;
}

async function sendMilestoneWhatsApp(params: WhatsAppParams): Promise<void> {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

  // Format the guest phone to WhatsApp: prefix
  const toFormatted = params.to.startsWith('whatsapp:') ? params.to : `whatsapp:${params.to}`;

  // Post-stay review requests (D+1) are outside the 24-hour free-form window.
  // Use a content template if TWILIO_TEMPLATE_SID_REVIEW_REQUEST is configured.
  if (
    params.milestone === 'review_request' &&
    process.env.TWILIO_TEMPLATE_SID_REVIEW_REQUEST
  ) {
    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: toFormatted,
      contentSid: process.env.TWILIO_TEMPLATE_SID_REVIEW_REQUEST,
    });
  } else {
    // Free-form for pre-arrival and checkout (guest is within 24h conversation window)
    // Fall back to free-form for review requests when no template SID is set.
    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: toFormatted,
      body: params.body,
    });
  }
}

// =============================================================================
// Email sender (Resend)
// =============================================================================

interface EmailParams {
  to: string;
  subject: string;
  body: string;
}

async function sendMilestoneEmail(params: EmailParams): Promise<void> {
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Wrap plain text body in minimal HTML for email client compatibility
  const html = `<p style="font-family: sans-serif; line-height: 1.6;">${params.body.replace(/\n/g, '<br>')}</p>`;

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: params.to,
    subject: params.subject,
    html,
  });
}

// =============================================================================
// Per-booking dispatcher
// =============================================================================

/**
 * Dispatch a milestone message for a single booking.
 * Handles channel routing (WhatsApp vs email) and errors per booking.
 * Returns true if dispatched successfully, false on error.
 */
async function dispatchBookingMilestone(params: MilestoneDispatchParams): Promise<boolean> {
  const { booking, milestone, hotelName, templates } = params;

  try {
    const channel = booking.channel;
    const template = findTemplate(templates, milestone, channel);
    const body = buildMessageBody(booking, milestone, hotelName, template);

    if (channel === 'whatsapp') {
      if (!booking.guest_phone) {
        console.warn(`[milestoneDispatch] Booking ${booking.id} channel=whatsapp but no guest_phone — skipping`);
        return false;
      }

      // Post-stay review via WhatsApp requires a Twilio template SID.
      // If none is configured, fall back to email if email is available.
      if (milestone === 'review_request' && !process.env.TWILIO_TEMPLATE_SID_REVIEW_REQUEST) {
        if (booking.guest_email) {
          console.info(`[milestoneDispatch] Booking ${booking.id}: no review_request WhatsApp template SID — falling back to email`);
          const emailTemplate = findTemplate(templates, milestone, 'email');
          const emailBody = buildMessageBody(booking, milestone, hotelName, emailTemplate);
          const subject = buildEmailSubject(milestone, emailTemplate);
          await sendMilestoneEmail({ to: booking.guest_email, subject, body: emailBody });
        } else {
          console.warn(`[milestoneDispatch] Booking ${booking.id}: no review_request template SID and no guest_email — skipping`);
          return false;
        }
      } else {
        await sendMilestoneWhatsApp({ to: booking.guest_phone, body, milestone });
      }
    } else {
      // Email channel
      if (!booking.guest_email) {
        console.warn(`[milestoneDispatch] Booking ${booking.id} channel=email but no guest_email — skipping`);
        return false;
      }
      const subject = buildEmailSubject(milestone, template);
      await sendMilestoneEmail({ to: booking.guest_email, subject, body });
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[milestoneDispatch] Failed to dispatch ${milestone} for booking ${booking.id}: ${message}`);
    return false;
  }
}

// =============================================================================
// Sent flag updater
// =============================================================================

const SENT_FLAG_COLUMN: Record<MessageMilestone, 'pre_arrival_sent' | 'checkout_reminder_sent' | 'review_request_sent'> = {
  pre_arrival: 'pre_arrival_sent',
  checkout_reminder: 'checkout_reminder_sent',
  review_request: 'review_request_sent',
};

async function markSent(
  supabase: SupabaseClient,
  bookingId: string,
  milestone: MessageMilestone,
): Promise<void> {
  const column = SENT_FLAG_COLUMN[milestone];
  const { error } = await (supabase as unknown as SupabaseClient)
    .from('bookings')
    .update({ [column]: true })
    .eq('id', bookingId);

  if (error) {
    console.error(`[milestoneDispatch] Failed to mark ${column}=true for booking ${bookingId}: ${error.message}`);
  }
}

// =============================================================================
// Main export
// =============================================================================

/**
 * Process all hotels and dispatch milestone messages for bookings due today.
 *
 * - Pre-arrival: bookings with check_in_date = tomorrow (hotel timezone)
 * - Checkout reminder: bookings with check_out_date = today (hotel timezone)
 * - Post-stay review: bookings with check_out_date = yesterday (hotel timezone)
 *
 * Each milestone is sent at most once per booking (sent flag guard).
 * Hotels with guest_experience agent disabled are skipped.
 *
 * @returns Summary of processing: hotelsProcessed, messagesSent, errors
 */
export async function runMilestoneDispatch(): Promise<DispatchResult> {
  const supabase = createServiceClient();
  let hotelsProcessed = 0;
  let messagesSent = 0;
  let errors = 0;

  // Fetch all hotels with timezone info
  // Cast to unknown SupabaseClient to avoid TypeScript never inference for partial select,
  // then cast result to Hotel[] — same pattern as escalation.ts and audit.ts
  const { data: hotels, error: hotelsError } = await (supabase as unknown as SupabaseClient)
    .from('hotels')
    .select('id, name, timezone, contact_email');

  if (hotelsError) {
    throw new Error(`[milestoneDispatch] Failed to fetch hotels: ${hotelsError.message}`);
  }

  if (!hotels || hotels.length === 0) {
    console.info('[milestoneDispatch] No hotels found — nothing to process');
    return { hotelsProcessed: 0, messagesSent: 0, errors: 0 };
  }

  for (const hotel of hotels as Pick<Hotel, 'id' | 'name' | 'timezone' | 'contact_email'>[]) {
    try {
      // Check if guest_experience agent is enabled for this hotel
      const { data: agentConfig } = await (supabase as unknown as SupabaseClient)
        .from('agents')
        .select('is_enabled')
        .eq('hotel_id', hotel.id)
        .eq('role', 'guest_experience')
        .maybeSingle();

      // No agent row = treat as enabled (hotels created before Phase 5 migration)
      if (agentConfig && !(agentConfig as { is_enabled: boolean }).is_enabled) {
        console.info(`[milestoneDispatch] Hotel ${hotel.id} (${hotel.name}): guest_experience agent disabled — skipping`);
        continue;
      }

      // Compute today/tomorrow/yesterday in the hotel's timezone
      const now = new TZDate(new Date(), hotel.timezone);
      const todayStr = format(now, 'yyyy-MM-dd');
      const tomorrowStr = format(addDays(now, 1), 'yyyy-MM-dd');
      const yesterdayStr = format(addDays(now, -1), 'yyyy-MM-dd');

      // Load custom message templates for this hotel
      const { data: templates } = await (supabase as unknown as SupabaseClient)
        .from('message_templates')
        .select('*')
        .eq('hotel_id', hotel.id);

      const hotelTemplates: MessageTemplate[] = (templates as MessageTemplate[]) ?? [];

      // Define milestone queries
      const milestones: Array<{
        milestone: MessageMilestone;
        dateColumn: string;
        dateValue: string;
        sentFlag: string;
      }> = [
        {
          milestone: 'pre_arrival',
          dateColumn: 'check_in_date',
          dateValue: tomorrowStr,
          sentFlag: 'pre_arrival_sent',
        },
        {
          milestone: 'checkout_reminder',
          dateColumn: 'check_out_date',
          dateValue: todayStr,
          sentFlag: 'checkout_reminder_sent',
        },
        {
          milestone: 'review_request',
          dateColumn: 'check_out_date',
          dateValue: yesterdayStr,
          sentFlag: 'review_request_sent',
        },
      ];

      for (const { milestone, dateColumn, dateValue, sentFlag } of milestones) {
        // Query bookings for this milestone (not yet sent)
        const { data: bookings, error: bookingsError } = await (supabase as unknown as SupabaseClient)
          .from('bookings')
          .select('*')
          .eq('hotel_id', hotel.id)
          .eq(dateColumn, dateValue)
          .eq(sentFlag, false);

        if (bookingsError) {
          console.error(
            `[milestoneDispatch] Hotel ${hotel.id}: failed to query ${milestone} bookings: ${bookingsError.message}`,
          );
          errors++;
          continue;
        }

        const pendingBookings: Booking[] = (bookings as Booking[]) ?? [];

        if (pendingBookings.length === 0) {
          continue;
        }

        console.info(
          `[milestoneDispatch] Hotel ${hotel.name}: ${pendingBookings.length} ${milestone} booking(s) to process`,
        );

        // Process bookings in batches of 10 to avoid API rate limits
        const BATCH_SIZE = 10;
        for (let i = 0; i < pendingBookings.length; i += BATCH_SIZE) {
          const batch = pendingBookings.slice(i, i + BATCH_SIZE);

          const results = await Promise.allSettled(
            batch.map(async (booking) => {
              const dispatched = await dispatchBookingMilestone({
                booking,
                milestone,
                hotelName: hotel.name,
                templates: hotelTemplates,
              });

              if (dispatched) {
                await markSent(supabase, booking.id, milestone);
                return true;
              }
              return false;
            }),
          );

          for (const result of results) {
            if (result.status === 'fulfilled' && result.value === true) {
              messagesSent++;
            } else {
              errors++;
            }
          }
        }
      }

      hotelsProcessed++;
    } catch (hotelError) {
      const message = hotelError instanceof Error ? hotelError.message : String(hotelError);
      console.error(`[milestoneDispatch] Hotel ${hotel.id} (${hotel.name}) failed: ${message}`);
      errors++;
    }
  }

  console.info(
    `[milestoneDispatch] Complete. Hotels: ${hotelsProcessed}, Messages sent: ${messagesSent}, Errors: ${errors}`,
  );

  return { hotelsProcessed, messagesSent, errors };
}
