/**
 * Tool executor for the OtelAI agent system.
 *
 * Dispatches tool calls by name to their stub implementations.
 * Returns results as JSON strings (Anthropic tool_result content format).
 *
 * This is the runtime dispatch layer between invokeAgent() and the actual
 * tool implementations (currently stubs in stubs.ts, real DB queries in Phase 7).
 *
 * Error handling: If a tool throws, returns an error result object as JSON
 * rather than re-throwing. This allows Claude to handle tool failures gracefully
 * by informing the guest, rather than crashing the invocation.
 *
 * Context parameter: executeTool() accepts a context object with hotelId and
 * fromRole. This is required by delegate_task to INSERT into agent_tasks with
 * the correct hotel isolation and originating role. Other tools ignore context.
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md, 02-03-PLAN.md
 */

import { getAvailability, getRoomPricing, lookupGuestReservation } from './stubs';
import { delegateTask } from '../coordination';

// =============================================================================
// Tool Context
// =============================================================================

/**
 * Execution context passed to every tool invocation.
 * Required for tools that need hotel isolation or role information.
 */
export interface ToolContext {
  /** UUID of the hotel — required for RLS-scoped DB operations */
  hotelId: string;
  /** Role of the invoking agent (e.g. 'FRONT_DESK') */
  fromRole: string;
}

// =============================================================================
// Tool Dispatch Map
// =============================================================================

/**
 * Maps tool names (as defined in registry.ts) to their implementations.
 * Keys must exactly match the `name` field of the tool definitions in registry.ts.
 */
const TOOL_DISPATCH: Record<
  string,
  (input: Record<string, unknown>, context: ToolContext) => Promise<Record<string, unknown>>
> = {
  get_room_availability: (input) => getAvailability(input),
  get_room_pricing: (input) => getRoomPricing(input),
  lookup_guest_reservation: (input) => lookupGuestReservation(input),
  delegate_task: async (input, context) => {
    await delegateTask({
      hotelId: context.hotelId,
      fromRole: context.fromRole,
      toRole: input.to_role as string,
      taskType: input.task_type as string,
      payload: { details: input.details },
    });
    return {
      delegated: true,
      task_type: input.task_type,
      to_role: input.to_role,
      message: 'Task has been delegated. The other employee will handle it.',
    };
  },

  /**
   * Progressive onboarding tool — saves owner-provided hotel info during conversation.
   * Uses RLS-scoped server client (not service_role) consistent with project decision:
   * "No service_role client in memory helpers — all queries respect RLS via anon key + session cookie."
   */
  update_hotel_info: async (input, context) => {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();

    const allowedFields = ['city', 'country', 'address', 'contact_email', 'contact_phone'];
    const field = input.field as string;
    const value = input.value as string;

    if (!allowedFields.includes(field)) {
      return { error: true, message: `Field "${field}" is not updateable` };
    }

    if (!value || value.trim().length === 0) {
      return { error: true, message: 'Value cannot be empty' };
    }

    // Update hotel — RLS enforces hotel_id scoping via session cookie
    const { error } = await (supabase.from('hotels') as ReturnType<typeof supabase.from>)
      .update({ [field]: value.trim(), updated_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', context.hotelId);

    if (error) {
      return { error: true, message: error.message };
    }

    return {
      updated: true,
      field,
      value: value.trim(),
      message: `Hotel ${field} updated to "${value.trim()}"`,
    };
  },
};

// =============================================================================
// Tool Executor
// =============================================================================

/**
 * Executes a tool by name with the given input and execution context.
 *
 * Returns the tool result as a JSON string for inclusion in Anthropic's
 * tool_result content block.
 *
 * If the tool throws, returns a JSON error object rather than re-throwing,
 * allowing Claude to report the failure to the guest gracefully.
 *
 * @param name    - Tool name (must match a key in TOOL_DISPATCH)
 * @param input   - Tool input parameters from the Claude tool_use block
 * @param context - Execution context with hotelId and fromRole
 * @returns JSON string of the tool result
 * @throws Error if the tool name is not registered (programming error)
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<string> {
  const handler = TOOL_DISPATCH[name];

  if (!handler) {
    throw new Error(
      `Unknown tool: "${name}". ` +
        `Registered tools: ${Object.keys(TOOL_DISPATCH).join(', ')}`,
    );
  }

  try {
    const result = await handler(input, context);
    return JSON.stringify(result);
  } catch (error) {
    // Return an error result to Claude rather than crashing invokeAgent()
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      error: true,
      message: `Tool execution failed: ${message}`,
    });
  }
}
