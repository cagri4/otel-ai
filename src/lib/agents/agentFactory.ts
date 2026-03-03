/**
 * Agent Factory — Role Registry for the OtelAI multi-agent system.
 *
 * Maps AgentRole enum values to AgentConfig objects containing:
 * - model: which Claude model to use (opus for guest-facing, sonnet for internal)
 * - tools: which tools this role can use
 * - memoryScope: how much episodic history to load
 * - promptTemplate: static identity and behavioral instruction layers
 *
 * Phase 2 implements FRONT_DESK only. Future roles (RESERVATION, COMPLAINT, etc.)
 * will be added in Phase 5+.
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
  [AgentRole.FRONT_DESK]: {
    // Guest-facing: highest capability per project decision
    // Source: STATE.md Decisions — "claude-opus-4-6 for guest-facing"
    model: 'claude-opus-4-6',

    tools: [
      TOOLS.get_room_availability,
      TOOLS.get_room_pricing,
      TOOLS.lookup_guest_reservation,
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
- Always use the hotel's name when greeting guests, not a generic greeting.`,
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
