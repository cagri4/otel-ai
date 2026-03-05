'use server'

/**
 * Server Actions for the onboarding wizard.
 *
 * Called by: OnboardingWizard component (src/components/knowledge/OnboardingWizard.tsx)
 *
 * Flow:
 * 1. Authenticate user via supabase.auth.getUser()
 * 2. Get hotel via RLS-scoped query (returns only user's hotel)
 * 3. Validate and update hotel fields
 * 4. Set onboarding_completed_at when city is provided (wizard step 1 complete)
 * 5. Revalidate cached paths for immediate UI update
 *
 * Design: Follows the same pattern as settings/actions.ts — explicit hotel id
 * from prior SELECT, then RLS-scoped UPDATE for belt-and-suspenders isolation.
 *
 * Source: .planning/phases/03-knowledge-base-and-onboarding/03-03-PLAN.md
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface OnboardingStepState {
  success?: boolean
  error?: string
}

/**
 * Complete an onboarding step by saving hotel details.
 *
 * Accepts all fields from both step 0 (hotel name) and step 1 (city, country,
 * contact info). Sets onboarding_completed_at when city is provided, marking
 * the onboarding wizard as complete.
 */
export async function completeOnboardingStep(
  formData: FormData
): Promise<OnboardingStepState> {
  const supabase = await createClient()

  // 1. Verify authentication
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  // 2. Get hotel id — RLS scopes this to the authenticated user's hotel only
  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('id')
    .single() as { data: { id: string } | null; error: Error | null }

  if (hotelError || !hotel) {
    return { error: 'Hotel not found' }
  }

  // 3. Parse form fields
  const name = (formData.get('name') as string | null)?.trim() ?? ''
  const city = (formData.get('city') as string | null)?.trim() ?? ''
  const country = (formData.get('country') as string | null)?.trim() ?? ''
  const contact_email = (formData.get('contact_email') as string | null)?.trim() ?? ''
  const contact_phone = (formData.get('contact_phone') as string | null)?.trim() ?? ''

  // 4. Validate required fields
  if (name.length < 2) {
    return { error: 'Hotel name must be at least 2 characters' }
  }
  if (city.length > 0 && city.length < 2) {
    return { error: 'City must be at least 2 characters' }
  }

  // 5. Build update payload — only include non-empty optional fields
  const updatePayload: Record<string, unknown> = {
    name,
    updated_at: new Date().toISOString(),
  }

  if (city) updatePayload.city = city
  if (country) updatePayload.country = country
  if (contact_email) updatePayload.contact_email = contact_email
  if (contact_phone) updatePayload.contact_phone = contact_phone

  // Mark onboarding complete when city is provided (step 1 submitted)
  if (city) {
    updatePayload.onboarding_completed_at = new Date().toISOString()
  }

  // 6. Update the hotel record
  const { error: updateError } = await (supabase
    .from('hotels') as ReturnType<typeof supabase.from>)
    .update(updatePayload as Record<string, unknown>)
    .eq('id', hotel.id)

  if (updateError) {
    return { error: updateError.message }
  }

  // 7. Revalidate cached paths so UI immediately reflects the changes
  revalidatePath('/')
  revalidatePath('/onboarding')

  return { success: true }
}

/**
 * Skip the onboarding wizard by setting onboarding_completed_at without
 * requiring any hotel detail fields to be filled.
 */
export async function skipOnboarding(): Promise<OnboardingStepState> {
  const supabase = await createClient()

  // 1. Verify authentication
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  // 2. Get hotel id — RLS scopes this to the authenticated user's hotel only
  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('id')
    .single() as { data: { id: string } | null; error: Error | null }

  if (hotelError || !hotel) {
    return { error: 'Hotel not found' }
  }

  // 3. Set onboarding_completed_at to mark as skipped/done
  const { error: updateError } = await (supabase
    .from('hotels') as ReturnType<typeof supabase.from>)
    .update({
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', hotel.id)

  if (updateError) {
    return { error: updateError.message }
  }

  revalidatePath('/')

  return { success: true }
}
