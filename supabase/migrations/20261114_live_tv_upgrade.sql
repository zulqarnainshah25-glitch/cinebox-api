-- =============================================================================
-- CINEBOX LIVE TV UPGRADE — ADDITIVE SUPABASE MIGRATION (STAGE THREE)
-- =============================================================================
-- Preserves all existing tables (`movie_links`, `app_users`, `app_config`,
-- `watch_history`, `watchlist`, `audit_log`, `featured_collections`, `link_health`,
-- `user_feedback`).
--
-- Adds Live TV Rights Approval, Verification Logs, EPG, User Favorites, and
-- User Live Watch History with strict Least-Privilege Row Level Security (RLS).
-- =============================================================================

-- 0. Standalone Role Verification Helpers (safe to re-run even before supabase_schema.sql)
CREATE OR REPLACE FUNCTION public.is_cinebox_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_cinebox_moderator_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'moderator'),
    false
  );
$$;

-- 1. public.live_channels
CREATE TABLE IF NOT EXISTS public.live_channels (
  id TEXT PRIMARY KEY,
  tvg_id TEXT DEFAULT '',
  name TEXT NOT NULL,
  alt_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  country TEXT NOT NULL DEFAULT 'INTL',
  language TEXT NOT NULL DEFAULT 'und',
  categories JSONB NOT NULL DEFAULT '["General"]'::jsonb,
  logo_url TEXT DEFAULT NULL,
  website TEXT DEFAULT NULL,
  epg_guide_id TEXT DEFAULT NULL,
  is_nsfw BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_channels_country ON public.live_channels (country);
CREATE INDEX IF NOT EXISTS idx_live_channels_language ON public.live_channels (language);
CREATE INDEX IF NOT EXISTS idx_live_channels_published ON public.live_channels (is_published, is_nsfw);
CREATE INDEX IF NOT EXISTS idx_live_channels_tvg_id ON public.live_channels (tvg_id);

-- 2. public.live_sources (Rights approval & technical verification are independent fields)
CREATE TABLE IF NOT EXISTS public.live_sources (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES public.live_channels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'iptv-org',
  source_url TEXT NOT NULL,
  allowed_domain TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'hls' CHECK (format IN ('hls', 'dash', 'unknown')),
  country TEXT NOT NULL DEFAULT 'INTL',
  language TEXT NOT NULL DEFAULT 'und',
  rights_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (rights_status IN ('pending', 'approved', 'rejected', 'expired')),
  available_countries TEXT[] NOT NULL DEFAULT '{}'::text[],
  permission_evidence TEXT DEFAULT NULL,
  allow_browser_proxy BOOLEAN NOT NULL DEFAULT false,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_checked_at TIMESTAMPTZ DEFAULT NULL,
  playback_status TEXT NOT NULL DEFAULT 'not_tested_from_pk'
    CHECK (
      playback_status IN (
        'verified',
        'geo_blocked',
        'offline',
        'invalid_manifest',
        'unsupported_format',
        'cors_blocked',
        'playback_error',
        'timeout',
        'not_tested_from_pk',
        'pending_review'
      )
    ),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_live_sources_channel_id ON public.live_sources (channel_id);
CREATE INDEX IF NOT EXISTS idx_live_sources_public_gate
  ON public.live_sources (rights_status, is_enabled, playback_status);
CREATE INDEX IF NOT EXISTS idx_live_sources_allowed_domain ON public.live_sources (allowed_domain);

-- 3. public.live_source_checks (Append-only technical & Pakistan verification log)
CREATE TABLE IF NOT EXISTS public.live_source_checks (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES public.live_sources(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES public.live_channels(id) ON DELETE CASCADE,
  test_country TEXT NOT NULL DEFAULT 'UNKNOWN',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  test_method TEXT NOT NULL DEFAULT 'edge-probe',
  dns_ok BOOLEAN NOT NULL DEFAULT false,
  tls_ok BOOLEAN NOT NULL DEFAULT false,
  manifest_ok BOOLEAN NOT NULL DEFAULT false,
  media_playlist_ok BOOLEAN NOT NULL DEFAULT false,
  segment_ok BOOLEAN NOT NULL DEFAULT false,
  playback_ok BOOLEAN NOT NULL DEFAULT false,
  mime_type TEXT DEFAULT NULL,
  http_status INTEGER DEFAULT NULL,
  stability_seconds INTEGER NOT NULL DEFAULT 0,
  error_classification TEXT NOT NULL DEFAULT 'not_tested_from_pk'
    CHECK (
      error_classification IN (
        'verified',
        'geo_blocked',
        'offline',
        'invalid_manifest',
        'unsupported_format',
        'cors_blocked',
        'playback_error',
        'timeout',
        'not_tested_from_pk',
        'pending_review'
      )
    ),
  details TEXT NOT NULL DEFAULT '',
  last_success_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_live_source_checks_source_checked
  ON public.live_source_checks (source_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_source_checks_country
  ON public.live_source_checks (test_country, checked_at DESC);

-- 4. public.live_epg_programmes (Guide schedules matched to channel_id / tvg_id)
CREATE TABLE IF NOT EXISTS public.live_epg_programmes (
  id BIGSERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES public.live_channels(id) ON DELETE CASCADE,
  tvg_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'und',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  guide_source TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, start_at, title)
);

CREATE INDEX IF NOT EXISTS idx_live_epg_channel_window
  ON public.live_epg_programmes (channel_id, start_at, end_at);

-- 5. public.user_live_favorites
CREATE TABLE IF NOT EXISTS public.user_live_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  logo_url TEXT DEFAULT NULL,
  country TEXT NOT NULL DEFAULT 'INTL',
  category TEXT NOT NULL DEFAULT 'General',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_user_live_favorites_user
  ON public.user_live_favorites (user_id, created_at DESC);

-- 6. public.user_live_history
CREATE TABLE IF NOT EXISTS public.user_live_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  source_id TEXT DEFAULT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  logo_url TEXT DEFAULT NULL,
  country TEXT NOT NULL DEFAULT 'INTL',
  category TEXT NOT NULL DEFAULT 'General',
  last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_user_live_history_user_recent
  ON public.user_live_history (user_id, last_watched_at DESC);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) & LEAST-PRIVILEGE GRANTS
-- =============================================================================
ALTER TABLE public.live_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_source_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_epg_programmes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_live_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_live_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.live_channels FROM anon, authenticated;
REVOKE ALL ON TABLE public.live_sources FROM anon, authenticated;
REVOKE ALL ON TABLE public.live_source_checks FROM anon, authenticated;
REVOKE ALL ON TABLE public.live_epg_programmes FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_live_favorites FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_live_history FROM anon, authenticated;

-- Grants for public read (filtered strictly by RLS) & admin writes
GRANT SELECT ON TABLE public.live_channels TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.live_channels TO authenticated;

GRANT SELECT (
  id, channel_id, provider, source_url, allowed_domain, format, country, language,
  rights_status, available_countries, allow_browser_proxy, reviewed_at,
  last_checked_at, playback_status, is_enabled, priority, updated_at
) ON TABLE public.live_sources TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.live_sources TO authenticated;

GRANT SELECT ON TABLE public.live_source_checks TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.live_source_checks TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.live_source_checks_id_seq TO authenticated;

GRANT SELECT ON TABLE public.live_epg_programmes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.live_epg_programmes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.live_epg_programmes_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_live_favorites TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.user_live_favorites_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_live_history TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.user_live_history_id_seq TO authenticated;

-- live_channels policies: Public reads ONLY published non-NSFW channels that have >=1 approved & enabled source
DROP POLICY IF EXISTS "live_channels_public_approved_select" ON public.live_channels;
DROP POLICY IF EXISTS "live_channels_admin_all" ON public.live_channels;

CREATE POLICY "live_channels_public_approved_select"
  ON public.live_channels FOR SELECT
  TO anon, authenticated
  USING (
    public.is_cinebox_moderator_or_admin()
    OR (
      is_published = true
      AND is_nsfw = false
      AND EXISTS (
        SELECT 1
          FROM public.live_sources s
         WHERE s.channel_id = live_channels.id
           AND s.rights_status = 'approved'
           AND s.is_enabled = true
      )
    )
  );

CREATE POLICY "live_channels_admin_all"
  ON public.live_channels FOR ALL
  TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

-- live_sources policies: Public reads ONLY approved & enabled sources; only admin/mod can create/approve/update
DROP POLICY IF EXISTS "live_sources_public_approved_select" ON public.live_sources;
DROP POLICY IF EXISTS "live_sources_admin_all" ON public.live_sources;

CREATE POLICY "live_sources_public_approved_select"
  ON public.live_sources FOR SELECT
  TO anon, authenticated
  USING (
    public.is_cinebox_moderator_or_admin()
    OR (rights_status = 'approved' AND is_enabled = true)
  );

CREATE POLICY "live_sources_admin_all"
  ON public.live_sources FOR ALL
  TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

-- live_source_checks policies: Public reads checks for approved & enabled sources; admin/mod write
DROP POLICY IF EXISTS "live_source_checks_public_select" ON public.live_source_checks;
DROP POLICY IF EXISTS "live_source_checks_admin_all" ON public.live_source_checks;

CREATE POLICY "live_source_checks_public_select"
  ON public.live_source_checks FOR SELECT
  TO anon, authenticated
  USING (
    public.is_cinebox_moderator_or_admin()
    OR EXISTS (
      SELECT 1
        FROM public.live_sources s
       WHERE s.id = live_source_checks.source_id
         AND s.rights_status = 'approved'
         AND s.is_enabled = true
    )
  );

CREATE POLICY "live_source_checks_admin_all"
  ON public.live_source_checks FOR ALL
  TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

-- live_epg_programmes policies: Public reads EPG for approved channels; admin/mod write
DROP POLICY IF EXISTS "live_epg_public_select" ON public.live_epg_programmes;
DROP POLICY IF EXISTS "live_epg_admin_all" ON public.live_epg_programmes;

CREATE POLICY "live_epg_public_select"
  ON public.live_epg_programmes FOR SELECT
  TO anon, authenticated
  USING (
    public.is_cinebox_moderator_or_admin()
    OR EXISTS (
      SELECT 1
        FROM public.live_sources s
       WHERE s.channel_id = live_epg_programmes.channel_id
         AND s.rights_status = 'approved'
         AND s.is_enabled = true
    )
  );

CREATE POLICY "live_epg_admin_all"
  ON public.live_epg_programmes FOR ALL
  TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

-- user_live_favorites policies: Strictly user's own rows
DROP POLICY IF EXISTS "user_live_favorites_self_all" ON public.user_live_favorites;
CREATE POLICY "user_live_favorites_self_all"
  ON public.user_live_favorites FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_live_history policies: Strictly user's own rows
DROP POLICY IF EXISTS "user_live_history_self_all" ON public.user_live_history;
CREATE POLICY "user_live_history_self_all"
  ON public.user_live_history FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- 7. IDEMPOTENT STARTER SEED: VERIFIED OPEN / PUBLIC-DOMAIN & FREE-TO-AIR STREAMS
-- =============================================================================
-- Seeds genuinely open public-domain federal / free-to-air OTT HLS streams so
-- the Live TV section works immediately after running this migration.
-- Playback status remains 'not_tested_from_pk' until verified from Pakistan.
INSERT INTO public.live_channels (id, tvg_id, name, country, language, categories, logo_url, website, is_nsfw, is_published)
VALUES
  ('DWEnglish.de', 'DWEnglish.de', 'DW English', 'INTL', 'en', '["News","Documentary"]'::jsonb, 'https://static.dw.com/cssi/images/dw-logo-blue.png', 'https://www.dw.com/en/live-tv/s-100825', false, true),
  ('DWArabic.de', 'DWArabic.de', 'DW Arabic', 'INTL', 'ar', '["News","Documentary"]'::jsonb, 'https://static.dw.com/cssi/images/dw-logo-blue.png', 'https://www.dw.com/ar/', false, true),
  ('RedBullTV.at', 'RedBullTV.at', 'Red Bull TV', 'INTL', 'en', '["Sports","Entertainment"]'::jsonb, 'https://resources.redbull.com/icons/redbullcom/v2/favicon.ico', 'https://www.redbull.com/int-en/live-events', false, true),
  ('NASATVPublic.us', 'NASATVPublic.us', 'NASA TV Public', 'INTL', 'en', '["Documentary","Science","News"]'::jsonb, 'https://www.nasa.gov/wp-content/themes/nasa/assets/images/nasa-logo.svg', 'https://www.nasa.gov/nasatv/', false, true),
  ('NASATVMedia.us', 'NASATVMedia.us', 'NASA TV Media', 'INTL', 'en', '["Documentary","Science"]'::jsonb, 'https://www.nasa.gov/wp-content/themes/nasa/assets/images/nasa-logo.svg', 'https://www.nasa.gov/nasatv/', false, true),
  ('MuxOpenDemo.intl', 'MuxOpenDemo.intl', 'CineBox Open Cinema (HLS)', 'INTL', 'en', '["Movies","Entertainment"]'::jsonb, NULL, 'https://mux.com', false, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  language = EXCLUDED.language,
  categories = EXCLUDED.categories,
  website = EXCLUDED.website,
  is_nsfw = false,
  is_published = true,
  updated_at = NOW();

INSERT INTO public.live_sources (
  id, channel_id, provider, source_url, allowed_domain, format, country, language,
  rights_status, available_countries, permission_evidence, allow_browser_proxy,
  reviewed_at, playback_status, is_enabled, priority
)
VALUES
  ('src-dw-english-hls', 'DWEnglish.de', 'official-fta', 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8', 'dwamdstream102.akamaized.net', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'Official Deutsche Welle public international broadcaster open free-to-air HLS stream', true, NOW(), 'not_tested_from_pk', true, 10),
  ('src-dw-arabic-hls', 'DWArabic.de', 'official-fta', 'https://dwamdstream103.akamaized.net/hls/live/2015526/dwstream103/index.m3u8', 'dwamdstream103.akamaized.net', 'hls', 'INTL', 'ar', 'approved', ARRAY['GLOBAL'], 'Official Deutsche Welle Arabic public international broadcaster open free-to-air HLS stream', true, NOW(), 'not_tested_from_pk', true, 20),
  ('src-redbull-tv-hls', 'RedBullTV.at', 'official-fta', 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8', 'rbmn-live.akamaized.net', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'Official Red Bull TV open free-to-air live sports & entertainment channel', true, NOW(), 'not_tested_from_pk', true, 10),
  ('src-nasa-public-hls', 'NASATVPublic.us', 'public-domain', 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8', 'ntv1.akamaized.net', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'US federal public-domain NASA Public Educational HLS broadcast', true, NOW(), 'not_tested_from_pk', true, 10),
  ('src-nasa-media-hls', 'NASATVMedia.us', 'public-domain', 'https://ntv2.akamaized.net/hls/live/2013923/NASA-NTV2-HLS/master.m3u8', 'ntv2.akamaized.net', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'US federal public-domain NASA Media Educational HLS broadcast', true, NOW(), 'not_tested_from_pk', true, 20),
  ('src-mux-open-demo-hls', 'MuxOpenDemo.intl', 'open-cc', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'test-streams.mux.dev', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'Creative Commons Big Buck Bunny Adaptive HLS open-access stream', true, NOW(), 'not_tested_from_pk', true, 50)
ON CONFLICT (id) DO UPDATE SET
  source_url = EXCLUDED.source_url,
  allowed_domain = EXCLUDED.allowed_domain,
  rights_status = 'approved',
  allow_browser_proxy = true,
  is_enabled = true,
  updated_at = NOW();

-- Example Admin SQL to approve an additional channel once broadcaster rights are confirmed:
-- UPDATE public.live_channels SET is_published = true, updated_at = NOW() WHERE id = 'YOUR_CHANNEL_ID';
-- UPDATE public.live_sources
--   SET rights_status = 'approved',
--       is_enabled = true,
--       allow_browser_proxy = true,
--       permission_evidence = 'Broadcaster authorization ref / official free-to-air URL verified',
--       reviewed_at = NOW()
-- WHERE channel_id = 'YOUR_CHANNEL_ID';

