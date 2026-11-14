import {
  LivePlaybackStatus,
  LiveRightsStatus,
  LiveStreamFormat,
} from '../types/movie';
import { getSupabaseClient, getSupabaseCredentials } from './supabaseClient';
import {
  detectStreamFormatFromUrl,
  generateStableChannelId,
  generateStableSourceId,
  getActiveLiveCatalogUrl,
} from './iptvService';
import { sanitizeSafeUrl, stripHtmlAndScriptContent } from '../utils/securityValidator';

export interface AdminLiveChannelEntry {
  channelId: string;
  sourceId: string;
  name: string;
  country: string;
  language: string;
  categories: string[];
  logoUrl: string | null;
  streamUrl: string;
  format: LiveStreamFormat;
  provider: string;
  rightsStatus: LiveRightsStatus;
  playbackStatus: LivePlaybackStatus;
  allowBrowserProxy: boolean;
  isPublished: boolean;
  isEnabled: boolean;
  permissionEvidence: string | null;
  updatedAt: string;
}

export interface LiveTvBackendDiagnostic {
  catalogEndpoint: string;
  edgeFunctionReachable: boolean;
  edgeFunctionHttpStatus: number | null;
  schemaReady: boolean;
  publishedChannelCount: number;
  approvedSourceCount: number;
  message: string;
}

const SAFE_LIVE_SOURCE_SELECT_COLS =
  'id,channel_id,provider,source_url,allowed_domain,format,country,language,rights_status,available_countries,allow_browser_proxy,reviewed_at,last_checked_at,playback_status,is_enabled,priority,updated_at';

