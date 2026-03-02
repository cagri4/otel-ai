/**
 * Login page.
 *
 * Route: /login
 * Layout: (auth)/layout.tsx — centered card
 */
import { LoginForm } from '@/components/forms/login-form'

export const metadata = {
  title: 'Sign in — OtelAI',
}

export default function LoginPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to your hotel dashboard
        </p>
      </div>
      <LoginForm />
    </div>
  )
}
