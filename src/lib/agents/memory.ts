/**
 * Three-tier memory read/write helpers for OtelAI agent system.
 *
 * Tier 1 — Semantic memory:  hotel_facts     (static hotel knowledge)
 * Tier 2 — Episodic memory:  guest_interactions (per-guest history summaries)
 * Tier 3 — Working memory:   conversation_turns (rolling context window)
 *
 * Rolling context window (Phase 7 Plan 3):
 * - loadConversationTurns loads the LAST RECENT_TURNS_N turns verbatim into the
 *   messages array (not the first N, and no longer a hard-cap 20 turns).
 * - When total turns exceed SUMMARY_THRESHOLD, summarizeOldTurns() is called
 *   fire-and-forget to compress older turns into conversation_summaries table.
 * - loadConversationSummary reads that compressed summary for injection into
 *   the system prompt memory layer (via assembleContext.ts).
 *
 * Standard queries use the server Supabase client (respects RLS).
 * summarizeOldTurns uses the service-role client because it runs fire-and-forget
 * in an async context where the session cookie may no longer be available.
 *
 * Type note: supabase-js v2.98 (postgrest-js v12) requires generated types from
 * `supabase gen types typescript` for full type inference. Manually-written types
 * need explicit casts. SELECT queries use .returns<T>() or cast to SupabaseClient;
 * INSERT/UPDATE queries cast payload to Record<string, unknown> —
 * following the pattern established in actions.ts and escalation.ts.
 * This is safe because RLS policies enforce data isolation at the DB level.
 *
 * Research notes:
 * - Working memory limited to RECENT_TURNS_N turns verbatim (prevents context rot, pitfall 3)
 * - Older turns compressed via Claude API when count exceeds SUMMARY_THRESHOLD
 * - Summarization skipped when an up-to-date summary already exists (pitfall 4)
 * - Episodic history capped at 100 rows maximum for performance
 * - Semantic facts formatted as grouped string for system prompt injection
 *
 * Source: .planning/phases/02-agent-core/02-RESEARCH.md
 *         .planning/phases/07-booking-ai/07-03-PLAN.md
 */

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import type { ContentBlock, MessageParam } from '@/lib/agents/types';
import type {
  ConversationTurn,
  ConversationSummary,
  HotelFact,
  GuestInteraction,
  Room,
} from '@/types/database';

// =============================================================================
// Rolling context window constants
// =============================================================================

/** Number of most-recent conversation turns to load verbatim into the messages array. */
const RECENT_TURNS_N = 10;

/** When total turn count exceeds this threshold, fire summarizeOldTurns() to compress older turns. */
const SUMMARY_THRESHOLD = 30;

// =============================================================================
// Tier 3 — Working Memory: Conversation Turns
// =============================================================================

/**
 * Loads the last RECENT_TURNS_N (10) conversation turns for a given conversation ID.
 *
 * Rolling context window strategy:
 * - Fetches descending by created_at, limits to RECENT_TURNS_N, then reverses
 *   to restore chronological order. This ensures we always get the LAST N turns.
 * - If the total turn count exceeds SUMMARY_THRESHOLD (30), fires
 *   summarizeOldTurns() as a fire-and-forget background job to compress older turns.
 *   The response is NOT blocked by summarization — it runs in the background.
 *
 * Reconstructs the Anthropic MessageParam shape from stored rows:
 * - user/assistant rows become simple string content params
 * - tool role rows are reconstructed as tool_result content blocks
 *   using the stored tool_use_id for correlation
 *
 * @param conversationId - UUID grouping this conversation's turns
 * @returns Array of MessageParam objects ready for Anthropic API (last 10 turns)
 */
