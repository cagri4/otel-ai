/**
 * Telegram MarkdownV2 special character escaping.
 *
 * Telegram's MarkdownV2 format requires that any character in the set of 18
 * special characters be escaped with a preceding backslash when used in plain
 * text (i.e., not as intentional Markdown syntax).
 *
 * Failing to escape these characters causes the Telegram Bot API to return
 * a 400 Bad Request with "can't parse entities" — the sendReply fallback
 * handles this case, but correct escaping prevents it from happening.
 *
 * Telegram Bot API docs: https://core.telegram.org/bots/api#markdownv2-style
 *
 * Source: .planning/phases/09-telegram-infrastructure/09-02-PLAN.md
 */

/**
 * Escapes all MarkdownV2 special characters in plain text.
 * Must be applied to ALL text that should render as plain text in Telegram.
 *
 * The 18 special characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * @param text - Raw text string to escape
 * @returns Text with all MarkdownV2 special characters backslash-escaped
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
