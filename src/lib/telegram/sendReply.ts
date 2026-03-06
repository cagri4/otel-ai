/**
 * Telegram sendMessage API wrapper for OtelAI bot replies.
 *
 * Sends AI agent responses to guests via the Telegram Bot API's sendMessage
 * endpoint. Uses MarkdownV2 formatting as primary format with a plaintext
 * fallback if MarkdownV2 parsing fails (Telegram returns HTTP 400 on parse
 * errors from unescaped special characters).
 *
 * Design decisions:
 * - MarkdownV2 as primary format: current Telegram spec, better formatting support
 * - Plaintext fallback on 400: ensures the user always receives a reply even if
 *   edge-case escaping issues slip through
 * - Never throws: fire-and-forget safe; all errors are caught and logged
 * - botToken is plaintext (decrypted from Vault by caller): keeps decryption
 *   responsibility with the webhook handler where the Vault RPC already runs
 *
 * Source: .planning/phases/09-telegram-infrastructure/09-02-PLAN.md
 */

import { escapeMarkdownV2 } from './escapeMarkdownV2';

interface SendReplyParams {
  botToken: string; // Plaintext bot token (decrypted from Vault)
  chatId: number;   // Telegram chat.id from the inbound Update
  text: string;     // Raw response text from invokeAgent()
}

/**
 * Sends an AI agent response to a Telegram user via the Bot API.
 *
 * Attempts MarkdownV2 format first. If Telegram responds with a non-2xx
 * status (typically 400 on parse error), falls back to sending the original
 * unescaped text with no parse_mode.
 *
 * Never throws — all errors are caught and logged.
 *
 * @param params - botToken, chatId, and raw response text
 */
export async function sendTelegramReply(params: SendReplyParams): Promise<void> {
  const url = `https://api.telegram.org/bot${params.botToken}/sendMessage`;
  const escaped = escapeMarkdownV2(params.text);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: escaped,
        parse_mode: 'MarkdownV2',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[sendTelegramReply] MarkdownV2 failed:', res.status, errBody);

      // Fallback: send as plain text (no parse_mode) — ensures user always gets a reply
      // Uses original unescaped text since there is no parse_mode to trigger errors
      const fallbackRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text, // Original unescaped text, no parse_mode
        }),
      });

      if (!fallbackRes.ok) {
        const fallbackErr = await fallbackRes.text();
        console.error(
          '[sendTelegramReply] Plaintext fallback also failed:',
          fallbackRes.status,
          fallbackErr,
        );
      }
    }
  } catch (error) {
    console.error('[sendTelegramReply] Network error:', error);
  }
}
