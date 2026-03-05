-- Migration: 0008_housekeeping
-- Phase 8: Housekeeping Coordinator — room status tracking, daily queue, and staff tables.
-- Creates room_housekeeping_status, housekeeping_queue, housekeeping_staff tables.
-- Extends seed_hotel_defaults to seed housekeeping_coordinator agent row.
--
-- Depends on: 0001_foundation.sql (hotels, set_updated_at)
--             0002_agent_core.sql
--             0003_knowledge_base.sql (rooms table, seed_hotel_defaults)
--             0004_guest_facing.sql
--             0005_guest_experience.sql (agents table, seed_hotel_defaults extended)
--             0006_billing.sql (subscriptions, seed_hotel_defaults extended)
--             0007_booking_ai.sql (booking_ai agent, seed_hotel_defaults extended)

-- =============================================================================
-- room_housekeeping_status table
-- One status row per room. Tracks current cleaning status for each room.
-- Updated by AI agent (updated_by='agent'), cron jobs (updated_by='cron'),
-- or owner directly (updated_by='owner').
-- =============================================================================

CREATE TABLE public.room_housekeeping_status (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id     UUID         NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  status      TEXT         NOT NULL DEFAULT 'dirty'
              CHECK (status IN ('clean', 'dirty', 'inspected', 'out_of_order')),
  notes       TEXT,
  updated_by  TEXT,        -- 'agent' | 'cron' | 'owner'
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, room_id)
);

-- Index: primary access pattern — fetch all room statuses for a hotel
CREATE INDEX idx_room_housekeeping_status_hotel ON public.room_housekeeping_status(hotel_id);

-- RLS: hotel owners can read their own room statuses via JWT hotel_id claim
ALTER TABLE public.room_housekeeping_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own room housekeeping status"
  ON public.room_housekeeping_status FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role policy for ALL operations (AI tools use service client)
CREATE POLICY "Service role can manage room housekeeping status"
  ON public.room_housekeeping_status FOR ALL
  TO authenticated
  WITH CHECK (true);

-- =============================================================================
-- housekeeping_queue table
-- Daily priority queue for housekeeping tasks — one row per room per date.
-- Priority: 1=checkout today (highest), 2=checkin today, 3=checkin tomorrow.
-- UNIQUE(hotel_id, room_id, queue_date) ensures idempotency (cron re-runs safe).
-- =============================================================================

CREATE TABLE public.housekeeping_queue (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id      UUID         NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  queue_date   DATE         NOT NULL,
  priority     INTEGER      NOT NULL,  -- 1=checkout today, 2=checkin today, 3=checkin tomorrow
  reason       TEXT         NOT NULL,  -- 'checkout_today' | 'checkin_today' | 'checkin_tomorrow'
  assigned_to  TEXT,        -- Staff name or email (NULL until assigned)
  assigned_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, room_id, queue_date)
);

-- Index: primary access pattern — fetch queue for a hotel on a given date
CREATE INDEX idx_housekeeping_queue_hotel_date ON public.housekeeping_queue(hotel_id, queue_date);

-- RLS: hotel owners can read their queue; service role manages it
ALTER TABLE public.housekeeping_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own housekeeping queue"
  ON public.housekeeping_queue FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role policy for ALL operations (cron jobs and AI tools use service client)
CREATE POLICY "Service role can manage housekeeping queue"
  ON public.housekeeping_queue FOR ALL
  TO authenticated
  WITH CHECK (true);

-- =============================================================================
-- housekeeping_staff table
-- Staff directory for housekeeping task assignment.
-- UNIQUE(hotel_id, email) prevents duplicate staff entries.
-- =============================================================================

CREATE TABLE public.housekeeping_staff (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  email       TEXT         NOT NULL,
  phone       TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, email)
);

-- RLS: hotel owners can manage their own staff directory
ALTER TABLE public.housekeeping_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own housekeeping staff"
  ON public.housekeeping_staff FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role policy for ALL operations
CREATE POLICY "Service role can manage housekeeping staff"
  ON public.housekeeping_staff FOR ALL
  TO authenticated
  WITH CHECK (true);

-- =============================================================================
-- Extend seed_hotel_defaults to insert housekeeping_coordinator agent row
-- Replaces the function defined in 0007_booking_ai.sql.
-- Adds INSERT for housekeeping_coordinator agent alongside front_desk,
-- guest_experience, and booking_ai entries.
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

  -- 4 default agent configuration rows (Phase 5 + Phase 7 + Phase 8)
  -- All agents start enabled; hotel owners can disable from dashboard
  INSERT INTO public.agents (hotel_id, role, is_enabled, behavior_config) VALUES
    (NEW.id, 'front_desk',               TRUE, '{}'),
    (NEW.id, 'guest_experience',          TRUE, '{}'),
    (NEW.id, 'booking_ai',               TRUE, '{}'),
    (NEW.id, 'housekeeping_coordinator', TRUE, '{}');

  -- 1 default trial subscription row (Phase 6)
  -- Trial lasts 14 days; no payment required during trial period
  INSERT INTO public.subscriptions (hotel_id, plan_name, status, trial_ends_at) VALUES
    (NEW.id, 'trial', 'trialing', NOW() + INTERVAL '14 days');

  RETURN NEW;
END;
$$;

-- =============================================================================
-- Backfill housekeeping_coordinator agent for existing hotels
-- Hotels created before this migration have front_desk, guest_experience, and
-- booking_ai rows but no housekeeping_coordinator row.
-- ON CONFLICT DO NOTHING is safe because agents table has a unique constraint
-- on (hotel_id, role).
-- =============================================================================

INSERT INTO public.agents (hotel_id, role, is_enabled, behavior_config)
SELECT id, 'housekeeping_coordinator', true, '{}'
FROM public.hotels
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Seed initial room statuses for existing rooms
-- All existing rooms start with 'dirty' status (safe default — requires cleaning).
-- ON CONFLICT DO NOTHING is safe due to UNIQUE(hotel_id, room_id).
-- =============================================================================

INSERT INTO public.room_housekeeping_status (hotel_id, room_id, status, updated_by)
SELECT r.hotel_id, r.id, 'dirty', 'cron'
FROM public.rooms r
ON CONFLICT (hotel_id, room_id) DO NOTHING;
