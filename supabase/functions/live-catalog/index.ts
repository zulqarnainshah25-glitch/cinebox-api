// Supabase Edge Function: supabase/functions/live-catalog/index.ts
// Deploy with JWT gate disabled for public GET catalogue:
//   supabase functions deploy live-catalog --no-verify-jwt
// (Or set VITE_LIVE_CATALOG_URL if you deployed under another slug such as `live-cataloge`.)
//
// Public GET `/functions/v1/live-catalog?country=PK&category=News&language=ur&search=...&channelId=...`
// - Queries `live_channels` + `live_sources` + `live_epg_programmes`.
// - Strictly returns ONLY sources where `rights_status = 'approved'` AND `is_enabled = true`.
// - Never returns pending, rejected, expired, or NSFW entries to public consumers.
// - Reports `schemaReady: false` and `diagnostic` if SQL tables have not been created yet.
//
// Admin POST `/functions/v1/live-catalog`
// - Requires EITHER `X-Sync-Secret` matching `LIVE_CATALOG_SYNC_SECRET`
//   OR an authenticated Supabase Admin/Moderator JWT (`app_metadata.role IN ('admin', 'moderator')`).
// - Supports actions:
//   - `{ action: "list_all_admin" }` -> lists all channels + sources for Admin Live TV Manager
//   - `{ action: "upsert_and_approve", channel: {...}, source: {...} }` -> saves & approves a channel
//   - `{ action: "update_rights", sourceId, channelId, rightsStatus, isEnabled, allowBrowserProxy, isPublished, permissionEvidence }`
//   - default / `{ action: "sync" }` -> sync verification hook

declare const Deno: any;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export interface LiveCatalogQueryDeps {
  fetchChannelsAndSources?: () => Promise<{
    channels: any[];
    sources: any[];
    epgProgrammes: any[];
    schemaReady?: boolean;
    diagnostic?: string | null;
  }>;
  verifySyncAuthorized?: (req: Request) => Promise<boolean>;
  runIngestionSync?: () => Promise<{ ingestedChannels: number; ingestedSources: number }>;
  handleAdminAction?: (body: any, adminUserId: string | null) => Promise<Response>;
}

/**
 * Strictly filters raw database rows so pending/rejected/expired/disabled sources NEVER leak publicly.
 */
