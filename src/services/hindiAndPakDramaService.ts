import { sanitizeSearchQuery } from '../utils/streamResolver';
import { buildCorsProxyHeaders, buildProxiedUrl } from './movieBoxDirectApi';

export interface DramaOrHindiStreamOption {
  id: string;
  title: string;
  durationSeconds: number;
  durationFormatted: string;
  embedUrl: string;
  watchUrl: string;
  thumbnailUrl?: string;
}

const KNOWN_PAK_DRAMA_KEYWORDS = [
  'dar e nijaat',
  'dar-e-nijaat',
  'kabhi main kabhi tum',
  'tere bin',
  'ishq murshid',
  'parizaad',
  'humsafar',
  'mere humsafar',
  'jaan e jahan',
  'sunn mere dil',
  'kaffara',
  'jafaa',
  'noor jahan',
  'duniyapur',
  'bismil',
  'iqtidar',
  'meem se mohabbat',
  'khuda aur mohabbat',
  'ary digital',
  'har pal geo',
  'hum tv',
];

/**
 * Detects whether a MovieItem represents a Pakistani Drama or Urdu-language series/show.
 */
export function isPakistaniOrUrduContent(item: {
  title?: string;
  originalTitle?: string;
  language?: string;
}): boolean {
  const lang = (item.language || '').toLowerCase();
  if (lang.includes('urdu') || lang.includes('pak')) {
    return true;
  }

  const orig = item.originalTitle || '';
  // Detect Arabic/Urdu script characters
  if (/[\u0600-\u06FF]/.test(orig)) {
    return true;
  }

  const combinedTitle = `${item.title || ''} ${orig}`.toLowerCase();
  return KNOWN_PAK_DRAMA_KEYWORDS.some((kw) => combinedTitle.includes(kw));
}

/**
 * Formats duration in seconds into human-readable `1h 56m` or `37m 53s`.
 */
export function formatStreamDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m ${secs}s`;
}

/**
 * Pure helper to filter out short promo clips/trailers and rank full-length Pakistani Drama episodes
 * or full-length Hindi Dubbed movies first.
 */
export function rankAndFilterDramaOrHindiStreams(
  rawItems: { id?: string; title?: string; duration?: number; thumbnail_url?: string }[],
  targetEpisode: number = 1,
  mode: 'pak-drama' | 'hindi-dub' = 'pak-drama'
): DramaOrHindiStreamOption[] {
  if (!Array.isArray(rawItems)) return [];

  const minDurationSeconds = mode === 'hindi-dub' ? 1200 : 480; // >=20 min for movies, >=8 min for drama episodes
  const epNum = Math.max(1, Math.floor(Number(targetEpisode) || 1));
  const epRegex = new RegExp(`\\b(episode|ep)\\s*0*${epNum}\\b`, 'i');

  const valid = rawItems
    .filter((item) => {
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9]+$/.test(item.id)) {
        return false;
      }
      const dur = Number(item.duration) || 0;
      return dur >= minDurationSeconds;
    })
    .map((item) => {
      const cleanId = item.id!.trim();
      const dur = Math.floor(Number(item.duration) || 0);
      const cleanTitle = (item.title || 'Full Episode / Movie Stream')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, 120);

      // Compute relevance score: exact episode match + full length (20-50 mins for drama, 60+ mins for movie)
      let score = 0;
      if (mode === 'pak-drama') {
        if (epRegex.test(cleanTitle)) score += 100;
        if (dur >= 1500 && dur <= 3600) score += 50; // 25m - 60m typical Pakistani drama full episode
      } else {
        if (/hindi|dubbed|dual audio/i.test(cleanTitle)) score += 80;
        if (dur >= 3600) score += 60; // 60+ mins full movie
      }

      return {
        score,
        option: {
          id: cleanId,
          title: cleanTitle,
          durationSeconds: dur,
          durationFormatted: formatStreamDuration(dur),
          embedUrl: `https://www.dailymotion.com/embed/video/${cleanId}?autoplay=1&queue-enable=false&ui-start-screen-info=false`,
          watchUrl: `https://www.dailymotion.com/video/${cleanId}`,
          thumbnailUrl: item.thumbnail_url,
        } satisfies DramaOrHindiStreamOption,
      };
    });

  valid.sort((a, b) => b.score - a.score);
  return valid.map((v) => v.option);
}