export async function loadConversationTurns(conversationId: string): Promise<MessageParam[]> {
  const supabase = await createClient();

  // Count total turns to decide whether to trigger background summarization.
  const { count } = await supabase
    .from('conversation_turns')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  const totalTurns = count ?? 0;

  // Fire-and-forget summarization when conversation grows beyond the threshold.
  // This does NOT block the current response — errors are logged, not thrown.
  if (totalTurns > SUMMARY_THRESHOLD) {
    summarizeOldTurns(conversationId, totalTurns - RECENT_TURNS_N).catch(
      (err) => console.error('[memory] summarizeOldTurns failed:', err),
    );
  }

  // Fetch the LAST RECENT_TURNS_N turns by ordering descending then reversing.
  const { data, error } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(RECENT_TURNS_N)
    .returns<ConversationTurn[]>();

  if (error) {
    throw new Error('Failed to load conversation turns: ' + error.message);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Reverse to restore chronological order (we fetched descending for "last N" semantics).
  const rows = (data ?? []).reverse();

  const messages: MessageParam[] = [];

  for (const row of rows) {
    if (row.role === 'user') {
      messages.push({
        role: 'user',
        content: row.content,
      });
    } else if (row.role === 'assistant') {
      // Assistant content may be stored as a JSON string (tool_use block array)
      // or as plain text. Parse if it looks like JSON.
      let content: string | ContentBlock[];
      try {
        const parsed = JSON.parse(row.content);
        if (Array.isArray(parsed)) {
          content = parsed as ContentBlock[];
        } else {
          content = row.content;
        }
      } catch {
        // Not JSON — plain text assistant message
        content = row.content;
      }
      messages.push({
        role: 'assistant',
        content,
      });
    } else if (row.role === 'tool') {
      // Tool result rows are stored with role='tool' and a tool_use_id.
      // Reconstruct as a user message containing a tool_result content block
      // (Anthropic requires tool results to come from the "user" turn).
      const toolResultBlock: ContentBlock = {
        type: 'tool_result',
        tool_use_id: row.tool_use_id ?? '',
        content: row.content,
      };
      messages.push({
        role: 'user',
        content: [toolResultBlock],
      });
    }
  }

  return messages;
}

/**
 * Loads the current conversation summary from the conversation_summaries table.
 *
 * Returns empty string when no summary exists yet (new conversation or summarization
 * has not yet been triggered). assembleContext.ts skips injection on empty string.
 *
 * Uses the standard session client (consistent with other memory read functions).
 *
 * @param conversationId - The conversation identifier (matches conversation_turns.conversation_id)
 * @returns Compressed summary text, or empty string if none exists
 */
export async function loadConversationSummary(conversationId: string): Promise<string> {
  const supabase = await createClient();
  // Cast to bypass postgrest-js v12 type inference issue with manually-typed tables.
  const { data } = await (supabase as unknown as SupabaseClient)
    .from('conversation_summaries')
    .select('summary')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  return (data as Pick<ConversationSummary, 'summary'> | null)?.summary ?? '';
}

/**
 * Summarizes older conversation turns via Claude API and upserts into conversation_summaries.
 *
 * This function is INTERNAL — it is NOT exported. Called fire-and-forget from
 * loadConversationTurns() when total turns exceed SUMMARY_THRESHOLD.
 *
 * Design decisions:
 * - Uses service-role client: fire-and-forget context; session cookie may not be available.
 * - Stale-check: skips if existing summary already covers >= turnsToSummarize turns (Pitfall 4).
 * - Only user/assistant turns are included in summary text (tool turns are implementation details).
 * - Uses claude-sonnet-4-6 per project decision for internal/background tasks.
 * - Upserts with onConflict: 'conversation_id' to handle concurrent summarization attempts.
 *
 * @param conversationId - The conversation to summarize
 * @param turnsToSummarize - Number of older turns to compress (totalTurns - RECENT_TURNS_N)
 */
async function summarizeOldTurns(conversationId: string, turnsToSummarize: number): Promise<void> {
  // Use service client — this runs fire-and-forget; session may not be available.
  const { createServiceClient } = await import('@/lib/supabase/service');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as unknown as SupabaseClient;

  // Stale-check: skip if existing summary already covers these turns (Pitfall 4 prevention).
  const { data: existingRaw } = await supabase
    .from('conversation_summaries')
    .select('turns_summarized')
    .eq('conversation_id', conversationId)
    .maybeSingle();

  const existing = existingRaw as Pick<ConversationSummary, 'turns_summarized'> | null;
  if (existing && existing.turns_summarized >= turnsToSummarize) {
    return; // Summary already up to date — skip.
  }

  // Load the older turns that need summarizing (all turns BEFORE the recent N).
  const { data: allTurnsRaw } = await supabase
    .from('conversation_turns')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(turnsToSummarize);

  const allTurns = allTurnsRaw as Pick<ConversationTurn, 'role' | 'content' | 'created_at'>[] | null;
  if (!allTurns || allTurns.length === 0) return;

  // Format turns as readable text — include only user/assistant turns (not tool internals).
  const turnText = allTurns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n');

  if (!turnText.trim()) return;

  // Call Claude sonnet for summarization (internal/background task = sonnet per project decision).
  const AnthropicSdk = (await import('@anthropic-ai/sdk')).default;
  const client = new AnthropicSdk();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system:
      'You are a conversation summarizer. Produce a concise summary of the following hotel guest conversation. Focus on: guest preferences, dates discussed, room types considered, pricing mentioned, any special requests. Output only the summary, nothing else.',
    messages: [{ role: 'user', content: turnText }],
  });

  const summaryText = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!summaryText.trim()) return;

  // Get hotel_id from the first turn (needed for FK/RLS).
  const { data: firstTurnRaw } = await supabase
    .from('conversation_turns')
    .select('hotel_id')
    .eq('conversation_id', conversationId)
    .limit(1)
    .single();

  const firstTurn = firstTurnRaw as Pick<ConversationTurn, 'hotel_id'> | null;
  if (!firstTurn) return;

  // Upsert summary — service client has full access; onConflict handles concurrent attempts.
  await supabase
    .from('conversation_summaries')
    .upsert(
      {
        conversation_id: conversationId,
        hotel_id: firstTurn.hotel_id,
        summary: summaryText.trim(),
        turns_summarized: turnsToSummarize,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>,
      { onConflict: 'conversation_id' },
    );
}

