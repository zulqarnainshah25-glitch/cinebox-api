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
-- Movies use season = 0, episode = 0 (default); TV Series use season >= 1, episode >= 1.
-- Uses a single `progress_seconds` column for playback resume position.
CREATE TABLE IF NOT EXISTS public.watch_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id BIGINT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
  season INTEGER NOT NULL DEFAULT 0,
  episode INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  poster_url TEXT DEFAULT '',
  backdrop_url TEXT DEFAULT '',
  progress_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  watched_percent NUMERIC NOT NULL DEFAULT 0,
  last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tmdb_id, media_type, season, episode)
);

-- Safe migration for existing databases
ALTER TABLE IF EXISTS public.watch_history
  ALTER COLUMN season SET DEFAULT 0,
  ALTER COLUMN episode SET DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  DROP COLUMN IF EXISTS position_seconds;

-- 5B. public.watchlist (Synced User Watchlist across devices)
CREATE TABLE IF NOT EXISTS public.watchlist (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id BIGINT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL DEFAULT '',
  poster_path TEXT NOT NULL DEFAULT '',
  poster_url TEXT DEFAULT '',
  backdrop_url TEXT DEFAULT '',
  release_year TEXT DEFAULT '',
  rating NUMERIC DEFAULT 0,
  language TEXT DEFAULT '',
  genres JSONB DEFAULT '[]'::jsonb,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tmdb_id, media_type)
);

ALTER TABLE IF EXISTS public.watchlist
  ADD COLUMN IF NOT EXISTS poster_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

-- =============================================================================
-- 10F. FIX 8: HARDENED USER FEEDBACK TABLE (Anti-Spam Rate Limit, Honeypot,
--      Strict Email Regex & Server-Side btrim(message) Length Enforcement)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  -- Server-side TRIM and length check (3 to 500 characters after btrim)
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 3 AND 500),
  -- Strict email regex validation on the database server when email is provided
  email TEXT DEFAULT NULL CHECK (
    email IS NULL OR (
      char_length(btrim(email)) BETWEEN 5 AND 120
      AND btrim(email) ~* '^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,15}$'
    )
  ),
  -- Anti-bot Honeypot field: must always remain empty string ''
  website_honeypot TEXT NOT NULL DEFAULT '' CHECK (website_honeypot = ''),
  -- Captures requester IP via PostgREST request.headers for server-side rate limiting
  client_ip TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at
  ON public.user_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_client_ip_created
  ON public.user_feedback (client_ip, created_at DESC);

-- Helper to extract client IP from PostgREST x-forwarded-for / cf-connecting-ip header
CREATE OR REPLACE FUNCTION public.get_request_client_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_headers text;
  headers_json json;
  forwarded_for text;
  cf_ip text;
BEGIN
  raw_headers := current_setting('request.headers', true);
  IF raw_headers IS NULL OR raw_headers = '' THEN
    RETURN 'unknown';
  END IF;
  headers_json := raw_headers::json;
  cf_ip := btrim(COALESCE(headers_json ->> 'cf-connecting-ip', ''));
  IF cf_ip <> '' THEN
    RETURN cf_ip;
  END IF;
  forwarded_for := btrim(split_part(COALESCE(headers_json ->> 'x-forwarded-for', ''), ',', 1));
  IF forwarded_for <> '' THEN
    RETURN forwarded_for;
  END IF;
  RETURN 'unknown';
EXCEPTION WHEN OTHERS THEN
  RETURN 'unknown';
END;
$$;

-- Server-side Rate-Limit Function: Max 3 feedback submissions per 1 hour per IP, user_id, or email
CREATE OR REPLACE FUNCTION public.check_feedback_rate_limit(
  p_user_id UUID DEFAULT NULL,
  p_email TEXT DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_ip text;
  clean_email text;
  recent_count integer;
BEGIN
  req_ip := public.get_request_client_ip();
  clean_email := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');

  SELECT COUNT(*)
    INTO recent_count
    FROM public.user_feedback f
   WHERE f.created_at > (now() - interval '1 hour')
     AND (
       (req_ip <> 'unknown' AND f.client_ip = req_ip)
       OR (p_user_id IS NOT NULL AND f.user_id = p_user_id)
       OR (clean_email IS NOT NULL AND lower(f.email) = clean_email)
     );

  RETURN COALESCE(recent_count, 0) < 3;
END;
$$;

-- Server-side BEFORE INSERT OR UPDATE Trigger: enforces btrim(message), normalizes email, and stamps client_ip
CREATE OR REPLACE FUNCTION public.trg_sanitize_user_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.message := btrim(COALESCE(NEW.message, ''));
  IF char_length(NEW.message) < 3 OR char_length(NEW.message) > 500 THEN
    RAISE EXCEPTION 'Feedback message must be between 3 and 500 characters after trimming.';
  END IF;

  NEW.email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  IF NEW.email IS NOT NULL AND (
    char_length(NEW.email) < 5
    OR char_length(NEW.email) > 120
    OR NEW.email !~* '^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,15}$'
  ) THEN
    RAISE EXCEPTION 'Invalid email format supplied for feedback.';
  END IF;

  NEW.website_honeypot := COALESCE(NEW.website_honeypot, '');
  IF NEW.website_honeypot <> '' THEN
    RAISE EXCEPTION 'Spam submission rejected by honeypot.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.client_ip := public.get_request_client_ip();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sanitize_user_feedback_before_write ON public.user_feedback;
CREATE TRIGGER sanitize_user_feedback_before_write
  BEFORE INSERT OR UPDATE ON public.user_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sanitize_user_feedback();

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_feedback FROM anon, authenticated;
GRANT INSERT ON TABLE public.user_feedback TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON TABLE public.user_feedback TO authenticated;

DROP POLICY IF EXISTS "Anyone can insert feedback" ON public.user_feedback;
DROP POLICY IF EXISTS "user_feedback_rate_limited_insert" ON public.user_feedback;
DROP POLICY IF EXISTS "Only admins can view feedback" ON public.user_feedback;
DROP POLICY IF EXISTS "user_feedback_admin_select" ON public.user_feedback;
DROP POLICY IF EXISTS "user_feedback_admin_update" ON public.user_feedback;
DROP POLICY IF EXISTS "user_feedback_admin_delete" ON public.user_feedback;

CREATE POLICY "user_feedback_rate_limited_insert"
  ON public.user_feedback FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    website_honeypot = ''
    AND char_length(btrim(message)) BETWEEN 3 AND 500
    AND (
      email IS NULL OR (
        char_length(btrim(email)) BETWEEN 5 AND 120
        AND btrim(email) ~* '^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,15}$'
      )
    )
    AND public.check_feedback_rate_limit(user_id, email)
  );

