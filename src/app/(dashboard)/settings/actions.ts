'use server'

/**
 * Server Action for updating hotel settings.
 *
 * Called by: HotelSettingsForm via useActionState (React 19)
 *
 * Flow:
 * 1. Authenticate user via supabase.auth.getUser()
 * 2. Get hotel id via RLS-scoped query (returns only user's hotel)
 * 3. Validate form data with hotelSettingsSchema
 * 4. Update hotels table with validated data
 * 5. Revalidate cached paths for immediate UI update
 *
 * RLS note: The update is scoped via .eq('id', hotel.id) — RLS policies also
 * enforce that the authenticated user can only update their own hotel row.
 * The explicit hotel id from the prior SELECT query is the safest approach.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { hotelSettingsSchema } from '@/lib/validations/hotel'

export interface UpdateHotelSettingsState {
  success?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateHotelSettings(
  prevState: UpdateHotelSettingsState | null,
  formData: FormData
): Promise<UpdateHotelSettingsState> {
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

  // 3. Parse and validate form data
  const raw = Object.fromEntries(formData.entries())
  const parsed = hotelSettingsSchema.safeParse(raw)

  if (!parsed.success) {
    return {
      error: 'Validation failed',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  // 4. Update the hotel record
  const { error: updateError } = await (supabase
    .from('hotels') as ReturnType<typeof supabase.from>)
    .update({
      name: parsed.data.name,
      address: parsed.data.address || null,
      city: parsed.data.city || null,
      country: parsed.data.country || null,
      timezone: parsed.data.timezone,
      contact_email: parsed.data.contactEmail || null,
      contact_phone: parsed.data.contactPhone || null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', hotel.id)

  if (updateError) {
    return { error: updateError.message }
  }

  // 5. Revalidate cached data so the UI immediately reflects the changes
  revalidatePath('/settings')
  revalidatePath('/')

  return { success: true }
}
