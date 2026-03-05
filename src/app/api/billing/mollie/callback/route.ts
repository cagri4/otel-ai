/**
 * Mollie payment callback endpoint (redirect URL).
 *
 * GET /api/billing/mollie/callback
 *
 * This is the redirectUrl that Mollie sends the customer back to after completing
 * (or abandoning) the payment on Mollie's hosted payment page.
 *
 * IMPORTANT: This endpoint does NOT determine payment success.
 * Payment status is authoritative only via the Mollie webhook (/api/webhooks/mollie).
 * The webhook fetches the actual status from Mollie API and updates the DB.
 *
 * All we do here is redirect to the billing dashboard with a 'pending' status
 * so the UI can show "Payment being verified" while the webhook processes.
 *
 * Source: .planning/phases/06-billing/06-03-PLAN.md
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET(): Response {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return NextResponse.redirect(`${appUrl}/billing?status=pending`, { status: 302 });
}
