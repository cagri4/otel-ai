/**
 * Billing plan constants for OtelAI.
 *
 * Plan limits are defined as TypeScript constants (not database rows).
 * The subscriptions.plan_name column stores which tier a hotel is on;
 * these constants define what that tier means in terms of capabilities.
 *
 * Source: .planning/phases/06-billing/06-RESEARCH.md — Pattern 2
 */

// Valid plan name strings — matches CHECK constraint in subscriptions table
export const PLAN_NAMES = ['trial', 'starter', 'pro', 'enterprise'] as const;

export type PlanName = typeof PLAN_NAMES[number];

/**
 * Per-plan capability limits.
 * maxAgents: maximum number of simultaneously enabled AI agents.
 */
export const PLAN_LIMITS: Record<PlanName, { maxAgents: number; displayName: string }> = {
  trial:      { maxAgents: 2, displayName: 'Free Trial' },
  starter:    { maxAgents: 2, displayName: 'Starter' },
  pro:        { maxAgents: 4, displayName: 'Pro' },
  enterprise: { maxAgents: 6, displayName: 'Enterprise' },
};

/**
 * Monthly prices per market.
 * Informational — actual prices are configured in the iyzico/Mollie dashboard.
 * TRY prices for iyzico (TR market); EUR prices for Mollie (EU market).
 */
export const PLAN_PRICES: Record<Exclude<PlanName, 'trial'>, { try: number; eur: number }> = {
  starter:    { try: 299, eur: 29 },
  pro:        { try: 599, eur: 59 },
  enterprise: { try: 999, eur: 99 },
};

/**
 * Route a hotel to the appropriate payment provider based on country.
 * TR hotels use iyzico (Turkish payment gateway).
 * All other countries use Mollie (EU payment gateway).
 *
 * @param country - hotels.country value (may be null for incomplete onboarding)
 * @returns 'iyzico' for Turkey, 'mollie' for all other countries
 */
export function getProviderForHotel(country: string | null): 'iyzico' | 'mollie' {
  return country?.toUpperCase() === 'TR' ? 'iyzico' : 'mollie';
}
