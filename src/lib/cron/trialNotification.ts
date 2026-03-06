/**
 * Trial countdown notification dispatch logic.
 *
 * Runs daily via Vercel cron (see vercel.json). Queries all subscriptions in
 * 'trialing' status, computes days remaining in the trial, and sends Telegram
 * notifications to hotel owners at days 7, 12, 13, and 14 of their trial period.
 *
 * Notifications are sent via the hotel's front desk bot (the main bot the owner
 * interacts with). Boolean tracking columns on the subscriptions table prevent
 * duplicate sends — each notification is sent at most once per hotel.
 *
 * Hotels without owner_telegram_chat_id are skipped silently — they have not
 * yet completed the Telegram onboarding wizard.
 *
 * Day 14 handler: instead of a plain text message, calls sendTrialSelectionKeyboard
 * which presents the employee selection inline keyboard to the owner, triggering
 * the trial-end payment flow (Plan 12-03).
 *
 * Source: .planning/phases/12-billing-model-migration-and-trial-end-flow/12-02-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramReply } from '@/lib/telegram/sendReply';
import { sendTrialSelectionKeyboard } from '@/lib/billing/trialSelection';
import type { Subscription, Hotel } from '@/types/database';

// =============================================================================
// Types
// =============================================================================

interface TrialNotificationResult {
  processed: number;
  sent: number;
  errors: number;
}

// Joined row from subscriptions + hotels
interface TrialingHotel {
  // From subscriptions
  subscription_id: string;
  hotel_id: string;
  trial_ends_at: string;
  trial_notified_day_7: boolean;
  trial_notified_day_12: boolean;
  trial_notified_day_13: boolean;
  trial_notified_day_14: boolean;
  // From hotels
  hotel_name: string;
  owner_telegram_chat_id: number | null;
  country: string | null;
}

// =============================================================================
// Notification column map
// =============================================================================

type NotificationDay = 7 | 12 | 13 | 14;

const NOTIFIED_COLUMN: Record<NotificationDay, keyof Pick<Subscription, 'trial_notified_day_7' | 'trial_notified_day_12' | 'trial_notified_day_13' | 'trial_notified_day_14'>> = {
  7: 'trial_notified_day_7',
  12: 'trial_notified_day_12',
  13: 'trial_notified_day_13',
  14: 'trial_notified_day_14',
};

// =============================================================================
// Notification messages
// =============================================================================

const NOTIFICATION_MESSAGES: Record<Exclude<NotificationDay, 14>, string> = {
  7: 'Your OtelAI trial has 7 days remaining. All your AI employees are working for you! Enjoy the rest of your trial.',
  12: 'Your OtelAI trial ends in 2 days. You\'ll be asked to select which AI employees to keep. Start thinking about which roles are most valuable to your hotel.',
  13: 'Your OtelAI trial ends tomorrow. After expiry, you\'ll select your AI team and complete payment to keep them active.',
};

// =============================================================================
// Bot token resolver
// =============================================================================

/**
 * Resolve the plaintext front desk bot token for a hotel.
 *
 * Queries hotel_bots for the active front desk bot, then calls the
 * get_bot_token RPC to decrypt the token from Supabase Vault.
 *
 * @returns Plaintext bot token, or null if no active front desk bot found
 */
