/**
 * SSE streaming endpoint for the Front Desk AI agent.
 *
 * POST /api/agent/stream — Streams a Claude response via Server-Sent Events.
 * GET  /api/agent/stream — Returns conversation history (for UI hydration on mount).
 *
 * Runtime choice: Node.js (not Edge).
 * Per research pitfall 4: Edge runtime breaks @supabase/ssr cookie-based auth.
 *
 * Fire-and-forget pattern (pitfall 1):
 * invokeAgent() is NOT awaited inside the ReadableStream start() callback.
 * Awaiting it would buffer the entire response before sending.
 * Instead, tokens are pushed via the onToken callback as they arrive.
 *
 * SSE heartbeat (pitfall 3):
 * A 15-second ping interval prevents proxy/load-balancer timeouts on
 * Vercel deployments where responses take > 30s for complex tool chains.
 *
 * Conversation ID:
 * If not provided, defaults to `${hotelId}_owner_chat` — one persistent
 * conversation per hotel owner (per research recommendation).
 *
 * Source: .planning/phases/02-agent-core/02-04-PLAN.md
 * Research: .planning/phases/02-agent-core/02-RESEARCH.md
 */

import { invokeAgent } from '@/lib/agents/invokeAgent';
import { AgentRole } from '@/lib/agents/types';
import { createClient } from '@/lib/supabase/server';
import type { Hotel } from '@/types/database';

// =============================================================================
// Route Config
// =============================================================================

export const runtime = 'nodejs';
export const maxDuration = 60; // 60s on Vercel Pro — sufficient for Claude responses
export const dynamic = 'force-dynamic';

// =============================================================================
// POST — SSE Streaming Chat
// =============================================================================

/**
 * Handles a new chat message and streams the agent response via SSE.
 *
 * Request body: { message: string, conversationId?: string }
 * Response: SSE stream with events:
 *   data: { type: "token", token: string }
 *   data: { type: "done" }
 *   data: { type: "error", message: string }
 *   event: ping\ndata: keep-alive (heartbeat)
 */
export async function POST(req: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Step 1: Authenticate
  // ---------------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------------------------------------------------------------------------
  // Step 2: Get hotel_id via RLS-scoped query
  // select('*') avoids postgrest-js v12 partial-select type narrowing issue.
  // Dashboard layout uses the same pattern (select('*') + cast to Hotel).
  // ---------------------------------------------------------------------------
  const { data: hotelData, error: hotelError } = await supabase
    .from('hotels')
    .select('*')
    .single();

  const hotel = hotelData as Hotel | null;

  if (hotelError || !hotel) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------------------------------------------------------------------------
  // Step 3: Parse and validate request body
  // ---------------------------------------------------------------------------
  let message: string;
  let conversationId: string | undefined;
  let roleStr: string | undefined;

  try {
    const body = await req.json();
    message = body.message;
    conversationId = body.conversationId;
    roleStr = body.role;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Resolve role from request body — defaults to FRONT_DESK for backward compatibility.
  // Accepts "guest_experience" to route to the Guest Experience AI.
  // Accepts "booking_ai" to route to the Booking AI (Phase 7).
  // Accepts "housekeeping_coordinator" to route to the Housekeeping Coordinator (Phase 8).
  const role =
    roleStr === 'guest_experience'
      ? AgentRole.GUEST_EXPERIENCE
      : roleStr === 'booking_ai'
        ? AgentRole.BOOKING_AI
        : roleStr === 'housekeeping_coordinator'
          ? AgentRole.HOUSEKEEPING_COORDINATOR
          : AgentRole.FRONT_DESK;

  // One persistent conversation per hotel owner if no conversationId provided
  const effectiveConversationId =
    conversationId && conversationId.trim() !== ''
      ? conversationId
      : `${hotel.id}_owner_chat`;

  // ---------------------------------------------------------------------------
  // Step 4: Create ReadableStream with SSE encoding
  // ---------------------------------------------------------------------------
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Heartbeat every 15s to prevent proxy/load-balancer timeout
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: keep-alive\n\n`));
      }, 15_000);

      // Clean up on client disconnect / abort
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        controller.close();
      });

      // CRITICAL: Fire-and-forget — do NOT await here (pitfall 1).
      // Awaiting inside start() would block the stream from being returned.
      // Tokens are pushed via onToken callback as they arrive from Claude.
      invokeAgent({
        role,
        userMessage: message.trim(),
        conversationId: effectiveConversationId,
        hotelId: hotel.id,
        onToken: (token) => send({ type: 'token', token }),
      })
        .then(() => send({ type: 'done' }))
        .catch((err) =>
          send({
            type: 'error',
            message: err instanceof Error ? err.message : 'Unknown error',
          }),
        )
        .finally(() => {
          clearInterval(heartbeat);
          controller.close();
        });
    },
  });

  // ---------------------------------------------------------------------------
  // Step 5: Return SSE response
  // ---------------------------------------------------------------------------
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// =============================================================================
// GET — Conversation History (UI hydration)
// =============================================================================

/**
 * Returns conversation history for a given conversationId.
 *
 * Query params: conversationId (optional, defaults to `${hotelId}_owner_chat`)
 *
 * Response: JSON array of { id, role, content, created_at } objects.
 * Filters to user/assistant turns only (no tool turns for display).
 */
export async function GET(req: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Authenticate
  // ---------------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------------------------------------------------------------------------
  // Get hotel_id — same select('*') pattern as POST handler.
  // ---------------------------------------------------------------------------
  const { data: hotelData, error: hotelError } = await supabase
    .from('hotels')
    .select('*')
    .single();

  const hotel = hotelData as Hotel | null;

  if (hotelError || !hotel) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------------------------------------------------------------------------
  // Extract conversationId from query params
  // ---------------------------------------------------------------------------
  const url = new URL(req.url);
  const conversationId =
    url.searchParams.get('conversationId') ?? `${hotel.id}_owner_chat`;

  // ---------------------------------------------------------------------------
  // Load conversation turns and filter to display-only rows
  // ---------------------------------------------------------------------------
  try {
    // Use raw Supabase query for display-only rows (loadConversationTurns returns MessageParam[])
    // .returns<> required for partial selects with manual Database types.
    const { data, error } = await supabase
      .from('conversation_turns')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: true })
      .limit(50)
      .returns<Array<{ id: string; role: string; content: string; created_at: string }>>();

    if (error) {
      throw new Error(error.message);
    }

    // Filter assistant turns with JSON content (tool_use blocks) — not displayable
    const displayTurns = (data ?? []).filter((row) => {
      if (row.role === 'assistant') {
        try {
          const parsed = JSON.parse(row.content);
          // If it parsed as an array, it's a tool_use block — skip for display
          return !Array.isArray(parsed);
        } catch {
          return true; // Plain text — display it
        }
      }
      return true; // User turns always displayed
    });

    return new Response(JSON.stringify(displayTurns), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Failed to load history',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
