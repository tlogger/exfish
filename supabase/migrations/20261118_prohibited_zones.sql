-- 낚시금지구역 사용자 작도·신고·사후 삭제(비노출) 스키마
-- 직접 anon 쓰기는 RLS로 차단하고 Vercel Serverless API(SUPABASE_SERVICE_ROLE_KEY)에서만 기록합니다.

CREATE TABLE IF NOT EXISTS public.user_prohibited_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'flagged', 'deleted')),
  zone_name text NOT NULL,
  restriction_scope text NOT NULL DEFAULT 'all_year' CHECK (restriction_scope IN ('all_year', 'seasonal', 'night_only')),
  source_note text,
  geometry_geojson jsonb NOT NULL,
  bbox float8[4] NOT NULL,
  area_sqm float8 NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by text
);

CREATE INDEX IF NOT EXISTS idx_user_prohibited_zones_user_status_created
  ON public.user_prohibited_zones (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_prohibited_zones_status_created
  ON public.user_prohibited_zones (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.suppressed_zones (
  zone_id text PRIMARY KEY,
  reason text,
  deleted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.zone_flags (
  zone_id uuid NOT NULL REFERENCES public.user_prohibited_zones(id) ON DELETE CASCADE,
  reporter_user_id text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, reporter_user_id)
);

ALTER TABLE public.user_prohibited_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressed_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_flags ENABLE ROW LEVEL SECURITY;

-- 읽기 전용 공개 조회는 api/zones-delta.ts(service_role) 또는 active 행 SELECT만 허용
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_prohibited_zones' AND policyname = 'Allow public read active zones'
  ) THEN
    CREATE POLICY "Allow public read active zones"
      ON public.user_prohibited_zones
      FOR SELECT
      USING (status = 'active');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'suppressed_zones' AND policyname = 'Allow public read suppressed zones'
  ) THEN
    CREATE POLICY "Allow public read suppressed zones"
      ON public.suppressed_zones
      FOR SELECT
      USING (restored_at IS NULL);
  END IF;
END $$;
