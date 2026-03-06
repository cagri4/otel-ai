/**
 * Redis-based wizard session persistence for the OtelAI Setup Wizard bot.
 *
 * Stores wizard state per Telegram chat ID in Upstash Redis with a 7-day TTL.
 * TTL resets on every write so active sessions never expire mid-wizard.
 *
 * Graceful degradation:
 * - If Redis env vars are missing, all operations are no-ops.
 * - getWizardState returns null (no session) when Redis is unavailable.
 * - setWizardState and clearWizardState are silent no-ops when Redis is unavailable.
 * - isRedisAvailable() lets callers distinguish "Redis down" from "no session found".
 *
 * Source: .planning/phases/11-setup-wizard-bot/11-01-PLAN.md
 */

import { Redis } from '@upstash/redis';

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
// Wizard State Types
// ============================================================================

/**
 * All possible steps in the Setup Wizard flow.
 *
 * 5 data-collection steps + 1 confirmation step.
 * Steps are traversed in order; confirm_complete is a terminal step
 * requiring inline keyboard interaction.
 */
export type WizardStep =
  | 'collect_hotel_name'
  | 'collect_address'
  | 'collect_room_count'
  | 'collect_checkin_time'
  | 'collect_checkout_time'
  | 'confirm_complete';

/**
 * Wizard session state stored in Redis per Telegram chat ID.
 *
 * hotelId is always present (set on /start deep link intake).
 * Data fields are populated incrementally as the owner answers each step.
 */
export interface WizardState {
  hotelId: string;
  step: WizardStep;
  hotelName?: string;
  address?: string;
  roomCount?: number;
  checkinTime?: string;
  checkoutTime?: string;
}

// ============================================================================
// Redis CRUD Operations
// ============================================================================

const KEY_PREFIX = 'wizard:';
const TTL_SECONDS = 604800; // 7 days — resets on every write

/**
 * Retrieve wizard state for a Telegram chat.
 *
 * @param chatId - Telegram chat.id from the inbound Update
 * @returns WizardState if session exists, null if no session or Redis unavailable
 */
export async function getWizardState(chatId: number): Promise<WizardState | null> {
  const redis = getRedis();
  if (!redis) {
    return null;
  }

  try {
    const data = await redis.get<WizardState>(`${KEY_PREFIX}${chatId}`);
    return data ?? null;
  } catch (error) {
    console.error('[wizardState] getWizardState error:', error);
    return null;
  }
}

/**
 * Persist wizard state for a Telegram chat.
 *
 * Resets TTL to 7 days on every write — active sessions never expire mid-wizard.
 *
 * @param chatId - Telegram chat.id from the inbound Update
 * @param state - Current wizard state to persist
 */
export async function setWizardState(chatId: number, state: WizardState): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.set(`${KEY_PREFIX}${chatId}`, state, { ex: TTL_SECONDS });
  } catch (error) {
    console.error('[wizardState] setWizardState error:', error);
  }
}

/**
 * Delete wizard state for a Telegram chat.
 *
 * Called on wizard completion to free Redis storage.
 *
 * @param chatId - Telegram chat.id from the inbound Update
 */
export async function clearWizardState(chatId: number): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.del(`${KEY_PREFIX}${chatId}`);
  } catch (error) {
    console.error('[wizardState] clearWizardState error:', error);
  }
}

/**
 * Check whether Redis is available.
 *
 * Used by the webhook handler to distinguish "Redis down" (send error message)
 * from "no session found" (send guidance message).
 *
 * @returns true if Redis client was successfully initialized, false otherwise
 */
export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}
