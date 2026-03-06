/**
 * Setup Wizard message sender, message handler, callback handler, and completion logic.
 *
 * This module is the entry point for the webhook route handler (Plan 02).
 * It dispatches Telegram updates (messages and callback queries) to the
 * correct wizard logic and sends replies back to the hotel owner.
 *
 * Exports:
 * - sendWizardMessage      — MarkdownV2 + plaintext fallback message sender
 * - handleWizardMessage    — handles /start deep links and text input
 * - handleWizardCallback   — handles inline keyboard button presses
 *
 * Source: .planning/phases/11-setup-wizard-bot/11-01-PLAN.md
 */

import {
  getWizardState,
  setWizardState,
  clearWizardState,
  isRedisAvailable,
  WizardState,
} from './wizardState';
import { escapeMarkdownV2 } from '@/lib/telegram/escapeMarkdownV2';
import { sanitizeGuestInput } from '@/lib/security/sanitizeGuestInput';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TelegramMessage, TelegramCallbackQuery } from '@/lib/telegram/types';
import { advanceWizard } from './wizardSteps';

// ============================================================================
// Message sender
// ============================================================================

/** Optional inline keyboard reply_markup for confirmation step */
interface InlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/**
 * Send a message to a Telegram user via the Bot API.
 *
 * Uses MarkdownV2 format as primary with plaintext fallback on non-ok response.
 * Never throws — all errors are caught and logged.
 *
 * @param botToken    - Plaintext bot token for the Setup Wizard bot
 * @param chatId      - Telegram chat.id to send the message to
 * @param text        - Raw message text (will be escaped for MarkdownV2)
 * @param replyMarkup - Optional inline keyboard markup
 */
export async function sendWizardMessage(
  botToken: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const escaped = escapeMarkdownV2(text);

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: escaped,
    parse_mode: 'MarkdownV2',
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[sendWizardMessage] MarkdownV2 failed:', res.status, errBody);

      // Fallback: send as plaintext — ensures owner always receives a reply
      const fallbackBody: Record<string, unknown> = {
        chat_id: chatId,
        text, // Original unescaped text, no parse_mode
      };
      if (replyMarkup) {
        fallbackBody.reply_markup = replyMarkup;
      }

      const fallbackRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackBody),
      });

      if (!fallbackRes.ok) {
        const fallbackErr = await fallbackRes.text();
        console.error(
          '[sendWizardMessage] Plaintext fallback also failed:',
          fallbackRes.status,
          fallbackErr
        );
      }
    }
  } catch (error) {
    console.error('[sendWizardMessage] Network error:', error);
  }
}

// ============================================================================
// /start deep link handler and text message router
// ============================================================================

/**
 * Get the question prompt text for a given wizard step.
 * Used when resuming a session to ask the current step's question again.
 */
function getStepPrompt(step: WizardState['step']): string {
  switch (step) {
    case 'collect_hotel_name':
      return 'What is the full name of your hotel?';
    case 'collect_address':
      return 'What is your hotel address?';
    case 'collect_room_count':
      return 'How many rooms does your hotel have?';
    case 'collect_checkin_time':
      return 'What time is check-in? (e.g. 3 PM or 15:00)';
    case 'collect_checkout_time':
      return 'What time is check-out? (e.g. 11 AM or 11:00)';
    case 'confirm_complete':
      return 'Please use the buttons above to confirm or restart.';
  }
}

/**
 * Handle an inbound Telegram message for the Setup Wizard bot.
 *
 * Dispatches:
 * - /start {payload}: deep link intake — initializes or resumes a wizard session
 * - Any other text:   routes to advanceWizard for the current step
 *
 * @param message - TelegramMessage from the Update
 */
export async function handleWizardMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const text = message.text ?? '';
  const botToken = process.env.SETUP_WIZARD_BOT_TOKEN ?? '';

  // ---- /start with payload -----------------------------------------------
  const match = text.match(/^\/start\s+([A-Za-z0-9_-]{1,64})$/);
  if (match) {
    const payload = match[1];

    // Validate payload is UUID format (36 chars: 8-4-4-4-12 with hyphens)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(payload)) {
      await sendWizardMessage(
        botToken,
        chatId,
        'Invalid setup link. Please contact your administrator.'
      );
      return;
    }

    // Check for existing session
    const existingState = await getWizardState(chatId);
    if (existingState && existingState.hotelId === payload) {
      // Resume existing session
      await sendWizardMessage(
        botToken,
        chatId,
        'You have an active setup session. Pick up where you left off:\n\n' +
          getStepPrompt(existingState.step)
      );
      return;
    }

    // Verify hotel exists via service client
    const supabase = createServiceClient() as unknown as SupabaseClient;
    const { data: hotel, error } = await supabase
      .from('hotels')
      .select('id, name')
      .eq('id', payload)
      .maybeSingle();

    if (error || !hotel) {
      await sendWizardMessage(
        botToken,
        chatId,
        'Invalid setup link. Please contact your administrator.'
      );
      return;
    }

    // Initialize wizard state
    const initialState: WizardState = {
      hotelId: payload,
      step: 'collect_hotel_name',
    };

    // Pre-fill hotel name if it's been set and is not the default placeholder
    if (hotel.name && hotel.name !== 'My Hotel') {
      initialState.hotelName = hotel.name;
    }

    await setWizardState(chatId, initialState);

    await sendWizardMessage(
      botToken,
      chatId,
      'Welcome! I am your OtelAI setup assistant.\n\nLet\'s start with your hotel name. What is the full name of your hotel?'
    );
    return;
  }

  // ---- Non-/start messages ------------------------------------------------

  // Check Redis availability first
  if (!isRedisAvailable()) {
    await sendWizardMessage(
      botToken,
      chatId,
      'Setup service is temporarily unavailable. Please try again later.'
    );
    return;
  }

  // Get current wizard state
  const state = await getWizardState(chatId);
  if (!state) {
    await sendWizardMessage(
      botToken,
      chatId,
      'No active setup session. Please use the setup link provided by your administrator.'
    );
    return;
  }

  // Guard confirm_complete — must use buttons, not text
  if (state.step === 'confirm_complete') {
    await sendWizardMessage(
      botToken,
      chatId,
      'Please use the buttons above to confirm or restart.'
    );
    return;
  }

  // Sanitize input before passing to the step machine
  const sanitizedText = sanitizeGuestInput(text);

  // Advance the wizard with the user's sanitized text input
  await advanceWizard(chatId, state, sanitizedText, botToken);
}

