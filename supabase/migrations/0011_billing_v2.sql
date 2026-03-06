-- Migration 0011_billing_v2.sql
-- Phase 12: Billing model migration — per-employee pricing foundation
--
-- Changes:
-- 1. Add owner_telegram_chat_id to hotels table (nullable BIGINT)
--    Needed by trial notification cron to send countdown messages to hotel owner via Telegram.
--    NULL for hotels not yet onboarded via the Telegram Setup Wizard.
--
-- 2. Add trial notification tracking columns to subscriptions table
--    Four boolean flags for idempotent cron notifications at days 7, 12, 13, 14 of trial.
--    Prevents duplicate Telegram messages if cron runs multiple times per day.

-- 1. Hotel owner Telegram chat_id
ALTER TABLE public.hotels
  ADD COLUMN owner_telegram_chat_id BIGINT;

-- 2. Trial notification tracking columns (idempotency guards for cron)
ALTER TABLE public.subscriptions
  ADD COLUMN trial_notified_day_7 BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.subscriptions
  ADD COLUMN trial_notified_day_12 BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.subscriptions
  ADD COLUMN trial_notified_day_13 BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.subscriptions
  ADD COLUMN trial_notified_day_14 BOOLEAN NOT NULL DEFAULT FALSE;