export function buildCuratedPublicCatalogPayload(params: {
  channels: any[];
  sources: any[];
  epgProgrammes: any[];
  filters: {
    country?: string;
    category?: string;
    language?: string;
    search?: string;
    channelId?: string;
  };
  nowIso?: string;
  schemaReady?: boolean;
  diagnostic?: string | null;
}) {
  const countryFilter = (params.filters.country || '').trim().toUpperCase();
  const categoryFilter = (params.filters.category || '').trim().toLowerCase();
  const languageFilter = (params.filters.language || '').trim().toLowerCase();
  const searchFilter = (params.filters.search || '').trim().toLowerCase();
  const channelIdFilter = (params.filters.channelId || '').trim().toLowerCase();

  const sourcesByChannel = new Map<string, any[]>();
  for (const src of params.sources || []) {
    if (!src || src.rights_status !== 'approved' || src.is_enabled !== true) {
      continue;
    }
    const list = sourcesByChannel.get(src.channel_id) || [];
    list.push({
      id: src.id,
      channelId: src.channel_id,
      provider: src.provider || 'curated',
      sourceUrl: src.source_url,
      allowedDomain: src.allowed_domain || '',
      format: src.format || 'hls',
      country: src.country || 'INTL',
      language: src.language || 'und',
      rightsStatus: 'approved',
      availableCountries: Array.isArray(src.available_countries) ? src.available_countries : [],
      permissionEvidence: null, // Never leak internal review docs publicly
      allowBrowserProxy: Boolean(src.allow_browser_proxy),
      reviewedAt: src.reviewed_at || null,
      lastCheckedAt: src.last_checked_at || null,
      playbackStatus: src.playback_status || 'not_tested_from_pk',
      isEnabled: true,
      priority: typeof src.priority === 'number' ? src.priority : 100,
    });
    sourcesByChannel.set(src.channel_id, list);
  }

  const publishedChannels: any[] = [];
  for (const ch of params.channels || []) {
    if (!ch || ch.is_nsfw === true || ch.is_published !== true) continue;
    const approvedSources = (sourcesByChannel.get(ch.id) || []).sort(
      (a, b) => a.priority - b.priority
    );
    if (approvedSources.length === 0) continue;

    if (channelIdFilter && String(ch.id).toLowerCase() !== channelIdFilter) continue;
    if (
      countryFilter &&
      countryFilter !== 'ALL' &&
      String(ch.country || '').toUpperCase() !== countryFilter
    ) {
      continue;
    }

    const chCats: string[] = Array.isArray(ch.categories) ? ch.categories : ['General'];
    if (
      categoryFilter &&
      categoryFilter !== 'all' &&
      !chCats.some((c) => String(c).toLowerCase() === categoryFilter)
    ) {
      continue;
    }

    const chLang = String(ch.language || 'und').toLowerCase();
    if (languageFilter && languageFilter !== 'all' && chLang !== languageFilter) {
      continue;
    }

    if (searchFilter) {
      const hay = `${ch.name || ''} ${ch.country || ''} ${chCats.join(' ')}`.toLowerCase();
      if (!hay.includes(searchFilter)) continue;
    }

    const primarySource = approvedSources[0];
    publishedChannels.push({
      id: ch.id,
      tvgId: ch.tvg_id || ch.id,
      name: ch.name,
      logoUrl: ch.logo_url || null,
      country: ch.country || 'INTL',
      language: ch.language || 'und',
      categories: chCats,
      website: ch.website || null,
      isNsfw: false,
      rightsStatus: 'approved',
      playbackStatus: primarySource.playbackStatus,
      lastCheckedAt: primarySource.lastCheckedAt,
      pkTested: primarySource.playbackStatus === 'verified',
      sources: approvedSources,
    });
  }

  const allowedChannelIds = new Set(publishedChannels.map((c) => c.id));
  const filteredEpg = (params.epgProgrammes || [])
    .filter((p) => allowedChannelIds.has(p.channel_id))
    .map((p) => ({
      id: String(p.id),
      channelId: p.channel_id,
      tvgId: p.tvg_id || p.channel_id,
      title: p.title,
      description: p.description || '',
      category: p.category || '',
      language: p.language || 'und',
      startAtUtc: p.start_at,
      endAtUtc: p.end_at,
    }));

  const nowIso = params.nowIso || new Date().toISOString();
  return {
    version: `cat-${nowIso.slice(0, 10)}-${publishedChannels.length}`,
    updatedAt: nowIso,
    totalCount: publishedChannels.length,
    schemaReady: params.schemaReady !== false,
    diagnostic: params.diagnostic || null,
    channels: publishedChannels,
    epgProgrammes: filteredEpg,
  };
}

