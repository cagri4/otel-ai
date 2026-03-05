/**
 * Hotel resolution for WhatsApp inbound messages.
 *
 * Resolves a hotel_id from an incoming Twilio WhatsApp number.
 * Uses the service-role Supabase client because WhatsApp webhooks
 * have no user auth session — RLS cannot be applied.
 *
 * Resolution strategy:
 * 1. Query hotel_whatsapp_numbers WHERE twilio_number = twilioNumber
 * 2. If no record found, check TWILIO_WHATSAPP_NUMBER env var for sandbox
 *    fallback — returns first hotel in DB (single-hotel MVP mode)
 * 3. Return null if nothing matches
 *
 * Note: .returns<T>() is required for Supabase SELECT with manual Database types —
 * postgrest-js v12 type inference requires this workaround until generated types are used.
 * See STATE.md decision: ".returns<T>() required for Supabase SELECT with manual Database types"
 *
 * Source: .planning/phases/04-guest-facing-layer/04-02-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';

/**
 * Resolve a hotel_id from an inbound Twilio WhatsApp number.
 *
 * @param twilioNumber - The "To" number from Twilio webhook (e.g. "whatsapp:+14155238886")
 * @returns hotel_id UUID if a matching hotel is found, null otherwise
 */
export async function resolveHotelFromNumber(twilioNumber: string): Promise<string | null> {
  const supabase = createServiceClient();

  // Normalize: strip "whatsapp:" prefix if present (Twilio includes it in the To field)
  const normalizedNumber = twilioNumber.replace(/^whatsapp:/i, '');

  // 1. Query hotel_whatsapp_numbers for a direct match
  // .returns<T>() required for postgrest-js v12 type inference with manual Database types
  const { data, error } = await supabase
    .from('hotel_whatsapp_numbers')
    .select('hotel_id')
    .eq('twilio_number', normalizedNumber)
    .returns<{ hotel_id: string }[]>()
    .maybeSingle();

  if (error) {
    console.error('[resolveHotelFromNumber] DB query error:', error.message);
    return null;
  }

  if (data?.hotel_id) {
    return data.hotel_id;
  }

  // 2. Sandbox fallback: if the incoming number matches the configured sandbox number,
  //    return the first hotel in the database (single-hotel MVP mode)
  const sandboxNumber = process.env.TWILIO_WHATSAPP_NUMBER?.replace(/^whatsapp:/i, '');
  if (sandboxNumber && normalizedNumber === sandboxNumber) {
    // .returns<T>() required for postgrest-js v12 type inference with manual Database types
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('hotels')
      .select('id')
      .limit(1)
      .returns<{ id: string }[]>()
      .maybeSingle();

    if (fallbackError) {
      console.error('[resolveHotelFromNumber] Fallback DB query error:', fallbackError.message);
      return null;
    }

    if (fallbackData?.id) {
      console.warn(
        '[resolveHotelFromNumber] Using sandbox fallback — number not in hotel_whatsapp_numbers. ' +
          'Register the hotel number in production.',
      );
      return fallbackData.id;
    }
  }

  // 3. No match found
  return null;
}
