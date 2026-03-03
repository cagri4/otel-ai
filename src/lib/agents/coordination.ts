/**
 * Agent-to-agent coordination via async tasks table.
 *
 * Pattern: Fire-and-forget delegation. An agent INSERTs a task row and
 * returns to the caller immediately. The delegated agent picks up the
 * task on its next invocation (or via a future cron/webhook trigger).
 *
 * Anti-pattern: NEVER call invokeAgent() from within this module or
 * from a tool handler. Always delegate via delegateTask() instead.
 *
 * Type note: postgrest-js v12 requires generated types for full INSERT/UPDATE
 * inference. With manually-written Database types, INSERT/UPDATE queries must
 * cast the client to SupabaseClient (plain) and the payload to
 * Record<string, unknown>. SELECT queries use .returns<T>() instead.
 * This matches the pattern in memory.ts (established Phase 2 Plan 1).
 */

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentTask } from '@/types/database';

// =============================================================================
// Delegate Task
// =============================================================================

/**
 * Inserts a new task row into agent_tasks with status 'pending'.
 *
 * Use case: Front Desk AI delegates "check_housekeeping_status" to the
 * Housekeeping role — fire-and-forget, caller returns immediately.
 *
 * @param params.hotelId   - Hotel the task belongs to (for RLS isolation)
 * @param params.fromRole  - Role of the delegating agent (e.g. 'front_desk')
 * @param params.toRole    - Role of the receiving agent (e.g. 'housekeeping')
 * @param params.taskType  - Type descriptor (e.g. 'check_room_status')
 * @param params.payload   - Arbitrary task data (stored as JSONB)
 * @returns The newly created AgentTask row
 */
export async function delegateTask(params: {
  hotelId: string;
  fromRole: string;
  toRole: string;
  taskType: string;
  payload: Record<string, unknown>;
}): Promise<AgentTask> {
  const supabase = await createClient();

  // Cast to bypass postgrest-js v12 Insert type inference issue with manual Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('agent_tasks')
    .insert({
      hotel_id: params.hotelId,
      from_role: params.fromRole,
      to_role: params.toRole,
      task_type: params.taskType,
      payload: params.payload,
      status: 'pending',
    } as Record<string, unknown>)
    .select()
    .single();

  if (error) {
    throw new Error(
      `delegateTask failed: ${error.message} (code: ${error.code})`,
    );
  }

  return data as AgentTask;
}

// =============================================================================
// Get Pending Tasks
// =============================================================================

/**
 * Returns all pending tasks assigned to a given agent role for a hotel.
 *
 * FIFO ordering (created_at ASC) ensures tasks are processed in arrival order.
 *
 * @param hotelId  - Hotel ID (RLS scope)
 * @param forRole  - Target agent role to fetch tasks for
 * @returns Array of pending AgentTask rows, oldest first
 */
export async function getPendingTasks(
  hotelId: string,
  forRole: string,
): Promise<AgentTask[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('agent_tasks')
    .select()
    .eq('hotel_id', hotelId)
    .eq('to_role', forRole)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .returns<AgentTask[]>();

  if (error) {
    throw new Error(
      `getPendingTasks failed: ${error.message} (code: ${error.code})`,
    );
  }

  return data ?? [];
}

// =============================================================================
// Claim Task
// =============================================================================

/**
 * Atomically transitions a task from 'pending' to 'processing'.
 *
 * The WHERE status = 'pending' condition is a lightweight optimistic lock —
 * only one worker can claim a given task. If the task was already claimed,
 * the UPDATE affects zero rows and an error is thrown.
 *
 * @param taskId - UUID of the task to claim
 * @returns The updated AgentTask row (status = 'processing')
 * @throws Error if the task does not exist or is no longer pending
 */
export async function claimTask(taskId: string): Promise<AgentTask> {
  const supabase = await createClient();

  // Cast to bypass postgrest-js v12 Update type inference issue with manual Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('agent_tasks')
    .update({
      status: 'processing',
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', taskId)
    .eq('status', 'pending')
    .select()
    .single();

  if (error) {
    throw new Error(
      `claimTask failed: ${error.message} (code: ${error.code})`,
    );
  }

  return data as AgentTask;
}

// =============================================================================
// Complete Task
// =============================================================================

/**
 * Marks a task as 'completed' and stores the result payload.
 *
 * @param taskId - UUID of the task to complete
 * @param result - Arbitrary result data (stored as JSONB)
 * @returns The updated AgentTask row (status = 'completed')
 */
export async function completeTask(
  taskId: string,
  result: Record<string, unknown>,
): Promise<AgentTask> {
  const supabase = await createClient();

  const now = new Date().toISOString();

  // Cast to bypass postgrest-js v12 Update type inference issue with manual Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('agent_tasks')
    .update({
      status: 'completed',
      result,
      completed_at: now,
      updated_at: now,
    } as Record<string, unknown>)
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `completeTask failed: ${error.message} (code: ${error.code})`,
    );
  }

  return data as AgentTask;
}

// =============================================================================
// Fail Task
// =============================================================================

/**
 * Marks a task as 'failed' and records the error message.
 *
 * @param taskId       - UUID of the task that failed
 * @param errorMessage - Human-readable description of what went wrong
 * @returns The updated AgentTask row (status = 'failed')
 */
export async function failTask(
  taskId: string,
  errorMessage: string,
): Promise<AgentTask> {
  const supabase = await createClient();

  // Cast to bypass postgrest-js v12 Update type inference issue with manual Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('agent_tasks')
    .update({
      status: 'failed',
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `failTask failed: ${error.message} (code: ${error.code})`,
    );
  }

  return data as AgentTask;
}
