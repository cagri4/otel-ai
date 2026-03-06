/**
 * Admin route group layout.
 *
 * Server Component — validates session and checks SUPER_ADMIN_EMAIL env var.
 *
 * Guard logic:
 * 1. If no authenticated user → redirect to /login
 * 2. If user email does not match SUPER_ADMIN_EMAIL env var → redirect to /
 * 3. Otherwise → render admin UI with minimal header
 *
 * Pattern follows (dashboard)/layout.tsx but uses env var check instead of
 * loading hotel data. Route group (admin) does not affect URL paths.
 *
 * Source: .planning/phases/10-super-admin-panel-and-employee-bots/10-02-PLAN.md
 */
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Force dynamic rendering — requires real request context (cookies)
export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const supabase = await createClient()

  // Server-side session validation
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Super admin guard — only the configured email can access /admin routes
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) {
    redirect('/')
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal admin header — no sidebar, no nav bar */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-sm">OtelAI Admin</span>
            <span className="text-muted-foreground text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full">
              Super Admin
            </span>
          </div>
          <a
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