async function getAdminJwtToken(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

export async function diagnoseLiveTvBackend(
  fetchImpl: typeof fetch = fetch
): Promise<LiveTvBackendDiagnostic> {
  const { url: supabaseUrl, anonKey } = getSupabaseCredentials();
  const endpoint = getActiveLiveCatalogUrl();
  let edgeStatus: number | null = null;
  let edgeOk = false;
  let schemaReady = true;
  let publishedCount = 0;
  let approvedCount = 0;
  let msg = '';

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (anonKey) {
    headers['apikey'] = anonKey;
    headers['Authorization'] = `Bearer ${anonKey}`;
  }

  try {
    const res = await fetchImpl(endpoint, { method: 'GET', headers });
    edgeStatus = res.status;
    if (res.ok) {
      edgeOk = true;
      const payload = await res.json();
      schemaReady = payload?.schemaReady !== false;
      publishedCount = Array.isArray(payload?.channels) ? payload.channels.length : 0;
      approvedCount = publishedCount;
      msg = !schemaReady
        ? String(
            payload?.diagnostic ||
              'live_channels / live_sources tables missing in Supabase SQL.'
          )
        : publishedCount > 0
        ? `live-catalog HTTP 200 OK · ${publishedCount} approved channel(s) published.`
        : 'live-catalog HTTP 200 OK, but 0 approved channels in database yet.';
    } else if (res.status === 401) {
      msg =
        'live-catalog returned HTTP 401 (JWT Verification ON). Redeploy with `--no-verify-jwt` or set VITE_SUPABASE_ANON_KEY.';
    } else if (res.status === 404) {
      msg =
        'live-catalog Edge Function not found (404). Deploy `live-catalog` in Supabase Edge Functions.';
    } else {
      msg = `live-catalog returned HTTP ${res.status}.`;
    }
  } catch {
    msg = 'Unable to reach live-catalog Edge Function endpoint.';
  }

  // Also check PostgREST directly if configured
  if (supabaseUrl && anonKey) {
    try {
      const restCh = await fetchImpl(
        `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/live_channels?select=id&is_published=eq.true&limit=200`,
        { method: 'GET', headers }
      );
      if (!restCh.ok) {
        const body = await restCh.text().catch(() => '');
        if (restCh.status === 404 || /does not exist|42P01|PGRST205/i.test(body)) {
          schemaReady = false;
          msg =
            'Live TV SQL tables (`live_channels`, `live_sources`) are missing in Supabase. Copy & run the Live TV SQL Schema below!';
        }
      } else {
        const rows = await restCh.json();
        if (Array.isArray(rows)) {
          publishedCount = Math.max(publishedCount, rows.length);
        }
      }
    } catch {
      // ignore network error
    }
  }

  return {
    catalogEndpoint: endpoint,
    edgeFunctionReachable: edgeOk,
    edgeFunctionHttpStatus: edgeStatus,
    schemaReady,
    publishedChannelCount: publishedCount,
    approvedSourceCount: approvedCount,
    message: msg,
  };
}

export async function adminFetchAllLiveChannels(
  fetchImpl: typeof fetch = fetch
): Promise<{
  ok: boolean;
  entries: AdminLiveChannelEntry[];
  schemaReady: boolean;
  error?: string;
}> {
  const jwt = await getAdminJwtToken();
  const { anonKey } = getSupabaseCredentials();
  const catalogUrl = getActiveLiveCatalogUrl();

  // 1. Try privileged `live-catalog` POST list_all_admin first (shows pending + rejected + permission_evidence)
  if (jwt) {
    try {
      const res = await fetchImpl(catalogUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(anonKey ? { apikey: anonKey } : {}),
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ action: 'list_all_admin' }),
      });

      if (res.ok) {
        const payload = await res.json();
        const chList = Array.isArray(payload?.channels) ? payload.channels : [];
        const srcList = Array.isArray(payload?.sources) ? payload.sources : [];
        return {
          ok: true,
          schemaReady: payload?.schemaReady !== false,
          entries: mergeChannelsAndSourcesForAdmin(chList, srcList),
        };
      }
    } catch {
      // Fall through to Supabase client RLS query
    }
  }

  // 2. Fallback: Direct authenticated Supabase PostgREST RLS query
  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      schemaReady: true,
      entries: [],
      error: 'Supabase client is not configured (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).',
    };
  }

  try {
    const [chRes, srcRes] = await Promise.all([
      client
        .from('live_channels')
        .select('id,tvg_id,name,country,language,categories,logo_url,is_published,updated_at')
        .order('updated_at', { ascending: false })
        .limit(300),
      client
        .from('live_sources')
        .select(SAFE_LIVE_SOURCE_SELECT_COLS)
        .order('updated_at', { ascending: false })
        .limit(500),
    ]);

    if (chRes.error || srcRes.error) {
      const errMsg = chRes.error?.message || srcRes.error?.message || 'Query error';
      const missing = /does not exist|42P01|PGRST205/i.test(errMsg);
      return {
        ok: false,
        schemaReady: !missing,
        entries: [],
        error: missing
          ? 'Live TV SQL tables do not exist in Supabase yet. Run the Live TV SQL Schema first.'
          : errMsg,
      };
    }

    return {
      ok: true,
      schemaReady: true,
      entries: mergeChannelsAndSourcesForAdmin(chRes.data || [], srcRes.data || []),
    };
  } catch (err) {
    return {
      ok: false,
      schemaReady: true,
      entries: [],
      error: err instanceof Error ? err.message : 'Failed to load Live TV database entries.',
    };
  }
}

