'use server';

/**
 * provisionBots — Server Actions for Telegram bot provisioning.
 *
 * provisionBotForRole: For a single role, validates the bot token via Telegram's
 * getMe API, stores the plaintext token in Supabase Vault, generates a random
 * webhook_path_slug and webhook_secret, registers the webhook with Telegram's
 * setWebhook API, and upserts the hotel_bots row.
 *
 * Cleanup pattern: Every failure path after a successful Vault insert calls the
 * delete_vault_secret RPC to prevent orphaned Vault secrets.
 *
 * provisionAllBots: Runs provisioning for all roles in parallel via Promise.all.
 *
 * Source: .planning/phases/10-super-admin-panel-and-employee-bots/10-01-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

const ROLES = [
  'front_desk',
  'booking_ai',
  'guest_experience',
  'housekeeping_coordinator',
] as const;

type BotRole = (typeof ROLES)[number];

/**
 * Provisions a single Telegram bot for a hotel role.
 *
 * Steps:
 * 1. HTTPS validation — reject http:// URLs before calling Telegram
 * 2. Token validation via getMe — validates against Telegram's actual records
 * 3. Store token in Vault via create_bot_token_secret RPC
 * 4. Generate random webhook_path_slug and webhook_secret
 * 5. Register webhook with Telegram setWebhook
 * 6. Upsert hotel_bots row (handles re-provisioning via onConflict)
 * 7. Cleanup: delete Vault secret on any failure after step 3
 *
 * @returns { success: true; botUsername } on success, { error } on failure
 */
export async function provisionBotForRole(params: {
  hotelId: string;
  role: BotRole;
  botToken: string;
  appUrl: string;
}): Promise<{ success: true; botUsername: string } | { error: string }> {
  const supabase = createServiceClient();

  // Step 1: HTTPS validation — setWebhook requires HTTPS.
  // Return early before any API call to avoid confusing Telegram API errors.
  if (!params.appUrl.startsWith('https://')) {
    return {
      error:
        'App URL must be HTTPS for Telegram webhook registration. Use ngrok in development.',
    };
  }

  // Step 2: Token validation via getMe.
  // Validates the token against Telegram's records and retrieves bot_username.
  const getMeRes = await fetch(
    `https://api.telegram.org/bot${params.botToken}/getMe`,
  );
  const getMeBody = (await getMeRes.json()) as {
    ok: boolean;
    result?: { username: string };
  };

  if (!getMeBody.ok || !getMeBody.result?.username) {
    return { error: 'Invalid bot token — getMe failed' };
  }

  const botUsername = getMeBody.result.username;

  // Step 3: Store token in Vault via create_bot_token_secret RPC.
  // Returns vault.secrets.id UUID for storage in hotel_bots.vault_secret_id.
  const { data: vaultId, error: vaultError } = await (
    supabase as unknown as SupabaseClient
  ).rpc('create_bot_token_secret', {
    p_token: params.botToken,
    p_name: `hotel_bot_${params.hotelId}_${params.role}_${Date.now()}`,
  });

  if (vaultError || !vaultId) {
    return {
      error: `Vault storage failed: ${vaultError?.message ?? 'unknown'}`,
    };
  }

  // Step 4: Generate routing credentials.
  // webhook_path_slug: random UUID used as the URL path segment (NOT the bot token).
  // webhook_secret: 32 hex chars, no dashes — sent by Telegram on every update.
  const webhookPathSlug = crypto.randomUUID();
  const webhookSecret = crypto.randomUUID().replace(/-/g, '');

  // Step 5: Register webhook with Telegram setWebhook.
  // On failure: clean up the Vault secret to prevent orphans.
  const webhookUrl = `${params.appUrl}/api/telegram/${webhookPathSlug}`;
  const setWebhookRes = await fetch(
    `https://api.telegram.org/bot${params.botToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        drop_pending_updates: true,
        allowed_updates: ['message'],
      }),
    },
  );
  const setWebhookBody = (await setWebhookRes.json()) as {
    ok: boolean;
    description?: string;
  };

  if (!setWebhookBody.ok) {
    // Cleanup: remove Vault secret — setWebhook failed, bot not registered
    void (async () => {
      try {
        await (supabase as unknown as SupabaseClient).rpc('delete_vault_secret', {
          p_vault_secret_id: vaultId,
        });
      } catch (e: unknown) {
        console.error('[provisionBots] Vault cleanup failed after setWebhook error:', e);
      }
    })();

    return {
      error: `setWebhook failed: ${setWebhookBody.description ?? 'unknown'}`,
    };
  }

  // Step 6: Upsert hotel_bots row.
  // onConflict: 'hotel_id,role' handles re-provisioning (e.g. token rotation).
  // On failure: clean up the Vault secret to prevent orphans.
  const { error: upsertError } = await (supabase as unknown as SupabaseClient)
    .from('hotel_bots')
    .upsert(
      {
        hotel_id: params.hotelId,
        role: params.role,
        vault_secret_id: vaultId,
        bot_username: botUsername,
        webhook_secret: webhookSecret,
        webhook_path_slug: webhookPathSlug,
        is_active: true,
      },
      { onConflict: 'hotel_id,role' },
    );

  if (upsertError) {
    // Cleanup: remove Vault secret — DB upsert failed, secret would be orphaned
    void (async () => {
      try {
        await (supabase as unknown as SupabaseClient).rpc('delete_vault_secret', {
          p_vault_secret_id: vaultId,
        });
      } catch (e: unknown) {
        console.error('[provisionBots] Vault cleanup failed after upsert error:', e);
      }
    })();

    return { error: `DB upsert failed: ${upsertError.message}` };
  }

  return { success: true, botUsername };
}

/**
 * Provisions all Telegram bots for a hotel in parallel.
 *
 * Runs provisionBotForRole for each role with a non-empty token string.
 * Roles with empty/undefined tokens are skipped.
 *
 * @param params.hotelId - Hotel UUID
 * @param params.tokens - Map of role strings to bot tokens (empty = skip)
 * @param params.appUrl - Base URL for webhook registration (must be HTTPS)
 * @returns Record of role -> result for all processed roles
 */
export async function provisionAllBots(params: {
  hotelId: string;
  tokens: Record<string, string>;
  appUrl: string;
}): Promise<{
  results: Record<string, { success: true; botUsername: string } | { error: string }>;
}> {
  const entries = Object.entries(params.tokens).filter(
    ([, token]) => token && token.trim().length > 0,
  );

  const results = await Promise.all(
    entries.map(async ([role, token]) => {
      const result = await provisionBotForRole({
        hotelId: params.hotelId,
        role: role as BotRole,
        botToken: token.trim(),
        appUrl: params.appUrl,
      });
      return [role, result] as const;
    }),
  );

  return {
    results: Object.fromEntries(results),
  };
}
