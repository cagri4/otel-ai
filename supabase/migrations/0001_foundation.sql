-- =============================================================================
-- OtelAI Foundation Schema
-- Phase 1: Multi-tenant hotel schema with RLS, signup trigger, JWT hook
--
-- Source patterns from: .planning/phases/01-foundation/01-RESEARCH.md
-- References:
--   https://supabase.com/docs/guides/database/postgres/row-level-security
--   https://supabase.com/docs/guides/auth/managing-user-data
--   https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
--   https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
-- =============================================================================

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- 1. Hotels table (one per tenant)
-- Source: Pattern 1 (RLS Schema Design)
CREATE TABLE public.hotels (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL,
  address     TEXT,
  city        TEXT,
  country     TEXT,
  timezone    TEXT         NOT NULL DEFAULT 'UTC',  -- IANA timezone string e.g. 'Europe/Istanbul'
  contact_email  TEXT,
  contact_phone  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. Profiles table (links auth.users to hotels)
-- Source: Pattern 1 (RLS Schema Design)
CREATE TABLE public.profiles (
  id          UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hotel_id    UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  full_name   TEXT,
  role        TEXT         NOT NULL DEFAULT 'owner',  -- for future multi-user support
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES (critical for RLS performance)
-- Source: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
-- Without indexes, RLS policies cause full-table scans
-- =============================================================================

CREATE INDEX idx_profiles_hotel_id ON public.profiles(hotel_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on both tables
ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES FOR HOTELS
-- Uses (SELECT auth.jwt()) wrapping pattern to cache JWT read per query (performance)
-- Source: RLS Performance Best Practices — "SELECT wrapping triggers initPlan caching"
CREATE POLICY "Hotel owners see own hotel"
  ON public.hotels FOR SELECT
  TO authenticated
  USING (id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel owners update own hotel"
  ON public.hotels FOR UPDATE
  TO authenticated
  USING (id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- RLS POLICIES FOR PROFILES
CREATE POLICY "Users see own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- =============================================================================
-- UPDATED_AT AUTO-UPDATE TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_hotels_updated_at
  BEFORE UPDATE ON public.hotels
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- SIGNUP TRIGGER — Auto-create hotel and profile on user signup
-- Source: Pattern 2, https://supabase.com/docs/guides/auth/managing-user-data
--
-- Fires on auth.users INSERT and atomically creates:
--   1. Hotel record (hotel_name from user metadata, default 'My Hotel')
--   2. Profile record linking user to hotel
--   3. Updates app_metadata with hotel_id (for Custom Access Token Hook)
--
-- SECURITY DEFINER + search_path = '' prevents search path injection attacks
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_hotel_id UUID;
BEGIN
  -- 1. Create the hotel record
  INSERT INTO public.hotels (name, timezone)
  VALUES (
    COALESCE(NEW.raw_user_meta_data ->> 'hotel_name', 'My Hotel'),
    'UTC'
  )
  RETURNING id INTO new_hotel_id;

  -- 2. Create the profile linking user to hotel
  INSERT INTO public.profiles (id, hotel_id, full_name, role)
  VALUES (
    NEW.id,
    new_hotel_id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    'owner'
  );

  -- 3. Write hotel_id into app_metadata so Custom Access Token Hook
  --    can inject it into JWT claims on next token issuance
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('hotel_id', new_hotel_id)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- Attach trigger to fire on every new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- =============================================================================
-- CUSTOM ACCESS TOKEN HOOK — Inject hotel_id into JWT claims
-- Source: Pattern 3, https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
--
-- Fires on every token issuance. Reads hotel_id from app_metadata (set by
-- handle_new_user trigger) and injects it as a top-level JWT claim.
--
-- RLS policies then read hotel_id directly from JWT with zero subqueries:
--   USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
--
-- Enable in Dashboard: Authentication > Hooks > Custom Access Token
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims   JSONB;
  hotel_id TEXT;
BEGIN
  claims := event -> 'claims';

  -- Try to get hotel_id from app_metadata (authoritative — set server-side by trigger)
  -- Note: user_metadata is user-modifiable and NOT trusted for authorization
  hotel_id := (event -> 'claims' -> 'app_metadata') ->> 'hotel_id';

  -- Fallback: check user_metadata (only on first token after trigger may not have run yet)
  IF hotel_id IS NULL THEN
    hotel_id := event -> 'user_metadata' ->> 'hotel_id';
  END IF;

  -- Inject hotel_id as top-level claim for zero-subquery RLS policies
  IF hotel_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{hotel_id}', to_jsonb(hotel_id));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Required grants: only supabase_auth_admin can execute the hook
-- REVOKE from all other roles to prevent direct invocation
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
