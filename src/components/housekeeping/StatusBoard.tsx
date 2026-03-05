'use client';

/**
 * StatusBoard — Live room cleaning status display for the Housekeeping page.
 *
 * Client component that polls Supabase every 5 seconds to display current
 * cleaning status of all rooms. Uses the browser Supabase client and the
 * authenticated session to get hotel_id.
 *
 * Polling approach: setInterval every 5 seconds ensures the board reflects
 * changes made by the Housekeeping Coordinator agent shortly after the tool
 * executes.
 *
 * Status badge colors:
 * - clean       → green
 * - dirty       → red
 * - inspected   → blue
 * - out_of_order → gray
 *
 * Note on SupabaseClient cast: Uses (supabase as unknown as SupabaseClient)
 * to bypass postgrest-js v12 type inference for manually-typed tables that
 * don't thread through from() inference. Same pattern from Phase 5 Plan 1
 * and documented in STATE.md decisions.
 *
 * Source: .planning/phases/08-housekeeping-coordinator/08-01-PLAN.md
 */

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// Types
// =============================================================================

type HousekeepingStatus = 'clean' | 'dirty' | 'inspected' | 'out_of_order' | 'unknown';

interface RoomStatusRow {
  room_id: string;
  room_name: string;
  status: HousekeepingStatus;
  notes: string | null;
  updated_at: string | null;
}

// =============================================================================
// Status badge helpers
// =============================================================================

const STATUS_LABELS: Record<HousekeepingStatus, string> = {
  clean: 'Clean',
  dirty: 'Dirty',
  inspected: 'Inspected',
  out_of_order: 'Out of Order',
  unknown: 'Unknown',
};

const STATUS_BADGE_CLASSES: Record<HousekeepingStatus, string> = {
  clean: 'bg-green-100 text-green-800 border border-green-200',
  dirty: 'bg-red-100 text-red-800 border border-red-200',
  inspected: 'bg-blue-100 text-blue-800 border border-blue-200',
  out_of_order: 'bg-gray-100 text-gray-600 border border-gray-200',
  unknown: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
};

function StatusBadge({ status }: { status: HousekeepingStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatRelativeTime(updatedAt: string | null): string {
  if (!updatedAt) return 'Never';

  const date = new Date(updatedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// =============================================================================
// StatusBoard component
// =============================================================================

export function StatusBoard() {
  const [rooms, setRooms] = useState<RoomStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);

  // Fetch current user session to get hotel_id from JWT
  useEffect(() => {
    async function initHotelId() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      // Extract hotel_id from JWT claims (injected by Custom Access Token Hook)
      const jwt = session.access_token;
      try {
        const payload = JSON.parse(atob(jwt.split('.')[1]));
        const hotelIdFromJwt = payload.hotel_id as string | undefined;

        if (!hotelIdFromJwt) {
          setError('Hotel ID not found in session');
          setLoading(false);
          return;
        }

        setHotelId(hotelIdFromJwt);
      } catch {
        setError('Failed to parse session token');
        setLoading(false);
      }
    }

    initHotelId();
  }, []);

  // Fetch room statuses — called initially and on each poll interval
  const fetchStatuses = useCallback(async (currentHotelId: string) => {
    try {
      const supabase = createClient();

      // Cast to bypass postgrest-js v12 never inference for manually-typed new tables
      // Same pattern as escalation.ts and Phase 5 Plan 1 documented decision.
      const { data, error: fetchError } = await (supabase as unknown as SupabaseClient)
        .from('room_housekeeping_status')
        .select(`
          room_id,
          status,
          notes,
          updated_at,
          rooms!inner(name)
        `)
        .eq('hotel_id', currentHotelId)
        .order('updated_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      const rows: RoomStatusRow[] = (data ?? []).map(
        (row: Record<string, unknown>) => ({
          room_id: row.room_id as string,
          room_name: ((row.rooms as { name: string }) ?? {}).name ?? 'Unknown Room',
          status: (row.status as HousekeepingStatus) ?? 'unknown',
          notes: (row.notes as string | null) ?? null,
          updated_at: (row.updated_at as string | null) ?? null,
        }),
      );

      setRooms(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load room statuses');
    } finally {
      setLoading(false);
    }
  }, []);

  // Start polling once hotel_id is available
  useEffect(() => {
    if (!hotelId) return;

    // Fetch immediately
    fetchStatuses(hotelId);

    // Poll every 5 seconds while the component is mounted
    const interval = setInterval(() => {
      fetchStatuses(hotelId);
    }, 5_000);

    return () => clearInterval(interval);
  }, [hotelId, fetchStatuses]);

  // =============================================================================
  // Render
  // =============================================================================

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Room Status
        </h2>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Room Status
        </h2>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // Count by status for summary
  const counts = rooms.reduce(
    (acc, room) => {
      acc[room.status] = (acc[room.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<HousekeepingStatus, number>,
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Room Status
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Updates every 5s</p>
      </div>

      {/* Summary counts */}
      {rooms.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.entries(counts) as [HousekeepingStatus, number][]).map(([status, count]) => (
            <div key={status} className="flex items-center justify-between bg-muted/40 rounded px-2 py-1">
              <StatusBadge status={status} />
              <span className="text-xs font-semibold ml-1">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Room list */}
      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No room statuses yet. Chat with the Housekeeping Coordinator to update room statuses.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rooms.map((room) => (
            <div
              key={room.room_id}
              className="border rounded-md p-2.5 bg-background"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{room.room_name}</p>
                  {room.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {room.notes}
                    </p>
                  )}
                </div>
                <StatusBadge status={room.status} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatRelativeTime(room.updated_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
