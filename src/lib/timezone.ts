/**
 * Timezone display utility — converts UTC timestamps to hotel-local time.
 *
 * Source: https://blog.date-fns.org/v40-with-time-zone-support/
 * Pattern 8 from: .planning/phases/01-foundation/01-RESEARCH.md
 *
 * Why @date-fns/tz over date-fns-tz:
 * - date-fns v4 includes first-class timezone support via @date-fns/tz
 * - date-fns-tz is the legacy companion for v2/v3; deprecated for new projects
 * - TZDate handles DST transitions, ambiguous times, and leap seconds correctly
 *
 * Usage:
 *   formatInHotelTz("2026-03-02T09:00:00Z", "Europe/Istanbul")
 *   => "02 Mar 2026 12:00"  (UTC+3)
 *
 *   formatInHotelTz(hotel.created_at, hotel.timezone, "dd/MM/yyyy")
 *   => "02/03/2026"
 */
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

/**
 * Format a UTC timestamp for display in the hotel's local timezone.
 *
 * @param utcTimestamp - ISO 8601 string from Supabase (always UTC/timestamptz) or Date object
 * @param hotelTimezone - IANA timezone string e.g. "Europe/Istanbul" (stored in hotels.timezone)
 * @param formatStr - date-fns format string, default "dd MMM yyyy HH:mm"
 * @returns Formatted date string in the hotel's local timezone
 *
 * @example
 * // Booking at 09:00 UTC, hotel in Istanbul (UTC+3)
 * formatInHotelTz("2026-03-02T09:00:00Z", "Europe/Istanbul")
 * // => "02 Mar 2026 12:00"
 */
export function formatInHotelTz(
  utcTimestamp: string | Date,
  hotelTimezone: string,
  formatStr = 'dd MMM yyyy HH:mm'
): string {
  // TZDate has separate overloads for string and Date.
  // TypeScript needs explicit narrowing to pick the correct overload.
  let tzDate: TZDate
  if (typeof utcTimestamp === 'string') {
    tzDate = new TZDate(utcTimestamp, hotelTimezone)
  } else {
    tzDate = new TZDate(utcTimestamp, hotelTimezone)
  }
  return format(tzDate, formatStr)
}
