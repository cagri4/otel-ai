/**
 * Redis-based trial selection state for the trial-end employee selection flow.
 *
 * Stores the owner's current employee selection (toggles) per Telegram chat ID
 * in Upstash Redis with a 1-hour TTL.
 *
 * Also exports sendTrialSelectionKeyboard — the entry point called by the
 * trial notification cron (Plan 02) when a hotel's trial reaches day 14.
 *
 * Redis key pattern: trialSelect:{chatId}
 * TTL: 1 hour — selection session expires if owner does not complete it
 *
 * Source: .planning/phases/12-billing-model-migration-and-trial-end-flow/12-01-PLAN.md
 */

import { Redis } from '@upstash/redis';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPLOYEE_ROLE_PRICES, calculateMonthlyTotal, type EmployeeRoleKey } from './plans';
import { buildSelectionKeyboard } from './trialKeyboard';

// Lazily initialized Redis client — null if env vars are missing.
let _redis: Redis | null | undefined = undefined; // undefined = not yet initialized

function getRedis(): Redis | null {
  if (_redis !== undefined) {
    return _redis;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    _redis = null;
    return null;
  }

  _redis = new Redis({ url, token });
  return _redis;
}

// ============================================================================
// Trial Selection State Type
// ============================================================================

/**
 * State for the trial-end employee selection session.
 *
 * Stored in Redis per hotel owner's Telegram chat ID for the duration of the
 * selection flow. messageId is needed for editMessageReplyMarkup when the owner
 * toggles employees on/off.
 */
export interface TrialSelection {
  hotelId: string;
  chatId: number;
  botToken: string;        // Front desk bot token (plaintext, for sending messages)
  messageId: number;       // Telegram message_id of the selection keyboard (for editMessageReplyMarkup)
  selectedRoles: string[]; // Role keys currently toggled on e.g. ['front_desk', 'booking_ai']
  availableRoles: string[]; // All role keys the hotel has active bots for
  currency: 'try' | 'eur'; // Determined by hotel country
}

// ============================================================================
// Redis CRUD Operations
// ============================================================================

const KEY_PREFIX = 'trialSelect:';
const TTL_SECONDS = 3600; // 1 hour

/**
 * Retrieve trial selection state for a Telegram chat.
 *
 * @param chatId - Telegram chat.id of the hotel owner
 * @returns TrialSelection if session exists, null if no session or Redis unavailable
 */
export async function getTrialSelection(chatId: number): Promise<TrialSelection | null> {
  const redis = getRedis();
  if (!redis) {
    return null;
  }

  try {
    const data = await redis.get<TrialSelection>(`${KEY_PREFIX}${chatId}`);
    return data ?? null;
  } catch (error) {
    console.error('[trialSelection] getTrialSelection error:', error);
    return null;
  }
}

/**
 * Persist trial selection state for a Telegram chat.
 *
 * @param chatId - Telegram chat.id of the hotel owner
 * @param state  - Current trial selection state to persist
 */
export async function setTrialSelection(chatId: number, state: TrialSelection): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.set(`${KEY_PREFIX}${chatId}`, JSON.stringify(state), { ex: TTL_SECONDS });
  } catch (error) {
    console.error('[trialSelection] setTrialSelection error:', error);
  }
}

/**
 * Delete trial selection state for a Telegram chat.
 *
 * Called after the owner confirms their selection (Plan 03 callback handler)
 * or when the session expires naturally.
 *
 * @param chatId - Telegram chat.id of the hotel owner
 */
export async function clearTrialSelection(chatId: number): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.del(`${KEY_PREFIX}${chatId}`);
  } catch (error) {
    console.error('[trialSelection] clearTrialSelection error:', error);
  }
}

// ============================================================================
// Selection keyboard sender
// ============================================================================

/**
 * Send the trial-end employee selection keyboard to the hotel owner via Telegram.
 *
 * Called by the trial notification cron on day 14 (or when the trial expires).
 * Also called by the callback handler for re-sending after session expiry.
 *
 * Flow:
 * 1. Queries hotel_bots to find which employee bots are active for this hotel.
 * 2. Initializes TrialSelection with all active roles selected by default.
 *    (Owner starts with everything enabled, deselects what they don't want.)
 * 3. Builds the inline keyboard via buildSelectionKeyboard.
 * 4. Sends the message via Telegram Bot API sendMessage.
 * 5. Saves returned message_id to TrialSelection (for editMessageReplyMarkup on toggle).
 * 6. Stores TrialSelection in Redis.
 *
 * @param params.hotelId   - Hotel UUID
 * @param params.chatId    - Telegram chat.id of the hotel owner
 * @param params.botToken  - Plaintext bot token for the front desk bot
 * @param params.currency  - 'try' for TR hotels, 'eur' for EU hotels
 */
export async function sendTrialSelectionKeyboard(params: {
  hotelId: string;
  chatId: number;
  botToken: string;
  currency: 'try' | 'eur';
}): Promise<void> {
  const { hotelId, chatId, botToken, currency } = params;
  const supabase = createServiceClient() as unknown as SupabaseClient;

  // 1. Query active hotel bots to determine available roles
  const { data: bots, error: botsError } = await supabase
    .from('hotel_bots')
    .select('role')
    .eq('hotel_id', hotelId)
    .eq('is_active', true);

  if (botsError) {
    console.error('[sendTrialSelectionKeyboard] Failed to fetch hotel_bots:', botsError);
    return;
  }

  const availableRoles: string[] = bots?.map((b: { role: string }) => b.role) ?? [];

  if (availableRoles.length === 0) {
    console.warn('[sendTrialSelectionKeyboard] No active bots found for hotel:', hotelId);
    return;
  }

  // 2. All roles are selected by default — owner deselects what they don't want
  const selectedRoles = [...availableRoles];

  // 3. Build the inline keyboard
  const replyMarkup = buildSelectionKeyboard(availableRoles, selectedRoles, currency);

  // 4. Build message text with employee list and pricing
  const currencyLabel = currency === 'try' ? 'TRY' : 'EUR';
  const employeeLines = availableRoles
    .map((roleKey) => {
      const roleData = EMPLOYEE_ROLE_PRICES[roleKey as EmployeeRoleKey];
      if (!roleData) return null;
      return `- ${roleData.displayName}: ${roleData[currency]} ${currencyLabel}/month`;
    })
    .filter(Boolean)
    .join('\n');

  const total = calculateMonthlyTotal(selectedRoles as EmployeeRoleKey[], currency);
  const messageText =
    'Your trial has ended. Select which AI employees to keep:\n\n' +
    employeeLines +
    `\n\nTotal: ${total} ${currencyLabel}/month\n\n` +
    'Tap an employee to toggle. Tap Confirm to proceed to payment.';

  // 5. Send the message via Telegram Bot API
  let messageId = 0;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        reply_markup: replyMarkup,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[sendTrialSelectionKeyboard] sendMessage failed:', res.status, errText);
      return;
    }

    const result = await res.json() as { ok: boolean; result?: { message_id: number } };
    if (result.ok && result.result) {
      messageId = result.result.message_id;
    }
  } catch (error) {
    console.error('[sendTrialSelectionKeyboard] Network error sending message:', error);
    return;
  }

  // 6. Store TrialSelection in Redis
  const trialSelectionState: TrialSelection = {
    hotelId,
    chatId,
    botToken,
    messageId,
    selectedRoles,
    availableRoles,
    currency,
  };

  await setTrialSelection(chatId, trialSelectionState);
}
