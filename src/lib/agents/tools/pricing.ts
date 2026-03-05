/**
 * Real room pricing tool implementation for the OtelAI agent system.
 *
 * Replaces the stub implementation from stubs.ts (Phase 2).
 * Queries the rooms table in Supabase to return room pricing information
 * as configured by the hotel owner.
 *
 * Uses the service-role client (createServiceClient) because tools run in the
 * WhatsApp webhook and widget context where there is no authenticated user session.
 * Hotel scoping is enforced via the hotel_id parameter injected by executor.ts
 * from ToolContext.hotelId — not via RLS.
 *
 * Price data design: base_price_note is a freeform text string set by the hotel owner
 * (e.g. "from €120/night" or "€90-150 depending on season"). It is NOT a numeric value.
 * The agent receives it as-is and presents it to the guest verbatim.
 * This avoids premature booking engine assumptions (Phase 3 decision).
 *
 * Source: .planning/phases/07-booking-ai/07-01-PLAN.md (BOOK-02, BOOK-03)
 */

import { createServiceClient } from '@/lib/supabase/service';

/**
 * Returns room pricing for a given hotel, optionally filtered by room_type.
 *
 * The hotel_id is injected by executor.ts from ToolContext — tools never
 * accept hotel_id from the AI model's tool call input directly.
 *
 * @param input - Tool input: hotel_id (injected), optional room_type, optional check_in/check_out
 * @returns Pricing result with list of room prices, or error object
 */
export async function getRoomPricing(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { hotel_id, room_type, check_in, check_out } = input as {
    hotel_id: string;
    room_type?: string;
    check_in?: string;
    check_out?: string;
  };

  if (!hotel_id) {
    return { error: true, message: 'hotel_id is required.' };
  }

  const supabase = createServiceClient();

  let roomQuery = supabase
    .from('rooms')
    .select('name, room_type, base_price_note, bed_type, max_occupancy')
    .eq('hotel_id', hotel_id)
    .order('sort_order');

  // Optional room_type filter
  if (room_type) {
    roomQuery = roomQuery.eq('room_type', room_type);
  }

  const { data, error } = await roomQuery;

  if (error) {
    return { error: true, message: error.message };
  }

  const prices = (data ?? []).map((r) => ({
    name: r.name,
    type: r.room_type,
    price_note: r.base_price_note, // Freeform text — return as-is, not computed
    bed_type: r.bed_type,
    max_occupancy: r.max_occupancy,
  }));

  return {
    prices,
    check_in: check_in ?? null,
    check_out: check_out ?? null,
  };
}
