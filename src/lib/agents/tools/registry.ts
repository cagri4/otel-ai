/**
 * Tool definitions for the OtelAI agent system.
 *
 * These are the tool schemas passed to the Claude API — not the implementations.
 * They define the JSON Schema format for each tool's input parameters.
 *
 * Phase 2: get_room_availability, get_room_pricing, lookup_guest_reservation, delegate_task
 * Phase 3: update_hotel_info (progressive onboarding)
 * Phase 8 Plan 1: get_room_status, update_room_status (housekeeping status)
 * Phase 8 Plan 2: assign_cleaning_task (staff assignment with Resend email)
 *
 * Tool-first policy: Tool descriptions include "MUST be called" directives.
 * This structurally prevents agents from hallucinating data — they must
 * call the tool to get data before they can respond.
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md, 02-03-PLAN.md
 *         .planning/phases/08-housekeeping-coordinator/08-02-PLAN.md
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
 * Retrieves current cleaning status of all rooms for the hotel.
 * Used by HOUSEKEEPING_COORDINATOR before answering any room status questions.
 * hotel_id is injected by executor.ts — NOT in the tool schema.
 */
const getRoomStatusTool: Anthropic.Messages.Tool = {
  name: 'get_room_status',
  description:
    'Retrieve the current cleaning status of all rooms in the hotel. ALWAYS call this before answering any question about room statuses. Do not guess statuses from conversation history.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * Updates the cleaning status of a specific hotel room.
 * Used by HOUSEKEEPING_COORDINATOR when the owner reports a status change.
 * hotel_id is injected by executor.ts — NOT in the tool schema.
 */
const updateRoomStatusTool: Anthropic.Messages.Tool = {
  name: 'update_room_status',
  description:
    'Update the cleaning status of a hotel room. MUST be called when the owner reports a room status change. Resolve the room by name from the conversation.',
  input_schema: {
    type: 'object',
    properties: {
      room_identifier: {
        type: 'string',
        description: 'Room name or number as the owner stated it (e.g. "Room 12", "Suite 3")',
      },
      new_status: {
        type: 'string',
        enum: ['clean', 'dirty', 'inspected', 'out_of_order'],
        description: 'New cleaning status for the room',
      },
      notes: {
        type: 'string',
        description: 'Optional notes about the status change (e.g. reason for out_of_order)',
      },
    },
    required: ['room_identifier', 'new_status'],
  },
};

/**
 * Assigns a room cleaning task to a housekeeping staff member and sends an email.
 * Used by HOUSEKEEPING_COORDINATOR when the owner requests a task assignment.
 * hotel_id is injected by executor.ts — NOT in the tool schema.
 */
const assignCleaningTaskTool: Anthropic.Messages.Tool = {
  name: 'assign_cleaning_task',
  description:
    'Assign a room cleaning task to a housekeeping staff member and send them an email notification. Use this when the owner asks to assign a cleaning task to a specific staff member.',
  input_schema: {
    type: 'object',
    properties: {
      room_identifier: {
        type: 'string',
        description: 'Room name or number to be cleaned (e.g. "Room 12", "Suite 3")',
      },
      staff_name: {
        type: 'string',
        description: 'Name of the staff member to assign the task to',
      },
      notes: {
        type: 'string',
        description: 'Optional special instructions or notes for the cleaning task',
      },
    },
    required: ['room_identifier', 'staff_name'],
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
  get_room_status: getRoomStatusTool,
  update_room_status: updateRoomStatusTool,
  assign_cleaning_task: assignCleaningTaskTool,
};

/**
 * Returns the tool definitions for a given agent role.
 *
 * FRONT_DESK gets all core tools including delegate_task for cross-department delegation.
 * BOOKING_AI gets the three booking tools (availability, pricing, reservation lookup) but not delegate_task.
 * GUEST_EXPERIENCE gets no tools — generates messages from templates provided in system prompt.
 * HOUSEKEEPING_COORDINATOR gets three housekeeping tools (get/update room status, assign task) — no delegate_task.
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
    case AgentRole.BOOKING_AI:
      // Booking-specific tools: availability, pricing, reservation lookup
      // No delegate_task (prevents delegation chains from non-FRONT_DESK roles)
      // No update_hotel_info (booking agents don't update hotel config)
      return [
        getAvailabilityTool,
        getRoomPricingTool,
        lookupGuestReservationTool,
      ];
    case AgentRole.HOUSEKEEPING_COORDINATOR:
      // Housekeeping-specific tools: read and update room cleaning status, assign tasks to staff
      // No delegate_task (prevents circular delegation chains from non-FRONT_DESK roles)
      return [
        getRoomStatusTool,
        updateRoomStatusTool,
        assignCleaningTaskTool,
      ];
    default:
      // Fallback: unregistered roles get no tools
      return [];
  }
}
