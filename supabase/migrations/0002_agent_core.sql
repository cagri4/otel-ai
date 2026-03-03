-- =============================================================================
-- OtelAI Agent Core Schema
-- Phase 2: Three-tier memory tables + agent task coordination
--
-- Source patterns from: .planning/phases/02-agent-core/02-RESEARCH.md
-- References:
--   https://supabase.com/docs/guides/database/postgres/row-level-security
--   https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
-- =============================================================================

-- =============================================================================
-- SEMANTIC MEMORY — Hotel facts (policies, amenities, FAQs, pricing notes)
-- Tier 1: Static knowledge base injected into every agent system prompt
-- =============================================================================

CREATE TABLE public.hotel_facts (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  category    TEXT         NOT NULL, -- 'policy' | 'amenity' | 'faq' | 'pricing_note'
  fact        TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hotel_facts_hotel_id ON public.hotel_facts(hotel_id);

ALTER TABLE public.hotel_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff see own facts"
  ON public.hotel_facts FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff insert own facts"
  ON public.hotel_facts FOR INSERT
  TO authenticated
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff update own facts"
  ON public.hotel_facts FOR UPDATE
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff delete own facts"
  ON public.hotel_facts FOR DELETE
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Reuse set_updated_at trigger from 0001_foundation.sql
CREATE TRIGGER set_hotel_facts_updated_at
  BEFORE UPDATE ON public.hotel_facts
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- EPISODIC MEMORY — Guest interaction summaries
-- Tier 2: Per-guest history; agent writes summaries after each conversation
-- =============================================================================

CREATE TABLE public.guest_interactions (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id           UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  guest_identifier   TEXT         NOT NULL, -- email, phone, or session token
  summary            TEXT         NOT NULL, -- agent-written summary of the interaction
  sentiment          TEXT,                  -- 'positive' | 'neutral' | 'negative'
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guest_interactions_hotel_id ON public.guest_interactions(hotel_id, created_at);

ALTER TABLE public.guest_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff see own guest interactions"
  ON public.guest_interactions FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff insert own guest interactions"
  ON public.guest_interactions FOR INSERT
  TO authenticated
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- =============================================================================
-- WORKING MEMORY — Conversation turns (active context window)
-- Tier 3: Per-conversation message history; last N turns assembled on every call
-- =============================================================================

CREATE TABLE public.conversation_turns (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID         NOT NULL,
  hotel_id         UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  role             TEXT         NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content          TEXT         NOT NULL,
  tool_use_id      TEXT,        -- for tool/tool_result correlation (NULL for user/assistant turns)
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_turns_conv ON public.conversation_turns(conversation_id, created_at);

ALTER TABLE public.conversation_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff see own conversation turns"
  ON public.conversation_turns FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff insert own conversation turns"
  ON public.conversation_turns FOR INSERT
  TO authenticated
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- =============================================================================
-- AGENT TASK COORDINATION — Task queue for multi-agent handoffs
-- Used by orchestrator to delegate tasks between specialized agents
-- =============================================================================

CREATE TYPE public.task_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE public.agent_tasks (
  id              UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID                 NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  from_role       TEXT                 NOT NULL, -- originating agent role
  to_role         TEXT                 NOT NULL, -- target agent role
  task_type       TEXT                 NOT NULL, -- e.g. 'reservation_lookup', 'complaint_escalate'
  payload         JSONB                NOT NULL DEFAULT '{}',
  status          public.task_status   NOT NULL DEFAULT 'pending',
  result          JSONB,               -- populated by executing agent on completion
  error_message   TEXT,                -- populated on failure
  created_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ          -- NULL until status becomes 'completed' or 'failed'
);

CREATE INDEX idx_agent_tasks_hotel_status ON public.agent_tasks(hotel_id, status, created_at);

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff see own agent tasks"
  ON public.agent_tasks FOR SELECT
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff insert own agent tasks"
  ON public.agent_tasks FOR INSERT
  TO authenticated
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff update own agent tasks"
  ON public.agent_tasks FOR UPDATE
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Reuse set_updated_at trigger from 0001_foundation.sql
CREATE TRIGGER set_agent_tasks_updated_at
  BEFORE UPDATE ON public.agent_tasks
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