async function getFrontDeskBotToken(
  supabase: SupabaseClient,
  hotelId: string,
): Promise<string | null> {
  // Find the active front desk bot for this hotel
  const { data: bot, error: botError } = await supabase
    .from('hotel_bots')
    .select('vault_secret_id')
    .eq('hotel_id', hotelId)
    .eq('role', 'front_desk')
    .eq('is_active', true)
    .maybeSingle();

  if (botError) {
    console.error(`[trialNotification] Failed to fetch front_desk bot for hotel ${hotelId}: ${botError.message}`);
    return null;
  }

  if (!bot || !(bot as { vault_secret_id: string }).vault_secret_id) {
    console.warn(`[trialNotification] No active front_desk bot found for hotel ${hotelId}`);
    return null;
  }

  const vaultSecretId = (bot as { vault_secret_id: string }).vault_secret_id;

  // Decrypt the bot token from Vault via RPC
  const { data: tokenData, error: tokenError } = await supabase.rpc('get_bot_token', {
    p_vault_secret_id: vaultSecretId,
  });

  if (tokenError) {
    console.error(`[trialNotification] get_bot_token RPC failed for hotel ${hotelId}: ${tokenError.message}`);
    return null;
  }

  return (tokenData as string) ?? null;
}

// =============================================================================
// Sent flag updater
// =============================================================================

/**
 * Mark the trial notification flag for the given day as sent.
 * Uses the SupabaseClient cast pattern for manually-typed tables.
 */
async function markNotificationSent(
  supabase: SupabaseClient,
  subscriptionId: string,
  day: NotificationDay,
): Promise<void> {
  const column = NOTIFIED_COLUMN[day];
  const { error } = await (supabase as unknown as SupabaseClient)
    .from('subscriptions')
    .update({ [column]: true })
    .eq('id', subscriptionId);

  if (error) {
    console.error(`[trialNotification] Failed to mark ${column}=true for subscription ${subscriptionId}: ${error.message}`);
  }
}

// =============================================================================
// Main export
// =============================================================================

/**
 * Process all trialing subscriptions and send Telegram countdown notifications.
 *
 * Notification schedule (most-recent-first else-if chaining prevents batch
 * catch-up when multiple thresholds have passed on first check):
 * - daysRemaining <= 0 AND NOT trial_notified_day_14 => sendTrialSelectionKeyboard
 * - daysRemaining <= 1 AND NOT trial_notified_day_13 => "trial ends tomorrow"
 * - daysRemaining <= 2 AND NOT trial_notified_day_12 => "trial ends in 2 days"
 * - daysRemaining <= 7 AND NOT trial_notified_day_7  => "7 days remaining"
 *
 * Hotels without owner_telegram_chat_id are skipped silently.
 * Each notification is sent at most once via boolean tracking columns.
 *
 * @returns Summary of processing: processed, sent, errors
 */
