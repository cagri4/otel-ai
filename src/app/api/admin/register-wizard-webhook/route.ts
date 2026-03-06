/**
 * Wizard bot webhook registration endpoint — /api/admin/register-wizard-webhook
 *
 * One-time admin endpoint to register the Setup Wizard bot's webhook URL
 * with the Telegram Bot API via setWebhook.
 *
 * Usage:
 * The super admin calls this endpoint once after deployment (or after rotating
 * the webhook secret). It is idempotent — calling it again simply overwrites
 * the existing webhook registration with the same or updated values.
 *
 * Auth guard:
 * Follows the same SUPER_ADMIN_EMAIL check pattern as (admin)/layout.tsx but
 * implemented as an API route guard instead of a layout redirect. Returns
 * 401 for unauthenticated and 403 for non-admin users.
 *
 * Telegram setWebhook call includes:
 * - url: {NEXT_PUBLIC_APP_URL}/api/telegram/wizard
 * - secret_token: SETUP_WIZARD_WEBHOOK_SECRET (validates inbound requests)
 * - drop_pending_updates: true (discard any queued updates from before registration)
 * - allowed_updates: ['message', 'callback_query'] (wizard needs both)
 *
 * Required env vars:
 * - SETUP_WIZARD_BOT_TOKEN      — plaintext token for the Setup Wizard bot
 * - SETUP_WIZARD_WEBHOOK_SECRET — secret token to set on webhook (validated per request)
 * - NEXT_PUBLIC_APP_URL         — base URL of the deployed app (e.g. https://app.otelai.com)
 * - SUPER_ADMIN_EMAIL           — email address of the authorized super admin
 *
 * Source: .planning/phases/11-setup-wizard-bot/11-02-PLAN.md
 */

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shape of the Telegram setWebhook API response */
interface TelegramSetWebhookResponse {
  ok: boolean;
  description?: string;
  result?: boolean;
}

/**
 * POST /api/admin/register-wizard-webhook
 *
 * Registers the wizard bot webhook with Telegram. Requires super admin auth.
 * Idempotent — repeated calls overwrite the existing webhook registration.
 */
export async function POST(): Promise<Response> {
  // -------------------------------------------------------------------------
  // Step 1: Auth guard — must be authenticated super admin
  // Uses the same session client pattern as (admin)/layout.tsx.
  // Returns 401 for no session, 403 for non-super-admin user.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Step 2: Read required env vars
  // All three are required — missing any one makes the registration impossible.
  // -------------------------------------------------------------------------
  const botToken = process.env.SETUP_WIZARD_BOT_TOKEN;
  const webhookSecret = process.env.SETUP_WIZARD_WEBHOOK_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!botToken || !webhookSecret || !appUrl) {
    return Response.json(
      { error: 'Missing required env vars: SETUP_WIZARD_BOT_TOKEN, SETUP_WIZARD_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL' },
      { status: 400 },
    );
  }

  // -------------------------------------------------------------------------
  // Step 3: Call Telegram setWebhook API
  // allowed_updates includes both 'message' (text input) and 'callback_query'
  // (inline keyboard button presses) — the wizard needs both.
  // drop_pending_updates: true discards any queued updates from before
  // registration, preventing wizard state confusion on re-registration.
  // -------------------------------------------------------------------------
  const telegramUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
  const webhookUrl = `${appUrl}/api/telegram/wizard`;

  let telegramResponse: TelegramSetWebhookResponse;

  try {
    const res = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query'],
      }),
    });

    telegramResponse = (await res.json()) as TelegramSetWebhookResponse;
  } catch (error) {
    console.error('[register-wizard-webhook] Telegram API request failed:', error);
    return Response.json({ error: 'Failed to reach Telegram API' }, { status: 500 });
  }

  // -------------------------------------------------------------------------
  // Step 4: Return result based on Telegram response
  // -------------------------------------------------------------------------
  if (telegramResponse.ok) {
    console.info(
      '[register-wizard-webhook] Webhook registered successfully:',
      webhookUrl,
    );
    return Response.json({
      success: true,
      description: telegramResponse.description ?? 'Webhook was set',
      webhookUrl,
    });
  }

  console.error(
    '[register-wizard-webhook] Telegram setWebhook failed:',
    telegramResponse.description,
  );
  return Response.json(
    { error: telegramResponse.description ?? 'Telegram setWebhook returned ok: false' },
    { status: 500 },
  );
}
