/**
 * Inline keyboard builder for the trial-end employee selection UI.
 *
 * Generates a Telegram inline keyboard where each available employee role
 * is a toggle button (checkmark = selected, cross = deselected).
 *
 * callback_data uses 2-letter shortCodes from EMPLOYEE_ROLE_PRICES to stay
 * within the Telegram 64-byte callback_data limit.
 *
 * Source: .planning/phases/12-billing-model-migration-and-trial-end-flow/12-01-PLAN.md
 */

import { EMPLOYEE_ROLE_PRICES, type EmployeeRoleKey } from './plans';

/**
 * Build the inline keyboard for the trial-end employee selection message.
 *
 * Each available role gets its own row with a toggle button showing:
 * - Checkmark prefix when the role is selected
 * - Cross prefix when the role is deselected
 * - Display name and monthly price for the selected currency
 *
 * A final row contains "Confirm Selection" and "Select All" action buttons.
 *
 * @param availableRoles - Array of role keys the hotel has active bots for
 * @param selectedRoles  - Array of role keys currently toggled on
 * @param currency       - 'try' for Turkish Lira, 'eur' for Euro
 * @returns Telegram inline keyboard markup object
 */
export function buildSelectionKeyboard(
  availableRoles: string[],
  selectedRoles: string[],
  currency: 'try' | 'eur'
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const selectedSet = new Set(selectedRoles);
  const currencyLabel = currency === 'try' ? 'TRY' : 'EUR';

  const roleRows = availableRoles.map((roleKey) => {
    const roleData = EMPLOYEE_ROLE_PRICES[roleKey as EmployeeRoleKey];
    if (!roleData) {
      // Unknown role — skip gracefully with a placeholder button
      return [{ text: roleKey, callback_data: `trial_toggle:${roleKey.slice(0, 2)}` }];
    }

    const isSelected = selectedSet.has(roleKey);
    const prefix = isSelected ? '\u2705' : '\u274C'; // checkmark or cross
    const price = roleData[currency];
    const text = `${prefix} ${roleData.displayName} \u2014 ${price} ${currencyLabel}/mo`;
    const callbackData = `trial_toggle:${roleData.shortCode}`;

    return [{ text, callback_data: callbackData }];
  });

  // Action row: Confirm Selection + Select All
  const actionRow = [
    { text: 'Confirm Selection', callback_data: 'trial_confirm' },
    { text: 'Select All', callback_data: 'trial_all' },
  ];

  return {
    inline_keyboard: [...roleRows, actionRow],
  };
}
