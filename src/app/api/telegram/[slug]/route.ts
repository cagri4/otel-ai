/**
 * Telegram webhook route handler — /api/telegram/[slug]
 *
 * Receives inbound Telegram updates from registered bots, validates the
 * webhook secret, sanitizes and rate-limits input, then asynchronously
 * invokes the AI agent pipeline and sends the reply back via the Bot API.
 *
 * Key design decisions:
 * - Dynamic [slug] routing: each bot has a unique random UUID slug as its
 *   webhook URL path segment — prevents bot token exposure in URLs/logs
 * - Secret token validation via X-Telegram-Bot-Api-Secret-Token header:
 *   standard Telegram Bot API header, validated before any agent work
 * - after() from next/server: extends serverless function lifetime after
 *   the 200 response is sent — prevents Telegram retry storms when agent
 *   response takes longer than Telegram's timeout window (Pitfall 1, research)
 * - Bot token decrypted inside after(): minimizes time plaintext token is in
 *   memory; Vault RPC only called if all earlier validation steps pass
 * - Non-streaming invokeAgent: Telegram requires a complete message (same
 *   pattern as WhatsApp webhook — no onToken callback)
 * - All errors inside after() are caught: post-response phase must never crash
 * - Rate limited / unknown slug / non-text updates return 200 (not 429/404):
 *   prevents Telegram from retrying requests that will always fail
 *
 * Differences from WhatsApp webhook:
 * 1. Dynamic routing via [slug] (not a fixed URL)
 * 2. Secret token header validation (not Twilio HMAC signature)
 * 3. after() for async agent invocation (WhatsApp awaits inline)
 *
 * Source: .planning/phases/09-telegram-infrastructure/09-02-PLAN.md
 */

import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveBot } from '@/lib/telegram/resolveBot';
import { sendTelegramReply } from '@/lib/telegram/sendReply';
import type { TelegramUpdate } from '@/lib/telegram/types';
import { invokeAgent } from '@/lib/agents/invokeAgent';
import { AgentRole } from '@/lib/agents/types';
import { sanitizeGuestInput } from '@/lib/security/sanitizeGuestInput';
import { checkHotelRateLimit } from '@/lib/security/rateLimiter';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/telegram/[slug]
 *
 * Telegram webhook handler. Returns 200 immediately on all non-403 paths
 * to prevent Telegram retry storms. Agent invocation happens asynchronously
 * via after() after the response is sent.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // -------------------------------------------------------------------------
  // Step 1: Await params (Next.js 15+ — params is a Promise)
  // -------------------------------------------------------------------------
  const { slug } = await params;

  // -------------------------------------------------------------------------
  // Step 2: Resolve bot by slug
  // Returns null if no active bot row matches the slug.
  // Return 200 (not 404) to suppress Telegram retries for deregistered bots.
  // -------------------------------------------------------------------------
  const botRow = await resolveBot(slug);
  if (!botRow) {
    console.warn('[Telegram] Unknown slug:', slug);
    return new Response('', { status: 200 });
  }

  // -------------------------------------------------------------------------
  // Step 3: Validate X-Telegram-Bot-Api-Secret-Token header
  // Telegram sets this header when setWebhook was called with secret_token.
  // Missing or incorrect token → 403. This is the only path that returns
  // non-200 — genuine auth failure, not a Telegram retry candidate.
  // -------------------------------------------------------------------------
  const secretToken = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (secretToken !== botRow.webhook_secret) {
    console.warn('[Telegram] Invalid secret token for slug:', slug);
    return new Response('Forbidden', { status: 403 });
  }

  // -------------------------------------------------------------------------
  // Step 4: Parse body and extract message
  // Non-text updates (photos, stickers, etc.) are discarded silently.
  // Return 200 — Telegram would retry if we returned 4xx.
  // -------------------------------------------------------------------------
  const body = (await req.json()) as TelegramUpdate;
  const message = body.message;
  if (!message?.text || !message?.chat?.id) {
    return new Response('', { status: 200 });
  }

  // -------------------------------------------------------------------------
  // Step 5: Per-hotel rate limit
  // Discard silently (200) to prevent Telegram from retrying rate-limited reqs.
  // -------------------------------------------------------------------------
  const rateLimited = await checkHotelRateLimit(botRow.hotel_id);
  if (!rateLimited.success) {
    return new Response('', { status: 200 });
  }

  // -------------------------------------------------------------------------
  // Step 6: Sanitize input and build identifiers
  // conversationId format: tg_{hotelId}_{chatId} — matches wa_/widget_ pattern.
  // chatId is the Telegram chat.id (numeric user/group identifier).
  // -------------------------------------------------------------------------
  const chatId = message.chat.id;
  const userText = sanitizeGuestInput(message.text);
  const conversationId = `tg_${botRow.hotel_id}_${chatId}`;

  // -------------------------------------------------------------------------
  // Step 7: Map role string to AgentRole enum
  // Unknown roles are discarded (200) — misconfigured bots should not crash.
  // -------------------------------------------------------------------------
  const roleMap: Record<string, AgentRole> = {
    front_desk: AgentRole.FRONT_DESK,
    guest_experience: AgentRole.GUEST_EXPERIENCE,
    booking_ai: AgentRole.BOOKING_AI,
    housekeeping_coordinator: AgentRole.HOUSEKEEPING_COORDINATOR,
  };
  const role = roleMap[botRow.role];
  if (!role) {
    console.error('[Telegram] Unknown role:', botRow.role);
    return new Response('', { status: 200 });
  }

  // -------------------------------------------------------------------------
  // Step 8: Schedule async agent work via after() and return 200 immediately
  //
  // after() extends the Next.js serverless function lifetime beyond the
  // response — the agent can take as long as it needs without Telegram timing
  // out and sending duplicate updates.
  //
  // All work inside after() is wrapped in try/catch. A crash in after() must
  // not surface as an unhandled rejection that could affect future requests.
  // -------------------------------------------------------------------------
  after(async () => {
    try {
      // Decrypt bot token from Vault for the sendMessage call.
      // Uses (supabase as unknown as SupabaseClient) cast — required by this
      // project's pattern for service client queries against tables/functions
      // not in the auto-generated schema. See resolveBot.ts and escalation.ts.
      const supabase = createServiceClient();
      const { data: plaintextToken } = await (supabase as unknown as SupabaseClient).rpc(
        'get_bot_token',
        { p_vault_secret_id: botRow.vault_secret_id },
      );

      if (!plaintextToken) {
        console.error('[Telegram] Failed to decrypt bot token for slug:', slug);
        return;
      }

      // Invoke the agent (non-streaming — Telegram needs complete response).
      // No onToken callback — same pattern as WhatsApp webhook.
      const response = await invokeAgent({
        role,
        userMessage: userText,
        conversationId,
        hotelId: botRow.hotel_id,
        guestIdentifier: String(chatId),
      });

      // Send the reply via Telegram Bot API.
      // sendTelegramReply handles MarkdownV2 escaping and plaintext fallback.
      await sendTelegramReply({
        botToken: plaintextToken as string,
        chatId,
        text: response,
      });
    } catch (error) {
      console.error('[Telegram] Agent/reply error:', error);
    }
  });

  // Return 200 BEFORE the after() callback runs — this is the critical line
  // that prevents Telegram retry storms on slow agent responses.
  return new Response('', { status: 200 });
}