CREATE POLICY "user_feedback_admin_select"
  ON public.user_feedback FOR SELECT
  TO authenticated
  USING (public.is_cinebox_admin());

CREATE POLICY "user_feedback_admin_update"
  ON public.user_feedback FOR UPDATE
  TO authenticated
  USING (public.is_cinebox_admin())
  WITH CHECK (public.is_cinebox_admin());

CREATE POLICY "user_feedback_admin_delete"
  ON public.user_feedback FOR DELETE
  TO authenticated
  USING (public.is_cinebox_admin());

-- =============================================================================
-- 11. LIVE TV UPGRADE (ADDITIVE TABLES & RLS — NEVER DESTROYS EXISTING TABLES)
-- Canonical migration source: supabase/migrations/20261114_live_tv_upgrade.sql
-- =============================================================================
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
        'verified', 'geo_blocked', 'offline', 'invalid_manifest',
        'unsupported_format', 'cors_blocked', 'playback_error',
        'timeout', 'not_tested_from_pk', 'pending_review'
      )
    ),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, source_url)
);

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
  error_classification TEXT NOT NULL DEFAULT 'not_tested_from_pk',
  details TEXT NOT NULL DEFAULT '',
  last_success_at TIMESTAMPTZ DEFAULT NULL
);

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
GRANT SELECT ON TABLE public.live_epg_programmes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.live_epg_programmes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_live_favorites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_live_history TO authenticated;

DROP POLICY IF EXISTS "live_channels_public_approved_select" ON public.live_channels;
CREATE POLICY "live_channels_public_approved_select"
  ON public.live_channels FOR SELECT TO anon, authenticated
  USING (
    public.is_cinebox_moderator_or_admin()
    OR (
      is_published = true AND is_nsfw = false
      AND EXISTS (
        SELECT 1 FROM public.live_sources s
        WHERE s.channel_id = live_channels.id
          AND s.rights_status = 'approved' AND s.is_enabled = true
      )
    )
  );
DROP POLICY IF EXISTS "live_channels_admin_all" ON public.live_channels;
CREATE POLICY "live_channels_admin_all"
  ON public.live_channels FOR ALL TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

DROP POLICY IF EXISTS "live_sources_public_approved_select" ON public.live_sources;
CREATE POLICY "live_sources_public_approved_select"
  ON public.live_sources FOR SELECT TO anon, authenticated
  USING (public.is_cinebox_moderator_or_admin() OR (rights_status = 'approved' AND is_enabled = true));
DROP POLICY IF EXISTS "live_sources_admin_all" ON public.live_sources;
CREATE POLICY "live_sources_admin_all"
  ON public.live_sources FOR ALL TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

DROP POLICY IF EXISTS "live_source_checks_public_select" ON public.live_source_checks;
CREATE POLICY "live_source_checks_public_select"
  ON public.live_source_checks FOR SELECT TO anon, authenticated
  USING (
    public.is_cinebox_moderator_or_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sources s
      WHERE s.id = live_source_checks.source_id
        AND s.rights_status = 'approved' AND s.is_enabled = true
    )
  );
DROP POLICY IF EXISTS "live_source_checks_admin_all" ON public.live_source_checks;
CREATE POLICY "live_source_checks_admin_all"
  ON public.live_source_checks FOR ALL TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

DROP POLICY IF EXISTS "live_epg_public_select" ON public.live_epg_programmes;
CREATE POLICY "live_epg_public_select"
  ON public.live_epg_programmes FOR SELECT TO anon, authenticated
  USING (
    public.is_cinebox_moderator_or_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sources s
      WHERE s.channel_id = live_epg_programmes.channel_id
        AND s.rights_status = 'approved' AND s.is_enabled = true
    )
  );
DROP POLICY IF EXISTS "live_epg_admin_all" ON public.live_epg_programmes;
CREATE POLICY "live_epg_admin_all"
  ON public.live_epg_programmes FOR ALL TO authenticated
  USING (public.is_cinebox_moderator_or_admin())
  WITH CHECK (public.is_cinebox_moderator_or_admin());

DROP POLICY IF EXISTS "user_live_favorites_self_all" ON public.user_live_favorites;
CREATE POLICY "user_live_favorites_self_all"
  ON public.user_live_favorites FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_live_history_self_all" ON public.user_live_history;
CREATE POLICY "user_live_history_self_all"
  ON public.user_live_history FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Starter verified open / public-domain / free-to-air Live TV channels (idempotent)
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



