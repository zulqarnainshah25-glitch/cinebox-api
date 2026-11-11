-- =============================================================================
-- CINEBOX PRODUCTION SUPABASE SQL SCHEMA & LEAST-PRIVILEGE RLS (PHASE 1)
-- =============================================================================
-- Security Model:
-- 1. Admin & Moderator authorization relies strictly on Supabase Auth JWT claims:
--    - Admin:     (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
--    - Moderator: (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'moderator')
--    No client-side PIN (`admin_pin_hash`) or hardcoded `admin_email` exists.
-- 2. `movie_links`: Public SELECT on playback columns; INSERT/UPDATE/DELETE only for Admin/Moderator.
-- 3. `app_users`: `anon` has ZERO access; authenticated users can SELECT/UPDATE only their own row; Admin has full access.
-- 4. `app_config`: Public SELECT on non-sensitive configuration columns; writes only for Admin.
-- 5. New Tables with RLS: `watch_history`, `watchlist`, `audit_log`, `featured_collections`, `link_health`.
-- =============================================================================

-- =============================================================================
-- MIGRATION BLOCK FOR EXISTING DATABASES (Safe to run multiple times)
-- =============================================================================
ALTER TABLE IF EXISTS public.app_config
  DROP COLUMN IF EXISTS admin_pin_hash CASCADE,
  DROP COLUMN IF EXISTS admin_email CASCADE;

ALTER TABLE IF EXISTS public.movie_links
  ADD COLUMN IF NOT EXISTS subtitles JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS intro_start INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS intro_end INTEGER DEFAULT NULL;

-- =============================================================================
-- 1. JWT ROLE VERIFICATION FUNCTIONS (SECURITY DEFINER, NO HARDCODED EMAILS)
-- =============================================================================
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

-- =============================================================================
-- 2. TABLE: public.movie_links (Playback & Download Links)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.movie_links (
  tmdb_id BIGINT PRIMARY KEY,
  title TEXT DEFAULT '',
  language TEXT NOT NULL DEFAULT 'Hindi / English',
  direct_video_url TEXT DEFAULT '',
  hindi_dubbed_video_url TEXT DEFAULT '',
  urdu_dubbed_video_url TEXT DEFAULT '',
  alternate_streams JSONB DEFAULT '[]'::jsonb,
  subtitles JSONB DEFAULT '[]'::jsonb,
  intro_start INTEGER DEFAULT NULL,
  intro_end INTEGER DEFAULT NULL,
  stream_url TEXT DEFAULT '',
  download_480p TEXT DEFAULT '',
  download_720p TEXT DEFAULT '',
  download_1080p TEXT DEFAULT '',
  file_size_480p TEXT DEFAULT '450.0MB',
  file_size_720p TEXT DEFAULT '1020.6MB',
  file_size_1080p TEXT DEFAULT '2150.0MB',
  is_trending BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 3. TABLE: public.app_users (Authenticated User Profiles, Referrals & APK Trial)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.app_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user', -- 'user' | 'vip' | 'moderator' | 'admin'
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended' | 'banned'
  platform TEXT NOT NULL DEFAULT 'Android',
  downloads_count INTEGER NOT NULL DEFAULT 0,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT DEFAULT '',
  trial_start_date TIMESTAMPTZ DEFAULT NOW(),
  trial_end_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '3 days'),
  referral_code TEXT UNIQUE,
  referred_by TEXT DEFAULT NULL,
  successful_referrals INTEGER NOT NULL DEFAULT 0,
  access_expiry_date TIMESTAMPTZ DEFAULT NULL
);