/**
 * Persists a single conversation turn to the database.
 *
 * Called after every user message and every agent response turn.
 * For tool_use responses, store the JSON-serialized content array.
 * For tool_result turns, use role='tool' with the tool_use_id for correlation.
 *
 * @param conversationId - UUID grouping this conversation's turns
 * @param hotelId - UUID for RLS enforcement (must match authenticated user's hotel)
 * @param role - Message role: 'user', 'assistant', or 'tool'
 * @param content - Message content (plain text or JSON-serialized content blocks)
 * @param toolUseId - tool_use_id for tool/tool_result correlation (undefined for user/assistant)
 * @returns The inserted ConversationTurn row
 */
export async function persistTurn(
  conversationId: string,
  hotelId: string,
  role: 'user' | 'assistant' | 'tool',
  content: string,
  toolUseId?: string,
): Promise<ConversationTurn> {
  const supabase = await createClient();

  // Cast to bypass postgrest-js v12 Insert type inference issue with manual Database types.
  // The payload shape matches the ConversationTurn Insert type exactly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('conversation_turns')
    .insert({
      conversation_id: conversationId,
      hotel_id: hotelId,
      role,
      content,
      tool_use_id: toolUseId ?? null,
    } as Record<string, unknown>)
    .select()
    .single();

  if (error) {
    throw new Error('Failed to persist conversation turn: ' + error.message);
  }

  return data as ConversationTurn;
}

// =============================================================================
// Tier 1 — Semantic Memory: Hotel Facts
// =============================================================================

/**
 * Loads all hotel facts for a hotel and formats them as a readable string
 * for injection into the agent system prompt.
 *
 * Facts are grouped by category for readability. Each category appears as
 * a section header, with facts listed below it.
 *
 * Example output:
 *   POLICY:
 *   - Check-in is at 3 PM, check-out at 11 AM.
 *   - No smoking on the premises.
 *
 *   AMENITY:
 *   - Rooftop pool open 8 AM to 10 PM.
 *
 * Returns empty string if no facts exist (agent falls back to general knowledge).
 *
 * @param hotelId - UUID for the hotel (RLS enforced server-side)
 * @returns Formatted multi-line string of hotel facts grouped by category
 */
export async function loadSemanticFacts(hotelId: string): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('hotel_facts')
    .select('*')
    .eq('hotel_id', hotelId)
    .returns<HotelFact[]>();

  if (error) {
    throw new Error('Failed to load hotel facts: ' + error.message);
  }

  if (!data || data.length === 0) {
    return '';
  }

  // Group facts by category
  const grouped: Record<string, string[]> = {};
  for (const row of data) {
    const cat = row.category.toUpperCase();
    if (!grouped[cat]) {
      grouped[cat] = [];
    }
    grouped[cat].push(row.fact);
  }

  // Format as readable sections
  const sections: string[] = [];
  for (const [category, facts] of Object.entries(grouped)) {
    const lines = facts.map((f) => `- ${f}`).join('\n');
    sections.push(`${category}:\n${lines}`);
  }

  return sections.join('\n\n');
}

