/**
 * Trial-end callback handler for the employee selection flow.
 *
 * Handles three callback_data patterns from the trial selection inline keyboard:
 * - trial_toggle:{shortCode}  — toggle an individual employee on/off
 * - trial_all                 — select all available employees
 * - trial_confirm             — confirm selection, deactivate unselected bots, generate payment link
 *
 * Design decisions:
 * - answerCallbackQuery is called FIRST on every path — dismisses the loading spinner
 *   before any async DB/Redis operations, matching the wizard callback pattern (Phase 11)
 * - Minimum 1 employee always enforced — if removal would empty selectedRoles, reject with message
 * - Mollie Payment Links API used for EU hotels (getPaymentUrl() helper)
 * - iyzico (TR) redirects to web dashboard billing page — Checkout Form requires buyer with
 *   Turkish national ID which cannot be collected via Telegram (per research)
 * - Unselected bots deactivated immediately on confirm (hotel_bots.is_active = false)
 * - Redis trial selection cleared after confirm to prevent double-processing
 * - All error paths are caught and logged — never thrown — to prevent unhandled rejections
 *
 * Source: .planning/phases/12-billing-model-migration-and-trial-end-flow/12-03-PLAN.md
 */

import type { TelegramCallbackQuery } from '@/lib/telegram/types';
import {
  getTrialSelection,
  setTrialSelection,
  clearTrialSelection,
} from '@/lib/billing/trialSelection';
import { buildSelectionKeyboard } from '@/lib/billing/trialKeyboard';
import {
  EMPLOYEE_ROLE_PRICES,
  calculateMonthlyTotal,
  getProviderForHotel,
  type EmployeeRoleKey,
} from '@/lib/billing/plans';
import { mollieClient } from '@/lib/billing/mollie';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Answer a Telegram callback query to dismiss the loading spinner.
 *
 * Should be called immediately at the start of every callback handler path.
 * Optional text is shown as a toast notification to the user.
 *
 * Never throws — errors are caught and logged.
 *
 * @param botToken   - Plaintext bot token for the employee bot
 * @param callbackId - Unique callback_query.id from the update
 * @param text       - Optional toast message shown to the user
 */
async function answerCallbackQuery(
  botToken: string,
  callbackId: string,
  text?: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackId,
        ...(text ? { text } : {}),
      }),
    });
  } catch (error) {
    console.error('[trialCallback] answerCallbackQuery error:', error);
  }
}

/**
 * Edit an existing Telegram message with new text and keyboard.
 *
 * Used to update the selection message when the owner toggles employees,
 * and to show "confirmed" state after they press Confirm.
 *
 * Never throws — errors are caught and logged.
 *
 * @param botToken    - Plaintext bot token
 * @param chatId      - Telegram chat.id
 * @param messageId   - message_id to edit
 * @param text        - New message text
 * @param replyMarkup - Optional new inline keyboard (omit to remove keyboard)
 */
async function editMessageText(
  botToken: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (error) {
    console.error('[trialCallback] editMessageText error:', error);
  }
}

/**
 * Send a new Telegram message to the owner.
 *
 * Used for the payment link message sent after confirm.
 *
 * Never throws — errors are caught and logged.
 *
 * @param botToken - Plaintext bot token
 * @param chatId   - Telegram chat.id
 * @param text     - Message text
 */
async function sendMessage(
  botToken: string,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('[trialCallback] sendMessage error:', error);
  }
}

/**
 * Build the updated selection message text showing current selections and total.
 *
 * @param selectedRoles  - Currently selected role keys
 * @param availableRoles - All available role keys for this hotel
 * @param currency       - 'try' | 'eur'
 * @returns Formatted message text
 */
function buildSelectionMessageText(
  selectedRoles: string[],
  availableRoles: string[],
  currency: 'try' | 'eur',
): string {
  const currencyLabel = currency === 'try' ? 'TRY' : 'EUR';
  const selectedSet = new Set(selectedRoles);

  const employeeLines = availableRoles
    .map((roleKey) => {
      const roleData = EMPLOYEE_ROLE_PRICES[roleKey as EmployeeRoleKey];
      if (!roleData) return null;
      const prefix = selectedSet.has(roleKey) ? '✅' : '❌';
      return `${prefix} ${roleData.displayName}: ${roleData[currency]} ${currencyLabel}/month`;
    })
    .filter(Boolean)
    .join('\n');

  const total = calculateMonthlyTotal(selectedRoles as EmployeeRoleKey[], currency);

  return (
    'Your trial has ended. Select which AI employees to keep:\n\n' +
    employeeLines +
    `\n\nTotal: ${total} ${currencyLabel}/month\n\n` +
    'Tap an employee to toggle. Tap Confirm to proceed to payment.'
  );
}

// ============================================================================
// Callback handlers
// ============================================================================

