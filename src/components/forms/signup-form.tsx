'use client'

/**
 * Signup form component.
 *
 * Collects: email, password, hotel name (required), full name (optional)
 *
 * On submit:
 * 1. Calls supabase.auth.signUp() with hotel_name + full_name in metadata
 *    → DB trigger (handle_new_user) atomically creates hotel + profile records
 * 2. Calls supabase.auth.refreshSession() to force new JWT with hotel_id claim
 *    → CRITICAL: the initial JWT at signup time does NOT contain hotel_id
 *    → The refresh triggers the Custom Access Token Hook which injects hotel_id
 *    → Without this refresh, dashboard shows "no hotel found" on first load
 * 3. Redirects to / (dashboard)
 *
 * Source: Pitfall 4 in .planning/phases/01-foundation/01-RESEARCH.md
 */

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { signupSchema, type SignupInput } from '@/lib/validations/auth'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SignupForm() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: '',
      password: '',
      hotelName: '',
      fullName: '',
    },
  })

  const { isSubmitting } = form.formState

  async function onSubmit(values: SignupInput) {
    setServerError(null)
    const supabase = createClient()

    // Step 1: Create account — DB trigger atomically creates hotel + profile
    const { error: signUpError } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: {
          hotel_name: values.hotelName,
          full_name: values.fullName ?? '',
        },
      },
    })

    if (signUpError) {
      setServerError(signUpError.message)
      return
    }

    // Step 2: Force session refresh to get new JWT with hotel_id injected by
    // the Custom Access Token Hook. The initial signup JWT is issued before the
    // DB trigger runs, so hotel_id is not yet in the claims.
    const { error: refreshError } = await supabase.auth.refreshSession()

    if (refreshError) {
      // Non-fatal: user is created, but JWT may not have hotel_id yet.
      // Redirect anyway; the dashboard layout will handle the edge case.
      console.error('Session refresh failed after signup:', refreshError.message)
    }

    // Step 3: Redirect to dashboard
    router.push('/')
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@hotel.com"
                  autoComplete="email"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="hotelName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hotel Name</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder="Grand Hotel Istanbul"
                  autoComplete="organization"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Your Name{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder="Jane Smith"
                  autoComplete="name"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {serverError && (
          <p className="text-sm font-medium text-destructive">{serverError}</p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="text-primary hover:underline font-medium">
            Sign in
          </a>
        </p>
      </form>
    </Form>
  )
}
