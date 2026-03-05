/**
 * Conversation detail page — Server Component.
 *
 * Route: /conversations/[conversationId]
 * Layout: (dashboard)/layout.tsx — authenticated, hotel header rendered there.
 *
 * Renders the full message thread for a single conversation, ordered
 * chronologically. Each turn is displayed as a message bubble:
 *   - user role:      left-aligned, muted background
 *   - assistant role: right-aligned, primary background
 *   - tool role:      collapsed/summary view, muted small text
 *
 * Timestamps are formatted in the hotel's local timezone.
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-03-PLAN.md
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ConversationTurn, Hotel } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatInHotelTz } from '@/lib/timezone'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Attempt to pretty-print JSON content for tool turns.
 * Returns a truncated summary string on failure.
 */
function summariseToolContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown
    const str = JSON.stringify(parsed, null, 2)
    return str.length > 300 ? str.slice(0, 300) + '\n…' : str
  } catch {
    return content.slice(0, 300)
  }
}

// =============================================================================
// Page
// =============================================================================

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { conversationId: encodedId } = await params
  const conversationId = decodeURIComponent(encodedId)

  // Load hotel for timezone display
  const { data: hotel } = await supabase
    .from('hotels')
    .select('timezone')
    .single() as { data: Pick<Hotel, 'timezone'> | null }

  const hotelTimezone = hotel?.timezone ?? 'UTC'

  // Fetch all turns for this conversation, oldest first.
  // RLS scopes to user's hotel_id from JWT.
  const { data: turns, error } = await (supabase as unknown as SupabaseClient)
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .returns<ConversationTurn[]>()

  if (error) {
    console.error('[conversation-detail] Failed to fetch turns:', error.message)
  }

  const turnList: ConversationTurn[] = turns ?? []

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back navigation */}
      <div>
        <Link
          href="/conversations"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          &larr; Back to Conversations
        </Link>
      </div>

      {/* Conversation metadata header */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Conversation Thread</h1>
        <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
            {conversationId}
          </span>
          <Badge variant="secondary">
            {turnList.length} {turnList.length === 1 ? 'message' : 'messages'}
          </Badge>
        </div>
      </div>

      {turnList.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No messages found for this conversation.
          </CardContent>
        </Card>
      )}

      {/* Message thread */}
      <div className="space-y-3">
        {turnList.map((turn) => {
          // Tool turns: collapsed summary view
          if (turn.role === 'tool') {
            return (
              <div key={turn.id} className="flex justify-center">
                <div className="max-w-lg w-full">
                  <details className="bg-muted/40 border border-border rounded-md px-3 py-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none font-medium">
                      Tool result — {formatInHotelTz(turn.created_at, hotelTimezone, 'HH:mm')}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs">
                      {summariseToolContent(turn.content)}
                    </pre>
                  </details>
                </div>
              </div>
            )
          }

          const isUser = turn.role === 'user'
          const isAssistant = turn.role === 'assistant'

          return (
            <div
              key={turn.id}
              className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}
            >
              <div className={`max-w-[75%] space-y-1 ${isUser ? '' : 'items-end flex flex-col'}`}>
                {/* Bubble */}
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm ${
                    isUser
                      ? 'bg-muted text-foreground rounded-tl-sm'
                      : isAssistant
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{turn.content}</p>
                </div>
                {/* Timestamp */}
                <span className="text-xs text-muted-foreground px-1">
                  {formatInHotelTz(turn.created_at, hotelTimezone, 'dd MMM HH:mm')}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
