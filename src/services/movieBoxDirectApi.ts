import { MovieItem } from '../types/movie';
import { sanitizeSafeUrl } from '../utils/securityValidator';

export const MOVIEBOX_SEARCH_ENDPOINT =
  'https://h5.aoneroom.com/wefeed-h5api-bff/subject/search';
export const MOVIEBOX_PLAY_ENDPOINT =
  'https://h5.aoneroom.com/wefeed-h5api-bff/media/play';

export const CLIENT_PROXIES = [
  {
    id: 'corsproxy',
    name: 'corsproxy.io',
    prefix: 'https://corsproxy.io/?',
  },
  {
    id: 'allorigins',
    name: 'api.allorigins.win',
    prefix: 'https://api.allorigins.win/raw?url=',
  },
] as const;

export const MOVIEBOX_REQUIRED_HEADERS: Record<string, string> = {
  'User-Agent':
    'com.community.mbox.in/50020130 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)',
  Referer: 'https://api3.aoneroom.com/',
};

export interface MovieBoxSearchResult {
  ok: boolean;
  items: MovieItem[];
  error?: string;
  proxyUsed?: string;
  targetUrl: string;
}

export interface MovieBoxStreamResult {
  ok: boolean;
  streamUrl: string | null;
  error?: string;
  proxyUsed?: string;
  targetUrl: string;
}

/**
 * Constructs a client-side proxied URL: `proxyPrefix + encodeURIComponent(targetUrl)`
 */
export function buildProxiedUrl(targetUrl: string, proxyPrefix: string): string {
  return `${proxyPrefix}${encodeURIComponent(targetUrl)}`;
}

/**
 * Parses the JSON response from `https://h5.aoneroom.com/wefeed-h5api-bff/subject/search?keyword={userQuery}`
 * Extracts `subjectId` (as ID), `title`, and `cover.url` (poster) from `data.items`.
 */
export function parseMovieBoxSearchResponse(rawJson: any): MovieItem[] {
  const items = rawJson?.data?.items;
  if (!Array.isArray(items)) {
    throw new Error('Invalid MovieBox search response: data.items is missing');
  }

  return items
    .filter((item: any) => item && (item.subjectId !== undefined || item.id !== undefined) && item.title)
    .map((item: any, idx: number): MovieItem => {
      const rawId = item.subjectId ?? item.id;
      const numericId = Number(String(rawId).replace(/\D/g, '').slice(0, 9)) || idx + 900000;
      const posterUrl =
        sanitizeSafeUrl(item?.cover?.url) ||
        sanitizeSafeUrl(item?.image?.url) ||
        sanitizeSafeUrl(item?.poster) ||
        'https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg';

      return {
        id: numericId,
        title: String(item.title).trim(),
        originalTitle: String(item.subjectId || numericId),
        releaseYear: String(item.releaseDate || item.year || '2025').slice(0, 4),
        rating: Number(item.imdbRatingValue || item.score || 8.2) || 8.2,
        language: item.language || 'Hindi / Eng',
        genres: Array.isArray(item.genre)
          ? item.genre.slice(0, 3)
          : typeof item.genre === 'string'
          ? item.genre.split(',').map((g: string) => g.trim()).filter(Boolean)
          : ['Action', 'Drama'],
        category: 'Trending',
        mediaType: Number(item.subjectType) === 2 ? 'tv' : 'movie',
        posterUrl,
        backdropUrl: posterUrl,
        overview:
          item.description ||
          `MovieBox Subject ID: ${rawId}. Click to fetch direct .mp4 stream via proxy and play in Blob Video Player.`,
        runtime: 'Full HD · Direct MP4',
        rankNumber: idx + 1,
        cast: [],
      };
    });
}

/**
 * Parses the JSON response from `https://h5.aoneroom.com/wefeed-h5api-bff/media/play?subjectId={subjectId}&se=0&ep=0`
 * Extracts `data.streams[0].url` as the direct `.mp4` stream URL.
 */
export function parseMovieBoxStreamResponse(rawJson: any): string | null {
  const streams = rawJson?.data?.streams;
  if (!Array.isArray(streams) || streams.length === 0) {
    return null;
  }
  const firstUrl = streams[0]?.url;
  return sanitizeSafeUrl(firstUrl);
}

/**
 * 1. Search Function (Client-Side Fetch with Multi-Proxy Fallback):
 * Calls `https://h5.aoneroom.com/wefeed-h5api-bff/subject/search?keyword={userQuery}`
 * First tries `https://corsproxy.io/?`, and if JSON parse or network fails, falls back to `https://api.allorigins.win/raw?url=`.
 * Sends required `User-Agent` and `Referer` headers.
 */
export async function searchMovieBoxViaProxy(userQuery: string): Promise<MovieBoxSearchResult> {
  const cleanQuery = (userQuery || '').trim();
  const targetUrl = `${MOVIEBOX_SEARCH_ENDPOINT}?keyword=${encodeURIComponent(cleanQuery)}`;

  for (const proxy of CLIENT_PROXIES) {
    const proxiedUrl = buildProxiedUrl(targetUrl, proxy.prefix);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(proxiedUrl, {
        method: 'GET',
        headers: MOVIEBOX_REQUIRED_HEADERS,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      const parsedJson = JSON.parse(text);
      const items = parseMovieBoxSearchResponse(parsedJson);

      if (items.length > 0) {
        return {
          ok: true,
          items,
          proxyUsed: proxy.name,
          targetUrl,
        };
      }
    } catch {
      // Try next proxy in CLIENT_PROXIES
      continue;
    }
  }

  return {
    ok: false,
    items: [],
    error: 'Server Busy, Try Again',
    targetUrl,
  };
}

/**
 * 2. Stream Link Fetch (Client-Side Fetch with Multi-Proxy Fallback):
 * Calls `https://h5.aoneroom.com/wefeed-h5api-bff/media/play?subjectId={subjectId}&se=0&ep=0`
 * via `corsproxy.io` -> fallback `allorigins.win` with required `User-Agent` and `Referer` headers.
 * Extracts `data.streams[0].url` (direct `.mp4` link).
 */
export async function fetchMovieBoxStreamViaProxy(
  subjectId: string | number,
  se: number = 0,
  ep: number = 0
): Promise<MovieBoxStreamResult> {
  const safeSubjectId = encodeURIComponent(String(subjectId).trim());
  const targetUrl = `${MOVIEBOX_PLAY_ENDPOINT}?subjectId=${safeSubjectId}&se=${se}&ep=${ep}`;

  for (const proxy of CLIENT_PROXIES) {
    const proxiedUrl = buildProxiedUrl(targetUrl, proxy.prefix);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(proxiedUrl, {
        method: 'GET',
        headers: MOVIEBOX_REQUIRED_HEADERS,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      const parsedJson = JSON.parse(text);
      const streamUrl = parseMovieBoxStreamResponse(parsedJson);

      if (streamUrl) {
        return {
          ok: true,
          streamUrl,
          proxyUsed: proxy.name,
          targetUrl,
        };
      }
    } catch {
      // Fallback to next proxy
      continue;
    }
  }

  return {
    ok: false,
    streamUrl: null,
    error: 'Server Busy, Try Again',
    targetUrl,
  };
}
