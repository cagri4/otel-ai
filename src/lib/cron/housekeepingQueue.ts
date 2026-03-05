/**
 * Housekeeping priority queue — daily cron logic.
 *
 * Runs at 07:00 UTC daily (see vercel.json). For each hotel, computes
 * timezone-adjusted today/tomorrow dates, queries reservations for
 * check-out and check-in activity, builds a priority queue:
 *
 *   Priority 1 — checkout today (rooms being vacated, must be cleaned)
 *   Priority 2 — check-in today (rooms must be ready before guests arrive)
 *   Priority 3 — check-in tomorrow (advance prep for next-day arrivals)
 *
 * Idempotency: INSERT ON CONFLICT DO NOTHING on (hotel_id, room_id, queue_date)
 * means re-running the cron on the same day is safe — no duplicate rows.
 *
 * NOTE: bookings table (Phase 5) lacks room_id FK; only the reservations table
 * (Phase 7) has a room_id foreign key. The queue is therefore built exclusively
 * from reservations — which are the AI-assisted bookings with full room context.
 *
 * Source: .planning/phases/08-housekeeping-coordinator/08-02-PLAN.md
 */

import { TZDate } from '@date-fns/tz';
import { addDays, format, subDays } from 'date-fns';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Hotel } from '@/types/database';

// =============================================================================
// Types
// =============================================================================

interface QueueResult {
  processed: number;
  errors: number;
}

interface ReservationRow {
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
}

interface RoomStatusRow {
  room_id: string;
  status: string;
}

// =============================================================================
// runHousekeepingQueue — main export
// =============================================================================

/**
 * Generate the daily housekeeping priority queue for all hotels.
 *
 * Steps per hotel:
 * 1. Compute today/tomorrow in hotel's IANA timezone.
 * 2. Query reservations for checkout today and check-in today/tomorrow.
 * 3. Build priority list (1=checkout today, 2=checkin today, 3=checkin tomorrow).
 * 4. For priorities 2 and 3, skip rooms already marked 'clean'.
 * 5. INSERT queue rows with ON CONFLICT DO NOTHING (idempotent).
 * 6. Mark checkout-today rooms as 'dirty' (vacated rooms need cleaning).
 * 7. Delete queue entries older than 7 days (rolling history cleanup).
 *
 * @returns { processed, errors } counts across all hotels
 */
