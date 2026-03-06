/**
 * Morning briefing cron dispatch logic.
 *
 * Runs daily at 08:00 UTC (see vercel.json). For each hotel with a registered
 * owner Telegram chat ID, queries all active employee bots and sends a
 * role-specific briefing message from each bot to the hotel owner.
 *
 * Briefing scope per role:
 * - front_desk:               check-ins, check-outs, open escalations
 * - booking_ai:               pending reservations
 * - guest_experience:         pre-arrival count (tomorrow), checkouts today
 * - housekeeping_coordinator: queue size today, dirty room count
 *
 * Rate limiting: 40ms sequential delay between each send (not between hotels)
 * to avoid Telegram bot API rate limiting when multiple hotels have multiple
 * active bots.
 *
 * Hotels without owner_telegram_chat_id are filtered at query level.
 * Hotels without any active bots are skipped (increments skipped counter).
 * Each hotel/bot send is independently try/caught — one failure does not
 * stop other sends.
 *
 * Source: .planning/phases/13-proactive-messaging-dashboard-readonly/13-01-PLAN.md
 */

import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramReply } from '@/lib/telegram/sendReply';

// =============================================================================
// Types
// =============================================================================

interface MorningBriefingResult {
  sent: number;
  errors: number;
  skipped: number;
}

interface HotelRow {
  id: string;
  name: string;
  timezone: string;
  owner_telegram_chat_id: number | null;
}

interface BotRow {
  role: string;
  vault_secret_id: string;
  is_active: boolean;
}

// =============================================================================
// Sleep helper
// =============================================================================

const INTER_SEND_DELAY_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Bot token resolver
// =============================================================================

/**
 * Resolve the plaintext token for any hotel bot by role.
 *
 * Queries hotel_bots for the active bot of the given role, then calls the
 * get_bot_token RPC to decrypt the token from Supabase Vault.
 *
 * @returns Plaintext bot token, or null if no active bot found for this role
 */
async function getBotToken(
  supabase: SupabaseClient,
  hotelId: string,
  role: string,
): Promise<string | null> {
  const { data: bot } = await supabase
    .from('hotel_bots')
    .select('vault_secret_id')
    .eq('hotel_id', hotelId)
    .eq('role', role)
    .eq('is_active', true)
    .maybeSingle();

  if (!bot?.vault_secret_id) return null;

  const { data: tokenData } = await supabase.rpc('get_bot_token', {
    p_vault_secret_id: (bot as { vault_secret_id: string }).vault_secret_id,
  });
  return (tokenData as string) ?? null;
}

// =============================================================================
// Per-role briefing builders
// =============================================================================

/**
 * Build Front Desk morning briefing: check-ins, check-outs, open escalations.
 */
async function buildFrontDeskBriefing(
  supabase: SupabaseClient,
  hotelId: string,
  timezone: string,
): Promise<string> {
  const nowInTz = new TZDate(new Date(), timezone);
  const todayStr = format(nowInTz, 'yyyy-MM-dd');

  // Today's check-ins (confirmed reservations with check_in_date = today)
  const { data: checkIns } = await (supabase as unknown as SupabaseClient)
    .from('reservations')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('check_in_date', todayStr)
    .eq('status', 'confirmed');

  const checkInCount = (checkIns ?? []).length;

  // Today's check-outs (confirmed reservations with check_out_date = today)
  const { data: checkOuts } = await (supabase as unknown as SupabaseClient)
    .from('reservations')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('check_out_date', todayStr)
    .eq('status', 'confirmed');

  const checkOutCount = (checkOuts ?? []).length;

  // Open escalations (escalations with resolved_at IS NULL)
  const { data: escalations } = await (supabase as unknown as SupabaseClient)
    .from('escalations')
    .select('id')
    .eq('hotel_id', hotelId)
    .is('resolved_at', null);

  const escalationCount = (escalations ?? []).length;

  return [
    'Good morning! Here is your daily Front Desk summary:',
    '',
    `- ${checkInCount} check-in(s) expected today`,
    `- ${checkOutCount} check-out(s) expected today`,
    `- ${escalationCount} open escalation(s)`,
    '',
    'Have a great day!',
  ].join('\n');
}