export async function runTrialNotificationDispatch(): Promise<TrialNotificationResult> {
  const supabase = createServiceClient();
  let processed = 0;
  let sent = 0;
  let errors = 0;

  // Query all trialing subscriptions joined to hotels
  // Use SupabaseClient cast to avoid TypeScript never inference for cross-table select
  const { data: subscriptions, error: subError } = await (supabase as unknown as SupabaseClient)
    .from('subscriptions')
    .select(`
      id,
      hotel_id,
      trial_ends_at,
      trial_notified_day_7,
      trial_notified_day_12,
      trial_notified_day_13,
      trial_notified_day_14,
      hotels!inner(
        name,
        owner_telegram_chat_id,
        country
      )
    `)
    .eq('status', 'trialing')
    .not('trial_ends_at', 'is', null);

  if (subError) {
    throw new Error(`[trialNotification] Failed to fetch trialing subscriptions: ${subError.message}`);
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.info('[trialNotification] No trialing subscriptions found — nothing to process');
    return { processed: 0, sent: 0, errors: 0 };
  }

  // Normalize joined data into flat TrialingHotel shape.
  // Cast through unknown first — PostgREST returns hotels as array from inner join,
  // but TypeScript infers it as array. We treat it as a single object after cast.
  type RawRow = {
    id: string;
    hotel_id: string;
    trial_ends_at: string;
    trial_notified_day_7: boolean;
    trial_notified_day_12: boolean;
    trial_notified_day_13: boolean;
    trial_notified_day_14: boolean;
    hotels: {
      name: string;
      owner_telegram_chat_id: number | null;
      country: string | null;
    };
  };
  const trialingHotels: TrialingHotel[] = (subscriptions as unknown as RawRow[]).map((row) => ({
    subscription_id: row.id,
    hotel_id: row.hotel_id,
    trial_ends_at: row.trial_ends_at,
    trial_notified_day_7: row.trial_notified_day_7,
    trial_notified_day_12: row.trial_notified_day_12,
    trial_notified_day_13: row.trial_notified_day_13,
    trial_notified_day_14: row.trial_notified_day_14,
    hotel_name: row.hotels.name,
    owner_telegram_chat_id: row.hotels.owner_telegram_chat_id,
    country: row.hotels.country,
  }));

  for (const hotel of trialingHotels) {
    processed++;

    try {
      // Skip hotels where owner has not completed Telegram onboarding
      if (!hotel.owner_telegram_chat_id) {
        console.info(
          `[trialNotification] Hotel ${hotel.hotel_id} (${hotel.hotel_name}): no owner_telegram_chat_id — skipping`,
        );
        continue;
      }

      const chatId = hotel.owner_telegram_chat_id;

      // Compute days remaining in trial
      const trialEndsMs = new Date(hotel.trial_ends_at).getTime();
      const nowMs = Date.now();
      const daysRemaining = Math.ceil((trialEndsMs - nowMs) / (1000 * 60 * 60 * 24));

      // Determine which notification to send (ordered most-recent-first to prevent
      // batch catch-up sends when a hotel is first checked after multiple thresholds
      // have passed — only ONE notification is sent per hotel per cron run)
      let notificationDay: NotificationDay | null = null;

      if (daysRemaining <= 0 && !hotel.trial_notified_day_14) {
        notificationDay = 14;
      } else if (daysRemaining <= 1 && !hotel.trial_notified_day_13) {
        notificationDay = 13;
      } else if (daysRemaining <= 2 && !hotel.trial_notified_day_12) {
        notificationDay = 12;
      } else if (daysRemaining <= 7 && !hotel.trial_notified_day_7) {
        notificationDay = 7;
      }

      if (notificationDay === null) {
        // No notification due for this hotel today
        continue;
      }

      // Resolve the front desk bot token
      const botToken = await getFrontDeskBotToken(supabase as unknown as SupabaseClient, hotel.hotel_id);
      if (!botToken) {
        console.warn(
          `[trialNotification] Hotel ${hotel.hotel_id}: could not resolve front_desk bot token — skipping`,
        );
        errors++;
        continue;
      }

      // Determine currency based on hotel country
      const currency: 'try' | 'eur' = hotel.country === 'TR' ? 'try' : 'eur';

      // Send the notification
      if (notificationDay === 14) {
        // Day 14: present the trial selection keyboard (triggers payment flow)
        await sendTrialSelectionKeyboard({
          hotelId: hotel.hotel_id,
          chatId,
          botToken,
          currency,
        });
      } else {
        // Days 7, 12, 13: send countdown plain text message
        const message = NOTIFICATION_MESSAGES[notificationDay];
        await sendTelegramReply({ botToken, chatId, text: message });
      }

      // Mark the notification as sent (idempotency guard)
      await markNotificationSent(supabase as unknown as SupabaseClient, hotel.subscription_id, notificationDay);

      sent++;

      console.info(
        `[trialNotification] Hotel ${hotel.hotel_name}: day-${notificationDay} notification sent (${daysRemaining} days remaining)`,
      );
    } catch (hotelError) {
      const message = hotelError instanceof Error ? hotelError.message : String(hotelError);
      console.error(
        `[trialNotification] Hotel ${hotel.hotel_id} (${hotel.hotel_name}) failed: ${message}`,
      );
      errors++;
    }
  }

  console.info(
    `[trialNotification] Complete. Processed: ${processed}, Sent: ${sent}, Errors: ${errors}`,
  );

  return { processed, sent, errors };
}
