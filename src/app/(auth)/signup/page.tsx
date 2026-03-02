/**
 * Signup page.
 *
 * Route: /signup
 * Layout: (auth)/layout.tsx — centered card
 */
import { SignupForm } from '@/components/forms/signup-form'

export const metadata = {
  title: 'Create account — OtelAI',
}

export default function SignupPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Create your hotel account
        </h1>
        <p className="text-sm text-muted-foreground">
          Sign up to get your AI hotel staff
        </p>
      </div>
      <SignupForm />
    </div>
  )
}
