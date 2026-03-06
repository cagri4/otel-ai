/**
 * Setup Wizard step machine with incremental Supabase writes.
 *
 * Handles the 5 data-collection steps of the wizard flow, persisting each
 * answer to the hotels table or hotel_facts incrementally so partial state
 * is never lost.
 *
 * Steps:
 *   1. collect_hotel_name  → hotels.name
 *   2. collect_address     → hotels.address
 *   3. collect_room_count  → hotel_facts (policy: "The hotel has N rooms.")
 *   4. collect_checkin_time  → hotel_facts (policy: "Check-in time is X.")
 *   5. collect_checkout_time → hotel_facts (policy: "Check-out time is X.")
 *                             → transitions to confirm_complete with inline keyboard
 *
 * Source: .planning/phases/11-setup-wizard-bot/11-01-PLAN.md
 */

import { setWizardState, WizardState } from './wizardState';
import { createServiceClient } from '@/lib/supabase/service';
import { sanitizeGuestInput } from '@/lib/security/sanitizeGuestInput';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWizardMessage } from './wizardActions';

// ============================================================================
// Private helpers
// ============================================================================

/**
 * Upsert a hotel fact row.
 * Uses insert — if a duplicate exists from a previous wizard run, the fact
 * will be added again (acceptable for MVP; deduplication can be added later).
 */
async function upsertHotelFact(
  supabase: SupabaseClient,
  hotelId: string,
  category: string,
  content: string
): Promise<void> {
  const { error } = await supabase
    .from('hotel_facts')
    .insert({ hotel_id: hotelId, category, content });

  if (error) {
    // Log but don't throw — wizard should not stall on a non-critical DB error
    console.error('[wizardSteps] upsertHotelFact error:', error);
  }
}

// ============================================================================
// Step machine
// ============================================================================

/**
 * Advance the wizard by one step, persisting the user's input.
 *
 * Reads the current step from state, sanitizes/validates input, writes to DB,
 * transitions state to the next step, and sends the next question to the user.
 *
 * @param chatId    - Telegram chat.id (used for Redis key and reply target)
 * @param state     - Current wizard state (read from Redis by caller)
 * @param userInput - Raw text from the Telegram message
 * @param botToken  - Plaintext bot token for sending replies
 */
