-- Migration: 0005_guest_experience
-- Phase 5: Guest Experience AI and Owner Dashboard foundation
-- Creates bookings, message_templates, agents, agent_audit_log tables.
-- Extends seed_hotel_defaults to insert default agent rows.
--
-- Depends on: 0001_foundation.sql (hotels, set_updated_at)
--             0002_agent_core.sql (agent_tasks)
--             0003_knowledge_base.sql (seed_hotel_defaults trigger)
--             0004_guest_facing.sql (escalations, realtime)

-- =============================================================================
-- bookings table
-- Guest stay records used by milestone messaging (pre-arrival, checkout reminder,
-- review request). Channel field determines delivery mechanism (email vs WhatsApp).
-- =============================================================================

CREATE TABLE public.bookings (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                 UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  guest_name               TEXT         NOT NULL,
  guest_email              TEXT,
  guest_phone              TEXT,          -- WhatsApp-formatted if available e.g. "+31612345678"
  channel                  TEXT         NOT NULL DEFAULT 'email'
                                         CHECK (channel IN ('email', 'whatsapp')),
  check_in_date            DATE         NOT NULL,
  check_out_date           DATE         NOT NULL,
  pre_arrival_sent         BOOLEAN      NOT NULL DEFAULT FALSE,
  checkout_reminder_sent   BOOLEAN      NOT NULL DEFAULT FALSE,
  review_request_sent      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index: booking lookups by hotel scoped to check-in date (cron queries this pattern)
CREATE INDEX idx_bookings_hotel ON public.bookings(hotel_id, check_in_date);

-- RLS: hotel owners can see their own bookings; cron inserts via service client
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- INSERT/UPDATE via service_role only (cron jobs use service client, no user session)
CREATE POLICY "Service can insert bookings"
  ON public.bookings FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service can update bookings"
  ON public.bookings FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- message_templates table
-- Per-hotel, per-milestone, per-channel message templates.
-- Hotel owner edits these via dashboard; cron uses them to generate/send messages.
-- =============================================================================

CREATE TABLE public.message_templates (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  milestone   TEXT         NOT NULL
              CHECK (milestone IN ('pre_arrival', 'checkout_reminder', 'review_request')),
  channel     TEXT         NOT NULL
              CHECK (channel IN ('email', 'whatsapp')),
  subject     TEXT,          -- for email only; NULL for WhatsApp
  body        TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, milestone, channel)
);

-- RLS: hotel owners manage their own templates
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own templates"
  ON public.message_templates FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel owners can insert own templates"
  ON public.message_templates FOR INSERT
  TO authenticated
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel owners can update own templates"
  ON public.message_templates FOR UPDATE
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel owners can delete own templates"
  ON public.message_templates FOR DELETE
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Auto-update updated_at on template edits
CREATE TRIGGER set_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- agents table
-- Per-hotel agent configuration. Each row controls one AI employee role:
-- is_enabled allows hotel owners to turn agents on/off from the dashboard.
-- behavior_config holds role-specific tuning (language, tone overrides, etc.)
-- =============================================================================

CREATE TABLE public.agents (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  role             TEXT         NOT NULL,   -- e.g. 'front_desk', 'guest_experience'
  is_enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
  behavior_config  JSONB        NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, role)
);

-- RLS: hotel owners can read and update their own agent configs
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own agents"
  ON public.agents FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel owners can update own agents"
  ON public.agents FOR UPDATE
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- INSERT via seed trigger (service-level) only
CREATE POLICY "Service can insert agents"
  ON public.agents FOR INSERT
  WITH CHECK (true);

-- Auto-update updated_at on agent config edits
CREATE TRIGGER set_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- agent_audit_log table
-- Append-only audit trail. Every tool call by any agent is recorded here.
-- Action class: OBSERVE (read-only queries), INFORM (notifications), ACT (writes/changes).
-- INSERT from server-side executeTool() via service client; NO UPDATE or DELETE policies.
-- =============================================================================

CREATE TABLE public.agent_audit_log (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  agent_role       TEXT         NOT NULL,
  conversation_id  TEXT         NOT NULL,
  tool_name        TEXT         NOT NULL,
  action_class     TEXT         NOT NULL CHECK (action_class IN ('OBSERVE', 'INFORM', 'ACT')),
  input_json       JSONB        NOT NULL DEFAULT '{}',
  result_json      JSONB        NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Indexes: hotel-scoped audit queries (chronological) and per-conversation lookups
CREATE INDEX idx_audit_log_hotel ON public.agent_audit_log(hotel_id, created_at);
CREATE INDEX idx_audit_log_conv  ON public.agent_audit_log(conversation_id);

-- RLS: hotel owners can read their own audit logs; server inserts via service client
ALTER TABLE public.agent_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own audit log"
  ON public.agent_audit_log FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- INSERT from server-side executeTool() using service client (bypasses RLS)
-- NO UPDATE or DELETE policies — audit log is append-only
CREATE POLICY "Service can insert audit log"
  ON public.agent_audit_log FOR INSERT
  WITH CHECK (true);

-- =============================================================================
-- Realtime publications
-- Allows Supabase Realtime to broadcast escalation and audit log changes.
-- escalations was created in 0004 but not added to realtime until now.
-- =============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.escalations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_audit_log;

-- =============================================================================
-- Extend seed_hotel_defaults to insert default agent rows
-- Replaces the function defined in 0003_knowledge_base.sql.
-- Adds INSERT into agents for 'front_desk' and 'guest_experience' roles.
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

  RETURN NEW;
END;
$$;
