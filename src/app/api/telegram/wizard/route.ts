/**
 * Telegram wizard bot webhook route handler — /api/telegram/wizard
 *
 * Receives inbound Telegram updates from the Setup Wizard bot, validates
 * the webhook secret, and asynchronously routes message and callback_query
 * updates to the wizard action handlers.
 *
 * Key design decisions:
 * - Fixed route (not slug-based): the wizard is a single global bot shared
 *   across all hotel onboarding flows — not per-hotel like employee bots.
 *   A single SETUP_WIZARD_BOT_TOKEN env var is used instead of Vault-per-hotel.
 * - Handles both message AND callback_query: unlike employee bots which only
 *   handle message.text, the wizard uses inline keyboard buttons which send
 *   callback_query updates (wizard:confirm, wizard:restart).
 * - after() from next/server: same pattern as employee bot handler — extends
 *   serverless function lifetime after 200 response, preventing Telegram retry
 *   storms when wizard DB writes take longer than Telegram's timeout window.
 * - Webhook secret validation via X-Telegram-Bot-Api-Secret-Token header:
 *   standard Telegram Bot API header, validated before any wizard work.
 * - All errors inside after() are caught: post-response phase must never crash.
 * - Non-text, non-callback updates return 200 silently: handles photos,
 *   stickers, etc. without causing Telegram to retry.
 * - No rate limiting: wizard is accessed by the hotel owner only, not
 *   guest-facing. Owner interacts at most 6 times per setup session.
 *
 * Required env vars:
 * - SETUP_WIZARD_BOT_TOKEN    — plaintext token for the Setup Wizard bot
 * - SETUP_WIZARD_WEBHOOK_SECRET — secret token registered via setWebhook
 *
 * Source: .planning/phases/11-setup-wizard-bot/11-02-PLAN.md
 */

import { after } from 'next/server';
import type { TelegramUpdate } from '@/lib/telegram/types';
import { handleWizardMessage, handleWizardCallback } from '@/lib/telegram/wizard/wizardActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/telegram/wizard
 *
 * Wizard bot webhook handler. Returns 200 immediately on all non-403 paths
 * to prevent Telegram retry storms. Wizard message/callback processing
 * happens asynchronously via after() after the response is sent.
 */
export async function POST(req: Request): Promise<Response> {
  // -------------------------------------------------------------------------
  // Step 1: Validate webhook secret
  // Telegram sets X-Telegram-Bot-Api-Secret-Token when setWebhook was called
  // with secret_token. Missing or incorrect token → 403.
  // This is the ONLY path that returns non-200.
  // -------------------------------------------------------------------------
  const secretToken = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  const expectedSecret = process.env.SETUP_WIZARD_WEBHOOK_SECRET ?? '';
  if (secretToken !== expectedSecret) {
    console.warn('[Wizard] Invalid webhook secret token');
    return new Response('Forbidden', { status: 403 });
  }

  // -------------------------------------------------------------------------
  // Step 2: Parse body and extract update fields
  // -------------------------------------------------------------------------
  const body = (await req.json()) as TelegramUpdate;
  const message = body.message;
  const callbackQuery = body.callback_query;

  // -------------------------------------------------------------------------
  // Step 3: Early exit for irrelevant updates
  // Handle photos, stickers, voice, etc. silently.
  // Return 200 — Telegram would retry if we returned 4xx.
  // -------------------------------------------------------------------------
  const hasValidMessage = !!(message?.text && message?.chat?.id);
  const hasValidCallback = !!(callbackQuery?.id && callbackQuery?.data);

  if (!hasValidMessage && !hasValidCallback) {
    return new Response('', { status: 200 });
  }

  // -------------------------------------------------------------------------
  // Step 4: Schedule async wizard work via after() and return 200 immediately
  //
  // after() extends the Next.js serverless function lifetime beyond the
  // response — the wizard DB writes can complete without Telegram timing
  // out and sending duplicate updates.
  //
  // All work inside after() is wrapped in try/catch. A crash in after() must
  // not surface as an unhandled rejection.
  // -------------------------------------------------------------------------
  after(async () => {
    try {
      if (hasValidMessage && message) {
        await handleWizardMessage(message);
      } else if (hasValidCallback && callbackQuery) {
        await handleWizardCallback(callbackQuery);
      }
    } catch (error) {
      console.error('[Wizard] Handler error:', error);
    }
  });

  // -------------------------------------------------------------------------
  // Step 5: Return 200 BEFORE the after() callback runs — this is the critical
  // line that prevents Telegram retry storms on slow wizard responses.
  // -------------------------------------------------------------------------
  return new Response('', { status: 200 });
}
