import { MovieItem } from '../types/movie';
import { sanitizeSafeUrl } from '../utils/securityValidator';

export const MOVIEBOX_SEARCH_ENDPOINT =
  'https://h5.aoneroom.com/wefeed-h5api-bff/subject/search';

export const MOVIEBOX_PLAY_ENDPOINT =
  'https://h5.aoneroom.com/wefeed-h5api-bff/media/play';

export const MOVIEBOX_REQUIRED_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'User-Agent':
    'com.community.mbox.in/50020130 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)',
  Referer: 'https://api3.aoneroom.com/',
});

/**
 * Deployed Supabase Edge Function CORS Proxy:
 * Format: `https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy?target={original_url}`
 */
export const DEFAULT_SUPABASE_CORS_PROXY_URL =
  'https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy';

export function getActiveCorsProxyBaseUrl(): string {
  const envCors = String((import.meta as any).env?.VITE_CORS_PROXY_URL || '').trim();
  const safeEnv = sanitizeSafeUrl(envCors);
  return safeEnv || DEFAULT_SUPABASE_CORS_PROXY_URL;
}

export const CLIENT_PROXIES = [
  {
    name: 'supabase-cors-proxy',
    prefix: `${DEFAULT_SUPABASE_CORS_PROXY_URL}?target=`,
  },
  {
    name: 'corsproxy.io',
    prefix: 'https://corsproxy.io/?',
  },
  {
    name: 'allorigins.win',
    prefix: 'https://api.allorigins.win/raw?url=',
  },
] as const;

/**
 * Builds the proxied URL for fetching an external movie source:
 * - Default / Supabase CORS Proxy format:
 *   `https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy?target={encoded_original_url}`
 * - Also preserves compatibility when a custom `proxyPrefix` (such as `https://corsproxy.io/?`) is passed.
 */
export function buildProxiedUrl(
  targetUrl: string,
  proxyPrefix: string = `${getActiveCorsProxyBaseUrl()}?target=`
): string {
  const safeTarget = sanitizeSafeUrl(targetUrl);
  if (!safeTarget || !proxyPrefix) {
    return '';
  }

  const trimmedPrefix = proxyPrefix.trim();
  // If a base `/functions/v1/cors-proxy` URL was passed without `?target=`, append `?target=` automatically
  if (
    trimmedPrefix.endsWith('/cors-proxy') ||
    trimmedPrefix.endsWith('/cors-proxy/')
  ) {
    const cleanBase = trimmedPrefix.replace(/\/+$/, '');
    return `${cleanBase}?target=${encodeURIComponent(safeTarget)}`;
  }

  return `${trimmedPrefix}${encodeURIComponent(safeTarget)}`;
}

/**
 * Builds headers for CORS proxy requests.
 * When calling a Supabase Edge Function proxy (`*.supabase.co/functions/v1/...`),
 * attaches `apikey` and `Authorization: Bearer <VITE_SUPABASE_ANON_KEY>`.
 */
export function buildCorsProxyHeaders(
  proxiedOrBaseUrl?: string,
  anonKeyOverride?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
  };

  const anonKey = String(
    anonKeyOverride ?? (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? ''
  ).trim();

  const checkUrl = proxiedOrBaseUrl || getActiveCorsProxyBaseUrl();
  if (anonKey && checkUrl.includes('.supabase.co/functions/v1/')) {
    headers['apikey'] = anonKey;
    headers['Authorization'] = `Bearer ${anonKey}`;
  }

  return headers;
}

export function parseMovieBoxSearchResponse(rawJson: unknown): MovieItem[] {
  if (!rawJson || typeof rawJson !== 'object') return [];
  const dataObj = rawJson as Record<string, any>;
  const rawList: any[] =
    dataObj?.data?.items ||
    dataObj?.data?.results ||
    dataObj?.data?.subjectList ||
    dataObj?.items ||
    dataObj?.results ||
    [];

  if (!Array.isArray(rawList)) return [];

  const results: MovieItem[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item || typeof item !== 'object') continue;
    const rawId = String(item.subjectId || item.id || '').trim();
    const numericId = Number(rawId.replace(/\D/g, '')) || 900000 + i;
    const rawTitle = String(item.title || item.name || '')
      .replace(/[<>]/g, '')
      .trim();
    if (!rawTitle) continue;

    const rawCover =
      item.cover?.url ||
      (typeof item.cover === 'string' ? item.cover : '') ||
      item.image?.url ||
      item.poster ||
      '';
    const safePoster =
      sanitizeSafeUrl(rawCover) ||
      'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=600&q=80';

    const releaseYear = String(item.releaseDate || item.year || '2025').slice(0, 4);
    const rating = Number(item.imdbRatingValue || item.rating || 8.2) || 8.2;

    results.push({
      id: numericId,
      title: rawTitle,
      originalTitle: rawId || String(numericId),
      releaseYear: /^\d{4}$/.test(releaseYear) ? releaseYear : '2025',
      rating: Math.min(10, Math.max(0, rating)),
      language: 'Hindi / Dual Audio',
      languageBadge: 'Hindi / Dual Audio',
      genres: ['Action', 'Drama'],
      category: 'trending',
      mediaType: item.subjectType === 2 ? 'tv' : 'movie',
      posterUrl: safePoster,
      backdropUrl: safePoster,
      overview: String(item.description || `${rawTitle} (${releaseYear})`),
      runtime: '2h 10m',
      duration: '2h 10m',
      cast: [],
    });
  }

  return results;
}

export function parseMovieBoxStreamResponse(rawJson: unknown): string | null {
  if (!rawJson || typeof rawJson !== 'object') return null;
  const dataObj = rawJson as Record<string, any>;
  const streams: any[] =
    dataObj?.data?.streams ||
    dataObj?.data?.playList ||
    dataObj?.streams ||
    [];

  if (Array.isArray(streams) && streams.length > 0) {
    for (const s of streams) {
      const candidate = sanitizeSafeUrl(s?.url || s?.playUrl);
      if (candidate) return candidate;
    }
  }

  const direct =
    dataObj?.data?.url ||
    dataObj?.data?.playUrl ||
    dataObj?.url ||
    null;

  return typeof direct === 'string' ? sanitizeSafeUrl(direct) : null;
}