// =============================================================================
// Room Context — Structured room inventory for agent system prompt
// Extends Tier 1: room data injected alongside semantic facts (KNOW-04)
// =============================================================================

/**
 * Loads all rooms for a hotel and formats them as a readable string
 * for injection into the agent system prompt memory layer.
 *
 * Each room is formatted as a single line with key details (type, bed, occupancy,
 * price note) as a header, and description + amenities as a body when available.
 *
 * Example output:
 *   ROOM: Deluxe Ocean View (deluxe) — king bed — max 2 guests — from $180/night. Ocean views, private balcony. Mini-bar, espresso machine, walk-in shower.
 *   ROOM: Standard Room (standard). Two twin beds available.
 *
 * Returns empty string if no rooms exist (agent falls back to general knowledge).
 *
 * @param hotelId - UUID for the hotel (RLS enforced server-side)
 * @returns Formatted multi-line string of room details, or empty string
 */
export async function loadRoomContext(hotelId: string): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('sort_order')
    .returns<Room[]>();

  if (error || !data || data.length === 0) return '';

  const lines = data.map((room) => {
    const parts = [`ROOM: ${room.name} (${room.room_type})`];
    if (room.bed_type) parts.push(`${room.bed_type} bed`);
    if (room.max_occupancy) parts.push(`max ${room.max_occupancy} guests`);
    if (room.base_price_note) parts.push(room.base_price_note);
    const header = parts.join(' — ');
    const details = [room.description, room.amenities?.join(', ')].filter(Boolean).join('. ');
    return details ? `${header}. ${details}` : header;
  });

  return lines.join('\n');
}

// =============================================================================
// Tier 2 — Episodic Memory: Guest Interaction History
// =============================================================================

/**
 * Loads guest interaction summaries for a hotel and formats them as a
 * readable string for injection into the agent system prompt.
 *
 * Scope controls how much history is loaded:
 * - "none": skip loading entirely (stateless mode or new guests)
 * - "recent_30": last 30 interactions ordered by recency
 * - "full": all interactions (capped at 100 for safety)
 *
 * Example output:
 *   Guest john@example.com: Asked about pool hours, booked a massage. (positive)
 *   Guest +905551234567: Complained about noise, resolved by room change. (neutral)
 *
 * @param hotelId - UUID for the hotel (RLS enforced server-side)
 * @param scope - How much episodic history to load
 * @returns Formatted string of guest interactions, or empty string if scope is "none"
 */
export async function loadEpisodicHistory(
  hotelId: string,
  scope: 'full' | 'recent_30' | 'none',
): Promise<string> {
  if (scope === 'none') {
    return '';
  }

  const supabase = await createClient();
  const limit = scope === 'recent_30' ? 30 : 100;

  const { data, error } = await supabase
    .from('guest_interactions')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<GuestInteraction[]>();

  if (error) {
    throw new Error('Failed to load guest interactions: ' + error.message);
  }

  if (!data || data.length === 0) {
    return '';
  }

  const lines = data.map((row) => {
    const sentiment = row.sentiment ? ` (${row.sentiment})` : '';
    return `Guest ${row.guest_identifier}: ${row.summary}${sentiment}`;
  });

  return lines.join('\n');
}

/**
 * Persists a guest interaction summary to the episodic memory store.
 *
 * Called by the agent after a conversation ends to record a summary of what
 * transpired. The summary is used in future conversations with the same guest
 * to provide continuity without replaying the full message history.
 *
 * @param hotelId - UUID for RLS enforcement
 * @param guestIdentifier - email, phone, or session token
 * @param summary - Agent-written summary of the interaction
 * @param sentiment - Overall sentiment: 'positive' | 'neutral' | 'negative'
 * @returns The inserted GuestInteraction row
 */
export async function persistEpisodicMemory(
  hotelId: string,
  guestIdentifier: string,
  summary: string,
  sentiment?: string,
): Promise<GuestInteraction> {
  const supabase = await createClient();

  // Cast to bypass postgrest-js v12 Insert type inference issue with manual Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('guest_interactions')
    .insert({
      hotel_id: hotelId,
      guest_identifier: guestIdentifier,
      summary,
      sentiment: sentiment ?? null,
    } as Record<string, unknown>)
    .select()
    .single();

  if (error) {
    throw new Error('Failed to persist episodic memory: ' + error.message);
  }

  return data as GuestInteraction;
}
