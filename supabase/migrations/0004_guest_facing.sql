-- Migration: 0004_guest_facing
-- Phase 4: Guest-Facing Layer foundation
-- Adds widget_token, widget_config to hotels, creates escalations and hotel_whatsapp_numbers tables.

-- =============================================================================
-- hotels table additions
-- Adds widget_token (unique token for embedding the chat widget) and
-- widget_config (JSONB for per-hotel widget appearance/behavior settings).
-- =============================================================================

ALTER TABLE public.hotels
  ADD COLUMN widget_token TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  ADD COLUMN widget_config JSONB DEFAULT '{}';

CREATE UNIQUE INDEX idx_hotels_widget_token ON public.hotels(widget_token);

-- =============================================================================
-- escalations table
-- Records conversations where the AI could not resolve the guest's request
-- and a human staff member needs to follow up.
-- =============================================================================

CREATE TABLE public.escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp', 'widget')),
  guest_message   TEXT NOT NULL,
  agent_response  TEXT,
  notified_at     TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fetching escalations by hotel ordered by recency
CREATE INDEX idx_escalations_hotel_id ON public.escalations(hotel_id, created_at);

-- Partial index for efficient query of unnotified escalations
CREATE INDEX idx_escalations_unnotified ON public.escalations(hotel_id) WHERE notified_at IS NULL;

-- RLS: hotel owners can read their own escalations; service role inserts
ALTER TABLE public.escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own escalations"
  ON public.escalations FOR SELECT
  USING (hotel_id = (auth.jwt() -> 'app_metadata' ->> 'hotel_id')::UUID);

CREATE POLICY "Service can insert escalations"
  ON public.escalations FOR INSERT
  WITH CHECK (true);  -- INSERT happens server-side via service_role

-- =============================================================================
-- hotel_whatsapp_numbers table
-- Maps Twilio phone numbers to hotels for inbound WhatsApp routing.
-- A hotel can have multiple numbers; each number belongs to one hotel.
-- =============================================================================

CREATE TABLE public.hotel_whatsapp_numbers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  twilio_number   TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.hotel_whatsapp_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel owners can view own numbers"
  ON public.hotel_whatsapp_numbers FOR SELECT
  USING (hotel_id = (auth.jwt() -> 'app_metadata' ->> 'hotel_id')::UUID);
