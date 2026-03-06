/**
 * Telegram webhook update type definitions for OtelAI.
 *
 * Only the fields we use are defined here — Telegram Update objects
 * contain many more fields not relevant to this implementation.
 *
 * Telegram Bot API docs: https://core.telegram.org/bots/api#update
 *
 * Source: .planning/phases/09-telegram-infrastructure/09-02-PLAN.md
 */

/**
 * Telegram CallbackQuery object — sent when a user clicks an inline keyboard button.
 *
 * callback_query is needed for the Setup Wizard inline keyboard (Phase 11).
 * The wizard uses "Yes, activate!" and "Start over" buttons which send callback_data
 * to handleWizardCallback in wizardActions.ts.
 *
 * Telegram Bot API docs: https://core.telegram.org/bots/api#callbackquery
 */
export interface TelegramCallbackQuery {
  /** Unique identifier for this query */
  id: string;
  /** Sender of the callback */
  from: TelegramUser;
  /** Message with the callback button that originated the query */
  message?: TelegramMessage;
  /** Data associated with the callback button — matches callback_data set on the button */
  data?: string;
}

/**
 * Telegram Update object — message and callback_query fields used.
 * allowed_updates: ['message', 'callback_query'] required for wizard inline keyboard.
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  /** callback_query is needed for wizard inline keyboard (Phase 11) */
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  username?: string;
}
