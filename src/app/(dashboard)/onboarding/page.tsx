/**
 * Onboarding page — full-width wizard for new hotel owners.
 *
 * Route: /onboarding
 * Layout: (dashboard)/layout.tsx — authenticated, hotel data loaded
 *
 * Server Component — loads hotel data server-side.
 * - If onboarding_completed_at is not null, redirects to / (already completed)
 * - Otherwise renders OnboardingWizard component
 *
 * The onboarding_completed_at guard here prevents already-completed users
 * from re-entering the wizard if they navigate directly to /onboarding.
 *
 * Source: .planning/phases/03-knowledge-base-and-onboarding/03-03-PLAN.md
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OnboardingWizard } from '@/components/knowledge/OnboardingWizard'
import type { Hotel } from '@/types/database'

export default async function OnboardingPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Load hotel — RLS scopes to user's hotel_id from JWT
  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('*')
    .single<Hotel>()

  if (hotelError || !hotel) {
    redirect('/')
  }

  // Already completed onboarding — redirect to dashboard
  if (hotel.onboarding_completed_at) {
    redirect('/')
  }

  return (
    <div className="min-h-[60vh] flex items-start justify-center pt-8">
      <OnboardingWizard hotel={hotel} />
    </div>
  )
}
