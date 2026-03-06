'use server';

/**
 * adminCreateHotel — Server Action for programmatic hotel creation.
 *
 * Calls supabase.auth.admin.createUser() with hotel_name in user_metadata.
 * The existing handle_new_user DB trigger fires automatically, atomically:
 *   1. Creating the hotels row (name from raw_user_meta_data.hotel_name)
 *   2. Creating the profiles row linking user to hotel
 *   3. Writing hotel_id back to app_metadata
 *
 * Admin-created hotels skip the onboarding wizard — onboarding_completed_at
 * is set immediately. The hotel owner is onboarded via the Telegram Setup
 * Wizard (Phase 11), not the web-based wizard.
 *
 * Source: .planning/phases/10-super-admin-panel-and-employee-bots/10-01-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a new hotel account programmatically via the Supabase Admin API.
 *
 * @param params.hotelName - Display name for the hotel
 * @param params.ownerEmail - Email address for the hotel owner's auth account
 * @param params.ownerPassword - Temporary password (owner should change on first login)
 * @returns { hotelId, userId } on success, { error } on failure
 */
export async function adminCreateHotel(params: {
  hotelName: string;
  ownerEmail: string;
  ownerPassword: string;
}): Promise<{ hotelId: string; userId: string } | { error: string }> {
  const supabase = createServiceClient();

  // Call the Admin API — fires handle_new_user trigger which atomically creates
  // the hotel + profile rows and writes hotel_id to app_metadata.
  // email_confirm: true skips email verification for admin-created accounts.
  const { data, error } = await supabase.auth.admin.createUser({
    email: params.ownerEmail,
    password: params.ownerPassword,
    email_confirm: true,
    user_metadata: {
      hotel_name: params.hotelName,
      full_name: '',
    },
  });

  if (error) {
    return { error: error.message };
  }

  const userId = data.user.id;

  // Retrieve hotel_id from app_metadata — set by handle_new_user trigger.
  // Pitfall 1: trigger timing — the UPDATE to raw_app_meta_data may not have
  // committed before createUser returns, so app_metadata.hotel_id may be
  // undefined. Fallback: query profiles table directly.
  let hotelId = data.user.app_metadata?.hotel_id as string | undefined;

  if (!hotelId) {
    // Fallback: query profiles table using service client (bypasses RLS)
    const { data: profile } = await (supabase as unknown as SupabaseClient)
      .from('profiles')
      .select('hotel_id')
      .eq('id', userId)
      .single();

    hotelId = (profile as { hotel_id: string } | null)?.hotel_id;
  }

  if (!hotelId) {
    return {
      error:
        'Hotel creation trigger did not set hotel_id — handle_new_user may not have run',
    };
  }

  // Mark onboarding complete — admin-created hotels skip the onboarding wizard.
  // The hotel owner is onboarded via Telegram Setup Wizard (Phase 11).
  await (supabase as unknown as SupabaseClient)
    .from('hotels')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', hotelId);

  return { hotelId, userId };
}
