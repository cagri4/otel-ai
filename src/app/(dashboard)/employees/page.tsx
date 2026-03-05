/**
 * AI Employees page — Server Component.
 *
 * Route: /employees
 * Layout: (dashboard)/layout.tsx — authenticated, hotel header rendered there.
 *
 * Displays all AI agents for this hotel. Each agent card shows:
 *   - Role display name
 *   - On/Off toggle (form submitting to toggleAgent Server Action)
 *   - Behavior config editor: tone dropdown + custom instructions textarea
 *     (form submitting to updateAgentConfig Server Action)
 *
 * Data fetching: RLS-scoped via anon key + session cookie.
 * The agents table RLS policy returns only the authenticated hotel's rows.
 *
 * SupabaseClient cast: same pattern as escalation.ts and audit.ts.
 * See STATE.md decision: "SupabaseClient cast for new tables".
 *
 * Error banners from toggleAgent enforcement redirects:
 *   ?error=limit_reached&maxAgents=N — agent limit exceeded for current plan
 *   ?error=trial_expired             — free trial has ended
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-03-PLAN.md
 * Updated: .planning/phases/06-billing/06-04-PLAN.md
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Agent } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toggleAgent, updateAgentConfig } from './actions'

// =============================================================================
// Role display name mapping
// =============================================================================

const ROLE_DISPLAY: Record<string, string> = {
  front_desk: 'Front Desk',
  guest_experience: 'Guest Experience',
}

function getRoleDisplayName(role: string): string {
  return ROLE_DISPLAY[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// =============================================================================
// Tone options
// =============================================================================

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
]

// =============================================================================
// Page
// =============================================================================

interface EmployeesPageProps {
  searchParams: Promise<{ error?: string; maxAgents?: string }>
}

export default async function EmployeesPage({ searchParams }: EmployeesPageProps) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Resolve search params for enforcement error banners
  const params = await searchParams
  const errorCode = params.error
  const maxAgents = params.maxAgents

  // Fetch all agents for this hotel — RLS scopes to user's hotel_id from JWT.
  // SupabaseClient cast required for manually-typed tables in postgrest-js v12.
  const { data: agents, error } = await (supabase as unknown as SupabaseClient)
    .from('agents')
    .select('*')
    .order('role')
    .returns<Agent[]>()

  if (error) {
    console.error('[employees] Failed to fetch agents:', error.message)
  }

  const agentList: Agent[] = agents ?? []

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold">AI Employees</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your AI staff — toggle them on/off and customize their behavior.
        </p>
      </div>

      {/* Enforcement error banners from toggleAgent redirect */}
      {errorCode === 'limit_reached' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Agent limit reached.</strong>{' '}
          {maxAgents
            ? `Your plan allows ${maxAgents} agent${Number(maxAgents) !== 1 ? 's' : ''}.`
            : 'You have reached your plan limit.'}{' '}
          <a href="/billing" className="underline font-medium hover:text-red-900">
            Upgrade your plan on the Billing page.
          </a>
        </div>
      )}

      {errorCode === 'trial_expired' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Your free trial has ended.</strong>{' '}
          <a href="/billing" className="underline font-medium hover:text-red-900">
            Subscribe on the Billing page
          </a>{' '}
          to manage AI employees.
        </div>
      )}

      {agentList.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No AI employees found. They are created automatically when your hotel is set up.
          </CardContent>
        </Card>
      )}

      {/* Two-column grid on large screens, single column on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {agentList.map((agent) => {
          const config = (agent.behavior_config ?? {}) as Record<string, unknown>
          const currentTone = (config.tone as string) ?? 'professional'
          const currentInstructions = (config.custom_instructions as string) ?? ''

          return (
            <Card key={agent.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-medium">
                    {getRoleDisplayName(agent.role)}
                  </CardTitle>
                  {/* Status badge */}
                  <Badge
                    variant={agent.is_enabled ? 'default' : 'secondary'}
                    className={
                      agent.is_enabled
                        ? 'bg-green-100 text-green-800 border border-green-200'
                        : 'bg-red-100 text-red-800 border border-red-200'
                    }
                  >
                    {agent.is_enabled ? 'Active' : 'Disabled'}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-6">
                {/* On/Off toggle form */}
                <form action={toggleAgent}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <input
                    type="hidden"
                    name="currentEnabled"
                    value={agent.is_enabled.toString()}
                  />
                  <Button
                    type="submit"
                    variant={agent.is_enabled ? 'destructive' : 'default'}
                    size="sm"
                    className="w-full"
                  >
                    {agent.is_enabled ? 'Turn Off' : 'Turn On'}
                  </Button>
                </form>

                {/* Behavior config form */}
                <form action={updateAgentConfig} className="space-y-4">
                  <input type="hidden" name="agentId" value={agent.id} />

                  {/* Tone selector */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`tone-${agent.id}`}
                      className="text-sm font-medium leading-none"
                    >
                      Tone
                    </label>
                    <select
                      id={`tone-${agent.id}`}
                      name="tone"
                      defaultValue={currentTone}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {TONE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Custom instructions */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`instructions-${agent.id}`}
                      className="text-sm font-medium leading-none"
                    >
                      Custom Instructions
                    </label>
                    <Textarea
                      id={`instructions-${agent.id}`}
                      name="custom_instructions"
                      defaultValue={currentInstructions}
                      placeholder="Optional: add specific behavior instructions for this employee..."
                      rows={3}
                      className="resize-none"
                    />
                  </div>

                  <Button type="submit" size="sm" variant="outline" className="w-full">
                    Save Config
                  </Button>
                </form>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
