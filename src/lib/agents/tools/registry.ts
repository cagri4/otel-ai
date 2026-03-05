/**
 * Tool definitions for the OtelAI agent system.
 *
 * These are the tool schemas passed to the Claude API — not the implementations.
 * They define the JSON Schema format for each tool's input parameters.
 *
 * Four tools are defined for Phase 2:
 * - get_room_availability: Forces agents to call the tool before stating availability
 * - get_room_pricing: Forces agents to call the tool before stating prices
 * - lookup_guest_reservation: Looks up an existing guest reservation
 * - delegate_task: Delegates work to another AI employee via the async tasks table
 *
 * Tool-first policy: Tool descriptions include "MUST be called" directives.
 * This structurally prevents agents from hallucinating data — they must
 * call the tool to get data before they can respond.
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md, 02-03-PLAN.md
 */

import type Anthropic from '@anthropic-ai/sdk';
import { AgentRole } from '../types';

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

/**
 * Updates hotel information based on owner-provided data during conversation.
 * Used by FRONT_DESK for progressive onboarding — saving owner-provided facts
 * (city, country, contact info) during the first conversation.
 */
const updateHotelInfoTool: Anthropic.Messages.Tool = {
  name: 'update_hotel_info',
  description:
    'Save hotel information provided by the owner during conversation. Use this when the owner tells you their city, contact details, address, or other hotel facts. This helps build the hotel knowledge base from conversation.',
  input_schema: {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        enum: ['city', 'country', 'address', 'contact_email', 'contact_phone'],
        description: 'Which hotel field to update',
      },
      value: {
        type: 'string',
        description: 'The new value for the field',
      },
    },
    required: ['field', 'value'],
  },
};

/**
 * Delegates a task to another AI employee via the async tasks queue.
 * Used by FRONT_DESK to hand off work to other departments without blocking.
 */
const delegateTaskTool: Anthropic.Messages.Tool = {
  name: 'delegate_task',
  description:
    'Delegate a task to another AI employee. Use this when a guest request requires a different department (e.g., housekeeping, concierge). The task will be queued for the other employee.',
  input_schema: {
    type: 'object',
    properties: {
      to_role: {
        type: 'string',
        description: "Target employee role, e.g. 'housekeeping', 'concierge'",
      },
      task_type: {
        type: 'string',
        description: "Type of task, e.g. 'check_room_status', 'arrange_transfer'",
      },
      details: {
        type: 'string',
        description: 'Description of what needs to be done',
      },
    },
    required: ['to_role', 'task_type', 'details'],
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
  update_hotel_info: updateHotelInfoTool,
  delegate_task: delegateTaskTool,
};

/**
 * Returns the tool definitions for a given agent role.
 *
 * FRONT_DESK gets all four tools including delegate_task for cross-department delegation.
 * Future roles may have restricted tool sets (e.g., HOUSEKEEPER doesn't need pricing).
 *
 * @param role - The agent role requesting tools
 * @returns Array of Anthropic.Messages.Tool definitions for the role
 */
export function getToolsForRole(role: AgentRole): Anthropic.Messages.Tool[] {
  switch (role) {
    case AgentRole.FRONT_DESK:
      return [
        getAvailabilityTool,
        getRoomPricingTool,
        lookupGuestReservationTool,
        updateHotelInfoTool,
        delegateTaskTool,
      ];
    case AgentRole.GUEST_EXPERIENCE:
      // No tools needed — generates messages from templates/context provided in system prompt
      return [];
    default:
      // Non-FRONT_DESK roles get the three core tools but not delegate_task
      // (prevents housekeeping/concierge from creating circular delegations)
      return [getAvailabilityTool, getRoomPricingTool, lookupGuestReservationTool];
  }
}
