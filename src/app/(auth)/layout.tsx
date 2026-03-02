/**
 * Auth route group layout.
 *
 * Centered card layout for login and signup pages.
 * No session check needed here — middleware handles redirecting
 * authenticated users away from auth routes.
 *
 * Route group: (auth) — parentheses mean this doesn't affect the URL path.
 * /login and /signup render directly without an /auth/ prefix.
 */
import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardContent className="pt-6">{children}</CardContent>
        </Card>
      </div>
    </div>
  )
}
