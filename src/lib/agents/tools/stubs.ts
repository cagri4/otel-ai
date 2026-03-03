/**
 * Stub tool implementations for the OtelAI agent system.
 *
 * These return plausible mock data for development and testing.
 * They will be replaced with real DB queries when the rooms/bookings
 * tables are created in Phase 7.
 *
 * Each function accepts `input: Record<string, unknown>` to match the
 * dispatch pattern in executor.ts and returns a Promise<Record<string, unknown>>.
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md
 */

// =============================================================================
// Availability Stub
// =============================================================================

/**
 * Returns mock room availability data.
 *
 * STUB: Returns mock data. Replace with real DB query when rooms/bookings
 * tables exist (Phase 7).
 *
 * @param input - Tool input containing check_in, check_out, and optional room_type
 */
export async function getAvailability(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // STUB: Returns mock data. Replace with real DB query when rooms/bookings tables exist (Phase 7).
  return {
    available: true,
    rooms: [
      { type: 'Standard', count: 3 },
      { type: 'Deluxe', count: 1 },
    ],
    check_in: input.check_in,
    check_out: input.check_out,
  };
}

// =============================================================================
// Pricing Stub
// =============================================================================

/**
 * Returns mock room pricing data.
 *
 * STUB: Returns mock data. Replace with real DB query when rooms/bookings
 * tables exist (Phase 7).
 *
 * @param input - Tool input containing optional room_type, check_in, check_out
 */
export async function getRoomPricing(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // STUB: Returns mock data. Replace with real DB query when rooms/bookings tables exist (Phase 7).
  void input;
  return {
    prices: [
      { type: 'Standard', price_per_night: 120, currency: 'EUR' },
      { type: 'Deluxe', price_per_night: 200, currency: 'EUR' },
    ],
  };
}

// =============================================================================
// Reservation Lookup Stub
// =============================================================================

/**
 * Returns mock guest reservation lookup result.
 *
 * STUB: Returns mock data. Replace with real DB query when rooms/bookings
 * tables exist (Phase 7).
 *
 * @param input - Tool input containing guest_identifier (email, phone, or name)
 */
export async function lookupGuestReservation(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // STUB: Returns mock data. Replace with real DB query when rooms/bookings tables exist (Phase 7).
  void input;
  return {
    found: false,
    message: 'No reservation found for this guest.',
  };
}
