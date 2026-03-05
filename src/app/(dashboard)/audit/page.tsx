/**
 * Audit Log page — Server Component.
 *
 * Route: /audit
 * Layout: (dashboard)/layout.tsx — authenticated, hotel header rendered there.
 *
 * Displays the last 100 audit log rows from agent_audit_log, ordered by most
 * recent first. Each row shows:
 *   - Timestamp (hotel timezone)
 *   - Agent role (display name)
 *   - Tool name
 *   - Action class (OBSERVE / INFORM / ACT) with colored badges
 *   - Conversation ID (linked to /conversations/[id])
 *   - Expandable row for input_json and result_json
 *
 * Data fetching: RLS-scoped via anon key + session cookie.
 * The agent_audit_log RLS SELECT policy returns only the authenticated hotel's rows.
 *
 * SupabaseClient cast: same pattern as escalation.ts and audit.ts.
 * See STATE.md decision: "SupabaseClient cast for new tables".
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-03-PLAN.md
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { AgentAuditLog, Hotel } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatInHotelTz } from '@/lib/timezone'

// =============================================================================
// Helpers
// =============================================================================

const ROLE_DISPLAY: Record<string, string> = {
  front_desk: 'Front Desk',
  guest_experience: 'Guest Experience',
}

function getRoleDisplayName(role: string): string {
  return ROLE_DISPLAY[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Returns Tailwind classes for OBSERVE / INFORM / ACT badges.
 * OBSERVE = blue (read-only)
 * INFORM = yellow (notifications)
 * ACT = red (state changes)
 */
function getActionClassBadgeClass(actionClass: string): string {
  switch (actionClass) {
    case 'OBSERVE':
      return 'bg-blue-100 text-blue-800 border border-blue-200'
    case 'INFORM':
      return 'bg-yellow-100 text-yellow-800 border border-yellow-200'
    case 'ACT':
      return 'bg-red-100 text-red-800 border border-red-200'
    default:
      return 'bg-gray-100 text-gray-800 border border-gray-200'
  }
}

// =============================================================================
// Page
// =============================================================================

export default async function AuditPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Load hotel for timezone display
  const { data: hotel } = await supabase
    .from('hotels')
    .select('timezone')
    .single() as { data: Pick<Hotel, 'timezone'> | null }

  const hotelTimezone = hotel?.timezone ?? 'UTC'

  // Fetch last 100 audit log entries — RLS scopes to user's hotel_id from JWT.
  // SupabaseClient cast required for manually-typed tables in postgrest-js v12.
  const { data: logs, error } = await (supabase as unknown as SupabaseClient)
    .from('agent_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<AgentAuditLog[]>()

  if (error) {
    console.error('[audit] Failed to fetch audit log:', error.message)
  }

  const logList: AgentAuditLog[] = logs ?? []

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every tool call made by your AI employees — showing the last 100 actions.
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="text-muted-foreground">Action classes:</span>
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 border border-blue-200">
          OBSERVE — Read only
        </Badge>
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border border-yellow-200">
          INFORM — Notification / write
        </Badge>
        <Badge variant="secondary" className="bg-red-100 text-red-800 border border-red-200">
          ACT — State change
        </Badge>
      </div>

      {logList.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No audit log entries yet. Entries appear when AI employees use tools.
          </CardContent>
        </Card>
      )}

      {/* Audit table */}
      {logList.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                  Agent
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                  Tool
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                  Class
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                  Conversation
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {logList.map((log) => (
                <tr
                  key={log.id}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatInHotelTz(log.created_at, hotelTimezone, 'dd MMM HH:mm:ss')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {getRoleDisplayName(log.agent_role)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    {log.tool_name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge
                      variant="secondary"
                      className={getActionClassBadgeClass(log.action_class)}
                    >
                      {log.action_class}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate">
                    <Link
                      href={`/conversations/${encodeURIComponent(log.conversation_id)}`}
                      className="text-primary hover:underline"
                      title={log.conversation_id}
                    >
                      {log.conversation_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                        View JSON
                      </summary>
                      <div className="mt-2 space-y-2">
                        <div>
                          <p className="font-medium text-muted-foreground mb-0.5">Input</p>
                          <pre className="bg-muted rounded p-2 text-xs whitespace-pre-wrap break-all max-w-xs overflow-auto max-h-24">
                            {JSON.stringify(log.input_json, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="font-medium text-muted-foreground mb-0.5">Result</p>
                          <pre className="bg-muted rounded p-2 text-xs whitespace-pre-wrap break-all max-w-xs overflow-auto max-h-24">
                            {JSON.stringify(log.result_json, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
