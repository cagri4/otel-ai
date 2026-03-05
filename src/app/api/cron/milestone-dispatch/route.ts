/**
 * Cron route handler for milestone message dispatch.
 *
 * Fires daily at 06:00 UTC (configured in vercel.json).
 * Vercel sets the Authorization: Bearer <CRON_SECRET> header on cron invocations.
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-02-PLAN.md
 */
import type { NextRequest } from 'next/server';
import { runMilestoneDispatch } from '@/lib/cron/milestoneDispatch';

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
    const result = await runMilestoneDispatch();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cron/milestone-dispatch] Fatal error:', message);
    // Return 200 even on error — Vercel cron does not retry on 5xx (only single attempt),
    // but returning 200 keeps the logs clean. Errors are logged for debugging.
    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}
