-- ExFish v6 Migration: Session-based multi-rig catch logs & privacy columns
-- Deploy this migration to Supabase BEFORE deploying v6 frontend/API changes.

ALTER TABLE IF EXISTS catch_logs
  ADD COLUMN IF NOT EXISTS session_id UUID NULL,
  ADD COLUMN IF NOT EXISTS tackle_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_catch_logs_session_id
  ON catch_logs (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catch_logs_public
  ON catch_logs (is_public, is_deleted, created_at DESC);

ALTER TABLE IF EXISTS fishing_spots
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE IF EXISTS fishing_shops
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE IF EXISTS spot_memos
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS shop_memos
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- [STAGED RLS — Phase 1.5]
-- After all clients migrate writes to /api/my-private-data (authenticated proxy)
-- and SUPABASE_SERVICE_ROLE_KEY + AUTH_SESSION_SECRET are configured in Vercel:
--
-- ALTER TABLE fishing_spots ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "public_spots_read" ON fishing_spots;
-- CREATE POLICY "public_spots_read" ON fishing_spots
--   FOR SELECT TO anon USING (is_public = true AND is_deleted = false);
--
-- ALTER TABLE catch_logs ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "public_logs_read" ON catch_logs;
-- CREATE POLICY "public_logs_read" ON catch_logs
--   FOR SELECT TO anon USING (is_public = true AND is_deleted = false);
