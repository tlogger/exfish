-- ==============================================================================
-- ExFish 스키마 정규화 및 데이터 무결성 마이그레이션 (v5.0 프로덕션)
-- 목적: description 및 memo 텍스트 컬럼에 대괄호 정규식([TAG:...])으로 임시 패킹되던
--       핵심 도메인 필드들을 정식 데이터베이스 Typed Column으로 승격
-- ==============================================================================

-- 1. fishing_spots 테이블 컬럼 추가
ALTER TABLE IF EXISTS public.fishing_spots
    ADD COLUMN IF NOT EXISTS casting_start_deg INTEGER,
    ADD COLUMN IF NOT EXISTS casting_end_deg INTEGER,
    ADD COLUMN IF NOT EXISTS casting_directions TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS use_sweet_spot BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sweet_spots JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS related_url TEXT;

-- 2. catch_logs 테이블 컬럼 추가
ALTER TABLE IF EXISTS public.catch_logs
    ADD COLUMN IF NOT EXISTS is_hitless BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS current_velocity NUMERIC,
    ADD COLUMN IF NOT EXISTS current_direction NUMERIC,
    ADD COLUMN IF NOT EXISTS start_time VARCHAR(10),
    ADD COLUMN IF NOT EXISTS end_time VARCHAR(10),
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- 3. 빠른 검색을 위한 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_fishing_spots_spot_type ON public.fishing_spots (spot_type);
CREATE INDEX IF NOT EXISTS idx_fishing_spots_public ON public.fishing_spots (is_public);
CREATE INDEX IF NOT EXISTS idx_catch_logs_spot_id ON public.catch_logs (spot_id);
CREATE INDEX IF NOT EXISTS idx_catch_logs_hitless ON public.catch_logs (is_hitless);

-- 4. 설명 코멘트 추가
COMMENT ON COLUMN public.fishing_spots.casting_start_deg IS '캐스팅 공략 유효 시작각 (0~359°, 북쪽 0° 기준 시계방향)';
COMMENT ON COLUMN public.fishing_spots.casting_end_deg IS '캐스팅 공략 유효 끝각 (0~359°)';
COMMENT ON COLUMN public.fishing_spots.sweet_spots IS '포인트 내 최대 3대 핵심 수중여/물골 스위트 스팟 배열 (JSONB)';
COMMENT ON COLUMN public.fishing_spots.related_url IS '포인트 관련 외부 웹/유튜브/블로그 참조 URL';
COMMENT ON COLUMN public.catch_logs.is_hitless IS '꽝(노피시/입질 무) 여부 플래그 (fish_count=0 또는 미입질)';
