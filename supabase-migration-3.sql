-- Run in Supabase SQL editor after AUTH_SETUP/player_progress exists.
-- Adds account-wide inventory/shop and infinite best persistence fields.

ALTER TABLE IF EXISTS public.player_progress
  ADD COLUMN IF NOT EXISTS shop_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS infinite_best_score integer NOT NULL DEFAULT 0;