function getSupabaseServerConfig() {
  const supabaseUrl =
    typeof Deno !== 'undefined'
      ? (Deno.env.get('SUPABASE_URL') || '').trim().replace(/\/+$/, '')
      : '';
  const serviceKey =
    typeof Deno !== 'undefined' ? (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim() : '';
  const anonKey =
    typeof Deno !== 'undefined' ? (Deno.env.get('SUPABASE_ANON_KEY') || '').trim() : '';
  return { supabaseUrl, serviceKey, anonKey };
}

async function fetchFromSupabaseTables() {
  const { supabaseUrl, serviceKey, anonKey } = getSupabaseServerConfig();
  const key = serviceKey || anonKey;

  if (!supabaseUrl || !key) {
    return {
      channels: [],
      sources: [],
      epgProgrammes: [],
      schemaReady: false,
      diagnostic: 'Supabase Edge Function runtime is missing SUPABASE_URL or API key environment variables.',
    };
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };

  const nowIso = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const [chRes, srcRes, epgRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/live_channels?is_published=eq.true&is_nsfw=eq.false&select=*`, {
      headers,
    }),
    fetch(
      `${supabaseUrl}/rest/v1/live_sources?rights_status=eq.approved&is_enabled=eq.true&select=id,channel_id,provider,source_url,allowed_domain,format,country,language,rights_status,available_countries,allow_browser_proxy,reviewed_at,last_checked_at,playback_status,is_enabled,priority`,
      { headers }
    ),
    fetch(
      `${supabaseUrl}/rest/v1/live_epg_programmes?end_at=gte.${encodeURIComponent(nowIso)}&select=*&limit=1000`,
      { headers }
    ),
  ]);

  if (!chRes.ok || !srcRes.ok) {
    const chErr = !chRes.ok ? await chRes.text().catch(() => `HTTP ${chRes.status}`) : '';
    const srcErr = !srcRes.ok ? await srcRes.text().catch(() => `HTTP ${srcRes.status}`) : '';
    const combinedErr = `${chErr} ${srcErr}`.trim();
    const isMissingRelation =
      chRes.status === 404 ||
      srcRes.status === 404 ||
      /does not exist|42P01|PGRST205/i.test(combinedErr);

    return {
      channels: [],
      sources: [],
      epgProgrammes: [],
      schemaReady: !isMissingRelation,
      diagnostic: isMissingRelation
        ? 'Live TV tables (live_channels / live_sources) do not exist in Supabase yet. Run supabase/migrations/20261114_live_tv_upgrade.sql in Supabase SQL Editor.'
        : `Supabase query error (${chRes.status}/${srcRes.status}): ${combinedErr.slice(0, 220)}`,
    };
  }

  const channels = await chRes.json();
  const sources = await srcRes.json();
  const epgProgrammes = epgRes.ok ? await epgRes.json() : [];

  return {
    channels: Array.isArray(channels) ? channels : [],
    sources: Array.isArray(sources) ? sources : [],
    epgProgrammes: Array.isArray(epgProgrammes) ? epgProgrammes : [],
    schemaReady: true,
    diagnostic: null,
  };
}

async function verifyAdminAuth(req: Request): Promise<{
  authorized: boolean;
  via: 'sync-secret' | 'admin-jwt' | 'none';
  userId: string | null;
}> {
  const expectedSecret =
    typeof Deno !== 'undefined' ? (Deno.env.get('LIVE_CATALOG_SYNC_SECRET') || '').trim() : '';
  const providedSecret = (req.headers.get('x-sync-secret') || '').trim();
  if (expectedSecret && providedSecret && expectedSecret === providedSecret) {
    return { authorized: true, via: 'sync-secret', userId: null };
  }

  const authHeader = (req.headers.get('authorization') || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { authorized: false, via: 'none', userId: null };
  }

  const { supabaseUrl, serviceKey, anonKey } = getSupabaseServerConfig();
  const apiKey = serviceKey || anonKey;
  if (!supabaseUrl || !apiKey) {
    return { authorized: false, via: 'none', userId: null };
  }

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Authorization: authHeader,
      },
    });
    if (!userRes.ok) {
      return { authorized: false, via: 'none', userId: null };
    }
    const user = await userRes.json();
    const role = String(user?.app_metadata?.role || '').toLowerCase();
    if (role === 'admin' || role === 'moderator') {
      return {
        authorized: true,
        via: 'admin-jwt',
        userId: typeof user?.id === 'string' ? user.id : null,
      };
    }
  } catch {
    return { authorized: false, via: 'none', userId: null };
  }

  return { authorized: false, via: 'none', userId: null };
}

function jsonResponse(body: unknown, status = 200, cacheControl?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
    },
  });
}

async function executeAdminPostAction(body: any, adminUserId: string | null): Promise<Response> {
  const { supabaseUrl, serviceKey } = getSupabaseServerConfig();
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      {
        error:
          'Edge Function requires SUPABASE_SERVICE_ROLE_KEY for server-side Live TV channel management.',
      },
      500
    );
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=representation',
  };

  const action = String(body?.action || 'sync');

  if (action === 'list_all_admin') {
    const [chRes, srcRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/live_channels?select=*&order=updated_at.desc&limit=500`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }),
      fetch(`${supabaseUrl}/rest/v1/live_sources?select=*&order=updated_at.desc&limit=1000`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }),
    ]);

    if (!chRes.ok || !srcRes.ok) {
      const msg = await chRes.text().catch(() => 'Database query error');
      return jsonResponse({ error: msg, schemaReady: false }, 400);
    }

    return jsonResponse({
      ok: true,
      schemaReady: true,
      channels: await chRes.json(),
      sources: await srcRes.json(),
    });
  }

  if (action === 'upsert_and_approve') {
    const ch = body?.channel || {};
    const src = body?.source || {};
    const channelId = String(ch.id || '').trim();
    const channelName = String(ch.name || '').trim();
    const sourceUrl = String(src.source_url || src.sourceUrl || '').trim();

    if (!channelId || !channelName || !/^https?:\/\//i.test(sourceUrl)) {
      return jsonResponse(
        { error: 'Missing valid channel.id, channel.name, or http(s) sourceUrl.' },
        400
      );
    }

    let allowedDomain = '';
    try {
      allowedDomain = new URL(sourceUrl).hostname.toLowerCase();
    } catch {
      return jsonResponse({ error: 'Invalid stream URL format.' }, 400);
    }

    const approveNow = src.rights_status === 'approved' || src.rightsStatus === 'approved' || body?.approve === true;
    const nowIso = new Date().toISOString();

    const chRow = {
      id: channelId,
      tvg_id: String(ch.tvg_id || ch.tvgId || channelId),
      name: channelName,
      country: String(ch.country || 'INTL').toUpperCase().slice(0, 6),
      language: String(ch.language || 'und').toLowerCase().slice(0, 12),
      categories: Array.isArray(ch.categories) && ch.categories.length > 0 ? ch.categories : ['General'],
      logo_url: ch.logo_url || ch.logoUrl || null,
      website: ch.website || null,
      is_nsfw: false,
      is_published: approveNow ? true : Boolean(ch.is_published ?? ch.isPublished ?? false),
      updated_at: nowIso,
    };

    const chUpsert = await fetch(`${supabaseUrl}/rest/v1/live_channels?on_conflict=id`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chRow),
    });

    if (!chUpsert.ok) {
      return jsonResponse({ error: await chUpsert.text() }, chUpsert.status);
    }

    const sourceId = String(src.id || `src-${channelId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    const srcRow = {
      id: sourceId,
      channel_id: channelId,
      provider: String(src.provider || 'admin-verified'),
      source_url: sourceUrl,
      allowed_domain: allowedDomain,
      format:
        src.format === 'dash' || sourceUrl.toLowerCase().includes('.mpd') ? 'dash' : 'hls',
      country: chRow.country,
      language: chRow.language,
      rights_status: approveNow ? 'approved' : String(src.rights_status || src.rightsStatus || 'pending'),
      available_countries: Array.isArray(src.available_countries) ? src.available_countries : ['GLOBAL'],
      permission_evidence: String(
        src.permission_evidence || src.permissionEvidence || 'Verified by CineBox Administrator'
      ),
      allow_browser_proxy: Boolean(src.allow_browser_proxy ?? src.allowBrowserProxy ?? true),
      reviewed_at: approveNow ? nowIso : null,
      reviewed_by: adminUserId || null,
      playback_status: String(src.playback_status || src.playbackStatus || 'not_tested_from_pk'),
      is_enabled: approveNow ? true : Boolean(src.is_enabled ?? src.isEnabled ?? false),
      priority: typeof src.priority === 'number' ? src.priority : 20,
      updated_at: nowIso,
    };

    const srcUpsert = await fetch(`${supabaseUrl}/rest/v1/live_sources?on_conflict=id`, {
      method: 'POST',
      headers,
      body: JSON.stringify(srcRow),
    });

    if (!srcUpsert.ok) {
      return jsonResponse({ error: await srcUpsert.text() }, srcUpsert.status);
    }

    return jsonResponse({ ok: true, channel: chRow, source: srcRow });
  }

  if (action === 'update_rights') {
    const channelId = String(body?.channelId || '').trim();
    const sourceId = String(body?.sourceId || '').trim();
    const rightsStatus = String(body?.rightsStatus || 'approved');
    const isEnabled = Boolean(body?.isEnabled);
    const allowBrowserProxy = Boolean(body?.allowBrowserProxy);
    const isPublished = body?.isPublished !== undefined ? Boolean(body.isPublished) : rightsStatus === 'approved' && isEnabled;
    const nowIso = new Date().toISOString();

    if (!channelId || !sourceId) {
      return jsonResponse({ error: 'channelId and sourceId are required.' }, 400);
    }

    const patchHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    const [chPatch, srcPatch] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/live_channels?id=eq.${encodeURIComponent(channelId)}`, {
        method: 'PATCH',
        headers: patchHeaders,
        body: JSON.stringify({ is_published: isPublished, updated_at: nowIso }),
      }),
      fetch(`${supabaseUrl}/rest/v1/live_sources?id=eq.${encodeURIComponent(sourceId)}`, {
        method: 'PATCH',
        headers: patchHeaders,
        body: JSON.stringify({
          rights_status: rightsStatus,
          is_enabled: isEnabled,
          allow_browser_proxy: allowBrowserProxy,
          permission_evidence: body?.permissionEvidence || 'Updated by CineBox Administrator',
          reviewed_at: nowIso,
          reviewed_by: adminUserId || null,
          updated_at: nowIso,
        }),
      }),
    ]);

    if (!chPatch.ok || !srcPatch.ok) {
      return jsonResponse(
        { error: 'Failed to update rights status in Supabase.' },
        400
      );
    }

    return jsonResponse({ ok: true, channelId, sourceId, rightsStatus, isEnabled, isPublished });
  }

  return jsonResponse({
    ok: true,
    message:
      'Authorized. Pass action="upsert_and_approve", "update_rights", or "list_all_admin", or run scripts/verify_live_sources.mjs for full PK stream probing.',
  });
}

