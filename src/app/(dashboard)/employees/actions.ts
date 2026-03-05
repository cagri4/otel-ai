'use server'

/**
 * Server Actions for managing AI employee (agent) configuration.
 *
 * Actions:
 *   toggleAgent    — Flips is_enabled for a single agent row.
 *   updateAgentConfig — Updates behavior_config JSONB (tone + custom_instructions).
 *
 * Auth pattern: identical to settings/actions.ts.
 * RLS: agents table RLS allows owner SELECT and UPDATE (scoped by hotel_id JWT claim).
 * SupabaseClient cast: same pattern as escalation.ts / audit.ts — avoids TypeScript
 * `never` inference for manually-typed tables in postgrest-js v12.
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-03-PLAN.md
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// =============================================================================
// toggleAgent — flip is_enabled for an agent
// =============================================================================

/**
 * Toggles the is_enabled flag for a single agent.
 *
 * Reads agentId and currentEnabled from FormData, then flips the value.
 * RLS policy on agents table ensures only the authenticated hotel owner
 * can update their own agents.
 */
export async function toggleAgent(formData: FormData): Promise<void> {
  const supabase = await createClient()

  // Auth guard — same pattern as settings/actions.ts
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return
  }

  const agentId = formData.get('agentId') as string
  const currentEnabled = formData.get('currentEnabled') === 'true'

  if (!agentId) {
    return
  }

  // SupabaseClient cast — manual Database types don't infer for agents table
  // until generated types replace these manual definitions (per STATE.md decision).
  const { error } = await (supabase as unknown as SupabaseClient)
    .from('agents')
    .update({ is_enabled: !currentEnabled, updated_at: new Date().toISOString() })
    .eq('id', agentId)

  if (error) {
    console.error('[employees] toggleAgent error:', error.message)
  }

  revalidatePath('/employees')
}

// =============================================================================
// updateAgentConfig — save tone + custom_instructions to behavior_config
// =============================================================================

/**
 * Updates the behavior_config JSONB for a single agent.
 *
 * Stores tone (string) and custom_instructions (string) in behavior_config.
 * Existing behavior_config fields outside tone/custom_instructions are
 * merged — the update only replaces these two keys.
 */
export async function updateAgentConfig(formData: FormData): Promise<void> {
  const supabase = await createClient()

  // Auth guard
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return
  }

  const agentId = formData.get('agentId') as string
  const tone = (formData.get('tone') as string) || 'professional'
  const customInstructions = (formData.get('custom_instructions') as string) || ''

  if (!agentId) {
    return
  }

  // Fetch current behavior_config to merge safely
  const { data: current } = await (supabase as unknown as SupabaseClient)
    .from('agents')
    .select('behavior_config')
    .eq('id', agentId)
    .single() as { data: { behavior_config: Record<string, unknown> } | null }

  const existingConfig: Record<string, unknown> = current?.behavior_config ?? {}

  const updatedConfig: Record<string, unknown> = {
    ...existingConfig,
    tone,
    custom_instructions: customInstructions,
  }

  const { error } = await (supabase as unknown as SupabaseClient)
    .from('agents')
    .update({
      behavior_config: updatedConfig,
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId)

  if (error) {
    console.error('[employees] updateAgentConfig error:', error.message)
  }

  revalidatePath('/employees')
}
