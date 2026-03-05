/**
 * Audit module for the OtelAI agent system.
 *
 * Classifies every tool call into one of three action classes and writes
 * an append-only audit log row to agent_audit_log.
 *
 * Action classification:
 *   OBSERVE — Read-only data queries (no side effects)
 *   INFORM  — Notifications and informational writes
 *   ACT     — Writes, modifications, state changes (defaults for unknown tools)
 *
 * Conservative default: unknown or future tools default to ACT.
 * This means if a new tool is added without being classified, it is treated
 * as the most restrictive class, avoiding false permission assumptions.
 *
 * Current ACT tools: none (Phase 5). The owner confirmation gate for ACT
 * classification is deferred until the first ACT-class tool is added.
 *
 * Audit writes are fire-and-forget — never block tool responses for logging.
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-01-PLAN.md
 */

import type { ActionClass } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export type { ActionClass };

// =============================================================================
// Action Classification Registry
// =============================================================================

/**
 * OBSERVE tools: read-only data queries with no side effects.
 * These tools only retrieve information — they do not change any state.
 */
const OBSERVE_TOOLS = new Set([
  'get_room_availability',
  'get_room_pricing',
  'lookup_guest_reservation',
  'get_room_status',          // Housekeeping: reads room status — no state change
]);

/**
 * INFORM tools: write informational or notification data.
 * Side effects are limited to internal state (task queue, hotel info, room status updates).
 */
const INFORM_TOOLS = new Set([
  'delegate_task',
  'update_hotel_info',
  'update_room_status',       // Housekeeping: updates internal room status — no external side effects
]);

/**
 * ACT tools: external side effects beyond internal state changes.
 * These tools send external communications or perform actions outside the system.
 * assign_cleaning_task: sends external Resend email to staff member — ACT classification.
 *
 * Note: The conservative default in classifyAction() already returns 'ACT' for any
 * unrecognized tool. This comment documents the explicit ACT classification intent.
 */
// ACT_TOOLS — assign_cleaning_task falls through to the default ACT return value.
// Listed here for documentation: ['assign_cleaning_task']

// =============================================================================
// classifyAction
// =============================================================================

/**
 * Classifies a tool call by name into OBSERVE, INFORM, or ACT.
 *
 * Conservative default: any unrecognized tool name returns ACT.
 * This ensures new tools require explicit classification before being
 * treated as lower-privilege operations.
 *
 * @param toolName - The name of the tool to classify
 * @returns ActionClass — 'OBSERVE', 'INFORM', or 'ACT'
 */
export function classifyAction(toolName: string): ActionClass {
  if (OBSERVE_TOOLS.has(toolName)) return 'OBSERVE';
  if (INFORM_TOOLS.has(toolName)) return 'INFORM';
  return 'ACT'; // Conservative default for unknown/future tools
}

// =============================================================================
// writeAuditLog
// =============================================================================

/**
 * Writes one row to agent_audit_log for a completed tool execution.
 *
 * Uses the service client — audit writes happen in tool execution context
 * where there is no user session (executeTool is called server-side).
 * The service client bypasses RLS, which is safe because:
 *   - All inputs are validated by the tool handler before reaching here
 *   - hotel_id is passed from the verified execution context, not client input
 *
 * Fire-and-forget pattern: callers should use .catch() to suppress errors
 * rather than awaiting this function in the critical path.
 *
 * @param params - Audit log entry data
 */
export async function writeAuditLog(params: {
  hotelId: string;
  agentRole: string;
  conversationId: string;
  toolName: string;
  actionClass: ActionClass;
  inputJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
}): Promise<void> {
  // Use service client — audit writes bypass RLS (no user session in tool context)
  const { createServiceClient } = await import('@/lib/supabase/service');
  const supabase = createServiceClient();

  // Cast to SupabaseClient — same pattern as escalation.ts.
  // The manual Database type does not thread through from() inference for new tables
  // until generated types replace these manual definitions (per project decision in STATE.md).
  const { error } = await (supabase as unknown as SupabaseClient)
    .from('agent_audit_log')
    .insert({
      hotel_id: params.hotelId,
      agent_role: params.agentRole,
      conversation_id: params.conversationId,
      tool_name: params.toolName,
      action_class: params.actionClass,
      input_json: params.inputJson,
      result_json: params.resultJson,
    });

  if (error) {
    // Log but do not throw — audit failure must never break the tool response
    console.error('[audit] Failed to write audit log:', error.message);
  }
}
