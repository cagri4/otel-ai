/**
 * Admin endpoint to re-provision all existing employee bot webhooks.
 *
 * Re-registers every hotel_bot webhook with corrected allowed_updates
 * (adding callback_query) so that Telegram inline keyboard button taps
 * reach the server. This fixes the silent callback_query drop caused by
 * the original provisionBots.ts registering webhooks with only ['message'].
 *
 * Key behaviors:
 * - Queries ALL hotel_bots rows (no is_active filter — inactive bots are
 *   updated too so that reactivation works correctly)
 * - Iterates sequentially to respect Telegram rate limits
 * - Does NOT use drop_pending_updates — preserves real pending guest messages
 * - Includes secret_token on every setWebhook call — preserves X-Telegram-Bot-Api-Secret-Token
 *   header validation in the existing webhook handler
 * - Read-only against the DB — only Telegram server-side registration is updated
 *
 * Auth: SUPER_ADMIN_EMAIL guard — same pattern as register-wizard-webhook/route.ts
 *
 * Source: .planning/phases/14-fix-callback-query-delivery/14-01-PLAN.md
 */

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shape of a hotel_bots row from the re-provision query */
interface HotelBotRow {
  hotel_id: string;
  role: string;
  vault_secret_id: string;
  webhook_path_slug: string;
  webhook_secret: string;
}

/** Per-bot result tracked for the structured response */
interface BotResult {
  hotel_id: string;
  role: string;
  ok: boolean;
  error?: string;
}

/** Shape of the Telegram setWebhook API response */
interface TelegramSetWebhookResponse {
  ok: boolean;
  description?: string;
}

/**
 * POST /api/admin/reprovision-employee-webhooks
 *
 * Re-provisions all hotel employee bot webhooks with corrected allowed_updates.
 * Requires super admin auth. Sequential iteration — no Promise.all.
 */
export async function POST(): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Step 1: Auth guard — must be authenticated super admin
  // Follows register-wizard-webhook/route.ts pattern exactly.
  // ---------------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!superAdminEmail || user.email !== superAdminEmail) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ---------------------------------------------------------------------------
  // Step 2: App URL check — required for constructing webhook URLs
  // ---------------------------------------------------------------------------
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return Response.json({ error: 'Missing NEXT_PUBLIC_APP_URL' }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Step 3: Query ALL hotel_bots rows (no is_active filter)
  // Inactive bots are updated too — they should work correctly if reactivated.
  // Uses createServiceClient with SupabaseClient cast (hotel_bots is manually typed).
  // ---------------------------------------------------------------------------
  const serviceClient = createServiceClient() as unknown as SupabaseClient;

  const { data: bots, error: botsError } = await serviceClient
    .from('hotel_bots')
    .select('hotel_id, role, vault_secret_id, webhook_path_slug, webhook_secret');

  if (botsError) {
    console.error('[reprovision-employee-webhooks] Failed to query hotel_bots:', botsError.message);
    return Response.json(
      { error: `Failed to query hotel_bots: ${botsError.message}` },
      { status: 500 },
    );
  }

  if (!bots || bots.length === 0) {
    return Response.json({ success: true, total: 0, updated: 0, failed: 0, details: [] });
  }

  const botRows = bots as unknown as HotelBotRow[];

  // ---------------------------------------------------------------------------
  // Step 4: Iterate sequentially — avoid Telegram rate limits at scale
  // For each bot: decrypt token via get_bot_token RPC, call setWebhook with
  // corrected allowed_updates. No drop_pending_updates — preserve guest messages.
  // ---------------------------------------------------------------------------
  let successCount = 0;
  let failedCount = 0;
  const results: BotResult[] = [];

  for (const bot of botRows) {
    // Decrypt the bot token from Vault via get_bot_token RPC
    const { data: botToken, error: tokenError } = await serviceClient.rpc('get_bot_token', {
      p_vault_secret_id: bot.vault_secret_id,
    });

    if (tokenError || !botToken) {
      const errMsg = tokenError?.message ?? 'get_bot_token returned null';
      console.warn(
        `[reprovision-employee-webhooks] Skipping ${bot.hotel_id}/${bot.role}: token decryption failed — ${errMsg}`,
      );
      failedCount++;
      results.push({ hotel_id: bot.hotel_id, role: bot.role, ok: false, error: errMsg });
      continue;
    }

    // Build the webhook URL using the existing webhook_path_slug
    const webhookUrl = `${appUrl}/api/telegram/${bot.webhook_path_slug}`;

    // Call setWebhook with corrected allowed_updates.
    // CRITICAL: include secret_token — preserves X-Telegram-Bot-Api-Secret-Token validation.
    // CRITICAL: no drop_pending_updates — do NOT discard real pending guest messages.
    let telegramResponse: TelegramSetWebhookResponse;
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken as string}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: bot.webhook_secret,
          allowed_updates: ['message', 'callback_query'],
        }),
      });
      telegramResponse = (await res.json()) as TelegramSetWebhookResponse;
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error(
        `[reprovision-employee-webhooks] Telegram API fetch failed for ${bot.hotel_id}/${bot.role}: ${errMsg}`,
      );
      failedCount++;
      results.push({ hotel_id: bot.hotel_id, role: bot.role, ok: false, error: errMsg });
      continue;
    }

    if (telegramResponse.ok) {
      successCount++;
      results.push({ hotel_id: bot.hotel_id, role: bot.role, ok: true });
      console.info(
        `[reprovision-employee-webhooks] Updated ${bot.hotel_id}/${bot.role} => ${webhookUrl}`,
      );
    } else {
      const errMsg = telegramResponse.description ?? 'setWebhook returned ok: false';
      console.error(
        `[reprovision-employee-webhooks] setWebhook failed for ${bot.hotel_id}/${bot.role}: ${errMsg}`,
      );
      failedCount++;
      results.push({ hotel_id: bot.hotel_id, role: bot.role, ok: false, error: errMsg });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 5: Return structured summary with per-bot details
  // ---------------------------------------------------------------------------
  console.info(
    `[reprovision-employee-webhooks] Complete. Total: ${botRows.length}, Updated: ${successCount}, Failed: ${failedCount}`,
  );

  return Response.json({
    success: true,
    total: botRows.length,
    updated: successCount,
    failed: failedCount,
    details: results,
  });
}
