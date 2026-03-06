/**
 * Admin hotel list page.
 *
 * Server Component — displays all hotels with subscription status badges
 * and a create hotel form.
 *
 * Hotel list uses service client (bypasses RLS) to see all hotels.
 * Status badge logic:
 *   - trialing + trial_ends_at in future → "Trial" (yellow)
 *   - active → "Active" (green)
 *   - no subscription or trial expired → "Expired" (red)
 *
 * Create form calls adminCreateHotel Server Action and redirects to
 * /admin/{hotelId} for immediate bot provisioning.
 *
 * Source: .planning/phases/10-super-admin-panel-and-employee-bots/10-02-PLAN.md
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { adminCreateHotel } from '@/lib/admin/createHotel'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type Subscription = {
  plan_name: string | null
  status: string | null
  trial_ends_at: string | null
}

type HotelRow = {
  id: string
  name: string
  city: string | null
  country: string | null
  created_at: string
  onboarding_completed_at: string | null
  subscriptions: Subscription[]
}

// ─────────────────────────────────────────────
// Status badge helper
// ─────────────────────────────────────────────

function getStatusBadge(hotel: HotelRow): {
  label: string
  className: string
} {
  const sub = hotel.subscriptions?.[0]

  if (!sub) {
    return { label: 'No plan', className: 'bg-gray-100 text-gray-600' }
  }

  if (sub.status === 'active') {
    return { label: 'Active', className: 'bg-green-100 text-green-700' }
  }

  if (sub.status === 'trialing' && sub.trial_ends_at) {
    const trialEnd = new Date(sub.trial_ends_at)
    if (trialEnd > new Date()) {
      return { label: 'Trial', className: 'bg-yellow-100 text-yellow-700' }
    }
    return { label: 'Trial expired', className: 'bg-red-100 text-red-700' }
  }

  return { label: 'Expired', className: 'bg-red-100 text-red-700' }
}

// ─────────────────────────────────────────────
// Server Action wrapper — handles redirect after creation
// ─────────────────────────────────────────────

async function handleCreateHotel(formData: FormData) {
  'use server'

  const hotelName = formData.get('hotelName') as string
  const ownerEmail = formData.get('ownerEmail') as string
  const ownerPassword = formData.get('ownerPassword') as string

  if (!hotelName?.trim() || !ownerEmail?.trim() || !ownerPassword?.trim()) {
    // Redirect with error — simple approach for admin-only form
    redirect('/admin?error=All+fields+are+required')
  }

  const result = await adminCreateHotel({
    hotelName: hotelName.trim(),
    ownerEmail: ownerEmail.trim(),
    ownerPassword: ownerPassword.trim(),
  })

  if ('error' in result) {
    const encodedError = encodeURIComponent(result.error)
    redirect(`/admin?error=${encodedError}`)
  }

  revalidatePath('/admin')
  redirect(`/admin/${result.hotelId}`)
}

// ─────────────────────────────────────────────
// Page component
// ─────────────────────────────────────────────

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const supabase = createServiceClient()
  const resolvedParams = await searchParams

  // Query all hotels with subscription data — service client bypasses RLS
  const { data: hotels } = await (supabase as unknown as SupabaseClient)
    .from('hotels')
    .select(
      'id, name, city, country, created_at, onboarding_completed_at, subscriptions(plan_name, status, trial_ends_at)',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  const hotelList = (hotels as HotelRow[] | null) ?? []

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Hotels</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {hotelList.length} hotel{hotelList.length !== 1 ? 's' : ''} registered
        </p>
      </div>

      {/* Error message */}
      {resolvedParams.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(resolvedParams.error)}
        </div>
      )}

      {/* Hotel list */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {hotelList.length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground text-sm">
            No hotels yet. Create the first one below.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Hotel
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Location
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Created
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Onboarded
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {hotelList.map((hotel) => {
                const badge = getStatusBadge(hotel)
                const createdAt = new Date(hotel.created_at).toLocaleDateString(
                  'en-GB',
                  { day: '2-digit', month: 'short', year: 'numeric' },
                )
                return (
                  <tr
                    key={hotel.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">{hotel.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {hotel.city && hotel.country
                        ? `${hotel.city}, ${hotel.country}`
                        : hotel.city || hotel.country || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {createdAt}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {hotel.onboarding_completed_at ? (
                        <span className="text-green-600">Done</span>
                      ) : (
                        <span className="text-yellow-600">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/admin/${hotel.id}`}
                        className="text-primary hover:underline text-xs font-medium"
                      >
                        Manage
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create hotel form */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Create New Hotel</h2>
        <form action={handleCreateHotel} className="space-y-4 max-w-md">
          <div>
            <label
              htmlFor="hotelName"
              className="block text-sm font-medium mb-1"
            >
              Hotel Name
            </label>
            <input
              id="hotelName"
              name="hotelName"
              type="text"
              required
              placeholder="Grand Hotel Istanbul"
              className="w-full rounded-md border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="ownerEmail"
              className="block text-sm font-medium mb-1"
            >
              Owner Email
            </label>
            <input
              id="ownerEmail"
              name="ownerEmail"
              type="email"
              required
              placeholder="owner@grandhotel.com"
              className="w-full rounded-md border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="ownerPassword"
              className="block text-sm font-medium mb-1"
            >
              Temporary Password
            </label>
            <input
              id="ownerPassword"
              name="ownerPassword"
              type="text"
              required
              placeholder="Temporary password for first login"
              className="w-full rounded-md border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Owner should change this on first login.
            </p>
          </div>

          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Create Hotel
          </button>
        </form>
      </div>
    </div>
  )
}
