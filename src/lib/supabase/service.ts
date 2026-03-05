/**
 * Service-role Supabase client for server-side operations.
 *
 * NEVER expose this client to browser code. Server-only.
 *
 * This client uses the SUPABASE_SERVICE_ROLE_KEY which bypasses Row Level Security.
 * It is used for server-side operations where there is no user session:
 * - Widget API routes: resolving hotel from widget_token
 * - WhatsApp API routes: routing inbound messages to hotels
 *
 * Why service role instead of anon key + RLS bypass:
 * - Widget guests have no auth session, so RLS cannot be enforced by user context
 * - The service role key is safe here because the server validates the widget_token
 *   before returning any hotel data — only valid token holders get a response
 *
 * Source: .planning/phases/04-guest-facing-layer/04-03-PLAN.md
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Creates a service-role Supabase client that bypasses RLS.
 *
 * NEVER expose this client to browser code. Server-only.
 *
 * @returns Supabase client with service role privileges
 */
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
