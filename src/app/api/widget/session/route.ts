/**
 * POST /api/widget/session — Resolves hotel from widget_token and creates a conversation session.
 *
 * This is the first request the ChatWidget makes on mount. It takes the widget_token
 * from the URL (passed as `token` in the request body), looks up the hotel, and returns
 * a conversationId + Realtime channel name for the widget to use.
 *
 * Security:
 * - Uses service-role client to query hotels by widget_token (no user session available)
 * - Returns 404 for invalid tokens (no hotel data is revealed on failure)
 * - conversationId format: widget_{hotelId}_{uuid} — hotelId parsed server-side from this
 *   on subsequent /api/widget/message requests
 *
 * Source: .planning/phases/04-guest-facing-layer/04-03-PLAN.md
 */

import { createServiceClient } from '@/lib/supabase/service';
import type { Hotel, WidgetConfig } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resolves hotel by widget token and creates a new conversation session.
 *
 * Request body: { token: string }
 * Response: { conversationId, hotelId, hotelName, widgetConfig, channel }
 */
export async function POST(req: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Step 1: Parse and validate request body
  // ---------------------------------------------------------------------------
  let token: string;

  try {
    const body = await req.json();
    token = body.token;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!token || typeof token !== 'string' || token.trim() === '') {
    return Response.json({ error: 'token is required' }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Step 2: Look up hotel by widget_token using service-role client
  // Service role bypasses RLS — required because there is no user session
  // ---------------------------------------------------------------------------
  const supabase = createServiceClient();

  // select('*') + cast avoids postgrest-js v12 partial-select type narrowing issue
  // (same pattern used in /api/agent/stream and dashboard layout)
  const { data: rawHotelData, error } = await supabase
    .from('hotels')
    .select('*')
    .eq('widget_token', token.trim())
    .single();

  const hotelData = rawHotelData as Hotel | null;

  if (error || !hotelData) {
    return Response.json({ error: 'Invalid widget token' }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // Step 3: Generate conversationId
  // Format: widget_{hotelId}_{uuid}
  // This format is parsed server-side by /api/widget/message to extract hotelId
  // — never trust hotelId from the client body.
  // ---------------------------------------------------------------------------
  const conversationId = `widget_${hotelData.id}_${crypto.randomUUID()}`;
  const channel = `widget_responses:${conversationId}`;

  return Response.json({
    conversationId,
    hotelId: hotelData.id,
    hotelName: hotelData.name,
    widgetConfig: (hotelData.widget_config ?? {}) as WidgetConfig,
    channel,
  });
}
