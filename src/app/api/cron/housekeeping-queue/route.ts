/**
 * Cron route handler for daily housekeeping priority queue generation.
 *
 * Fires daily at 07:00 UTC (configured in vercel.json).
 * Vercel sets the Authorization: Bearer <CRON_SECRET> header on cron invocations.
 *
 * Source: .planning/phases/08-housekeeping-coordinator/08-02-PLAN.md
 */
import type { NextRequest } from 'next/server';
import { runHousekeepingQueue } from '@/lib/cron/housekeepingQueue';

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
    const result = await runHousekeepingQueue();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cron/housekeeping-queue] Fatal error:', message);
    // Return 200 even on error — consistent with milestone-dispatch cron pattern.
    // Errors are logged for debugging; 200 prevents noisy Vercel cron failure alerts.
    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}
