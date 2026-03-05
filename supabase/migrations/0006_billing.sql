-- Migration: 0006_billing
-- Phase 6: Billing — subscriptions table, RLS, trial seed
-- Creates the subscriptions table with one row per hotel, storing plan state,
-- trial expiry, and payment provider references.
--
-- Depends on: 0001_foundation.sql (hotels, set_updated_at)
--             0002_agent_core.sql
--             0003_knowledge_base.sql (seed_hotel_defaults trigger)
--             0004_guest_facing.sql
--             0005_guest_experience.sql (seed_hotel_defaults extended for agents)

-- =============================================================================
-- subscriptions table
-- One row per hotel. Stores current plan name, subscription status, trial expiry,
-- and payment provider references (iyzico or Mollie).
-- Writes: service_role only (webhook handlers and trigger). No RLS for writes.
-- Reads: hotel owner can read their own row via JWT hotel_id claim.
-- =============================================================================

CREATE TABLE public.subscriptions (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                 UUID         NOT NULL UNIQUE REFERENCES public.hotels(id) ON DELETE CASCADE,
  plan_name                TEXT         NOT NULL DEFAULT 'trial'
                                        CHECK (plan_name IN ('trial', 'starter', 'pro', 'enterprise')),
  status                   TEXT         NOT NULL DEFAULT 'trialing'
                                        CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  trial_ends_at            TIMESTAMPTZ,                   -- NULL after trial converts to paid
  provider                 TEXT         CHECK (provider IN ('iyzico', 'mollie')),
  provider_customer_id     TEXT,        -- Mollie: cst_xxx | iyzico: customerReferenceCode
  provider_subscription_id TEXT,        -- Mollie: sub_xxx | iyzico: subscriptionReferenceCode
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index: subscription lookups by hotel_id (the primary access pattern)
CREATE INDEX idx_subscriptions_hotel_id ON public.subscriptions(hotel_id);

-- RLS: hotel owners can read their own subscription row
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own subscription"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- No INSERT/UPDATE/DELETE policies for authenticated role.
-- All writes go through service_role client (webhook handlers, seed trigger).
-- This prevents client-side subscription manipulation.

-- Auto-update updated_at when subscription row is modified by webhooks
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- Extend seed_hotel_defaults to insert a default trial subscription row
-- Replaces the function defined in 0005_guest_experience.sql.
-- Adds INSERT into subscriptions with plan_name='trial', status='trialing',
-- and trial_ends_at = NOW() + INTERVAL '14 days' when a new hotel is created.
-- All prior inserts (hotel_facts, rooms, agents) are kept intact.
-- SECURITY DEFINER + search_path = '' same as original (0001_foundation.sql pattern).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seed_hotel_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- 9 default hotel_facts rows
  INSERT INTO public.hotel_facts (hotel_id, category, fact) VALUES
    -- Policies (5)
    (NEW.id, 'policy', 'Check-in time is 3:00 PM. Early check-in is subject to availability.'),
    (NEW.id, 'policy', 'Check-out time is 11:00 AM. Late check-out may be available upon request.'),
    (NEW.id, 'policy', 'This is a non-smoking property. Smoking is not permitted anywhere on the premises.'),
    (NEW.id, 'policy', 'Cancellations must be made at least 48 hours before arrival to avoid a one-night charge.'),
    (NEW.id, 'policy', 'Pets are not permitted on the property.'),
    -- FAQs (3)
    (NEW.id, 'faq', 'Complimentary high-speed WiFi is available throughout the hotel. Network name and password are provided at check-in.'),
    (NEW.id, 'faq', 'Our front desk is staffed 24 hours a day, 7 days a week to assist you.'),
    (NEW.id, 'faq', 'Breakfast is not included in the standard room rate but is available in our restaurant each morning.'),
    -- Amenity (1)
    (NEW.id, 'amenity', 'A concierge service is available to assist with local recommendations, transportation, and reservations.');

  -- 1 default room skeleton
  INSERT INTO public.rooms (hotel_id, name, room_type, sort_order) VALUES
    (NEW.id, 'Standard Room', 'standard', 1);

  -- 2 default agent configuration rows (Phase 5)
  -- Both agents start enabled; hotel owners can disable from dashboard
  INSERT INTO public.agents (hotel_id, role, is_enabled, behavior_config) VALUES
    (NEW.id, 'front_desk',        TRUE, '{}'),
    (NEW.id, 'guest_experience',  TRUE, '{}');

  -- 1 default trial subscription row (Phase 6)
  -- Trial lasts 14 days; no payment required during trial period
  INSERT INTO public.subscriptions (hotel_id, plan_name, status, trial_ends_at) VALUES
    (NEW.id, 'trial', 'trialing', NOW() + INTERVAL '14 days');

  RETURN NEW;
END;
$$;
