/**
 * Hotel settings page.
 *
 * Route: /settings
 * Layout: (dashboard)/layout.tsx — authenticated, hotel data loaded in header
 *
 * Server Component — fetches the current hotel data and renders the
 * pre-populated settings form. RLS policy ensures only the authenticated
 * user's hotel is returned.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HotelSettingsForm } from '@/components/forms/hotel-settings-form'
import type { Hotel } from '@/types/database'

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Load hotel — RLS scopes to user's hotel_id from JWT
  const { data: hotel, error } = await supabase
    .from('hotels')
    .select('*')
    .single<Hotel>()

  if (error || !hotel) {
    redirect('/')
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Hotel Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your hotel&apos;s basic information
        </p>
      </div>

      {/* Settings form — pre-populated with current hotel data */}
      <div className="max-w-2xl">
        <HotelSettingsForm hotel={hotel} />
      </div>
    </div>
  )
}
