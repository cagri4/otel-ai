/**
 * Dashboard route group layout.
 *
 * Server Component — validates session and loads hotel data server-side.
 *
 * Belt-and-suspenders with middleware:
 * - Middleware redirects unauthenticated users to /login (fast, edge)
 * - This layout double-checks with getUser() server-side (secure)
 *
 * Pattern: getUser() not getSession() — getUser() validates JWT against
 * Supabase auth server; getSession() reads cookie without validation.
 *
 * Route group: (dashboard) — parentheses mean this doesn't affect URL paths.
 * / renders as the dashboard home without a /dashboard/ prefix.
 */
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/dashboard/sign-out-button'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { EscalationNotificationProvider } from '@/components/dashboard/EscalationNotificationProvider'
import { Toaster } from 'sonner'
import type { Hotel } from '@/types/database'

// Force dynamic rendering — this layout calls supabase.auth.getUser() which
// requires real request context (cookies). Static prerendering at build time
// has no session, causing Server Component render errors.
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const supabase = await createClient()

  // Server-side session validation — belt-and-suspenders with middleware
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Load hotel data — RLS policy automatically scopes to user's hotel_id from JWT
  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('*')
    .single()

  if (hotelError || !hotel) {
    // This can happen if:
    // 1. The DB trigger (handle_new_user) failed during signup
    // 2. The JWT hotel_id claim is not yet set (first request after signup
    //    before refreshSession() completes)
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-xl font-semibold">Hotel setup incomplete</h1>
          <p className="text-sm text-muted-foreground">
            Your hotel account could not be loaded. This can happen on the
            first login if setup is still in progress. Please try refreshing
            the page.
          </p>
          <SignOutButton />
        </div>
      </div>
    )
  }

  const typedHotel = hotel as Hotel

  return (
    <div className="min-h-screen bg-background">
      {/* Onboarding banner — shown on non-root routes when setup is incomplete */}
      {!typedHotel.onboarding_completed_at && (
        <div className="bg-primary text-primary-foreground px-4 py-3 text-center text-sm">
          <a href="/onboarding" className="underline font-medium">
            Complete your hotel setup
          </a>{' '}
          to get the most out of your AI staff.
        </div>
      )}

      {/* Telegram-first banner — shown when hotel has completed Telegram onboarding */}
      {typedHotel.owner_telegram_chat_id && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-center text-sm text-blue-700">
          Your primary interface is now Telegram. This dashboard shows your conversation
          history and hotel configuration as a readonly view.
        </div>
      )}

      {/* Top header */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <span className="font-semibold text-sm">OtelAI</span>
              <span className="text-muted-foreground text-sm ml-2">
                — {(hotel as Hotel).name}
              </span>
            </div>
            {/* Navigation links */}
            <nav className="flex items-center gap-4">
              <a
                href="/"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Dashboard
              </a>
              <a
                href="/desk"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Front Desk
              </a>
              <a
                href="/guest-experience"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Guest Experience
              </a>
              <a
                href="/knowledge"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Knowledge
              </a>
              <a
                href="/employees"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Employees
              </a>
              <a
                href="/billing"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Billing
              </a>
              <a
                href="/conversations"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Conversations
              </a>
              <a
                href="/audit"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Audit Log
              </a>
              <a
                href="/settings"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Settings
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Main content — wrapped with EscalationNotificationProvider for real-time toast alerts */}
      <EscalationNotificationProvider hotelId={typedHotel.id}>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </EscalationNotificationProvider>

      {/* Toaster — renders sonner toast notifications. Placed outside provider but inside layout. */}
      <Toaster position="top-right" richColors />
    </div>
  )
}