/**
 * Build Booking AI morning briefing: pending reservations count.
 */
async function buildBookingAiBriefing(
  supabase: SupabaseClient,
  hotelId: string,
  _timezone: string,
): Promise<string> {
  // Pending reservations awaiting follow-up
  const { data: pending } = await (supabase as unknown as SupabaseClient)
    .from('reservations')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('status', 'pending');

  const pendingCount = (pending ?? []).length;

  return [
    'Good morning! Booking AI daily update:',
    '',
    `- ${pendingCount} pending reservation(s) to follow up on`,
    '',
    'I am ready to handle new booking inquiries today.',
  ].join('\n');
}

/**
 * Build Guest Experience morning briefing: pre-arrivals tomorrow, checkouts today.
 *
 * Uses bookings table (Phase 5 guest journey) — no status column, all rows are
 * valid bookings. Milestone dispatch handles the actual pre-arrival sends; this
 * briefing only reports counts for the owner's awareness.
 */
async function buildGuestExperienceBriefing(
  supabase: SupabaseClient,
  hotelId: string,
  timezone: string,
): Promise<string> {
  const nowInTz = new TZDate(new Date(), timezone);
  const todayStr = format(nowInTz, 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(nowInTz, 1), 'yyyy-MM-dd');

  // Pre-arrival bookings checking in tomorrow (milestone dispatch sends them)
  const { data: preArrivals } = await (supabase as unknown as SupabaseClient)
    .from('bookings')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('check_in_date', tomorrowStr);

  const preArrivalCount = (preArrivals ?? []).length;

  // Checkouts today (review requests will fire later via milestone dispatch)
  const { data: checkouts } = await (supabase as unknown as SupabaseClient)
    .from('bookings')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('check_out_date', todayStr);

  const checkoutCount = (checkouts ?? []).length;

  return [
    'Good morning! Guest Experience daily update:',
    '',
    `- ${preArrivalCount} pre-arrival message(s) scheduled for tomorrow`,
    `- ${checkoutCount} guest(s) checking out today (review requests will follow)`,
    '',
    'Guest journey automation is running.',
  ].join('\n');
}

/**
 * Build Housekeeping Coordinator morning briefing: queue size, dirty rooms.
 */
async function buildHousekeepingBriefing(
  supabase: SupabaseClient,
  hotelId: string,
  timezone: string,
): Promise<string> {
  const nowInTz = new TZDate(new Date(), timezone);
  const todayStr = format(nowInTz, 'yyyy-MM-dd');

  // Rooms in today's cleaning queue
  const { data: queue } = await (supabase as unknown as SupabaseClient)
    .from('housekeeping_queue')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('queue_date', todayStr);

  const queueCount = (queue ?? []).length;

  // Rooms currently marked dirty
  const { data: dirty } = await (supabase as unknown as SupabaseClient)
    .from('room_housekeeping_status')
    .select('room_id')
    .eq('hotel_id', hotelId)
    .eq('status', 'dirty');

  const dirtyCount = (dirty ?? []).length;

  return [
    'Good morning! Housekeeping daily update:',
    '',
    `- ${queueCount} room(s) in today\'s cleaning queue`,
    `- ${dirtyCount} room(s) currently marked dirty`,
    '',
    'Ready for cleaning task assignments.',
  ].join('\n');
}

// =============================================================================
// Role dispatch map
// =============================================================================

const ROLE_BRIEFING_BUILDERS: Record<
  string,
  (s: SupabaseClient, h: string, tz: string) => Promise<string>
> = {
  front_desk: buildFrontDeskBriefing,
  booking_ai: buildBookingAiBriefing,
  guest_experience: buildGuestExperienceBriefing,
  housekeeping_coordinator: buildHousekeepingBriefing,
};

// =============================================================================
// Main export
// =============================================================================

/**
 * Send morning briefings from each active employee bot to hotel owners.
 *
 * Per-hotel logic:
 * 1. Get owner_telegram_chat_id — filtered at query level (no chat_id = skipped).
 * 2. Query active bots for this hotel.
 * 3. If no active bots, skip hotel (increment skipped).
 * 4. For each active bot role, build a role-specific briefing and send it.
 * 5. Sleep 40ms between each individual send (rate limit guard).
 *
 * @returns { sent, errors, skipped } summary across all hotels
 */
