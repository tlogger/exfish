-- ExFish 증분 동기화(Delta Sync) 및 캐시 정리를 위한 스키마 마이그레이션
-- Supabase SQL Editor에서 실행하거나 `supabase db push`로 적용하세요.

-- 1. 공통 updated_at 자동 갱신 트리거 함수
CREATE OR REPLACE FUNCTION public.set_exfish_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. fishing_spots: updated_at & is_deleted 컬럼 및 인덱스 추가
ALTER TABLE public.fishing_spots
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

UPDATE public.fishing_spots
SET updated_at = COALESCE(created_at, now());

DROP TRIGGER IF EXISTS trg_fishing_spots_updated_at ON public.fishing_spots;
CREATE TRIGGER trg_fishing_spots_updated_at
  BEFORE INSERT OR UPDATE ON public.fishing_spots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_exfish_updated_at();

CREATE INDEX IF NOT EXISTS idx_fishing_spots_updated_at
  ON public.fishing_spots (updated_at);

-- 3. catch_logs: updated_at & is_deleted 컬럼 및 인덱스 추가
ALTER TABLE public.catch_logs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

UPDATE public.catch_logs
SET updated_at = COALESCE(created_at, now());

DROP TRIGGER IF EXISTS trg_catch_logs_updated_at ON public.catch_logs;
CREATE TRIGGER trg_catch_logs_updated_at
  BEFORE INSERT OR UPDATE ON public.catch_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_exfish_updated_at();

CREATE INDEX IF NOT EXISTS idx_catch_logs_updated_at
  ON public.catch_logs (updated_at);

-- 4. khoa_global_cache: 만료 인덱스 추가 및 만료된 단기 캐시 일괄 정리
CREATE INDEX IF NOT EXISTS idx_khoa_global_cache_expires_at
  ON public.khoa_global_cache (expires_at);

DELETE FROM public.khoa_global_cache
WHERE expires_at < now();
