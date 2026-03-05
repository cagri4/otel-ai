-- Depends on: 0001_foundation.sql (hotels, set_updated_at), 0002_agent_core.sql (hotel_facts)

-- =============================================================================
-- OtelAI Knowledge Base Schema
-- Phase 3: Rooms table, default data seeding trigger, onboarding gate
--
-- Source patterns from: .planning/phases/03-knowledge-base-and-onboarding/03-RESEARCH.md
-- =============================================================================

-- =============================================================================
-- ONBOARDING GATE — track when hotel owner completes onboarding wizard
-- Research recommendation: dedicated column, not city check (open question 1)
-- =============================================================================

ALTER TABLE public.hotels ADD COLUMN onboarding_completed_at TIMESTAMPTZ DEFAULT NULL;

-- =============================================================================
-- ROOMS TABLE — structured room inventory for agent context
-- Tier 1 extension: room data served alongside semantic facts in every system prompt
-- =============================================================================

CREATE TABLE public.rooms (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  name              TEXT         NOT NULL,           -- e.g. "Deluxe Ocean View"
  room_type         TEXT         NOT NULL,           -- e.g. "standard", "deluxe", "suite"
  bed_type          TEXT,                            -- nullable: "king", "twin", "queen"
  max_occupancy     INTEGER,                         -- nullable: max guests
  description       TEXT,                            -- nullable: long-form room description
  amenities         TEXT[],                          -- PostgreSQL text array for amenity strings
  base_price_note   TEXT,                            -- nullable: e.g. "from $120/night" — text for agent, not booking engine
  sort_order        INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rooms_hotel_id ON public.rooms(hotel_id);

-- =============================================================================
-- RLS ON ROOMS — same JWT pattern as hotel_facts (0002_agent_core.sql)
-- =============================================================================

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff see own rooms"
  ON public.rooms FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff insert own rooms"
  ON public.rooms FOR INSERT
  TO authenticated
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff update own rooms"
  ON public.rooms FOR UPDATE
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff delete own rooms"
  ON public.rooms FOR DELETE
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- =============================================================================
-- UPDATED_AT TRIGGER FOR ROOMS — reuses set_updated_at() from 0001_foundation.sql
-- =============================================================================

CREATE TRIGGER set_rooms_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- SEED HOTEL DEFAULTS — fires when a new hotel is created (after signup trigger)
--
-- Inserts:
--   - 5 policy facts (check-in/checkout, no-smoking, cancellation, pets)
--   - 3 FAQ facts (WiFi, 24h front desk, breakfast)
--   - 1 amenity fact (concierge)
--   - 1 default Standard Room skeleton
--
-- SECURITY DEFINER + search_path = '' same as handle_new_user() (0001_foundation.sql)
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

  RETURN NEW;
END;
$$;

-- Trigger fires after each new hotel row is inserted (which happens in handle_new_user())
CREATE TRIGGER on_hotel_created_seed_defaults
  AFTER INSERT ON public.hotels
  FOR EACH ROW EXECUTE PROCEDURE public.seed_hotel_defaults();