function mergeChannelsAndSourcesForAdmin(chRows: any[], srcRows: any[]): AdminLiveChannelEntry[] {
  const chMap = new Map<string, any>();
  for (const ch of chRows) {
    if (ch?.id) chMap.set(String(ch.id), ch);
  }

  const entries: AdminLiveChannelEntry[] = [];
  for (const src of srcRows) {
    const ch = chMap.get(String(src.channel_id));
    if (!ch) continue;
    entries.push({
      channelId: String(ch.id),
      sourceId: String(src.id),
      name: String(ch.name || ch.id),
      country: String(ch.country || 'INTL'),
      language: String(ch.language || 'und'),
      categories: Array.isArray(ch.categories) ? ch.categories : ['General'],
      logoUrl: sanitizeSafeUrl(ch.logo_url),
      streamUrl: String(src.source_url || ''),
      format: (src.format || 'hls') as LiveStreamFormat,
      provider: String(src.provider || 'curated'),
      rightsStatus: (src.rights_status || 'pending') as LiveRightsStatus,
      playbackStatus: (src.playback_status || 'not_tested_from_pk') as LivePlaybackStatus,
      allowBrowserProxy: Boolean(src.allow_browser_proxy),
      isPublished: Boolean(ch.is_published),
      isEnabled: Boolean(src.is_enabled),
      permissionEvidence: src.permission_evidence ? String(src.permission_evidence) : null,
      updatedAt: String(src.updated_at || ch.updated_at || ''),
    });
  }
  return entries;
}

export interface AdminUpsertLiveChannelInput {
  channelId?: string;
  name: string;
  country: string;
  language: string;
  category: string;
  logoUrl?: string | null;
  streamUrl: string;
  format?: LiveStreamFormat;
  provider?: string;
  permissionEvidence: string;
  allowBrowserProxy: boolean;
  approveImmediately: boolean;
}

export async function adminUpsertAndApproveLiveChannel(
  input: AdminUpsertLiveChannelInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; channelId?: string; sourceId?: string; error?: string }> {
  const cleanName = stripHtmlAndScriptContent(input.name, 90);
  const safeStream = sanitizeSafeUrl(input.streamUrl);
  if (!cleanName || !safeStream) {
    return { ok: false, error: 'Valid channel name and http(s) HLS/DASH URL are required.' };
  }

  let domain = '';
  try {
    domain = new URL(safeStream).hostname.toLowerCase();
  } catch {
    return { ok: false, error: 'Invalid stream URL.' };
  }

  const country = (input.country || 'INTL').trim().toUpperCase().slice(0, 6) || 'INTL';
  const language = (input.language || 'und').trim().toLowerCase().slice(0, 12) || 'und';
  const category = stripHtmlAndScriptContent(input.category || 'General', 40) || 'General';
  const channelId =
    (input.channelId || '').trim() ||
    generateStableChannelId({ name: cleanName, country, streamUrl: safeStream });
  const sourceId = generateStableSourceId(channelId, safeStream);
  const format =
    input.format && input.format !== 'unknown'
      ? input.format
      : detectStreamFormatFromUrl(safeStream) === 'dash'
      ? 'dash'
      : 'hls';
  const nowIso = new Date().toISOString();

  // 1. Try Edge Function `live-catalog` POST first (works seamlessly with Admin JWT)
  const jwt = await getAdminJwtToken();
  const { anonKey } = getSupabaseCredentials();
  if (jwt) {
    try {
      const res = await fetchImpl(getActiveLiveCatalogUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(anonKey ? { apikey: anonKey } : {}),
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          action: 'upsert_and_approve',
          approve: input.approveImmediately,
          channel: {
            id: channelId,
            tvg_id: channelId,
            name: cleanName,
            country,
            language,
            categories: [category],
            logo_url: sanitizeSafeUrl(input.logoUrl),
            is_published: input.approveImmediately,
          },
          source: {
            id: sourceId,
            provider: input.provider || 'admin-verified',
            source_url: safeStream,
            format,
            rights_status: input.approveImmediately ? 'approved' : 'pending',
            permission_evidence:
              stripHtmlAndScriptContent(input.permissionEvidence, 240) ||
              'Verified by CineBox Administrator',
            allow_browser_proxy: input.allowBrowserProxy,
            is_enabled: input.approveImmediately,
            playback_status: 'not_tested_from_pk',
          },
        }),
      });
      if (res.ok) {
        return { ok: true, channelId, sourceId };
      }
    } catch {
      // Fallback to direct Supabase PostgREST RLS upsert
    }
  }

  // 2. Fallback: Direct authenticated Supabase RLS upsert
  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      error: 'Supabase not connected. Sign in as Admin with Supabase Auth configured.',
    };
  }

  const { error: chErr } = await client.from('live_channels').upsert(
    {
      id: channelId,
      tvg_id: channelId,
      name: cleanName,
      country,
      language,
      categories: [category],
      logo_url: sanitizeSafeUrl(input.logoUrl),
      is_nsfw: false,
      is_published: input.approveImmediately,
      updated_at: nowIso,
    },
    { onConflict: 'id' }
  );

  if (chErr) {
    return { ok: false, error: `Channel save failed: ${chErr.message}` };
  }

  const { error: srcErr } = await client.from('live_sources').upsert(
    {
      id: sourceId,
      channel_id: channelId,
      provider: input.provider || 'admin-verified',
      source_url: safeStream,
      allowed_domain: domain,
      format,
      country,
      language,
      rights_status: input.approveImmediately ? 'approved' : 'pending',
      available_countries: ['GLOBAL'],
      permission_evidence:
        stripHtmlAndScriptContent(input.permissionEvidence, 240) ||
        'Verified by CineBox Administrator',
      allow_browser_proxy: input.allowBrowserProxy,
      reviewed_at: input.approveImmediately ? nowIso : null,
      playback_status: 'not_tested_from_pk',
      is_enabled: input.approveImmediately,
      priority: 20,
      updated_at: nowIso,
    },
    { onConflict: 'id' }
  );

  if (srcErr) {
    return { ok: false, error: `Source save failed: ${srcErr.message}` };
  }

  return { ok: true, channelId, sourceId };
}

