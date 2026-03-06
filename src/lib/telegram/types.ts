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

/** Telegram Update object — only message field used (allowed_updates: ['message']) */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
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
