'use client'

/**
 * BillingClient — interactive billing management component.
 *
 * Handles:
 *   - Current plan display with status badge and trial countdown
 *   - Plan comparison grid (Starter / Pro / Enterprise) with provider-specific prices
 *   - Subscribe flow for trial/expired users:
 *     - iyzico: collects customer data required by Turkish financial regulation, renders form HTML
 *     - Mollie: direct checkout URL redirect
 *   - Upgrade/Downgrade flow for active subscribers:
 *     - iyzico: POST /api/billing/iyzico/upgrade
 *     - Mollie: POST /api/billing/mollie/change-plan
 *
 * Source: .planning/phases/06-billing/06-04-PLAN.md
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SubscriptionInfo } from '@/lib/billing/trialStatus'
import { PLAN_LIMITS, PLAN_PRICES, type PlanName } from '@/lib/billing/plans'

// =============================================================================
// Types
// =============================================================================

interface BillingClientProps {
  subscriptionInfo: SubscriptionInfo
  provider: 'iyzico' | 'mollie'
  hotelCountry: string
  hotelId: string
}

interface IyzicoCustomerForm {
  name: string
  surname: string
  gsmNumber: string
  identityNumber: string
  city: string
  address: string
  country: string
  zipCode: string
}

// =============================================================================
// Constants
// =============================================================================

const PLAN_ORDER: Array<Exclude<PlanName, 'trial'>> = ['starter', 'pro', 'enterprise']

const STATUS_BADGE: Record<
  SubscriptionInfo['status'],
  { label: string; className: string }
> = {
  trialing: { label: 'Free Trial', className: 'bg-blue-100 text-blue-800 border border-blue-200' },
  active: { label: 'Active', className: 'bg-green-100 text-green-800 border border-green-200' },
  past_due: { label: 'Past Due', className: 'bg-red-100 text-red-800 border border-red-200' },
  canceled: { label: 'Canceled', className: 'bg-gray-100 text-gray-700 border border-gray-200' },
  paused: { label: 'Paused', className: 'bg-yellow-100 text-yellow-800 border border-yellow-200' },
}

// =============================================================================
// BillingClient
// =============================================================================

export function BillingClient({
  subscriptionInfo,
  provider,
  hotelCountry,
  hotelId,
}: BillingClientProps) {
  const router = useRouter()

  // Loading + error state per plan card button
  const [loadingPlan, setLoadingPlan] = useState<PlanName | null>(null)
  const [errorByPlan, setErrorByPlan] = useState<Partial<Record<PlanName, string>>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)

  // iyzico checkout form state
  const [showIyzicoForm, setShowIyzicoForm] = useState(false)
  const [targetPlanForIyzico, setTargetPlanForIyzico] = useState<PlanName | null>(null)
  const [iyzicoFormHtml, setIyzicoFormHtml] = useState<string | null>(null)
  const [iyzicoCustomer, setIyzicoCustomer] = useState<IyzicoCustomerForm>({
    name: '',
    surname: '',
    gsmNumber: '',
    identityNumber: '',
    city: '',
    address: '',
    country: hotelCountry || 'TR',
    zipCode: '',
  })

  const { planName, status, trialDaysRemaining, isTrialExpired, maxAgents } = subscriptionInfo

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.trialing
  const isOnTrial = status === 'trialing'
  const isActive = status === 'active'

  // =============================================================================
  // Helpers
  // =============================================================================

  function getPlanDisplayName(p: PlanName): string {
    return PLAN_LIMITS[p].displayName
  }

  function getPlanPrice(p: Exclude<PlanName, 'trial'>): string {
    const prices = PLAN_PRICES[p]
    if (provider === 'iyzico') {
      return `₺${prices.try}/mo`
    }
    return `€${prices.eur}/mo`
  }

  function isCurrentPlan(p: PlanName): boolean {
    // For trial users, no paid plan is current
    if (isOnTrial && !isActive) return false
    return planName === p
  }

  function getButtonLabel(p: PlanName): string {
    if (isCurrentPlan(p)) return 'Current Plan'
    if (!isActive && !isOnTrial) return 'Subscribe'

    if (isOnTrial || isTrialExpired) return 'Subscribe'

    // Active subscriber — determine upgrade vs downgrade
    const currentIdx = PLAN_ORDER.indexOf(planName as Exclude<PlanName, 'trial'>)
    const targetIdx = PLAN_ORDER.indexOf(p as Exclude<PlanName, 'trial'>)
    if (currentIdx === -1 || targetIdx === -1) return 'Subscribe'
    if (targetIdx > currentIdx) return 'Upgrade'
    return 'Downgrade'
  }

  // =============================================================================
  // Actions
  // =============================================================================

  async function handleSubscribeMollie(targetPlan: PlanName) {
    setLoadingPlan(targetPlan)
    setErrorByPlan((prev) => ({ ...prev, [targetPlan]: undefined }))
    setGlobalError(null)

    try {
      const res = await fetch('/api/billing/mollie/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planName: targetPlan }),
      })

      const data = (await res.json()) as { checkoutUrl?: string; error?: string }

      if (!res.ok || !data.checkoutUrl) {
        setErrorByPlan((prev) => ({
          ...prev,
          [targetPlan]: data.error ?? 'Checkout failed. Please try again.',
        }))
        return
      }

      // Redirect to Mollie payment page
      window.location.href = data.checkoutUrl
    } catch {
      setErrorByPlan((prev) => ({
        ...prev,
        [targetPlan]: 'Network error. Please try again.',
      }))
    } finally {
      setLoadingPlan(null)
    }
  }

  function handleSubscribeIyzico(targetPlan: PlanName) {
    // Show the customer data form before proceeding
    setTargetPlanForIyzico(targetPlan)
    setShowIyzicoForm(true)
    setIyzicoFormHtml(null)
    setGlobalError(null)
  }

  async function handleIyzicoFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!targetPlanForIyzico) return

    setLoadingPlan(targetPlanForIyzico)
    setGlobalError(null)

    try {
      const res = await fetch('/api/billing/iyzico/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: targetPlanForIyzico,
          customer: {
            name: iyzicoCustomer.name,
            surname: iyzicoCustomer.surname,
            email: '',
            gsmNumber: iyzicoCustomer.gsmNumber || undefined,
            identityNumber: iyzicoCustomer.identityNumber || undefined,
            billingAddress: {
              contactName: `${iyzicoCustomer.name} ${iyzicoCustomer.surname}`,
              city: iyzicoCustomer.city,
              country: iyzicoCustomer.country,
              address: iyzicoCustomer.address,
              zipCode: iyzicoCustomer.zipCode || undefined,
            },
          },
        }),
      })

      const data = (await res.json()) as {
        checkoutFormContent?: string
        token?: string
        error?: string
      }

      if (!res.ok) {
        setGlobalError(data.error ?? 'Checkout initialization failed. Please try again.')
        return
      }

      if (data.checkoutFormContent) {
        // Render the iyzico checkout form HTML inline
        setIyzicoFormHtml(data.checkoutFormContent)
      } else {
        setGlobalError('No checkout form returned. Please try again.')
      }
    } catch {
      setGlobalError('Network error. Please try again.')
    } finally {
      setLoadingPlan(null)
    }
  }

  async function handleChangePlan(targetPlan: PlanName) {
    setLoadingPlan(targetPlan)
    setErrorByPlan((prev) => ({ ...prev, [targetPlan]: undefined }))
    setGlobalError(null)

    try {
      let res: Response

      if (provider === 'iyzico') {
        res = await fetch('/api/billing/iyzico/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPlanName: targetPlan, upgradePeriod: 'NOW' }),
        })
      } else {
        res = await fetch('/api/billing/mollie/change-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPlanName: targetPlan }),
        })
      }

      const data = (await res.json()) as { error?: string; status?: string }

      if (!res.ok) {
        setErrorByPlan((prev) => ({
          ...prev,
          [targetPlan]: data.error ?? 'Plan change failed. Please try again.',
        }))
        return
      }

      // Success — refresh page to show updated plan
      router.refresh()
    } catch {
      setErrorByPlan((prev) => ({
        ...prev,
        [targetPlan]: 'Network error. Please try again.',
      }))
    } finally {
      setLoadingPlan(null)
    }
  }

  function handlePlanAction(targetPlan: PlanName) {
    if (isCurrentPlan(targetPlan)) return

    const isSubscribeAction = isOnTrial || isTrialExpired || status === 'canceled'

    if (isSubscribeAction) {
      if (provider === 'iyzico') {
        handleSubscribeIyzico(targetPlan)
      } else {
        void handleSubscribeMollie(targetPlan)
      }
    } else {
      void handleChangePlan(targetPlan)
    }
  }

  // =============================================================================
  // Render
  // =============================================================================

  // If we have iyzico form HTML, render it (takes over the page)
  if (iyzicoFormHtml) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Complete Your Payment</h2>
        <p className="text-sm text-muted-foreground">
          Complete your payment details below to activate your subscription.
        </p>
        <div
          className="iyzico-checkout-form"
          dangerouslySetInnerHTML={{ __html: iyzicoFormHtml }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------------ */}
      {/* Section A: Current Plan Card                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Current Plan</h2>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>

        <div className="space-y-2">
          <p className="text-2xl font-bold">{getPlanDisplayName(planName)}</p>
          <p className="text-sm text-muted-foreground">
            Up to {maxAgents} AI agent{maxAgents !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Trial countdown */}
        {isOnTrial && !isTrialExpired && trialDaysRemaining !== null && (
          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {trialDaysRemaining === 0
              ? 'Your free trial expires today.'
              : `${trialDaysRemaining} day${trialDaysRemaining !== 1 ? 's' : ''} remaining in your free trial.`}{' '}
            Subscribe below to continue using AI employees after your trial ends.
          </div>
        )}

        {/* Expired trial banner */}
        {isTrialExpired && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Your free trial has ended.</strong> Subscribe to a plan below to continue using
            AI employees.
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section B: Plan Comparison Grid                                     */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          {isActive ? 'Change Plan' : 'Choose a Plan'}
        </h2>

        {globalError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {globalError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_ORDER.map((plan) => {
            const limits = PLAN_LIMITS[plan]
            const price = getPlanPrice(plan)
            const isCurrent = isCurrentPlan(plan)
            const buttonLabel = getButtonLabel(plan)
            const isLoading = loadingPlan === plan
            const planError = errorByPlan[plan]

            return (
              <div
                key={plan}
                className={`rounded-lg border p-6 flex flex-col gap-4 shadow-sm ${
                  isCurrent
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'bg-card hover:border-muted-foreground/50 transition-colors'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-base">{limits.displayName}</h3>
                    {isCurrent && (
                      <span className="text-xs font-medium text-primary">Current</span>
                    )}
                  </div>
                  <p className="text-2xl font-bold mt-2">{price}</p>
                </div>

                <ul className="space-y-1 text-sm text-muted-foreground flex-1">
                  <li>Up to {limits.maxAgents} AI agent{limits.maxAgents !== 1 ? 's' : ''}</li>
                  <li>All agent types included</li>
                  <li>24/7 guest communication</li>
                </ul>

                {planError && (
                  <p className="text-xs text-red-600 leading-snug">{planError}</p>
                )}

                <button
                  type="button"
                  disabled={isCurrent || isLoading || loadingPlan !== null}
                  onClick={() => handlePlanAction(plan)}
                  className={`w-full rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isCurrent
                      ? 'bg-muted text-muted-foreground cursor-default'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  {isLoading ? 'Processing...' : buttonLabel}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section C: iyzico Customer Data Form (shown when TR user clicks Subscribe) */}
      {/* ------------------------------------------------------------------ */}
      {showIyzicoForm && targetPlanForIyzico && (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Payment Details — {getPlanDisplayName(targetPlanForIyzico)}
            </h2>
            <button
              type="button"
              onClick={() => setShowIyzicoForm(false)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            The following information is required to process your payment through iyzico, as
            required by Turkish financial regulation.
          </p>

          <form onSubmit={(e) => void handleIyzicoFormSubmit(e)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">First Name *</label>
                <input
                  type="text"
                  required
                  value={iyzicoCustomer.name}
                  onChange={(e) =>
                    setIyzicoCustomer((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Last Name *</label>
                <input
                  type="text"
                  required
                  value={iyzicoCustomer.surname}
                  onChange={(e) =>
                    setIyzicoCustomer((prev) => ({ ...prev, surname: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Phone Number</label>
                <input
                  type="tel"
                  placeholder="+905xxxxxxxxx"
                  value={iyzicoCustomer.gsmNumber}
                  onChange={(e) =>
                    setIyzicoCustomer((prev) => ({ ...prev, gsmNumber: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  TC Identity Number{' '}
                  <span className="font-normal text-muted-foreground text-xs">
                    (Required by Turkish financial regulation)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="11-digit TC Kimlik No"
                  maxLength={11}
                  value={iyzicoCustomer.identityNumber}
                  onChange={(e) =>
                    setIyzicoCustomer((prev) => ({ ...prev, identityNumber: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Billing Address *</label>
              <input
                type="text"
                required
                placeholder="Street address"
                value={iyzicoCustomer.address}
                onChange={(e) =>
                  setIyzicoCustomer((prev) => ({ ...prev, address: e.target.value }))
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">City *</label>
                <input
                  type="text"
                  required
                  value={iyzicoCustomer.city}
                  onChange={(e) =>
                    setIyzicoCustomer((prev) => ({ ...prev, city: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Country *</label>
                <input
                  type="text"
                  required
                  value={iyzicoCustomer.country}
                  onChange={(e) =>
                    setIyzicoCustomer((prev) => ({ ...prev, country: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">ZIP Code</label>
                <input
                  type="text"
                  value={iyzicoCustomer.zipCode}
                  onChange={(e) =>
                    setIyzicoCustomer((prev) => ({ ...prev, zipCode: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            {globalError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {globalError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={loadingPlan !== null}
                className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loadingPlan ? 'Processing...' : 'Proceed to Payment'}
              </button>
              <button
                type="button"
                onClick={() => setShowIyzicoForm(false)}
                className="rounded-md border px-6 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
