/**
 * Billing dashboard page — Server Component.
 *
 * Route: /billing
 * Layout: (dashboard)/layout.tsx — authenticated, hotel header rendered there.
 *
 * Loads subscription status and hotel data server-side, passes to BillingClient.
 * Handles status URL params for payment result banners:
 *   ?status=success  — payment completed successfully
 *   ?status=failed   — payment failed
 *   ?status=pending  — payment pending (Mollie redirect after first payment)
 *
 * Pattern: Same Server + Client Component split as other dashboard pages.
 *
 * Source: .planning/phases/06-billing/06-04-PLAN.md
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSubscriptionStatus } from '@/lib/billing/trialStatus'
import { getProviderForHotel } from '@/lib/billing/plans'
import type { Hotel } from '@/types/database'
import { BillingClient } from './BillingClient'

interface BillingPageProps {
  searchParams: Promise<{ status?: string }>
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const supabase = await createClient()

  // Auth guard — belt-and-suspenders with middleware
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Load hotel data — RLS policy automatically scopes to user's hotel_id from JWT
  const { data: hotelData, error: hotelError } = await supabase
    .from('hotels')
    .select('*')
    .single()

  const hotel = hotelData as Hotel | null

  if (hotelError || !hotel) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Unable to load hotel data. Please refresh the page.
        </div>
      </div>
    )
  }

  // Load subscription status
  const subscriptionInfo = await getSubscriptionStatus(hotel.id)

  // Determine payment provider based on hotel country
  const provider = getProviderForHotel(hotel.country ?? null)

  // Resolve search params
  const params = await searchParams
  const statusParam = params.status

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your subscription plan and billing details.
        </p>
      </div>

      {/* Status banners from payment redirect */}
      {statusParam === 'success' && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Payment successful! Your subscription has been activated. It may take a few minutes to
          reflect.
        </div>
      )}
      {statusParam === 'failed' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Payment failed. Please try again or contact support.
        </div>
      )}
      {statusParam === 'pending' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Your payment is being processed. Your subscription will activate once confirmed. This
          usually takes a few minutes.
        </div>
      )}

      {/* Client component for interactive billing UI */}
      <BillingClient
        subscriptionInfo={subscriptionInfo}
        provider={provider}
        hotelCountry={hotel.country ?? ''}
        hotelId={hotel.id}
      />
    </div>
  )
}
