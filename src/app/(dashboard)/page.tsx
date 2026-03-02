/**
 * Dashboard home page.
 *
 * Route: / (root)
 * Layout: (dashboard)/layout.tsx — authenticated, hotel data loaded
 *
 * Server Component — fetches hotel data directly via server Supabase client.
 * RLS policy ensures only the authenticated user's hotel is returned.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Hotel } from '@/types/database'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Load hotel — RLS scopes to user's hotel_id from JWT
  const { data: hotel } = await supabase
    .from('hotels')
    .select('*')
    .single<Hotel>()

  return (
    <div className="space-y-8">
      {/* Welcome heading */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome to {hotel?.name ?? 'your hotel'}
        </h1>
        {hotel?.timezone && hotel.timezone !== 'UTC' && (
          <p className="text-muted-foreground mt-1">
            Timezone: {hotel.timezone}
          </p>
        )}
        {hotel?.timezone === 'UTC' && (
          <p className="text-muted-foreground mt-1 text-sm">
            Timezone: UTC —{' '}
            <a href="/settings" className="text-primary hover:underline">
              configure in settings
            </a>
          </p>
        )}
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">AI Staff</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Configure and deploy your virtual hotel employees.
            </p>
            <p className="text-xs text-muted-foreground mt-2">Coming soon</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversations</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Review guest interactions and messages.
            </p>
            <p className="text-xs text-muted-foreground mt-2">Coming soon</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Configure hotel details, timezone, and contact info.
            </p>
            <a
              href="/settings"
              className="text-sm text-primary hover:underline mt-2 block"
            >
              Go to settings
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
