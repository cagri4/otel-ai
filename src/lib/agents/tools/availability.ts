/**
 * Real room availability tool implementation for the OtelAI agent system.
 *
 * Replaces the stub implementation from stubs.ts (Phase 2).
 * Queries the reservations and rooms tables in Supabase to return real
 * availability data for a hotel's date range query.
 *
 * Uses the service-role client (createServiceClient) because tools run in the
 * WhatsApp webhook and widget context where there is no authenticated user session.
 * Hotel scoping is enforced via the hotel_id parameter injected by executor.ts
 * from ToolContext.hotelId — not via RLS.
 *
 * Overlap detection pattern: a reservation overlaps [check_in, check_out) if:
 *   reservation.check_in_date < check_out AND reservation.check_out_date > check_in
 * This is the standard half-open interval overlap algorithm.
 *
 * Source: .planning/phases/07-booking-ai/07-01-PLAN.md (BOOK-02, BOOK-03)
 */

import { createServiceClient } from '@/lib/supabase/service';

/**
 * Returns available rooms for a given hotel and date range.
 *
 * The hotel_id is injected by executor.ts from ToolContext — tools never
 * accept hotel_id from the AI model's tool call input directly.
 *
 * @param input - Tool input: hotel_id (injected), check_in (ISO date), check_out (ISO date), optional room_type
 * @returns Availability result with list of available rooms, or error object
 */
export async function getAvailability(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { hotel_id, check_in, check_out, room_type } = input as {
    hotel_id: string;
    check_in: string;
    check_out: string;
    room_type?: string;
  };

  if (!hotel_id || !check_in || !check_out) {
    return { error: true, message: 'hotel_id, check_in, and check_out are required.' };
  }

  const supabase = createServiceClient();

  // Step 1: Find all rooms booked (not cancelled) during the requested date range.
  // Overlap condition: reservation.check_in_date < check_out AND reservation.check_out_date > check_in
  const { data: bookedReservations, error: reservationError } = await supabase
    .from('reservations')
    .select('room_id')
    .eq('hotel_id', hotel_id)
    .neq('status', 'cancelled')
    .lt('check_in_date', check_out)
    .gt('check_out_date', check_in);

  if (reservationError) {
    return { error: true, message: reservationError.message };
  }

  const bookedRoomIds = (bookedReservations ?? []).map((r) => r.room_id as string);

  // Step 2: Query all rooms for this hotel, excluding booked ones.
  let roomQuery = supabase
    .from('rooms')
    .select('id, name, room_type, bed_type, max_occupancy, base_price_note')
    .eq('hotel_id', hotel_id)
    .order('sort_order');

  // Filter out booked rooms when there are any
  if (bookedRoomIds.length > 0) {
    roomQuery = roomQuery.not('id', 'in', `(${bookedRoomIds.join(',')})`);
  }

  // Optional room_type filter
  if (room_type) {
    roomQuery = roomQuery.eq('room_type', room_type);
  }

  const { data: availableRooms, error: roomError } = await roomQuery;

  if (roomError) {
    return { error: true, message: roomError.message };
  }

  const rooms = (availableRooms ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.room_type,
    bed_type: r.bed_type,
    max_occupancy: r.max_occupancy,
    price_note: r.base_price_note,
  }));

  // Calculate nights for the agent's convenience
  const checkInDate = new Date(check_in);
  const checkOutDate = new Date(check_out);
  const nights = Math.round((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

  return {
    available: rooms.length > 0,
    check_in,
    check_out,
    nights,
    rooms,
  };
}
