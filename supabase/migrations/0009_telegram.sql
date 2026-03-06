-- Migration: 0009_telegram
-- Phase 9: Telegram Infrastructure
-- Adds hotel_bots table with Vault-encrypted bot tokens, Vault SQL functions,
-- a vault cleanup trigger, and extends escalation channel CHECK constraint.

-- =============================================================================
-- hotel_bots table
-- Stores Telegram bot configuration per hotel role.
-- Bot tokens are stored in Supabase Vault — only vault_secret_id UUID is here.
-- webhook_path_slug is a random UUID used as the URL path segment for the
-- Telegram webhook endpoint (NOT the bot token — security improvement per research).
-- =============================================================================

CREATE TABLE public.hotel_bots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  vault_secret_id   UUID NOT NULL,
  bot_username      TEXT NOT NULL,
  webhook_secret    TEXT NOT NULL,
  webhook_path_slug TEXT NOT NULL UNIQUE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, role)
);

-- role stores AgentRole enum values as text:
--   'front_desk' | 'booking_ai' | 'guest_experience' | 'housekeeping_coordinator'

-- vault_secret_id references vault.secrets.id but has NO FK constraint
-- because vault schema is internal to Supabase and not exposed via pg_catalog.

-- Index for hotel-scoped bot lookups (e.g. dashboard listing all bots for a hotel)
CREATE INDEX idx_hotel_bots_hotel_id ON public.hotel_bots(hotel_id);

-- Index for webhook routing (fast lookup by slug on every inbound Telegram update)
CREATE INDEX idx_hotel_bots_slug ON public.hotel_bots(webhook_path_slug);

-- =============================================================================
-- RLS policies
-- =============================================================================

ALTER TABLE public.hotel_bots ENABLE ROW LEVEL SECURITY;

-- Authenticated hotel owners can view (SELECT only) their own bots via dashboard.
-- JWT app_metadata.hotel_id is embedded by the Custom Access Token Hook at login.
CREATE POLICY "Hotel owners can view own bots"
  ON public.hotel_bots FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Service role has full CRUD access — used by webhook registration and admin panel.
CREATE POLICY "Service role full access to hotel_bots"
  ON public.hotel_bots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- Vault SQL functions
-- Both functions are SECURITY DEFINER and restricted to service_role only.
-- Anon and authenticated roles cannot call them.
-- =============================================================================

-- create_bot_token_secret: stores a plaintext bot token in Vault and returns
-- the vault.secrets.id UUID for storage in hotel_bots.vault_secret_id.
CREATE OR REPLACE FUNCTION public.create_bot_token_secret(
  p_token TEXT,
  p_name  TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT vault.create_secret(p_token, p_name)
    INTO v_secret_id;
  RETURN v_secret_id;
END;
$$;

-- Restrict execution: revoke from PUBLIC, anon, authenticated; grant to service_role only.
REVOKE EXECUTE ON FUNCTION public.create_bot_token_secret(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_bot_token_secret(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_bot_token_secret(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.create_bot_token_secret(TEXT, TEXT) TO service_role;

-- get_bot_token: retrieves a decrypted bot token from Vault by secret UUID.
-- Used by the Telegram webhook handler to authenticate outbound API calls.
CREATE OR REPLACE FUNCTION public.get_bot_token(
  p_vault_secret_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  SELECT decrypted_secret
    INTO v_token
    FROM vault.decrypted_secrets
   WHERE id = p_vault_secret_id;
  RETURN v_token;
END;
$$;

-- Restrict execution: revoke from PUBLIC, anon, authenticated; grant to service_role only.
REVOKE EXECUTE ON FUNCTION public.get_bot_token(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bot_token(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_bot_token(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_bot_token(UUID) TO service_role;

-- =============================================================================
-- Vault cleanup trigger
-- Deletes the corresponding Vault secret when a hotel_bots row is deleted,
-- preventing orphaned secrets from accumulating in vault.secrets.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_bot_vault_secret()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets
   WHERE id = OLD.vault_secret_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_delete_bot_vault_secret
  AFTER DELETE ON public.hotel_bots
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_bot_vault_secret();

-- =============================================================================
-- Escalation channel extension
-- Updates the escalations table CHECK constraint from 0004_guest_facing.sql
-- to include 'telegram' as a valid channel alongside 'whatsapp' and 'widget'.
-- =============================================================================

ALTER TABLE public.escalations DROP CONSTRAINT IF EXISTS escalations_channel_check;
ALTER TABLE public.escalations ADD CONSTRAINT escalations_channel_check
  CHECK (channel IN ('whatsapp', 'widget', 'telegram'));