export async function runHousekeepingQueue(): Promise<QueueResult> {
  const supabase = createServiceClient();
  let processed = 0;
  let errors = 0;

  // Fetch all hotels with id and timezone columns.
  // Cast to bypass postgrest-js v12 type inference for partial select (same pattern as milestoneDispatch.ts).
  const { data: hotels, error: hotelsError } = await (supabase as unknown as SupabaseClient)
    .from('hotels')
    .select('id, timezone');

  if (hotelsError) {
    throw new Error(`[housekeepingQueue] Failed to fetch hotels: ${hotelsError.message}`);
  }

  if (!hotels || hotels.length === 0) {
    console.info('[housekeepingQueue] No hotels found — nothing to process');
    return { processed: 0, errors: 0 };
  }

  for (const hotel of hotels as Pick<Hotel, 'id' | 'timezone'>[]) {
    try {
      // Step 1: Compute timezone-aware today and tomorrow.
      const now = new TZDate(new Date(), hotel.timezone);
      const todayStr = format(now, 'yyyy-MM-dd');
      const tomorrowStr = format(addDays(now, 1), 'yyyy-MM-dd');
      const sevenDaysAgoStr = format(subDays(now, 7), 'yyyy-MM-dd');

      // Step 2: Query reservations for queue-relevant date patterns.
      // We need:
      //   a) Rooms with check_out_date = today (checkout today → priority 1)
      //   b) Rooms with check_in_date = today (checkin today → priority 2)
      //   c) Rooms with check_in_date = tomorrow (checkin tomorrow → priority 3)
      //
      // bookings table lacks room_id FK — only reservations (Phase 7) provides room-level data.
      const { data: reservations, error: reservationsError } = await (supabase as unknown as SupabaseClient)
        .from('reservations')
        .select('room_id, check_in_date, check_out_date, status')
        .eq('hotel_id', hotel.id)
        .neq('status', 'cancelled')
        .or(
          `check_out_date.eq.${todayStr},check_in_date.eq.${todayStr},check_in_date.eq.${tomorrowStr}`,
        );

      if (reservationsError) {
        console.error(
          `[housekeepingQueue] Hotel ${hotel.id}: failed to query reservations: ${reservationsError.message}`,
        );
        errors++;
        continue;
      }

      const rows: ReservationRow[] = (reservations as ReservationRow[]) ?? [];

      if (rows.length === 0) {
        // No relevant reservations today — nothing to queue for this hotel
        processed++;
        continue;
      }

      // Step 3: Fetch current room statuses for this hotel (needed for priority 2/3 filtering).
      const { data: statusRows } = await (supabase as unknown as SupabaseClient)
        .from('room_housekeeping_status')
        .select('room_id, status')
        .eq('hotel_id', hotel.id);

      const statusMap = new Map<string, string>();
      for (const row of ((statusRows as RoomStatusRow[]) ?? [])) {
        statusMap.set(row.room_id, row.status);
      }

      // Step 4: Build priority queue entries — deduplicate by room_id (higher priority wins).
      // Use a map keyed by room_id so the highest-priority entry per room is kept.
      const queueMap = new Map<string, { priority: number; reason: string }>();

      for (const reservation of rows) {
        const roomId = reservation.room_id;
        const currentStatus = statusMap.get(roomId) ?? 'unknown';

        if (reservation.check_out_date === todayStr) {
          // Priority 1: checkout today — always needs cleaning regardless of status
          const existing = queueMap.get(roomId);
          if (!existing || existing.priority > 1) {
            queueMap.set(roomId, { priority: 1, reason: 'checkout_today' });
          }
        } else if (reservation.check_in_date === todayStr) {
          // Priority 2: check-in today — skip if already clean
          if (currentStatus !== 'clean') {
            const existing = queueMap.get(roomId);
            if (!existing || existing.priority > 2) {
              queueMap.set(roomId, { priority: 2, reason: 'checkin_today' });
            }
          }
        } else if (reservation.check_in_date === tomorrowStr) {
          // Priority 3: check-in tomorrow — skip if already clean
          if (currentStatus !== 'clean') {
            const existing = queueMap.get(roomId);
            if (!existing || existing.priority > 3) {
              queueMap.set(roomId, { priority: 3, reason: 'checkin_tomorrow' });
            }
          }
        }
      }

      if (queueMap.size === 0) {
        // All rooms already clean — nothing to insert
        processed++;
        continue;
      }

      // Step 5: INSERT queue rows with ON CONFLICT DO NOTHING (idempotent re-runs).
      // Use upsert with ignoreDuplicates=true — equivalent to INSERT ON CONFLICT DO NOTHING.
      // The UNIQUE(hotel_id, room_id, queue_date) constraint ensures re-runs on same day
      // do not overwrite existing rows or create duplicates.
      const queueInserts = Array.from(queueMap.entries()).map(([roomId, entry]) => ({
        hotel_id: hotel.id,
        room_id: roomId,
        queue_date: todayStr,
        priority: entry.priority,
        reason: entry.reason,
      }));

      const { error: insertError } = await (supabase as unknown as SupabaseClient)
        .from('housekeeping_queue')
        .upsert(queueInserts, { onConflict: 'hotel_id,room_id,queue_date', ignoreDuplicates: true });

      if (insertError) {
        console.error(
          `[housekeepingQueue] Hotel ${hotel.id}: failed to insert queue rows: ${insertError.message}`,
        );
        errors++;
        continue;
      }

      // Step 6: Mark checkout-today rooms as 'dirty' in room_housekeeping_status.
      // Rooms being vacated are dirty by definition — they need cleaning before the next guest.
      const checkoutRoomIds = Array.from(queueMap.entries())
        .filter(([, entry]) => entry.reason === 'checkout_today')
        .map(([roomId]) => roomId);

      if (checkoutRoomIds.length > 0) {
        const dirtyUpserts = checkoutRoomIds.map((roomId) => ({
          hotel_id: hotel.id,
          room_id: roomId,
          status: 'dirty',
          updated_by: 'cron',
          updated_at: new Date().toISOString(),
        }));

        const { error: upsertError } = await (supabase as unknown as SupabaseClient)
          .from('room_housekeeping_status')
          .upsert(dirtyUpserts, { onConflict: 'hotel_id,room_id' });

        if (upsertError) {
          console.error(
            `[housekeepingQueue] Hotel ${hotel.id}: failed to mark checkout rooms as dirty: ${upsertError.message}`,
          );
          // Non-fatal — queue was inserted; status update failure is logged but not counted as an error
        }
      }

      // Step 7: Clean up old queue entries — keep rolling 7-day history.
      const { error: cleanupError } = await (supabase as unknown as SupabaseClient)
        .from('housekeeping_queue')
        .delete()
        .eq('hotel_id', hotel.id)
        .lt('queue_date', sevenDaysAgoStr);

      if (cleanupError) {
        // Non-fatal — old data is just not cleaned up; not counted as processing error
        console.error(
          `[housekeepingQueue] Hotel ${hotel.id}: failed to clean up old queue entries: ${cleanupError.message}`,
        );
      }

      console.info(
        `[housekeepingQueue] Hotel ${hotel.id}: queued ${queueMap.size} room(s) for ${todayStr} (${checkoutRoomIds.length} checkout, ${queueMap.size - checkoutRoomIds.length} checkin)`,
      );

      processed++;
    } catch (hotelError) {
      const message = hotelError instanceof Error ? hotelError.message : String(hotelError);
      console.error(`[housekeepingQueue] Hotel ${hotel.id} failed: ${message}`);
      errors++;
    }
  }

  console.info(
    `[housekeepingQueue] Complete. Hotels processed: ${processed}, Errors: ${errors}`,
  );

  return { processed, errors };
}