export async function advanceWizard(
  chatId: number,
  state: WizardState,
  userInput: string,
  botToken: string
): Promise<void> {
  const supabase = createServiceClient() as unknown as SupabaseClient;

  switch (state.step) {
    // ------------------------------------------------------------------
    // Step 1: Hotel name
    // ------------------------------------------------------------------
    case 'collect_hotel_name': {
      const name = sanitizeGuestInput(userInput);
      if (!name) {
        await sendWizardMessage(botToken, chatId, 'Please enter a valid hotel name.');
        return;
      }

      const { error } = await supabase
        .from('hotels')
        .update({ name })
        .eq('id', state.hotelId);

      if (error) {
        console.error('[wizardSteps] collect_hotel_name DB error:', error);
      }

      const nextState: WizardState = {
        ...state,
        hotelName: name,
        step: 'collect_address',
      };
      await setWizardState(chatId, nextState);
      await sendWizardMessage(botToken, chatId, 'What is your hotel address?');
      break;
    }

    // ------------------------------------------------------------------
    // Step 2: Address
    // ------------------------------------------------------------------
    case 'collect_address': {
      const address = sanitizeGuestInput(userInput);
      if (!address) {
        await sendWizardMessage(botToken, chatId, 'Please enter a valid address.');
        return;
      }

      const { error } = await supabase
        .from('hotels')
        .update({ address })
        .eq('id', state.hotelId);

      if (error) {
        console.error('[wizardSteps] collect_address DB error:', error);
      }

      const nextState: WizardState = {
        ...state,
        address,
        step: 'collect_room_count',
      };
      await setWizardState(chatId, nextState);
      await sendWizardMessage(botToken, chatId, 'How many rooms does your hotel have?');
      break;
    }

    // ------------------------------------------------------------------
    // Step 3: Room count
    // ------------------------------------------------------------------
    case 'collect_room_count': {
      const parsed = parseInt(userInput.trim(), 10);
      if (isNaN(parsed) || parsed <= 0) {
        await sendWizardMessage(
          botToken,
          chatId,
          'Please enter a valid number of rooms (e.g. 20)'
        );
        return; // Do not advance — prompt again
      }

      await upsertHotelFact(
        supabase,
        state.hotelId,
        'policy',
        `The hotel has ${parsed} rooms.`
      );

      const nextState: WizardState = {
        ...state,
        roomCount: parsed,
        step: 'collect_checkin_time',
      };
      await setWizardState(chatId, nextState);
      await sendWizardMessage(
        botToken,
        chatId,
        'What time is check-in? (e.g. 3 PM or 15:00)'
      );
      break;
    }

    // ------------------------------------------------------------------
    // Step 4: Check-in time
    // ------------------------------------------------------------------
    case 'collect_checkin_time': {
      const checkinTime = sanitizeGuestInput(userInput);
      if (!checkinTime) {
        await sendWizardMessage(
          botToken,
          chatId,
          'Please enter a valid check-in time (e.g. 3 PM or 15:00).'
        );
        return;
      }

      await upsertHotelFact(
        supabase,
        state.hotelId,
        'policy',
        `Check-in time is ${checkinTime}.`
      );

      const nextState: WizardState = {
        ...state,
        checkinTime,
        step: 'collect_checkout_time',
      };
      await setWizardState(chatId, nextState);
      await sendWizardMessage(
        botToken,
        chatId,
        'What time is check-out? (e.g. 11 AM or 11:00)'
      );
      break;
    }

    // ------------------------------------------------------------------
    // Step 5: Check-out time → transition to confirm_complete
    // ------------------------------------------------------------------
    case 'collect_checkout_time': {
      const checkoutTime = sanitizeGuestInput(userInput);
      if (!checkoutTime) {
        await sendWizardMessage(
          botToken,
          chatId,
          'Please enter a valid check-out time (e.g. 11 AM or 11:00).'
        );
        return;
      }

      await upsertHotelFact(
        supabase,
        state.hotelId,
        'policy',
        `Check-out time is ${checkoutTime}.`
      );

      const nextState: WizardState = {
        ...state,
        checkoutTime,
        step: 'confirm_complete',
      };
      await setWizardState(chatId, nextState);

      // Build summary for confirmation
      const summary =
        `Here is a summary of your hotel setup:\n\n` +
        `Hotel name: ${nextState.hotelName ?? '(not set)'}\n` +
        `Address: ${nextState.address ?? '(not set)'}\n` +
        `Rooms: ${nextState.roomCount ?? '(not set)'}\n` +
        `Check-in: ${nextState.checkinTime ?? '(not set)'}\n` +
        `Check-out: ${nextState.checkoutTime ?? '(not set)'}\n\n` +
        `Does everything look correct?`;

      await sendWizardMessage(botToken, chatId, summary, {
        inline_keyboard: [
          [
            { text: 'Yes, activate!', callback_data: 'wizard:confirm' },
            { text: 'Start over', callback_data: 'wizard:restart' },
          ],
        ],
      });
      break;
    }

    // ------------------------------------------------------------------
    // confirm_complete: handled by callback, not text input
    // ------------------------------------------------------------------
    case 'confirm_complete': {
      // This case should not be reached via advanceWizard — the caller in
      // wizardActions.ts guards against processing text on confirm_complete.
      // Defensive handler in case of unexpected call path.
      await sendWizardMessage(
        botToken,
        chatId,
        'Please use the buttons above to confirm or restart.'
      );
      break;
    }

    default: {
      // Exhaustive check — TypeScript should catch unreachable code
      const _exhaustive: never = state.step;
      console.error('[wizardSteps] Unknown step:', _exhaustive);
      break;
    }
  }
}
