/**
 * System prompt assembly for the OtelAI agent system.
 *
 * Builds a four-layer XML-tagged system prompt assembled fresh from the DB
 * on every invocation (stateless constraint — no caching).
 *
 * Layer order (per research Pattern 2):
 *   1. <identity>      — Who the agent is (static per role)
 *   2. <hotel_context> — Live hotel data from DB (name, address, timezone, etc.)
 *   3. <memory>        — Conversation summary + semantic facts + episodic guest history
 *                        Conversation summary appears FIRST to orient the model before
 *                        reading the static hotel knowledge base.
 *   4. <instructions>  — Behavioral rules and policies (static per role)
 *
 * IMPORTANT: Hotel query is NEVER cached. This function must query fresh data
 * on every call to respect the stateless invocation design constraint.
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md
 *         .planning/phases/07-booking-ai/07-03-PLAN.md
 * Research reference: .planning/phases/02-agent-core/02-RESEARCH.md Pattern 2
 */

import { createClient } from '@/lib/supabase/server';
import { loadSemanticFacts, loadEpisodicHistory, loadRoomContext, loadConversationSummary } from './memory';
import type { AgentRole, AgentConfig } from './types';
import type { Hotel } from '@/types/database';

// =============================================================================
// System Prompt Assembly
// =============================================================================

/**
 * Parameters required to assemble the system prompt.
 */
interface AssembleSystemPromptParams {
  role: AgentRole;
  hotelId: string;
  conversationId: string;
  config: AgentConfig;
}

/**
 * Assembles the four-layer XML-tagged system prompt from fresh DB data.
 *
 * Layer 1 — Identity: Who the agent is (from config.promptTemplate.identity)
 * Layer 2 — Hotel Context: Live hotel data fetched fresh from DB
 * Layer 3 — Memory: Conversation summary (first) + semantic facts + episodic history
 *            Conversation summary is loaded in parallel with hotel data (zero serial latency).
 *            It is injected as the FIRST memory entry so the model reads prior conversation
 *            context before the static hotel knowledge base.
 * Layer 4 — Instructions: Behavioral rules (from config.promptTemplate.behavioral)
 *
 * NEVER cache the result of this function. The stateless invocation design
 * requires fresh DB data on every call.
 *
 * @param params - Role, hotelId, conversationId, and agent config
 * @returns Four-layer XML-tagged system prompt string
 */
export async function assembleSystemPrompt(
  params: AssembleSystemPromptParams,
): Promise<string> {
  const { hotelId, config } = params;

  // Fetch hotel data and memory in parallel for performance.
  // IMPORTANT: No caching — fresh data every invocation.
  // conversationSummary is loaded in parallel — no serial latency added.
  const [hotel, semanticFacts, roomContext, episodicHistory, conversationSummary] = await Promise.all([
    fetchHotel(hotelId),
    loadSemanticFacts(hotelId),
    loadRoomContext(hotelId),
    loadEpisodicHistory(hotelId, config.memoryScope),
    loadConversationSummary(params.conversationId),
  ]);

  // -------------------------------------------------------------------------
  // Layer 1: Identity (static per role)
  // -------------------------------------------------------------------------
  const identityLayer = `<identity>
${config.promptTemplate.identity}
</identity>`;

  // -------------------------------------------------------------------------
  // Layer 2: Hotel Context (live from DB)
  // -------------------------------------------------------------------------
  const hotelContextLayer = `<hotel_context>
${formatHotelContext(hotel)}
</hotel_context>`;

  // -------------------------------------------------------------------------
  // Layer 3: Memory (conversation summary + semantic facts + episodic history)
  // Summary comes FIRST: model needs conversation context before hotel knowledge.
  // -------------------------------------------------------------------------
  const memoryParts: string[] = [];

  if (conversationSummary.trim()) {
    memoryParts.push(`[Earlier conversation summary]:\n${conversationSummary}`);
  }

  if (semanticFacts.trim()) {
    memoryParts.push(`Hotel Knowledge Base:\n${semanticFacts}`);
  }

  if (roomContext.trim()) {
    memoryParts.push(`Room Information:\n${roomContext}`);
  }

  if (episodicHistory.trim()) {
    memoryParts.push(`Guest Interaction History:\n${episodicHistory}`);
  }

  const memoryContent =
    memoryParts.length > 0
      ? memoryParts.join('\n\n')
      : 'No hotel facts or guest history available yet.';

  const memoryLayer = `<memory>
${memoryContent}
</memory>`;

  // -------------------------------------------------------------------------
  // Layer 4: Behavioral Instructions (static per role)
  // -------------------------------------------------------------------------
  const instructionsLayer = `<instructions>
${config.promptTemplate.behavioral}
</instructions>`;

  // -------------------------------------------------------------------------
  // Combine all four layers with blank lines between them
  // -------------------------------------------------------------------------
  return [identityLayer, hotelContextLayer, memoryLayer, instructionsLayer].join('\n\n');
}

// =============================================================================
// Private Helpers
// =============================================================================

/**
 * Fetches hotel data from the database.
 *
 * NEVER cache this result. Always called fresh on each assembleSystemPrompt invocation.
 *
 * @param hotelId - UUID of the hotel to fetch
 * @returns Hotel row from the database
 * @throws Error if hotel not found or DB error
 */
async function fetchHotel(hotelId: string): Promise<Hotel> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('hotels')
    .select('*')
    .eq('id', hotelId)
    .single()
    .returns<Hotel>();

  if (error) {
    throw new Error(`Failed to load hotel data for system prompt: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Hotel not found: ${hotelId}`);
  }

  return data;
}

/**
 * Formats hotel data as a readable string for the system prompt.
 *
 * @param hotel - Hotel row from the database
 * @returns Multi-line formatted string of hotel details
 */
function formatHotelContext(hotel: Hotel): string {
  const lines: string[] = [];

  lines.push(`Hotel Name: ${hotel.name}`);

  if (hotel.address) lines.push(`Address: ${hotel.address}`);
  if (hotel.city) lines.push(`City: ${hotel.city}`);
  if (hotel.country) lines.push(`Country: ${hotel.country}`);

  lines.push(`Timezone: ${hotel.timezone}`);

  if (hotel.contact_email) lines.push(`Contact Email: ${hotel.contact_email}`);
  if (hotel.contact_phone) lines.push(`Contact Phone: ${hotel.contact_phone}`);

  return lines.join('\n');
}
