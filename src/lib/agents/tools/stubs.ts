/**
 * Real guest reservation lookup tool for the OtelAI agent system.
 *
 * Originally this file contained three stub implementations (getAvailability,
 * getRoomPricing, lookupGuestReservation) that returned mock data for development.
 *
 * In Phase 7 (07-01), the stubs were replaced with real Supabase queries:
 * - getAvailability → moved to availability.ts
 * - getRoomPricing  → moved to pricing.ts
 * - lookupGuestReservation → real query implemented below
 *
 * Uses the service-role client (createServiceClient) because tools run in the
 * WhatsApp webhook and widget context where there is no authenticated user session.
 * Hotel scoping is enforced via the hotel_id parameter injected by executor.ts
 * from ToolContext.hotelId — not via RLS.
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md (stub)
 *         .planning/phases/07-booking-ai/07-01-PLAN.md (real implementation)
 */

import { createServiceClient } from '@/lib/supabase/service';

// =============================================================================
// Reservation Lookup
// =============================================================================

/**
 * Looks up guest reservations by name or phone number.
 *
 * Searches the reservations table for non-cancelled reservations matching
 * the guest_identifier (partial name match OR exact phone match).
 * Returns the 5 most recent reservations by check_in_date.
 *
 * The hotel_id is injected by executor.ts from ToolContext — tools never
 * accept hotel_id from the AI model's tool call input directly.
 *
 * @param input - Tool input: hotel_id (injected), guest_identifier (name or phone)
 * @returns Found reservations or not-found message, or error object
 */
export async function lookupGuestReservation(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { hotel_id, guest_identifier } = input as {
    hotel_id: string;
    guest_identifier: string;
  };

  if (!hotel_id || !guest_identifier) {
    return { error: true, message: 'hotel_id and guest_identifier are required.' };
  }

  const supabase = createServiceClient();

  // Search by guest_name (partial, case-insensitive) or guest_phone (exact match)
  const { data, error } = await supabase
    .from('reservations')
    .select('id, guest_name, guest_phone, check_in_date, check_out_date, status, notes')
    .eq('hotel_id', hotel_id)
    .or(`guest_name.ilike.%${guest_identifier}%,guest_phone.eq.${guest_identifier}`)
    .neq('status', 'cancelled')
    .order('check_in_date', { ascending: false })
    .limit(5);

  if (error) return { error: true, message: error.message };
  if (!data || data.length === 0) return { found: false, message: 'No reservation found for this guest.' };
  return { found: true, reservations: data };
}
