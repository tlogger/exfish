CREATE TABLE IF NOT EXISTS public.fishing_shops (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  is_public BOOLEAN NOT NULL DEFAULT true,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN 32.0 AND 39.5),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN 123.5 AND 132.5),
  navi_name TEXT,
  navi_url TEXT,
  kakao_place_id TEXT UNIQUE,
  has_restroom BOOLEAN NOT NULL DEFAULT false,
  has_store BOOLEAN NOT NULL DEFAULT false,
  is_promoted BOOLEAN NOT NULL DEFAULT false,
  promoted_until TIMESTAMPTZ,
  promo_badge_text TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fishing_shops_updated_at
  ON public.fishing_shops (updated_at ASC);

ALTER TABLE public.fishing_shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on fishing_shops" ON public.fishing_shops;
DROP POLICY IF EXISTS "Allow public all on fishing_shops" ON public.fishing_shops;
CREATE POLICY "Allow public all on fishing_shops"
  ON public.fishing_shops
  FOR ALL
  USING (true)
  WITH CHECK (true);

REVOKE UPDATE (is_promoted, promoted_until, promo_badge_text)
  ON public.fishing_shops FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.shop_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES public.fishing_shops(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_memos_shop_created
  ON public.shop_memos (shop_id, created_at DESC);

ALTER TABLE public.shop_memos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public all on shop_memos" ON public.shop_memos;
CREATE POLICY "Allow public all on shop_memos"
  ON public.shop_memos
  FOR ALL
  USING (true)
  WITH CHECK (true);
