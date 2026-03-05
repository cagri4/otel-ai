/**
 * Conversations browser — Server Component.
 *
 * Route: /conversations
 * Layout: (dashboard)/layout.tsx — authenticated, hotel header rendered there.
 *
 * Fetches recent conversation turns and groups them by conversation_id to
 * produce a list of distinct conversations with metadata:
 *   - Conversation ID (displayed with channel icon prefix)
 *   - Agent role badge (derived from conversation_id pattern)
 *   - Last message timestamp (hotel timezone)
 *   - Message count
 *   - Preview of last user message
 *
 * Grouping by AI employee:
 *   - conversation_ids ending in _guest_experience_chat → Guest Experience
 *   - all other guest-facing conversations (wa_*, widget_*, etc.) → Front Desk
 *   - owner_chat conversations → Owner (shown but not attributed to a guest-facing agent)
 *
 * Fetches last 200 turns ordered by created_at desc, groups in JS.
 * For hotels with high traffic, this provides a practical overview without
 * requiring a custom RPC (GROUP BY not natively supported by PostgREST client).
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-03-PLAN.md
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ConversationTurn } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatInHotelTz } from '@/lib/timezone'
import type { Hotel } from '@/types/database'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Derive agent role from conversation_id pattern.
 *
 * Conventions:
 *   *_guest_experience_chat → Guest Experience agent
 *   wa_* or widget_* or *_owner_chat → Front Desk (or Owner)
 *   anything else → Front Desk (default)
 */
function deriveAgentRole(conversationId: string): string {
  if (conversationId.includes('guest_experience')) return 'Guest Experience'
  if (conversationId.includes('owner_chat')) return 'Owner Chat'
  if (conversationId.startsWith('wa_')) return 'Front Desk (WhatsApp)'
  if (conversationId.startsWith('widget_')) return 'Front Desk (Widget)'
  return 'Front Desk'
}

/**
 * Returns the display label for the role badge variant.
 */
function getRoleBadgeClass(role: string): string {
  if (role.startsWith('Guest Experience')) return 'bg-purple-100 text-purple-800 border border-purple-200'
  if (role.startsWith('Owner')) return 'bg-blue-100 text-blue-800 border border-blue-200'
  return 'bg-gray-100 text-gray-800 border border-gray-200'
}

type ConversationGroup = {
  conversationId: string
  agentRole: string
  lastMessageAt: string
  messageCount: number
  lastUserMessage: string
}

/**
 * Group an array of ConversationTurn (ordered desc by created_at) into
 * one ConversationGroup per unique conversation_id.
 */
function groupTurns(turns: ConversationTurn[]): ConversationGroup[] {
  const groupMap = new Map<string, ConversationGroup>()

  for (const turn of turns) {
    const existing = groupMap.get(turn.conversation_id)

    if (!existing) {
      // First time seeing this conversation_id — it is the most recent turn
      groupMap.set(turn.conversation_id, {
        conversationId: turn.conversation_id,
        agentRole: deriveAgentRole(turn.conversation_id),
        lastMessageAt: turn.created_at,
        messageCount: 1,
        lastUserMessage:
          turn.role === 'user'
            ? turn.content.slice(0, 120)
            : '',
      })
    } else {
      // Accumulate
      existing.messageCount += 1
      if (turn.role === 'user' && !existing.lastUserMessage) {
        existing.lastUserMessage = turn.content.slice(0, 120)
      }
    }
  }

  // Return sorted by most recent (groupMap insertion order reflects desc sort)
  return Array.from(groupMap.values())
}

// =============================================================================
// Page
// =============================================================================

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
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

  // Fetch last 200 turns — RLS scopes to user's hotel_id from JWT.
  // SupabaseClient cast required for manually-typed tables in postgrest-js v12.
  const { data: turns, error } = await (supabase as unknown as SupabaseClient)
    .from('conversation_turns')
    .select('conversation_id, role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<ConversationTurn[]>()

  if (error) {
    console.error('[conversations] Failed to fetch turns:', error.message)
  }

  const allConversations = groupTurns(turns ?? [])

  // Filter by agent role if ?role= param is set
  const resolvedParams = await searchParams
  const roleFilter = resolvedParams?.role ?? 'all'
  const conversations =
    roleFilter === 'all'
      ? allConversations
      : allConversations.filter((c) => {
          if (roleFilter === 'guest_experience') return c.agentRole === 'Guest Experience'
          if (roleFilter === 'front_desk') return c.agentRole.startsWith('Front Desk')
          return true
        })

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold">Conversations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse all guest conversations handled by your AI employees.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Filter by employee:</span>
        {[
          { label: 'All', value: 'all' },
          { label: 'Front Desk', value: 'front_desk' },
          { label: 'Guest Experience', value: 'guest_experience' },
        ].map((opt) => (
          <Link
            key={opt.value}
            href={`/conversations${opt.value === 'all' ? '' : `?role=${opt.value}`}`}
            className={`text-sm px-3 py-1 rounded-full border transition-colors ${
              roleFilter === opt.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-input hover:text-foreground'
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {conversations.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No conversations found.{roleFilter !== 'all' ? ' Try selecting "All" to see all channels.' : ''}
          </CardContent>
        </Card>
      )}

      {/* Conversation list */}
      <div className="space-y-3">
        {conversations.map((conv) => (
          <Link
            key={conv.conversationId}
            href={`/conversations/${encodeURIComponent(conv.conversationId)}`}
            className="block"
          >
            <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Conversation ID + agent role */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs text-muted-foreground truncate max-w-[260px]">
                        {conv.conversationId}
                      </span>
                      <Badge
                        variant="secondary"
                        className={getRoleBadgeClass(conv.agentRole)}
                      >
                        {conv.agentRole}
                      </Badge>
                    </div>

                    {/* Message preview */}
                    {conv.lastUserMessage && (
                      <p className="text-sm text-muted-foreground truncate">
                        {conv.lastUserMessage}
                        {conv.lastUserMessage.length >= 120 ? '…' : ''}
                      </p>
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {formatInHotelTz(conv.lastMessageAt, hotelTimezone)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {conv.messageCount} {conv.messageCount === 1 ? 'message' : 'messages'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