-- =============================================================================
-- 4. TABLE: public.app_config (Global App Configuration — No PIN or Secrets)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.app_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  is_ads_enabled BOOLEAN NOT NULL DEFAULT false,
  ad_network_provider TEXT NOT NULL DEFAULT 'none',
  admob_app_id TEXT DEFAULT '',
  admob_banner_id TEXT DEFAULT '',
  admob_interstitial_id TEXT DEFAULT '',
  admob_app_open_id TEXT DEFAULT '',
  banner_ad_html TEXT DEFAULT '',
  popup_ad_link TEXT DEFAULT '',
  popup_ad_image TEXT DEFAULT '',
  app_name TEXT NOT NULL DEFAULT 'CineBox',
  primary_theme TEXT NOT NULL DEFAULT 'neon-green',
  featured_movie_ids TEXT DEFAULT '533535,872585,693134,550',
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  allow_guest_downloads BOOLEAN NOT NULL DEFAULT true,
  announcement_banner TEXT DEFAULT 'Welcome to CineBox — Stream HD Movies & Series with Offline Downloads!',
  apk_download_url TEXT DEFAULT 'https://drive.google.com/uc?export=download&id=1CineBoxLatestReleaseApk',
  apk_latest_version TEXT DEFAULT '1.0.2',
  apk_release_notes TEXT DEFAULT 'Latest CineBox Android APK (Google Drive Global Download, Native WebView Popup Blocker & Signature-Safe Update).',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.app_config (
  id, is_ads_enabled, ad_network_provider, banner_ad_html, popup_ad_link, popup_ad_image,
  app_name, primary_theme, featured_movie_ids, maintenance_mode, allow_guest_downloads,
  announcement_banner, apk_download_url, apk_latest_version, apk_release_notes
)
VALUES (
  1, false, 'none', '', '', '',
  'CineBox', 'neon-green', '533535,872585,693134,550', false, true,
  'Welcome to CineBox — Stream HD Movies & Series with Offline Downloads!',
  'https://drive.google.com/uc?export=download&id=1CineBoxLatestReleaseApk',
  '1.0.2',
  'Latest CineBox Android APK (Google Drive Global Download, Native WebView Popup Blocker & Signature-Safe Update).'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 5. NEW PHASE 1 TABLES: watch_history, watchlist, audit_log, featured_collections, link_health
-- =============================================================================

-- 5A. public.watch_history (Synced Continue Watching across devices)
CREATE TABLE IF NOT EXISTS public.watch_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id BIGINT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'movie', -- 'movie' | 'tv'
  season INTEGER NOT NULL DEFAULT 1,
  episode INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  poster_url TEXT DEFAULT '',
  backdrop_url TEXT DEFAULT '',
  current_time_seconds NUMERIC NOT NULL DEFAULT 0,
  duration_seconds NUMERIC NOT NULL DEFAULT 0,
  watched_percent NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tmdb_id, media_type, season, episode)
);

-- 5B. public.watchlist (Synced User Watchlist across devices)
CREATE TABLE IF NOT EXISTS public.watchlist (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id BIGINT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'movie',
  title TEXT NOT NULL DEFAULT '',
  poster_url TEXT DEFAULT '',
  backdrop_url TEXT DEFAULT '',
  release_year TEXT DEFAULT '',
  rating NUMERIC DEFAULT 0,
  language TEXT DEFAULT '',
  genres JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tmdb_id, media_type)
);

-- 5C. public.audit_log (Immutable Admin & Moderator Audit Trail)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id UUID DEFAULT auth.uid(),
  admin_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL, -- e.g. 'UPSERT_MOVIE_LINK', 'DELETE_MOVIE_LINK', 'UPDATE_USER_STATUS', 'UPDATE_APP_CONFIG'
  target_table TEXT NOT NULL,
  target_row_id TEXT NOT NULL,
  before_data JSONB DEFAULT NULL,
  after_data JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5D. public.featured_collections (Curated Home Collections)
CREATE TABLE IF NOT EXISTS public.featured_collections (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title_en TEXT NOT NULL,
  title_ur TEXT NOT NULL DEFAULT '',
  description_en TEXT DEFAULT '',
  description_ur TEXT DEFAULT '',
  tmdb_ids INTEGER[] NOT NULL DEFAULT '{}',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5E. public.link_health (Automated & Admin Stream Health Reports)
CREATE TABLE IF NOT EXISTS public.link_health (
  id BIGSERIAL PRIMARY KEY,
  tmdb_id BIGINT NOT NULL,
  source_key TEXT NOT NULL, -- 'direct_video_url' | 'stream_url' | 'hindi_dubbed_video_url' | 'urdu_dubbed_video_url'
  tested_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown', -- 'healthy' | 'broken' | 'timeout' | 'unverified-iframe'
  http_code INTEGER DEFAULT NULL,
  latency_ms INTEGER DEFAULT NULL,
  error_message TEXT DEFAULT '',
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tmdb_id, source_key)
);

