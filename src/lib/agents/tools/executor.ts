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
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md
 */

import { getAvailability, getRoomPricing, lookupGuestReservation } from './stubs';

// =============================================================================
// Tool Dispatch Map
// =============================================================================

/**
 * Maps tool names (as defined in registry.ts) to their implementations.
 * Keys must exactly match the `name` field of the tool definitions in registry.ts.
 */
const TOOL_DISPATCH: Record<
  string,
  (input: Record<string, unknown>) => Promise<Record<string, unknown>>
> = {
  get_room_availability: getAvailability,
  get_room_pricing: getRoomPricing,
  lookup_guest_reservation: lookupGuestReservation,
};

// =============================================================================
// Tool Executor
// =============================================================================

/**
 * Executes a tool by name with the given input.
 *
 * Returns the tool result as a JSON string for inclusion in Anthropic's
 * tool_result content block.
 *
 * If the tool throws, returns a JSON error object rather than re-throwing,
 * allowing Claude to report the failure to the guest gracefully.
 *
 * @param name - Tool name (must match a key in TOOL_DISPATCH)
 * @param input - Tool input parameters from the Claude tool_use block
 * @returns JSON string of the tool result
 * @throws Error if the tool name is not registered (programming error)
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const handler = TOOL_DISPATCH[name];

  if (!handler) {
    throw new Error(
      `Unknown tool: "${name}". ` +
        `Registered tools: ${Object.keys(TOOL_DISPATCH).join(', ')}`,
    );
  }

  try {
    const result = await handler(input);
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