export async function runMorningBriefingDispatch(): Promise<MorningBriefingResult> {
  const supabase = createServiceClient();
  let sent = 0;
  let errors = 0;
  let skipped = 0;

  // Query hotels that have completed Telegram onboarding (have owner_telegram_chat_id)
  const { data: hotels, error: hotelsError } = await (supabase as unknown as SupabaseClient)
    .from('hotels')
    .select('id, name, timezone, owner_telegram_chat_id')
    .not('owner_telegram_chat_id', 'is', null);

  if (hotelsError) {
    throw new Error(`[morningBriefing] Failed to fetch hotels: ${hotelsError.message}`);
  }

  if (!hotels || hotels.length === 0) {
    console.info('[morningBriefing] No hotels with owner Telegram chat ID — nothing to process');
    return { sent: 0, errors: 0, skipped: 0 };
  }

  for (const hotel of hotels as HotelRow[]) {
    try {
      const chatId = hotel.owner_telegram_chat_id;
      if (!chatId) {
        // Defensive check — query already filters nulls, but guard anyway
        skipped++;
        continue;
      }

      // Query all active bots for this hotel
      const { data: bots, error: botsError } = await (supabase as unknown as SupabaseClient)
        .from('hotel_bots')
        .select('role, vault_secret_id, is_active')
        .eq('hotel_id', hotel.id)
        .eq('is_active', true);

      if (botsError) {
        console.error(
          `[morningBriefing] Hotel ${hotel.id} (${hotel.name}): failed to fetch bots: ${botsError.message}`,
        );
        errors++;
        continue;
      }

      const activeBots: BotRow[] = (bots as BotRow[]) ?? [];

      if (activeBots.length === 0) {
        // No active bots — hotel is onboarded but no employees deployed
        console.info(
          `[morningBriefing] Hotel ${hotel.id} (${hotel.name}): no active bots — skipping`,
        );
        skipped++;
        continue;
      }

      // Send briefing from each active bot role
      for (const bot of activeBots) {
        try {
          const builder = ROLE_BRIEFING_BUILDERS[bot.role];
          if (!builder) {
            // Unknown role — no briefing builder registered, skip silently
            console.warn(
              `[morningBriefing] Hotel ${hotel.id}: unknown role "${bot.role}" — no briefing builder, skipping`,
            );
            continue;
          }

          // Resolve bot token from Vault
          const botToken = await getBotToken(
            supabase as unknown as SupabaseClient,
            hotel.id,
            bot.role,
          );

          if (!botToken) {
            console.warn(
              `[morningBriefing] Hotel ${hotel.id}: could not resolve token for role "${bot.role}" — skipping`,
            );
            errors++;
            continue;
          }

          // Build role-specific briefing text
          const text = await builder(
            supabase as unknown as SupabaseClient,
            hotel.id,
            hotel.timezone ?? 'UTC',
          );

          // Send the briefing message from this bot
          await sendTelegramReply({ botToken, chatId, text });

          sent++;

          console.info(
            `[morningBriefing] Hotel ${hotel.name}: sent ${bot.role} briefing to chat ${chatId}`,
          );

          // Rate limit: 40ms between each individual send
          await sleep(INTER_SEND_DELAY_MS);
        } catch (botError) {
          const message = botError instanceof Error ? botError.message : String(botError);
          console.error(
            `[morningBriefing] Hotel ${hotel.id} (${hotel.name}) role "${bot.role}" failed: ${message}`,
          );
          errors++;
        }
      }
    } catch (hotelError) {
      const message = hotelError instanceof Error ? hotelError.message : String(hotelError);
      console.error(
        `[morningBriefing] Hotel ${hotel.id} (${hotel.name}) failed: ${message}`,
      );
      errors++;
    }
  }

  console.info(
    `[morningBriefing] Complete. Sent: ${sent}, Errors: ${errors}, Skipped: ${skipped}`,
  );

  return { sent, errors, skipped };
}
