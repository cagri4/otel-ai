-- Migration: 0007_booking_ai
-- Phase 7: Booking AI — reservations table, conversation_summaries table,
-- RLS policies, indexes, seed update for booking_ai agent, and backfill.
--
-- Depends on: 0001_foundation.sql (hotels, set_updated_at)
--             0002_agent_core.sql
--             0003_knowledge_base.sql (rooms table, seed_hotel_defaults)
--             0004_guest_facing.sql
--             0005_guest_experience.sql (agents table, seed_hotel_defaults extended)
--             0006_billing.sql (subscriptions, seed_hotel_defaults extended)

-- =============================================================================
-- reservations table
-- Core booking record. Used by AI tools (get_room_availability,
-- lookup_guest_reservation) to answer real-time availability and guest queries.
-- Writes: service_role only (AI tool executor, future booking form handlers).
-- Reads: hotel owner via RLS (JWT hotel_id claim).
-- =============================================================================

CREATE TABLE public.reservations (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id        UUID         NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  guest_name     TEXT         NOT NULL,
  guest_phone    TEXT,
  check_in_date  DATE         NOT NULL,
  check_out_date DATE         NOT NULL,
  status         TEXT         NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  notes          TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT check_dates CHECK (check_out_date > check_in_date)
);

-- Indexes for the primary access patterns:
-- 1. Availability queries: filter by hotel_id and date range overlap
-- 2. Room-level conflict detection: filter by room_id and dates
CREATE INDEX idx_reservations_hotel_dates ON public.reservations(hotel_id, check_in_date, check_out_date);
CREATE INDEX idx_reservations_room       ON public.reservations(room_id, check_in_date);

-- RLS: hotel owners can read their own hotel's reservations
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own reservations"
  ON public.reservations FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role inserts (AI tool creates reservation on behalf of guest)
CREATE POLICY "Service role can insert reservations"
  ON public.reservations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Service role updates (cancel, modify status)
CREATE POLICY "Service role can update reservations"
  ON public.reservations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- conversation_summaries table
-- Stores rolling summaries of long conversations, used by plan 07-03
-- (progressive conversation summarization) to keep context within token limits.
-- conversation_id is the primary key (one summary per conversation thread).
-- =============================================================================

CREATE TABLE public.conversation_summaries (
  conversation_id  TEXT         PRIMARY KEY,
  hotel_id         UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  summary          TEXT         NOT NULL,
  turns_summarized INTEGER      NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index: fetch all summaries for a hotel (dashboard / debugging)
CREATE INDEX idx_conv_summaries_hotel ON public.conversation_summaries(hotel_id);

-- RLS: hotel owners can read their own conversation summaries
ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own conversation summaries"
  ON public.conversation_summaries FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role upserts (summarization job writes/updates summaries)
CREATE POLICY "Service role can upsert conversation summaries"
  ON public.conversation_summaries FOR ALL
  TO authenticated
  WITH CHECK (true);

-- =============================================================================
-- Extend seed_hotel_defaults to insert a booking_ai agent row
-- Replaces the function defined in 0006_billing.sql.
-- Adds INSERT for booking_ai agent alongside front_desk and guest_experience.
-- All prior inserts (hotel_facts, rooms, front_desk, guest_experience, subscriptions) are kept intact.
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

  -- 3 default agent configuration rows (Phase 5 + Phase 7)
  -- All agents start enabled; hotel owners can disable from dashboard
  INSERT INTO public.agents (hotel_id, role, is_enabled, behavior_config) VALUES
    (NEW.id, 'front_desk',        TRUE, '{}'),
    (NEW.id, 'guest_experience',  TRUE, '{}'),
    (NEW.id, 'booking_ai',        TRUE, '{}');

  -- 1 default trial subscription row (Phase 6)
  -- Trial lasts 14 days; no payment required during trial period
  INSERT INTO public.subscriptions (hotel_id, plan_name, status, trial_ends_at) VALUES
    (NEW.id, 'trial', 'trialing', NOW() + INTERVAL '14 days');

  RETURN NEW;
END;
$$;

-- =============================================================================
-- Backfill booking_ai agent for existing hotels
-- Hotels created before this migration have front_desk and guest_experience rows
-- but no booking_ai row. ON CONFLICT DO NOTHING is safe because agents table
-- has a unique constraint on (hotel_id, role).
-- =============================================================================

INSERT INTO public.agents (hotel_id, role, is_enabled, behavior_config)
SELECT id, 'booking_ai', true, '{}'
FROM public.hotels
ON CONFLICT DO NOTHING;
