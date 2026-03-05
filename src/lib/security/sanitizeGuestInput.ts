/**
 * Guest input sanitization for guest-facing API routes.
 *
 * Protects against:
 * 1. Prompt injection attacks — patterns designed to override agent instructions
 * 2. Excessively long inputs — capped at 2000 characters
 * 3. Control character injection — null bytes and non-printable chars removed
 * 4. Encoding inconsistencies — normalized to NFC Unicode form
 *
 * Injection patterns sourced from Phase 4 research (Pattern 5).
 *
 * Usage:
 *   const safe = sanitizeGuestInput(rawInput);
 *   // safe is always a clean string; injection attempts return a safe fallback
 */

const INJECTION_PATTERNS: RegExp[] = [
  // "ignore all/previous/prior/above instructions"
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  // "you are now in developer mode"
  /you\s+are\s+now\s+(in\s+)?developer\s+mode/i,
  // "forget everything/all/your you know/were told"
  /forget\s+(everything|all|your)\s+(you\s+)?(know|were\s+told)/i,
  // [SYSTEM] token injection
  /\[SYSTEM\]/i,
  // [INST] token injection (LLaMA/Mistral format)
  /\[INST\]/i,
  // <|system|> token injection (some open-weight models)
  /<\|system\|>/i,
  // "act as if you have no / are not"
  /act\s+as\s+if\s+you\s+(have\s+no|are\s+not)/i,
  // jailbreak keyword
  /jailbreak/i,
];

const INJECTION_FALLBACK =
  '[Message could not be processed. Please rephrase your question.]';

/**
 * Sanitize a guest input string for safe use in AI agent prompts.
 *
 * @param input - Raw string from guest (widget message, WhatsApp text, etc.)
 * @returns Sanitized string, or INJECTION_FALLBACK if injection was detected
 */
export function sanitizeGuestInput(input: string): string {
  // 1. Cap length at 2000 characters to prevent context flooding
  const truncated = input.slice(0, 2000);

  // 2. Normalize to NFC Unicode form (consistent representation)
  const normalized = truncated.normalize('NFC');

  // 3. Remove null bytes and control characters (keep \t=0x09, \n=0x0A, \r=0x0D)
  //    Range 0x00-0x08: control chars before tab
  //    0x0B: vertical tab
  //    0x0C: form feed
  //    0x0E-0x1F: control chars after carriage return
  //    0x7F: DEL character
  const cleaned = normalized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 4. Check for prompt injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      return INJECTION_FALLBACK;
    }
  }

  // 5. Trim whitespace and return
  return cleaned.trim();
}