-- =============================================================================
-- 6. ENABLE ROW LEVEL SECURITY (RLS) & REVOKE BLANKET GRANTS
-- =============================================================================
ALTER TABLE public.movie_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_health ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.movie_links FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_config FROM anon, authenticated;
REVOKE ALL ON TABLE public.watch_history FROM anon, authenticated;
REVOKE ALL ON TABLE public.watchlist FROM anon, authenticated;
REVOKE ALL ON TABLE public.audit_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.featured_collections FROM anon, authenticated;
REVOKE ALL ON TABLE public.link_health FROM anon, authenticated;

-- Drop any legacy permissive policies
DROP POLICY IF EXISTS "Allow Public Read on movie_links" ON public.movie_links;
DROP POLICY IF EXISTS "Allow Anon Insert Update Delete on movie_links" ON public.movie_links;
DROP POLICY IF EXISTS "movie_links_public_select" ON public.movie_links;
DROP POLICY IF EXISTS "movie_links_admin_insert" ON public.movie_links;
DROP POLICY IF EXISTS "movie_links_admin_update" ON public.movie_links;
DROP POLICY IF EXISTS "movie_links_admin_delete" ON public.movie_links;

DROP POLICY IF EXISTS "Allow Public Access on app_users" ON public.app_users;
DROP POLICY IF EXISTS "app_users_self_select" ON public.app_users;
DROP POLICY IF EXISTS "app_users_self_insert" ON public.app_users;
DROP POLICY IF EXISTS "app_users_self_update" ON public.app_users;
DROP POLICY IF EXISTS "app_users_admin_delete" ON public.app_users;
DROP POLICY IF EXISTS "app_users_admin_all" ON public.app_users;

DROP POLICY IF EXISTS "Allow Public Read on app_config" ON public.app_config;
DROP POLICY IF EXISTS "Allow Public Update on app_config" ON public.app_config;
DROP POLICY IF EXISTS "app_config_public_select" ON public.app_config;
DROP POLICY IF EXISTS "app_config_admin_insert" ON public.app_config;
DROP POLICY IF EXISTS "app_config_admin_update" ON public.app_config;
DROP POLICY IF EXISTS "app_config_admin_delete" ON public.app_config;

-- =============================================================================
-- 7. POLICIES FOR public.movie_links
-- Public SELECT only on playback columns; INSERT/UPDATE/DELETE only for Admin
-- =============================================================================
GRANT SELECT (
  tmdb_id, title, language, direct_video_url, hindi_dubbed_video_url,
  urdu_dubbed_video_url, alternate_streams, subtitles, intro_start, intro_end,
  stream_url, download_480p, download_720p, download_1080p,
  file_size_480p, file_size_720p, file_size_1080p, is_trending, updated_at
) ON public.movie_links TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE public.movie_links TO authenticated;

CREATE POLICY "movie_links_public_select"
  ON public.movie_links FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "movie_links_admin_insert"
  ON public.movie_links FOR INSERT
  TO authenticated
  WITH CHECK (public.is_cinebox_admin() OR public.is_cinebox_moderator_or_admin());

CREATE POLICY "movie_links_admin_update"
  ON public.movie_links FOR UPDATE
  TO authenticated
  USING (public.is_cinebox_admin() OR public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_admin() OR public.is_cinebox_moderator_or_admin());

CREATE POLICY "movie_links_admin_delete"
  ON public.movie_links FOR DELETE
  TO authenticated
  USING (public.is_cinebox_admin());

-- =============================================================================
-- 8. POLICIES FOR public.app_users
-- `anon` has ZERO access; authenticated user can read/update only their own row;
-- Admin has full access.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users TO authenticated;

