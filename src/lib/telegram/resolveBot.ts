/**
 * resolveBot() — Bot lookup helper for Telegram webhook routing.
 *
 * Resolves a hotel bot by its webhook path slug, returning the hotel_id,
 * role, vault_secret_id, webhook_secret, and is_active fields needed by
 * the Telegram webhook handler to authenticate and route inbound updates.
 *
 * Uses service_role client — webhook handler has no user session.
 * Returns null if no active bot found for the given slug.
 *
 * Security: webhook_path_slug is a random UUID (not the bot token).
 * This prevents the Telegram bot API token from appearing in URLs,
 * logs, or HTTP intermediary caches.
 *
 * Source: .planning/phases/09-telegram-infrastructure/09-01-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolves a hotel bot by its webhook path slug.
 * Used by the Telegram webhook handler to identify which hotel/role an update is for.
 *
 * @param slug - The webhook_path_slug UUID from the inbound webhook URL path segment
 * @returns Bot context (hotel_id, role, vault_secret_id, webhook_secret, is_active) or null
 */
export async function resolveBot(slug: string): Promise<{
  hotel_id: string;
  role: string;
  vault_secret_id: string;
  webhook_secret: string;
  is_active: boolean;
} | null> {
  const supabase = createServiceClient();
  const { data } = await (supabase as unknown as SupabaseClient)
    .from('hotel_bots')
    .select('hotel_id, role, vault_secret_id, webhook_secret, is_active')
    .eq('webhook_path_slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  return data as {
    hotel_id: string;
    role: string;
    vault_secret_id: string;
    webhook_secret: string;
    is_active: boolean;
  } | null;
}