/**
 * Builds the default search query for a Pakistani Drama episode or Hindi Dubbed movie.
 */
export function buildDramaOrHindiSearchQuery(params: {
  title: string;
  mediaType: 'movie' | 'tv';
  episode?: number;
  isPakDrama?: boolean;
}): string {
  const cleanTitle = sanitizeSearchQuery(params.title).replace(/[-:]/g, ' ').replace(/\s+/g, ' ').trim();
  const ep = Math.max(1, Math.floor(Number(params.episode) || 1));

  if (params.isPakDrama || params.mediaType === 'tv') {
    return `${cleanTitle} Episode ${ep}`;
  }
  return `${cleanTitle} Full Movie Hindi Dubbed`;
}

/**
 * Queries the live CORS-enabled Dailymotion Video API for full-length Pakistani Drama episodes
 * (e.g., "Dar e Nijaat Episode 1") or full-length Hindi Dubbed movies.
 */
export async function searchPakDramaOrHindiStreams(params: {
  title: string;
  mediaType: 'movie' | 'tv';
  episode?: number;
  customQuery?: string;
  isPakDrama?: boolean;
}): Promise<{
  ok: boolean;
  queryUsed: string;
  streams: DramaOrHindiStreamOption[];
  error?: string;
}> {
  const mode: 'pak-drama' | 'hindi-dub' =
    params.isPakDrama || params.mediaType === 'tv' ? 'pak-drama' : 'hindi-dub';

  const queryUsed =
    (params.customQuery && sanitizeSearchQuery(params.customQuery)) ||
    buildDramaOrHindiSearchQuery({
      title: params.title,
      mediaType: params.mediaType,
      episode: params.episode,
      isPakDrama: params.isPakDrama,
    });

  if (!queryUsed) {
    return { ok: false, queryUsed: '', streams: [], error: 'Empty search query.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const apiUrl = `https://api.dailymotion.com/videos?search=${encodeURIComponent(
      queryUsed
    )}&limit=15&fields=id,title,duration,thumbnail_url`;

    let res: Response;
    try {
      res = await fetch(apiUrl, { signal: controller.signal });
    } catch {
      const proxiedUrl = buildProxiedUrl(apiUrl);
      res = await fetch(proxiedUrl, {
        headers: buildCorsProxyHeaders(proxiedUrl),
        signal: controller.signal,
      });
    }
    clearTimeout(timer);

    if (!res.ok) {
      return {
        ok: false,
        queryUsed,
        streams: [],
        error: `Stream search returned HTTP ${res.status}`,
      };
    }

    const json = await res.json();
    const list = Array.isArray(json?.list) ? json.list : [];
    let streams = rankAndFilterDramaOrHindiStreams(list, params.episode || 1, mode);

    // Fallback: if strict Hindi movie query returned 0 long results, try broader Hindi Dubbed search
    if (streams.length === 0 && !params.customQuery) {
      const fallbackQuery =
        mode === 'pak-drama'
          ? sanitizeSearchQuery(params.title)
          : `${sanitizeSearchQuery(params.title)} Hindi`;
      const fallbackUrl = `https://api.dailymotion.com/videos?search=${encodeURIComponent(
        fallbackQuery
      )}&limit=15&fields=id,title,duration,thumbnail_url`;
      const fbRes = await fetch(fallbackUrl);
      if (fbRes.ok) {
        const fbJson = await fbRes.json();
        streams = rankAndFilterDramaOrHindiStreams(
          Array.isArray(fbJson?.list) ? fbJson.list : [],
          params.episode || 1,
          mode
        );
      }
    }

    return {
      ok: streams.length > 0,
      queryUsed,
      streams,
      error:
        streams.length === 0
          ? 'No full-length stream found for this query. Try editing the search box below.'
          : undefined,
    };
  } catch {
    return {
      ok: false,
      queryUsed,
      streams: [],
      error: 'Could not reach Pakistani Drama / Hindi Stream API. Check your internet connection.',
    };
  }
}
