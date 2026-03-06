/**
 * Cron route handler for morning briefing dispatch.
 *
 * Fires daily at 08:00 UTC (configured in vercel.json) — after milestone-dispatch
 * (06:00 UTC) and housekeeping-queue (07:00 UTC), before trial-notification (09:00 UTC).
 * Vercel sets the Authorization: Bearer <CRON_SECRET> header on cron invocations.
 *
 * maxDuration = 300: mandatory for batch crons — multiple hotels x multiple bots
 * x 40ms delay between each send requires extended timeout headroom.
 *
 * Source: .planning/phases/13-proactive-messaging-dashboard-readonly/13-01-PLAN.md
 */
import type { NextRequest } from 'next/server';
import { runMorningBriefingDispatch } from '@/lib/cron/morningBriefing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Pro plan: up to 300s for batch processing

export async function GET(request: NextRequest) {
  // Verify CRON_SECRET — Vercel sets Authorization header on cron invocations
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await runMorningBriefingDispatch();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cron/morning-briefing] Fatal error:', message);
    // Return 200 even on error — Vercel cron does not retry on 5xx (only single attempt),
    // but returning 200 keeps the logs clean. Errors are logged for debugging.
    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}