// ============================================================================
// Inline keyboard callback handler
// ============================================================================

/**
 * Handle a Telegram callback_query from an inline keyboard button press.
 *
 * Handles:
 * - wizard:confirm  → complete the wizard (write onboarding_completed_at, send bot links)
 * - wizard:restart  → reset state to step 1
 *
 * Always calls answerCallbackQuery FIRST to dismiss the loading spinner.
 *
 * @param callbackQuery - TelegramCallbackQuery from the Update
 */
export async function handleWizardCallback(
  callbackQuery: TelegramCallbackQuery
): Promise<void> {
  const chatId = callbackQuery.message?.chat.id;
  const callbackId = callbackQuery.id;
  const data = callbackQuery.data ?? '';
  const botToken = process.env.SETUP_WIZARD_BOT_TOKEN ?? '';

  if (!chatId) {
    return;
  }

  // Always answer callback FIRST — dismisses loading spinner on the button
  try {
    await fetch(
      `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackId }),
      }
    );
  } catch (error) {
    console.error('[handleWizardCallback] answerCallbackQuery error:', error);
  }

  if (data === 'wizard:confirm') {
    const state = await getWizardState(chatId);
    if (!state || state.step !== 'confirm_complete') {
      return;
    }
    await completeWizard(chatId, state, botToken);
    return;
  }

  if (data === 'wizard:restart') {
    const state = await getWizardState(chatId);
    if (!state) {
      return;
    }

    // Reset to first step — keep hotelId
    const resetState: WizardState = {
      hotelId: state.hotelId,
      step: 'collect_hotel_name',
    };
    await setWizardState(chatId, resetState);
    await sendWizardMessage(
      botToken,
      chatId,
      'No problem! Let\'s start again.\n\nWhat is the full name of your hotel?'
    );
  }
}

// ============================================================================
// Wizard completion
// ============================================================================

/**
 * Complete the wizard: write onboarding_completed_at, send employee bot links,
 * and clear wizard state from Redis.
 *
 * NOTE: Does NOT touch the subscriptions table — trial was already created by
 * seed_hotel_defaults at hotel creation time (Phase 10, Pitfall 4 from research).
 *
 * @param chatId   - Telegram chat.id
 * @param state    - Wizard state at confirm_complete step
 * @param botToken - Plaintext bot token for sending the completion message
 */
async function completeWizard(
  chatId: number,
  state: WizardState,
  botToken: string
): Promise<void> {
  const supabase = createServiceClient() as unknown as SupabaseClient;

  // Mark onboarding as complete and persist the owner's Telegram chat_id.
  // The chat_id is needed by the trial notification cron (Plan 02) to send
  // countdown messages directly to the hotel owner via Telegram.
  const { error: updateError } = await supabase
    .from('hotels')
    .update({ onboarding_completed_at: new Date().toISOString(), owner_telegram_chat_id: chatId })
    .eq('id', state.hotelId);

  if (updateError) {
    console.error('[completeWizard] Failed to update onboarding_completed_at:', updateError);
  }

  // Fetch active employee bots for this hotel
  const { data: bots, error: botsError } = await supabase
    .from('hotel_bots')
    .select('role, bot_username')
    .eq('hotel_id', state.hotelId)
    .eq('is_active', true);

  if (botsError) {
    console.error('[completeWizard] Failed to fetch hotel_bots:', botsError);
  }

  // Build bot role display labels
  const roleLabels: Record<string, string> = {
    front_desk: 'Front Desk',
    booking_ai: 'Booking AI',
    guest_experience: 'Guest Experience',
    housekeeping_coordinator: 'Housekeeping',
  };

  // Build bot links section
  let botLinks: string;
  if (bots && bots.length > 0) {
    botLinks = bots
      .map((bot) => {
        const label = roleLabels[bot.role] ?? bot.role;
        return `- ${label}: t.me/${bot.bot_username}`;
      })
      .join('\n');
  } else {
    botLinks =
      'Your administrator will activate your employee bots shortly.';
  }

  const completionMessage =
    'Setup complete! Your hotel AI team is ready.\n\n' +
    'Your employee bots:\n' +
    botLinks +
    '\n\nYour 14-day trial has started. Enjoy!';

  await sendWizardMessage(botToken, chatId, completionMessage);

  // Clear wizard state from Redis — session is no longer needed
  await clearWizardState(chatId);
}
