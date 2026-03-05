'use client'

/**
 * OnboardingWizard — 2-step setup wizard for new hotel owners.
 *
 * Gets hotel owners to their first AI conversation in under 2 minutes.
 *
 * Steps:
 *   0: Welcome — confirm hotel name, intro copy
 *   1: Details — city (required), country, contact email/phone
 *   2: Complete — success screen, auto-redirect to /desk
 *
 * Server Actions:
 *   - completeOnboardingStep: saves fields, sets onboarding_completed_at when city provided
 *   - skipOnboarding: sets onboarding_completed_at immediately, no fields required
 *
 * Source: .planning/phases/03-knowledge-base-and-onboarding/03-03-PLAN.md
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { completeOnboardingStep, skipOnboarding } from '@/lib/actions/onboarding'
import type { Hotel } from '@/types/database'

interface OnboardingWizardProps {
  hotel: Hotel
}

export function OnboardingWizard({ hotel }: OnboardingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Preserve hotel name entered in step 0 so it's included in step 1 submission
  const [hotelName, setHotelName] = useState(hotel.name ?? '')

  // Auto-redirect on completion step
  useEffect(() => {
    if (step === 2) {
      const timer = setTimeout(() => {
        router.push('/desk')
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [step, router])

  // --- Skip handler ---
  async function handleSkip() {
    setIsSubmitting(true)
    setError(null)
    const result = await skipOnboarding()
    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }
    router.push('/')
  }

  // --- Step 1 submit handler ---
  const formRef = useRef<HTMLFormElement>(null)

  async function handleCompleteSetup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    // Include hotel name from step 0 state
    formData.set('name', hotelName)

    const result = await completeOnboardingStep(formData)
    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }
    setIsSubmitting(false)
    setStep(2)
  }

  // Progress: 0 steps = 0%, 1 step = 50%, 2 steps = 100%
  const progressValue = Math.round((step / 2) * 100)

  return (
    <div className="w-full max-w-lg space-y-6 py-6">
      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Setup progress</span>
          <span>{progressValue}%</span>
        </div>
        <Progress value={progressValue} className="h-2" />
      </div>

      {/* Step 0: Welcome */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Welcome to OtelAI</CardTitle>
            <p className="text-muted-foreground text-sm">
              Let&apos;s get your AI staff ready in under 2 minutes.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="hotel-name">Hotel name</Label>
              <Input
                id="hotel-name"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                placeholder="Your hotel name"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                This is how your AI staff will refer to your property.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleSkip}
                disabled={isSubmitting}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
              <Button
                onClick={() => {
                  if (hotelName.trim().length < 2) {
                    setError('Hotel name must be at least 2 characters')
                    return
                  }
                  setError(null)
                  setStep(1)
                }}
                disabled={isSubmitting}
              >
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Hotel Details */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Hotel details</CardTitle>
            <p className="text-muted-foreground text-sm">
              Help your AI staff answer location and contact questions accurately.
            </p>
          </CardHeader>
          <CardContent>
            <form ref={formRef} onSubmit={handleCompleteSetup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="city">
                  City <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="city"
                  name="city"
                  defaultValue={hotel.city ?? ''}
                  placeholder="e.g. Istanbul"
                  required
                  minLength={2}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  name="country"
                  defaultValue={hotel.country ?? ''}
                  placeholder="e.g. Turkey"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact_email">Contact email</Label>
                <Input
                  id="contact_email"
                  name="contact_email"
                  type="email"
                  defaultValue={hotel.contact_email ?? ''}
                  placeholder="info@yourhotel.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact_phone">Contact phone</Label>
                <Input
                  id="contact_phone"
                  name="contact_phone"
                  defaultValue={hotel.contact_phone ?? ''}
                  placeholder="+90 212 000 0000"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setError(null)
                      setStep(0)
                    }}
                    disabled={isSubmitting}
                  >
                    Back
                  </Button>
                  <button
                    type="button"
                    onClick={handleSkip}
                    disabled={isSubmitting}
                    className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors disabled:opacity-50"
                  >
                    Skip for now
                  </button>
                </div>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Complete Setup'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Complete */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Your AI Staff is Ready!</CardTitle>
            <p className="text-muted-foreground text-sm">
              Your Front Desk AI is now online with default hotel policies. You can
              customize the knowledge base anytime.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Checklist */}
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span className="text-green-600 font-bold">&#10003;</span>
                Default hotel policies seeded
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-600 font-bold">&#10003;</span>
                Default room created
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-600 font-bold">&#10003;</span>
                Front Desk AI ready for guests
              </li>
            </ul>

            <p className="text-xs text-muted-foreground">
              Redirecting you to the Front Desk in a moment...
            </p>

            <Button onClick={() => router.push('/desk')} className="w-full">
              Go to Front Desk
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