export async function adminUpdateLiveSourceRights(
  params: {
    channelId: string;
    sourceId: string;
    rightsStatus: LiveRightsStatus;
    isEnabled: boolean;
    isPublished: boolean;
    allowBrowserProxy: boolean;
    permissionEvidence?: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string }> {
  const jwt = await getAdminJwtToken();
  const { anonKey } = getSupabaseCredentials();
  if (jwt) {
    try {
      const res = await fetchImpl(getActiveLiveCatalogUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(anonKey ? { apikey: anonKey } : {}),
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          action: 'update_rights',
          ...params,
        }),
      });
      if (res.ok) return { ok: true };
    } catch {
      // Fallback to direct RLS update
    }
  }

  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Supabase not configured.' };
  }

  const nowIso = new Date().toISOString();
  const [chRes, srcRes] = await Promise.all([
    client
      .from('live_channels')
      .update({ is_published: params.isPublished, updated_at: nowIso })
      .eq('id', params.channelId),
    client
      .from('live_sources')
      .update({
        rights_status: params.rightsStatus,
        is_enabled: params.isEnabled,
        allow_browser_proxy: params.allowBrowserProxy,
        ...(params.permissionEvidence ? { permission_evidence: params.permissionEvidence } : {}),
        reviewed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', params.sourceId),
  ]);

  if (chRes.error || srcRes.error) {
    return {
      ok: false,
      error: chRes.error?.message || srcRes.error?.message || 'Failed updating Live TV rights.',
    };
  }
  return { ok: true };
}

export const LIVE_TV_UPGRADE_SQL_SNIPPET = `-- Run in Supabase Dashboard -> SQL Editor -> New Query
-- Creates live_channels, live_sources, live_source_checks, live_epg_programmes,
-- user_live_favorites, user_live_history + RLS policies + 6 verified open FTA starter channels.

CREATE OR REPLACE FUNCTION public.is_cinebox_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

CREATE OR REPLACE FUNCTION public.is_cinebox_moderator_or_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'moderator'), false);
$$;

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
  rights_status TEXT NOT NULL DEFAULT 'pending' CHECK (rights_status IN ('pending', 'approved', 'rejected', 'expired')),
  available_countries TEXT[] NOT NULL DEFAULT '{}'::text[],
  permission_evidence TEXT DEFAULT NULL,
  allow_browser_proxy BOOLEAN NOT NULL DEFAULT false,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_checked_at TIMESTAMPTZ DEFAULT NULL,
  playback_status TEXT NOT NULL DEFAULT 'not_tested_from_pk',
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

REVOKE ALL ON TABLE public.live_channels, public.live_sources, public.live_source_checks, public.live_epg_programmes, public.user_live_favorites, public.user_live_history FROM anon, authenticated;

GRANT SELECT ON TABLE public.live_channels TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.live_channels TO authenticated;
GRANT SELECT (id, channel_id, provider, source_url, allowed_domain, format, country, language, rights_status, available_countries, allow_browser_proxy, reviewed_at, last_checked_at, playback_status, is_enabled, priority, updated_at) ON TABLE public.live_sources TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.live_sources TO authenticated;
GRANT SELECT ON TABLE public.live_source_checks, public.live_epg_programmes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.live_source_checks, public.live_epg_programmes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_live_favorites, public.user_live_history TO authenticated;

DROP POLICY IF EXISTS "live_channels_public_approved_select" ON public.live_channels;
CREATE POLICY "live_channels_public_approved_select" ON public.live_channels FOR SELECT TO anon, authenticated
USING (public.is_cinebox_moderator_or_admin() OR (is_published = true AND is_nsfw = false AND EXISTS (SELECT 1 FROM public.live_sources s WHERE s.channel_id = live_channels.id AND s.rights_status = 'approved' AND s.is_enabled = true)));

DROP POLICY IF EXISTS "live_channels_admin_all" ON public.live_channels;
CREATE POLICY "live_channels_admin_all" ON public.live_channels FOR ALL TO authenticated USING (public.is_cinebox_moderator_or_admin()) WITH CHECK (public.is_cinebox_moderator_or_admin());

DROP POLICY IF EXISTS "live_sources_public_approved_select" ON public.live_sources;
CREATE POLICY "live_sources_public_approved_select" ON public.live_sources FOR SELECT TO anon, authenticated USING (public.is_cinebox_moderator_or_admin() OR (rights_status = 'approved' AND is_enabled = true));

DROP POLICY IF EXISTS "live_sources_admin_all" ON public.live_sources;
CREATE POLICY "live_sources_admin_all" ON public.live_sources FOR ALL TO authenticated USING (public.is_cinebox_moderator_or_admin()) WITH CHECK (public.is_cinebox_moderator_or_admin());

DROP POLICY IF EXISTS "live_epg_public_select" ON public.live_epg_programmes;
CREATE POLICY "live_epg_public_select" ON public.live_epg_programmes FOR SELECT TO anon, authenticated USING (public.is_cinebox_moderator_or_admin() OR EXISTS (SELECT 1 FROM public.live_sources s WHERE s.channel_id = live_epg_programmes.channel_id AND s.rights_status = 'approved' AND s.is_enabled = true));

DROP POLICY IF EXISTS "live_epg_admin_all" ON public.live_epg_programmes;
CREATE POLICY "live_epg_admin_all" ON public.live_epg_programmes FOR ALL TO authenticated USING (public.is_cinebox_moderator_or_admin()) WITH CHECK (public.is_cinebox_moderator_or_admin());

DROP POLICY IF EXISTS "user_live_favorites_self_all" ON public.user_live_favorites;
CREATE POLICY "user_live_favorites_self_all" ON public.user_live_favorites FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_live_history_self_all" ON public.user_live_history;
CREATE POLICY "user_live_history_self_all" ON public.user_live_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Starter Seed: Open Public-Domain & Official Free-to-Air HLS Channels
INSERT INTO public.live_channels (id, tvg_id, name, country, language, categories, logo_url, website, is_nsfw, is_published)
VALUES
  ('DWEnglish.de', 'DWEnglish.de', 'DW English', 'INTL', 'en', '["News","Documentary"]'::jsonb, 'https://static.dw.com/cssi/images/dw-logo-blue.png', 'https://www.dw.com/en/live-tv/s-100825', false, true),
  ('DWArabic.de', 'DWArabic.de', 'DW Arabic', 'INTL', 'ar', '["News","Documentary"]'::jsonb, 'https://static.dw.com/cssi/images/dw-logo-blue.png', 'https://www.dw.com/ar/', false, true),
  ('RedBullTV.at', 'RedBullTV.at', 'Red Bull TV', 'INTL', 'en', '["Sports","Entertainment"]'::jsonb, 'https://resources.redbull.com/icons/redbullcom/v2/favicon.ico', 'https://www.redbull.com/int-en/live-events', false, true),
  ('NASATVPublic.us', 'NASATVPublic.us', 'NASA TV Public', 'INTL', 'en', '["Documentary","Science","News"]'::jsonb, 'https://www.nasa.gov/wp-content/themes/nasa/assets/images/nasa-logo.svg', 'https://www.nasa.gov/nasatv/', false, true),
  ('NASATVMedia.us', 'NASATVMedia.us', 'NASA TV Media', 'INTL', 'en', '["Documentary","Science"]'::jsonb, 'https://www.nasa.gov/wp-content/themes/nasa/assets/images/nasa-logo.svg', 'https://www.nasa.gov/nasatv/', false, true),
  ('MuxOpenDemo.intl', 'MuxOpenDemo.intl', 'CineBox Open Cinema (HLS)', 'INTL', 'en', '["Movies","Entertainment"]'::jsonb, NULL, 'https://mux.com', false, true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, categories = EXCLUDED.categories, is_published = true, updated_at = NOW();

INSERT INTO public.live_sources (id, channel_id, provider, source_url, allowed_domain, format, country, language, rights_status, available_countries, permission_evidence, allow_browser_proxy, reviewed_at, playback_status, is_enabled, priority)
VALUES
  ('src-dw-english-hls', 'DWEnglish.de', 'official-fta', 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8', 'dwamdstream102.akamaized.net', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'Official Deutsche Welle open free-to-air HLS stream', true, NOW(), 'not_tested_from_pk', true, 10),
  ('src-dw-arabic-hls', 'DWArabic.de', 'official-fta', 'https://dwamdstream103.akamaized.net/hls/live/2015526/dwstream103/index.m3u8', 'dwamdstream103.akamaized.net', 'hls', 'INTL', 'ar', 'approved', ARRAY['GLOBAL'], 'Official Deutsche Welle Arabic open free-to-air HLS stream', true, NOW(), 'not_tested_from_pk', true, 20),
  ('src-redbull-tv-hls', 'RedBullTV.at', 'official-fta', 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8', 'rbmn-live.akamaized.net', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'Official Red Bull TV open free-to-air live stream', true, NOW(), 'not_tested_from_pk', true, 10),
  ('src-nasa-public-hls', 'NASATVPublic.us', 'public-domain', 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8', 'ntv1.akamaized.net', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'US federal public-domain NASA Public Educational HLS', true, NOW(), 'not_tested_from_pk', true, 10),
  ('src-nasa-media-hls', 'NASATVMedia.us', 'public-domain', 'https://ntv2.akamaized.net/hls/live/2013923/NASA-NTV2-HLS/master.m3u8', 'ntv2.akamaized.net', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'US federal public-domain NASA Media Educational HLS', true, NOW(), 'not_tested_from_pk', true, 20),
  ('src-mux-open-demo-hls', 'MuxOpenDemo.intl', 'open-cc', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'test-streams.mux.dev', 'hls', 'INTL', 'en', 'approved', ARRAY['GLOBAL'], 'Creative Commons Mux Open HLS reference stream', true, NOW(), 'not_tested_from_pk', true, 50)
ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url, rights_status = 'approved', is_enabled = true, allow_browser_proxy = true, updated_at = NOW();`;
