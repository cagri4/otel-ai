/**
 * iyzico checkout form callback redirect handler.
 *
 * GET /api/billing/iyzico/callback
 *
 * iyzico redirects the browser here after the user completes (or abandons)
 * the hosted checkout form. This route inspects the query params and redirects
 * to the billing page with a status indicator.
 *
 * iyzico passes:
 *   ?token=...               — checkout form token
 *   &status=success|failure  — result of the form submission
 *
 * Redirect targets:
 *   success           → /billing?status=success
 *   failure           → /billing?status=failed&error=payment_failed
 *   token_expired     → /billing?status=failed&error=token_expired
 *
 * Note: Actual subscription state is driven by webhooks (POST /api/webhooks/iyzico).
 * This callback only handles the user-facing redirect — do NOT use it as the
 * source of truth for subscription activation.
 *
 * Source: .planning/phases/06-billing/06-02-PLAN.md
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const token = url.searchParams.get('token');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  // If no token, something unexpected happened
  if (!token) {
    return NextResponse.redirect(`${baseUrl}/billing?status=failed&error=payment_failed`);
  }

  // iyzico may pass "failure" with error details in query params
  if (status === 'failure' || status === 'failed') {
    return NextResponse.redirect(`${baseUrl}/billing?status=failed&error=payment_failed`);
  }

  // Check for token expiry indicator
  // iyzico may pass additional params indicating token expiry
  const errorCode = url.searchParams.get('errorCode') ?? url.searchParams.get('error_code');
  if (errorCode === '10012' || errorCode === 'token_expired') {
    // 10012 is iyzico's token-expired error code
    return NextResponse.redirect(`${baseUrl}/billing?status=failed&error=token_expired`);
  }

  // Success or unknown status — assume success and let webhook confirm state
  if (status === 'success') {
    return NextResponse.redirect(`${baseUrl}/billing?status=success`);
  }

  // Fallback for any other status
  return NextResponse.redirect(`${baseUrl}/billing?status=failed&error=payment_failed`);
}
