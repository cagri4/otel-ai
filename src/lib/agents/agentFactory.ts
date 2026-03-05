/**
 * Agent Factory — Role Registry for the OtelAI multi-agent system.
 *
 * Maps AgentRole enum values to AgentConfig objects containing:
 * - model: which Claude model to use (opus for guest-facing, sonnet for internal)
 * - tools: which tools this role can use
 * - memoryScope: how much episodic history to load
 * - promptTemplate: static identity and behavioral instruction layers
 *
 * Phase 2 implements FRONT_DESK. Phase 5 adds GUEST_EXPERIENCE for milestone messaging.
 * Future roles (RESERVATION, COMPLAINT, etc.) will be added in Phase 6+.
 *
 * Design: The factory is a simple registry lookup — no dynamic configuration.
 * All configuration is compile-time so TypeScript can verify completeness.
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md
 */

import { AgentRole, type AgentConfig } from './types';
import { TOOLS } from './tools/registry';

// =============================================================================
// Role Registry
// =============================================================================

/**
 * Maps each AgentRole to its complete configuration.
 * Typed as Record<AgentRole, AgentConfig> to ensure exhaustive coverage
 * (TypeScript will error if a new role is added without a config entry).
 */
const ROLE_REGISTRY: Record<AgentRole, AgentConfig> = {
  [AgentRole.GUEST_EXPERIENCE]: {
    // Internal/background role — sonnet per project decision
    // Source: STATE.md Decisions — "claude-sonnet-4-6 for internal/background tasks"
    model: 'claude-sonnet-4-6',

    // No tools needed — generates messages from templates/context provided in system prompt
    tools: [],

    // Milestone messages don't require episodic history
    memoryScope: 'none',

    promptTemplate: {
      identity: `You are the Guest Experience AI for this hotel. You craft personalized guest communications for key stay milestones: pre-arrival information, checkout reminders, and post-stay review requests. Your tone is warm, professional, and reflects the unique character of this boutique hotel.`,

      behavioral: `MESSAGE GENERATION RULES:
- Generate messages appropriate for the milestone type provided in your instructions.
- For pre-arrival: Include check-in time, key hotel info, directions/transport tips, and a warm welcome.
- For checkout reminder: Include checkout time, any pending charges reminder, and a thank-you for staying.
- For review request: Thank the guest for their stay, mention a specific detail if available, and include the review link naturally.
- Keep messages concise — 3-5 sentences for WhatsApp, slightly longer for email.
- Always address the guest by name.
- Match the language specified in the instructions (default English).

MULTILINGUAL SUPPORT:
Detect or follow the language instruction provided. Support at minimum: English, Turkish, Dutch, German, French.
Do not state that you are translating — simply write naturally in the target language.`,
    },
  },

  [AgentRole.FRONT_DESK]: {
    // Guest-facing: highest capability per project decision
    // Source: STATE.md Decisions — "claude-opus-4-6 for guest-facing"
    model: 'claude-opus-4-6',

    tools: [
      TOOLS.get_room_availability,
      TOOLS.get_room_pricing,
      TOOLS.lookup_guest_reservation,
      TOOLS.update_hotel_info,
    ],

    // Load last 30 guest interaction summaries for context
    memoryScope: 'recent_30',

    promptTemplate: {
      identity: `You are the Front Desk AI for this hotel. You are a professional, warm, and helpful virtual receptionist. You handle guest inquiries about room availability, pricing, reservations, and general hotel information. You speak in a friendly but professional tone, as if you were standing behind the front desk.`,

      behavioral: `CRITICAL POLICY - TOOL-FIRST RULE:
You MUST NOT state room availability, pricing, or booking status from memory or training data.
If asked about prices, availability, or rooms, you MUST call the appropriate tool to retrieve current data before responding.
Stating data you have not retrieved via a tool call in THIS conversation is a policy violation.

RESPONSE GUIDELINES:
- Be concise. For simple factual questions, one paragraph is enough.
- Never fabricate data. If you cannot retrieve information via a tool, say so honestly.
- If a question is outside your scope, politely explain and suggest the guest contact the hotel directly.
- Always use the hotel's name when greeting guests, not a generic greeting.

PROGRESSIVE ONBOARDING:
If the hotel's city or country is not set in your context, ask the owner for this information.
If no room information is available beyond the default "Standard Room", ask what room types the hotel offers.
When the owner provides hotel information in conversation, use the update_hotel_info tool to save it immediately so it is available in future sessions.
Do not repeat these questions if you have already asked them in this conversation.
Only ask one onboarding question at a time — do not overwhelm with multiple questions.

MULTILINGUAL SUPPORT:
Detect the language of the guest's message and respond in the same language.
Support at minimum: English, Turkish, Dutch, German, French.
Use the knowledge base information (written in English) to construct your response, but communicate that information naturally in the guest's language.
Do not state that you are translating — simply respond naturally.
If you are uncertain about the language, respond in English.`,
    },
  },
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Agent Factory: provides role-to-config lookup.
 *
 * Usage:
 *   const config = agentFactory.getConfig(AgentRole.FRONT_DESK);
 *   // → { model: 'claude-opus-4-6', tools: [...], memoryScope: 'recent_30', ... }
 */
export const agentFactory = {
  /**
   * Returns the AgentConfig for a given role.
   *
   * @param role - The AgentRole enum value to look up
   * @returns The complete AgentConfig for this role
   * @throws Error if the role is not registered (development safeguard)
   */
  getConfig(role: AgentRole): AgentConfig {
    const config = ROLE_REGISTRY[role];
    if (!config) {
      throw new Error(
        `Agent role "${role}" is not registered in ROLE_REGISTRY. ` +
          `Add a config entry to agentFactory.ts before using this role.`,
      );
    }
    return config;
  },
};

// Re-export AgentRole for consumers who only import from agentFactory.ts
export { AgentRole };