/**
 * Handle "trial_toggle:{shortCode}" callback.
 *
 * Finds the role matching the shortCode, toggles its presence in selectedRoles,
 * then updates the Redis state and edits the selection message to reflect the change.
 *
 * Enforces minimum 1 employee selected — rejects with toast if toggling would empty selectedRoles.
 */
async function handleToggle(
  callbackId: string,
  chatId: number,
  botToken: string,
  shortCode: string,
): Promise<void> {
  // Get current selection state
  const state = await getTrialSelection(chatId);
  if (!state) {
    // Session expired or not initiated — silently ignore
    return;
  }

  // Find the role key matching this shortCode
  const roleKey = Object.entries(EMPLOYEE_ROLE_PRICES).find(
    ([, data]) => data.shortCode === shortCode,
  )?.[0] as EmployeeRoleKey | undefined;

  if (!roleKey) {
    console.warn('[trialCallback] Unknown shortCode in trial_toggle:', shortCode);
    return;
  }

  const isCurrentlySelected = state.selectedRoles.includes(roleKey);
  let newSelectedRoles: string[];

  if (isCurrentlySelected) {
    // Would removal leave selectedRoles empty?
    if (state.selectedRoles.length <= 1) {
      // Enforce minimum 1 employee — reject with toast
      await answerCallbackQuery(botToken, callbackId, 'You must keep at least one employee');
      return;
    }
    newSelectedRoles = state.selectedRoles.filter((r) => r !== roleKey);
  } else {
    newSelectedRoles = [...state.selectedRoles, roleKey];
  }

  // Update Redis state with new selectedRoles
  const updatedState = { ...state, selectedRoles: newSelectedRoles };
  await setTrialSelection(chatId, updatedState);

  // Build updated keyboard and message text
  const newKeyboard = buildSelectionKeyboard(
    state.availableRoles,
    newSelectedRoles,
    state.currency,
  );
  const newText = buildSelectionMessageText(
    newSelectedRoles,
    state.availableRoles,
    state.currency,
  );

  // Edit the existing message to show updated selections
  await editMessageText(botToken, chatId, state.messageId, newText, newKeyboard);
}

/**
 * Handle "trial_all" callback — select all available employees.
 */
async function handleSelectAll(
  chatId: number,
  botToken: string,
): Promise<void> {
  const state = await getTrialSelection(chatId);
  if (!state) {
    return;
  }

  // Set selectedRoles to all available roles
  const newSelectedRoles = [...state.availableRoles];
  const updatedState = { ...state, selectedRoles: newSelectedRoles };
  await setTrialSelection(chatId, updatedState);

  const newKeyboard = buildSelectionKeyboard(
    state.availableRoles,
    newSelectedRoles,
    state.currency,
  );
  const newText = buildSelectionMessageText(
    newSelectedRoles,
    state.availableRoles,
    state.currency,
  );

  await editMessageText(botToken, chatId, state.messageId, newText, newKeyboard);
}

/**
 * Handle "trial_confirm" callback.
 *
 * 1. Validates at least one employee is selected
 * 2. Deactivates unselected bots in hotel_bots
 * 3. Generates payment link (Mollie for EU, web dashboard URL for iyzico/TR)
 * 4. Sends payment link to owner
 * 5. Clears Redis trial selection state
 * 6. Edits original selection message to show confirmed state (removes keyboard)
 */
