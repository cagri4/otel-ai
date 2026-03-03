/**
 * Tool definitions for the OtelAI agent system.
 *
 * These are the tool schemas passed to the Claude API — not the implementations.
 * They define the JSON Schema format for each tool's input parameters.
 *
 * Three tools are defined for Phase 2:
 * - get_room_availability: Forces agents to call the tool before stating availability
 * - get_room_pricing: Forces agents to call the tool before stating prices
 * - lookup_guest_reservation: Looks up an existing guest reservation
 *
 * Tool-first policy: Tool descriptions include "MUST be called" directives.
 * This structurally prevents agents from hallucinating data — they must
 * call the tool to get data before they can respond.
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { AgentRole } from '../types';

// =============================================================================
// Tool Definitions (Anthropic JSON Schema format)
// =============================================================================

/**
 * Checks room availability for given dates.
 * Structurally forces agents to retrieve current data before responding.
 */
const getAvailabilityTool: Anthropic.Messages.Tool = {
  name: 'get_room_availability',
  description:
    'Check room availability for given dates. MUST be called before stating availability.',
  input_schema: {
    type: 'object',
    properties: {
      check_in: {
        type: 'string',
        description: 'Check-in date in ISO 8601 format (e.g. 2026-06-15)',
      },
      check_out: {
        type: 'string',
        description: 'Check-out date in ISO 8601 format (e.g. 2026-06-18)',
      },
      room_type: {
        type: 'string',
        description: 'Optional room type filter (e.g. Standard, Deluxe, Suite)',
      },
    },
    required: ['check_in', 'check_out'],
  },
};

/**
 * Gets current room pricing.
 * Structurally forces agents to retrieve current data before stating prices.
 */
const getRoomPricingTool: Anthropic.Messages.Tool = {
  name: 'get_room_pricing',
  description: 'Get current room pricing. MUST be called before stating any prices.',
  input_schema: {
    type: 'object',
    properties: {
      room_type: {
        type: 'string',
        description: 'Optional room type filter (e.g. Standard, Deluxe, Suite)',
      },
      check_in: {
        type: 'string',
        description: 'Optional check-in date for date-specific pricing (ISO 8601)',
      },
      check_out: {
        type: 'string',
        description: 'Optional check-out date for date-specific pricing (ISO 8601)',
      },
    },
    required: [],
  },
};

/**
 * Looks up an existing guest reservation by identifier.
 */
const lookupGuestReservationTool: Anthropic.Messages.Tool = {
  name: 'lookup_guest_reservation',
  description: "Look up a guest's existing reservation by their identifier.",
  input_schema: {
    type: 'object',
    properties: {
      guest_identifier: {
        type: 'string',
        description: 'Guest identifier: email address, phone number, or full name',
      },
    },
    required: ['guest_identifier'],
  },
};

// =============================================================================
// Tools Registry
// =============================================================================

/**
 * Named tool definitions for use in role configs.
 * Each entry is a fully-typed Anthropic.Messages.Tool.
 */
export const TOOLS: Record<string, Anthropic.Messages.Tool> = {
  get_room_availability: getAvailabilityTool,
  get_room_pricing: getRoomPricingTool,
  lookup_guest_reservation: lookupGuestReservationTool,
};

/**
 * Returns the tool definitions for a given agent role.
 *
 * Currently returns all three tools for every role (Phase 2 only has FRONT_DESK).
 * Future roles may have restricted tool sets (e.g., HOUSEKEEPER doesn't need pricing).
 *
 * @param role - The agent role requesting tools
 * @returns Array of Anthropic.Messages.Tool definitions for the role
 */
export function getToolsForRole(role: AgentRole): Anthropic.Messages.Tool[] {
  // All current roles get all tools — specialized per-role tool sets in Phase 5+
  void role;
  return [getAvailabilityTool, getRoomPricingTool, lookupGuestReservationTool];
}
