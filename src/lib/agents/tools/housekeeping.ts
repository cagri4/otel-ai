/**
 * Housekeeping tool implementations for the OtelAI agent system.
 *
 * Two tools for the HOUSEKEEPING_COORDINATOR role:
 * - getRoomStatus:    Fetches current cleaning status of all rooms for a hotel.
 * - updateRoomStatus: Updates the cleaning status of a specific room by name.
 *
 * Uses the service-role client (createServiceClient) because the Housekeeping
 * Coordinator runs in the dashboard chat context where tool execution happens
 * server-side. Hotel scoping is enforced via the hotel_id parameter injected
 * by executor.ts from ToolContext.hotelId — not via RLS.
 *
 * CRITICAL — hotel_id injection: hotel_id is NOT in the tool schema.
 * It is injected from ToolContext.hotelId in the executor dispatch map.
 * This prevents cross-hotel data leakage (same pattern as booking tools).
 *
 * Source: .planning/phases/08-housekeeping-coordinator/08-01-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// getRoomStatus — Fetch current cleaning status of all rooms
// =============================================================================

/**
 * Returns the current cleaning status of all rooms for a hotel.
 *
 * Joins room_housekeeping_status with rooms to include room name.
 * If no status rows exist yet, queries rooms table and returns all rooms
 * with 'unknown' status as a safe fallback.
 *
 * @param params - hotel_id injected from ToolContext (never from AI input)
 * @returns Array of { room_name, room_id, status, notes, updated_at } objects
 */
export async function getRoomStatus(params: {
  hotel_id: string;
}): Promise<Record<string, unknown>> {
  const { hotel_id } = params;

  if (!hotel_id) {
    return { error: true, message: 'hotel_id is required.' };
  }

  const supabase = createServiceClient();

  // Query room_housekeeping_status joined with rooms.name
  // Cast to bypass postgrest-js v12 type inference for manual Database types.
  const { data: statusRows, error: statusError } = await (supabase as unknown as SupabaseClient)
    .from('room_housekeeping_status')
    .select(`
      room_id,
      status,
      notes,
      updated_at,
      updated_by,
      rooms!inner(name)
    `)
    .eq('hotel_id', hotel_id)
    .order('updated_at', { ascending: false });

  if (statusError) {
    return { error: true, message: statusError.message };
  }

  // If status rows exist, return them
  if (statusRows && statusRows.length > 0) {
    const rooms = statusRows.map((row: Record<string, unknown>) => ({
      room_id: row.room_id,
      room_name: (row.rooms as { name: string })?.name ?? 'Unknown Room',
      status: row.status,
      notes: row.notes ?? null,
      updated_at: row.updated_at,
      updated_by: row.updated_by ?? null,
    }));

    return {
      total_rooms: rooms.length,
      rooms,
    };
  }

  // Fallback: no status rows yet — query rooms table and return all as 'unknown'
  const { data: allRooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, name')
    .eq('hotel_id', hotel_id)
    .order('sort_order')
    .returns<{ id: string; name: string }[]>();

  if (roomsError) {
    return { error: true, message: roomsError.message };
  }

  const rooms = (allRooms ?? []).map((room) => ({
    room_id: room.id,
    room_name: room.name,
    status: 'unknown',
    notes: null,
    updated_at: null,
    updated_by: null,
  }));

  return {
    total_rooms: rooms.length,
    rooms,
    note: 'No status data found yet — all rooms shown as unknown.',
  };
}

// =============================================================================
// updateRoomStatus — Update the cleaning status of a specific room
// =============================================================================

/**
 * Updates the cleaning status of a hotel room identified by name.
 *
 * Room resolution:
 * - Zero matches → return error asking agent to clarify
 * - Multiple matches → return candidate list for agent to disambiguate
 * - Single match → upsert room_housekeeping_status with new status
 *
 * Uses ILIKE for case-insensitive partial name matching (e.g. "room 12" matches "Room 12").
 *
 * @param params - hotel_id injected from ToolContext; room_identifier, new_status, notes from AI
 * @returns Confirmation with room name and new status, or error/disambiguation message
 */
export async function updateRoomStatus(params: {
  hotel_id: string;
  room_identifier: string;
  new_status: 'clean' | 'dirty' | 'inspected' | 'out_of_order';
  notes?: string;
}): Promise<Record<string, unknown>> {
  const { hotel_id, room_identifier, new_status, notes } = params;

  if (!hotel_id || !room_identifier || !new_status) {
    return { error: true, message: 'hotel_id, room_identifier, and new_status are required.' };
  }

  const validStatuses = ['clean', 'dirty', 'inspected', 'out_of_order'];
  if (!validStatuses.includes(new_status)) {
    return {
      error: true,
      message: `Invalid status "${new_status}". Must be one of: clean, dirty, inspected, out_of_order`,
    };
  }

  const supabase = createServiceClient();

  // Resolve room by partial, case-insensitive name match scoped to hotel
  const { data: matchedRooms, error: roomError } = await supabase
    .from('rooms')
    .select('id, name')
    .eq('hotel_id', hotel_id)
    .ilike('name', `%${room_identifier}%`)
    .returns<{ id: string; name: string }[]>();

  if (roomError) {
    return { error: true, message: roomError.message };
  }

  const matches = matchedRooms ?? [];

  // Zero matches — ask the agent to clarify
  if (matches.length === 0) {
    return {
      error: true,
      message: `No room found matching "${room_identifier}". Please ask the owner to clarify the room name.`,
    };
  }

  // Multiple matches — return candidates for agent to disambiguate
  if (matches.length > 1) {
    const candidates = matches.map((r) => r.name);
    return {
      error: true,
      multiple_matches: true,
      message: `Found multiple rooms matching "${room_identifier}". Please ask which one: ${candidates.join(', ')}`,
      candidates,
    };
  }

  // Single match — upsert status
  const room = matches[0];

  const { error: upsertError } = await (supabase as unknown as SupabaseClient)
    .from('room_housekeeping_status')
    .upsert(
      {
        hotel_id,
        room_id: room.id,
        status: new_status,
        notes: notes ?? null,
        updated_by: 'agent',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hotel_id,room_id' },
    );

  if (upsertError) {
    return { error: true, message: upsertError.message };
  }

  return {
    updated: true,
    room_name: room.name,
    room_id: room.id,
    new_status,
    notes: notes ?? null,
    message: `Room "${room.name}" status updated to "${new_status}".`,
  };
}