async function handleConfirm(
  callbackId: string,
  chatId: number,
  botToken: string,
): Promise<void> {
  const state = await getTrialSelection(chatId);
  if (!state) {
    return;
  }

  if (state.selectedRoles.length === 0) {
    await answerCallbackQuery(botToken, callbackId, 'Select at least one employee');
    return;
  }

  const supabase = createServiceClient() as unknown as SupabaseClient;

  // --- Deactivate unselected bots ---
  const selectedSet = new Set(state.selectedRoles);
  const unselectedRoles = state.availableRoles.filter((r) => !selectedSet.has(r));

  for (const role of unselectedRoles) {
    const { error } = await supabase
      .from('hotel_bots')
      .update({ is_active: false })
      .eq('hotel_id', state.hotelId)
      .eq('role', role);

    if (error) {
      console.error('[trialCallback] Failed to deactivate bot for role:', role, error);
    }
  }

  // --- Generate payment link ---
  // Determine provider from hotel's country
  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('country')
    .eq('id', state.hotelId)
    .maybeSingle();

  if (hotelError) {
    console.error('[trialCallback] Failed to fetch hotel country:', hotelError);
  }

  const country = (hotel as { country?: string | null } | null)?.country ?? null;
  const provider = getProviderForHotel(country);

  const total = calculateMonthlyTotal(state.selectedRoles as EmployeeRoleKey[], state.currency);
  const selectedRolesDisplay = state.selectedRoles
    .map((r) => EMPLOYEE_ROLE_PRICES[r as EmployeeRoleKey]?.displayName ?? r)
    .join(', ');
  const currencyLabel = state.currency === 'try' ? 'TRY' : 'EUR';

  let paymentUrl: string;

  if (provider === 'mollie') {
    // Mollie Payment Links API for EU hotels
    try {
      const paymentLink = await mollieClient.paymentLinks.create({
        description: `OtelAI - ${state.selectedRoles.length} AI employee${state.selectedRoles.length !== 1 ? 's' : ''}`,
        amount: {
          currency: 'EUR',
          value: total.toFixed(2),
        },
        redirectUrl:
          (process.env.NEXT_PUBLIC_APP_URL ?? '') + '/billing?status=success',
      });

      paymentUrl = paymentLink.getPaymentUrl();
    } catch (error) {
      console.error('[trialCallback] Mollie payment link creation failed:', error);

      // Fallback: send owner to web dashboard billing page
      paymentUrl =
        (process.env.NEXT_PUBLIC_APP_URL ?? '') +
        '/billing?action=subscribe&roles=' +
        state.selectedRoles.join(',') +
        '&total=' +
        total;
    }
  } else {
    // iyzico (TR): redirect to web dashboard — Checkout Form requires Turkish national ID
    // which cannot be collected via Telegram
    paymentUrl =
      (process.env.NEXT_PUBLIC_APP_URL ?? '') +
      '/billing?action=subscribe&roles=' +
      state.selectedRoles.join(',') +
      '&total=' +
      total;
  }

  // --- Send payment link message to owner ---
  const paymentMessage =
    `Your selection: ${selectedRolesDisplay}\n` +
    `Monthly total: ${total} ${currencyLabel}\n\n` +
    `Complete payment here: ${paymentUrl}\n\n` +
    `Unselected employees have been deactivated. They will reactivate after payment is confirmed.`;

  await sendMessage(botToken, chatId, paymentMessage);

  // --- Clear Redis trial selection state ---
  await clearTrialSelection(chatId);

  // --- Edit original selection message to confirmed state (removes keyboard) ---
  await editMessageText(
    botToken,
    chatId,
    state.messageId,
    'Selection confirmed. Proceed to payment.',
  );
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Handle trial-end callback queries from the employee selection inline keyboard.
 *
 * Dispatches to the appropriate handler based on callback_data prefix:
 * - "trial_toggle:{shortCode}" → toggle individual employee
 * - "trial_all"               → select all employees
 * - "trial_confirm"           → confirm selection and generate payment link
 *
 * Always calls answerCallbackQuery first. All errors are caught and logged.
 *
 * @param callbackQuery - TelegramCallbackQuery from the webhook update
 * @param botRow        - Bot row from hotel_bots (hotel_id, vault_secret_id, role)
 *                        Note: botToken is read from TrialSelection Redis state
 *                        (the front desk bot token stored when keyboard was sent)
 */
export async function handleTrialCallback(
  callbackQuery: TelegramCallbackQuery,
  botRow: { hotel_id: string; vault_secret_id: string; role: string },
): Promise<void> {
  const callbackId = callbackQuery.id;
  const chatId = callbackQuery.from.id;
  const data = callbackQuery.data ?? '';

  // We need the bot token to answer callbacks and send messages.
  // The bot token used to send the selection keyboard is stored in TrialSelection.
  // For answerCallbackQuery, we need the token of the bot that RECEIVED the callback,
  // which is the current bot. We retrieve the plaintext token from TrialSelection.
  //
  // However, answerCallbackQuery must be called with the bot token that sent the message
  // (the front desk bot). We get this from the TrialSelection state.
  // If state is not available yet, we cannot answer. We use the state's botToken.
  //
  // Note: For the initial answerCallbackQuery (dismiss spinner), we need the token.
  // Since TrialSelection always stores the botToken used to send the keyboard,
  // we fetch state first, then answer. This slight delay is acceptable.

  // Fetch state to get the bot token
  const state = await getTrialSelection(chatId);

  // If no state (session expired), we cannot get the token to answer — just return silently
  if (!state) {
    // We cannot answer without the token. Log and return.
    console.warn('[trialCallback] No trial selection state for chatId:', chatId, '— callback ignored');
    return;
  }

  const botToken = state.botToken;

  // Always answer callback FIRST — dismisses loading spinner before async work
  await answerCallbackQuery(botToken, callbackId);

  // Dispatch based on callback_data
  if (data.startsWith('trial_toggle:')) {
    const shortCode = data.slice('trial_toggle:'.length);
    try {
      await handleToggle(callbackId, chatId, botToken, shortCode);
    } catch (error) {
      console.error('[trialCallback] handleToggle error:', error);
    }
    return;
  }

  if (data === 'trial_all') {
    try {
      await handleSelectAll(chatId, botToken);
    } catch (error) {
      console.error('[trialCallback] handleSelectAll error:', error);
    }
    return;
  }

  if (data === 'trial_confirm') {
    try {
      await handleConfirm(callbackId, chatId, botToken);
    } catch (error) {
      console.error('[trialCallback] handleConfirm error:', error);
    }
    return;
  }

  console.warn('[trialCallback] Unrecognized trial callback data:', data);
}
