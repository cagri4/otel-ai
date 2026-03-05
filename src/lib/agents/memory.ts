/**
 * Three-tier memory read/write helpers for OtelAI agent system.
 *
 * Tier 1 — Semantic memory:  hotel_facts     (static hotel knowledge)
 * Tier 2 — Episodic memory:  guest_interactions (per-guest history summaries)
 * Tier 3 — Working memory:   conversation_turns (active context window)
 *
 * All queries use the standard server Supabase client (respects RLS).
 * Do NOT use service_role client here — these helpers run from Route Handlers
 * that have the user's session cookie available.
 *
 * Type note: supabase-js v2.98 (postgrest-js v12) requires generated types from
 * `supabase gen types typescript` for full type inference. Manually-written types
 * need explicit casts. SELECT queries use .returns<T>(); INSERT/UPDATE queries
 * cast the builder to `ReturnType<typeof supabase.from>` and cast the payload
 * to `Record<string, unknown>` — following the pattern established in actions.ts.
 * This is safe because RLS policies enforce data isolation at the DB level.
 *
 * Research notes:
 * - Working memory limited to 20 turns to prevent context rot (pitfall 3)
 * - Episodic history capped at 100 rows maximum for performance
 * - Semantic facts formatted as grouped string for system prompt injection
 *
 * Source: .planning/phases/02-agent-core/02-RESEARCH.md
 */

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentBlock, MessageParam } from '@/lib/agents/types';
import type { ConversationTurn, HotelFact, GuestInteraction, Room } from '@/types/database';

// TODO: Replace ContentBlock and MessageParam with Anthropic.Messages types after SDK install (Plan 02-02)

// =============================================================================
// Tier 3 — Working Memory: Conversation Turns
// =============================================================================

/**
 * Loads the last 20 conversation turns for a given conversation ID.
 *
 * Limit of 20 turns prevents context rot — older turns have diminishing
 * relevance and inflate token costs (per research pitfall 3).
 *
 * Reconstructs the Anthropic MessageParam shape from stored rows:
 * - user/assistant rows become simple string content params
 * - tool role rows are reconstructed as tool_result content blocks
 *   using the stored tool_use_id for correlation
 *
 * @param conversationId - UUID grouping this conversation's turns
 * @returns Array of MessageParam objects ready for Anthropic API (last 20 turns)
 */
export async function loadConversationTurns(conversationId: string): Promise<MessageParam[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(20)
    .returns<ConversationTurn[]>();

  if (error) {
    throw new Error('Failed to load conversation turns: ' + error.message);
  }

  if (!data || data.length === 0) {
    return [];
  }

  const messages: MessageParam[] = [];

  for (const row of data) {
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