CREATE POLICY "app_users_self_select"
  ON public.app_users FOR SELECT
  TO authenticated
  USING (
    public.is_cinebox_admin()
    OR id = auth.uid()::text
    OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY "app_users_self_insert"
  ON public.app_users FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_cinebox_admin()
    OR (
      (id = auth.uid()::text OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')))
      AND role = 'user'
      AND status = 'active'
    )
  );

CREATE POLICY "app_users_self_update"
  ON public.app_users FOR UPDATE
  TO authenticated
  USING (
    public.is_cinebox_admin()
    OR id = auth.uid()::text
    OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  )
  WITH CHECK (
    public.is_cinebox_admin()
    OR (
      (id = auth.uid()::text OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')))
      AND role = 'user'
    )
  );

CREATE POLICY "app_users_admin_delete"
  ON public.app_users FOR DELETE
  TO authenticated
  USING (public.is_cinebox_admin());

-- =============================================================================
-- 9. POLICIES FOR public.app_config
-- Public SELECT only on non-sensitive columns; writes only for Admin
-- =============================================================================
GRANT SELECT (
  id, is_ads_enabled, ad_network_provider, admob_app_id, admob_banner_id,
  admob_interstitial_id, admob_app_open_id, banner_ad_html, popup_ad_link,
  popup_ad_image, app_name, primary_theme, featured_movie_ids,
  maintenance_mode, allow_guest_downloads, announcement_banner,
  apk_download_url, apk_latest_version, apk_release_notes, updated_at
) ON public.app_config TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE public.app_config TO authenticated;

CREATE POLICY "app_config_public_select"
  ON public.app_config FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "app_config_admin_insert"
  ON public.app_config FOR INSERT
  TO authenticated
  WITH CHECK (public.is_cinebox_admin());

CREATE POLICY "app_config_admin_update"
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (public.is_cinebox_admin())
  WITH CHECK (public.is_cinebox_admin());

CREATE POLICY "app_config_admin_delete"
  ON public.app_config FOR DELETE
  TO authenticated
  USING (public.is_cinebox_admin());

-- =============================================================================
-- 10. POLICIES FOR NEW TABLES (watch_history, watchlist, audit_log, featured_collections, link_health)
-- =============================================================================

-- 10A. watch_history: Authenticated users manage their own rows; Admin reads all
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.watch_history TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.watch_history_id_seq TO authenticated;

DROP POLICY IF EXISTS "watch_history_self_select" ON public.watch_history;
DROP POLICY IF EXISTS "watch_history_self_write" ON public.watch_history;
DROP POLICY IF EXISTS "watch_history_self_update" ON public.watch_history;
DROP POLICY IF EXISTS "watch_history_self_delete" ON public.watch_history;

CREATE POLICY "watch_history_self_select"
  ON public.watch_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_cinebox_admin());

CREATE POLICY "watch_history_self_write"
  ON public.watch_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watch_history_self_update"
  ON public.watch_history FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watch_history_self_delete"
  ON public.watch_history FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_cinebox_admin());

-- 10B. watchlist: Authenticated users manage their own rows; Admin reads all
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.watchlist TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.watchlist_id_seq TO authenticated;

DROP POLICY IF EXISTS "watchlist_self_select" ON public.watchlist;
DROP POLICY IF EXISTS "watchlist_self_write" ON public.watchlist;
DROP POLICY IF EXISTS "watchlist_self_delete" ON public.watchlist;

CREATE POLICY "watchlist_self_select"
  ON public.watchlist FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_cinebox_admin());

CREATE POLICY "watchlist_self_write"
  ON public.watchlist FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watchlist_self_delete"
  ON public.watchlist FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_cinebox_admin());

-- 10C. audit_log: Admin/Moderator INSERT & Admin SELECT only (Immutable)
GRANT SELECT, INSERT ON TABLE public.audit_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO authenticated;

DROP POLICY IF EXISTS "audit_log_admin_select" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_admin_insert" ON public.audit_log;

CREATE POLICY "audit_log_admin_select"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.is_cinebox_admin());

CREATE POLICY "audit_log_admin_insert"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (public.is_cinebox_moderator_or_admin());

-- 10D. featured_collections: Public SELECT active collections; Admin/Moderator write
GRANT SELECT ON TABLE public.featured_collections TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.featured_collections TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.featured_collections_id_seq TO authenticated;

DROP POLICY IF EXISTS "featured_collections_public_select" ON public.featured_collections;
DROP POLICY IF EXISTS "featured_collections_admin_write" ON public.featured_collections;

CREATE POLICY "featured_collections_public_select"
  ON public.featured_collections FOR SELECT
  TO anon, authenticated
  USING (is_active = true OR public.is_cinebox_moderator_or_admin());

CREATE POLICY "featured_collections_admin_write"
  ON public.featured_collections FOR ALL
  TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

-- 10E. link_health: Public SELECT; Admin/Moderator write
GRANT SELECT ON TABLE public.link_health TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.link_health TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.link_health_id_seq TO authenticated;

DROP POLICY IF EXISTS "link_health_public_select" ON public.link_health;
DROP POLICY IF EXISTS "link_health_admin_write" ON public.link_health;

CREATE POLICY "link_health_public_select"
  ON public.link_health FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "link_health_admin_write"
  ON public.link_health FOR ALL
  TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());