export async function handleLiveCatalogRequest(
  req: Request,
  deps: LiveCatalogQueryDeps = {}
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method === 'GET') {
    const reqUrl = new URL(req.url);
    const filters = {
      country: reqUrl.searchParams.get('country') || undefined,
      category: reqUrl.searchParams.get('category') || undefined,
      language: reqUrl.searchParams.get('language') || undefined,
      search: reqUrl.searchParams.get('search') || undefined,
      channelId: reqUrl.searchParams.get('channelId') || undefined,
    };

    try {
      const data = deps.fetchChannelsAndSources
        ? await deps.fetchChannelsAndSources()
        : await fetchFromSupabaseTables();
      const payload = buildCuratedPublicCatalogPayload({
        ...data,
        filters,
      });

      return jsonResponse(
        payload,
        200,
        payload.channels.length > 0 ? 'public, max-age=120, s-maxage=300' : 'no-store'
      );
    } catch (err: unknown) {
      return jsonResponse(
        {
          error: err instanceof Error ? err.message : 'Failed to query live catalog.',
        },
        500
      );
    }
  }

  if (req.method === 'POST') {
    let syncAuthorized = false;
    let adminUserId: string | null = null;

    if (deps.verifySyncAuthorized) {
      syncAuthorized = await deps.verifySyncAuthorized(req);
    } else {
      const auth = await verifyAdminAuth(req);
      syncAuthorized = auth.authorized;
      adminUserId = auth.userId;
    }

    if (!syncAuthorized) {
      return jsonResponse({ error: 'Unauthorized catalog sync or admin request.' }, 401);
    }

    if (deps.runIngestionSync) {
      const summary = await deps.runIngestionSync();
      return jsonResponse({ ok: true, ...summary }, 200);
    }

    let body: any = {};
    try {
      const raw = await req.text();
      if (raw.trim()) body = JSON.parse(raw);
    } catch {
      body = {};
    }

    if (deps.handleAdminAction) {
      return await deps.handleAdminAction(body, adminUserId);
    }

    return await executeAdminPostAction(body, adminUserId);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve((req: Request) => handleLiveCatalogRequest(req));
}
