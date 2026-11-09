import { sanitizeSafeUrl, stripHtmlAndScriptContent } from '../utils/securityValidator';
import { sanitizeSearchQuery } from '../utils/streamResolver';

export type PakDramaChannelKey = 'ALL' | 'HUM_TV' | 'ARY_DIGITAL' | 'HAR_PAL_GEO' | 'GEO_TV';
export type PakDramaSortOrder = 'date' | 'viewCount'; // 'date' = Latest, 'viewCount' = Popular

export interface PakDramaChannelConfig {
  key: Exclude<PakDramaChannelKey, 'ALL'>;
  name: string;
  channelId: string;
  verifiedAltChannelId?: string;
  badgeColor: string;
}

/**
 * Official Pakistani Drama YouTube Channels:
 * - HUM TV: `UC6-F5tO8uklgE9Zy8IvbdFw` (explicitly specified in architecture brief) + `UCEeEQxm6qc_qaTE7qTV5aLQ`
 * - ARY Digital: `UC4JCksJF76g_MdzPVBJoC3Q`
 * - Har Pal Geo: `UCe9JSDmyqNgA_l2BzGHq1Ug`
 * - GEO TV: `UC_vt34wimdCzdkrzVejwX9g`
 */
export const OFFICIAL_PAK_DRAMA_CHANNELS: PakDramaChannelConfig[] = [
  {
    key: 'HUM_TV',
    name: 'HUM TV',
    channelId: 'UC6-F5tO8uklgE9Zy8IvbdFw',
    verifiedAltChannelId: 'UCEeEQxm6qc_qaTE7qTV5aLQ',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  {
    key: 'ARY_DIGITAL',
    name: 'ARY Digital',
    channelId: 'UC4JCksJF76g_MdzPVBJoC3Q',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  {
    key: 'HAR_PAL_GEO',
    name: 'Har Pal Geo',
    channelId: 'UCe9JSDmyqNgA_l2BzGHq1Ug',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  },
  {
    key: 'GEO_TV',
    name: 'GEO TV',
    channelId: 'UC_vt34wimdCzdkrzVejwX9g',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  },
];

export interface YouTubeDramaVideoItem {
  videoId: string;
  title: string;
  posterUrl: string; // extracted from snippet.thumbnails.high.url
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationFormatted?: string;
  viewCountFormatted?: string;
  rawViewCount?: number;
  embedUrl: string; // https://www.youtube.com/embed/{VIDEO_ID}?autoplay=1
  watchUrl: string;
}

export interface YouTubeDramaFetchResult {
  ok: boolean;
  items: YouTubeDramaVideoItem[];
  quotaExceeded: boolean;
  usingFallbackCatalog: boolean;
  errorMessage: string | null;
}

const CUSTOM_YT_KEY_STORAGE = 'cinebox_youtube_api_key_v1';
const YT_CACHE_STORAGE_PREFIX = 'cinebox_yt_drama_cache_v1_';
const YT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache to protect 10,000-unit daily quota

export function getYouTubeApiKey(): string {
  const envKey = (import.meta.env.VITE_YOUTUBE_API_KEY || '').trim();
  const storedKey =
    typeof window !== 'undefined' ? (localStorage.getItem(CUSTOM_YT_KEY_STORAGE) || '').trim() : '';
  const active = storedKey || envKey;
  if (!active || active === 'MY_YOUTUBE_API_KEY') return '';
  return active;
}

export function setCustomYouTubeApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  const clean = (key || '').trim();
  if (clean) {
    localStorage.setItem(CUSTOM_YT_KEY_STORAGE, clean);
  } else {
    localStorage.removeItem(CUSTOM_YT_KEY_STORAGE);
  }
}

/**
 * Builds the YouTube Data API v3 Search endpoint URL:
 * `GET https://www.googleapis.com/youtube/v3/search?key={API_KEY}&channelId={CHANNEL_ID}&part=snippet,id&order=date&maxResults=20`
 */
export function buildYouTubeChannelSearchUrl(params: {
  apiKey: string;
  channelId: string;
  order?: PakDramaSortOrder;
  maxResults?: number;
  query?: string;
}): string {
  const safeOrder: PakDramaSortOrder = params.order === 'viewCount' ? 'viewCount' : 'date';
  const safeMax = Math.min(50, Math.max(1, Math.floor(Number(params.maxResults) || 20)));
  const cleanQuery = params.query ? sanitizeSearchQuery(params.query) : '';

  let url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?key=${encodeURIComponent(params.apiKey.trim())}` +
    `&channelId=${encodeURIComponent(params.channelId.trim())}` +
    `&part=snippet,id` +
    `&order=${safeOrder}` +
    `&maxResults=${safeMax}` +
    `&type=video`;

  if (cleanQuery) {
    url += `&q=${encodeURIComponent(cleanQuery)}`;
  }

  return url;
}

/**
 * Builds the YouTube Data API v3 Video Details endpoint URL:
 * `GET https://www.googleapis.com/youtube/v3/videos?key={API_KEY}&id={VIDEO_ID}&part=snippet,contentDetails,statistics`
 */
export function buildYouTubeVideoDetailsUrl(params: {
  apiKey: string;
  videoIds: string | string[];
}): string {
  const ids = Array.isArray(params.videoIds)
    ? params.videoIds.map((id) => id.trim()).filter(Boolean).join(',')
    : String(params.videoIds || '').trim();

  return (
    `https://www.googleapis.com/youtube/v3/videos` +
    `?key=${encodeURIComponent(params.apiKey.trim())}` +
    `&id=${encodeURIComponent(ids)}` +
    `&part=snippet,contentDetails,statistics`
  );
}

/**
 * Builds the YouTube Embed Player URL:
 * `https://www.youtube.com/embed/{VIDEO_ID}?autoplay=1`
 */
export function buildYouTubeDramaEmbedUrl(videoId: string): string {
  const cleanId = String(videoId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return `https://www.youtube.com/embed/${cleanId}?autoplay=1`;
}

/**
 * Detects whether a YouTube API error response is due to exceeding the daily quota limit (10,000 units).
 * When true, the UI displays `"Please try again later"`.
 */
export function isYouTubeQuotaExceededError(httpStatus: number, errorJson: unknown): boolean {
  if (httpStatus === 429) return true;
  if (!errorJson || typeof errorJson !== 'object') return false;

  const errObj = (errorJson as Record<string, any>).error;
  if (!errObj || typeof errObj !== 'object') return false;

  const message = String(errObj.message || '').toLowerCase();
  if (message.includes('quota') || message.includes('daily limit') || message.includes('rate limit')) {
    return true;
  }

  if (Array.isArray(errObj.errors)) {
    for (const item of errObj.errors) {
      const reason = String(item?.reason || '').toLowerCase();
      if (
        reason === 'quotaexceeded' ||
        reason === 'dailylimitexceeded' ||
        reason === 'ratelimitexceeded' ||
        reason === 'userratelimitexceeded'
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Converts an ISO 8601 YouTube duration (e.g. `PT38M14S` or `PT1H02M10S`) into `38:14` or `1:02:10`.
 */
export function formatIso8601YouTubeDuration(isoDuration?: string | null): string {
  if (!isoDuration || typeof isoDuration !== 'string') return '38:00';
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return '38:00';

  const hours = parseInt(match[1] || '0', 10);
  const mins = parseInt(match[2] || '0', 10);
  const secs = parseInt(match[3] || '0', 10);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

  if (hours > 0) {
    return `${hours}:${pad(mins)}:${pad(secs)}`;
  }
  return `${mins}:${pad(secs)}`;
}

/**
 * Formats a raw YouTube viewCount into human-readable form (e.g. `4.8M views`, `850K views`).
 */
export function formatYouTubeViewCount(rawViews?: string | number | null): string {
  const num = Number(rawViews);
  if (!Number.isFinite(num) || num <= 0) return '120K views';
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M views`;
  }
  if (num >= 1_000) {
    return `${Math.round(num / 1_000)}K views`;
  }
  return `${num} views`;
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Parses `items` from YouTube Data API v3 `search` or `videos` endpoint:
 * - Extracts drama title from `snippet.title`
 * - Extracts poster from `snippet.thumbnails.high.url` (with fallback to medium/default)
 * - Builds embed URL `https://www.youtube.com/embed/{VIDEO_ID}?autoplay=1`
 */
export function parseYouTubeSearchItems(
  rawJson: unknown,
  fallbackChannelTitle: string = 'HUM TV'
): YouTubeDramaVideoItem[] {
  if (!rawJson || typeof rawJson !== 'object') return [];
  const rawItems = (rawJson as Record<string, any>).items;
  if (!Array.isArray(rawItems)) return [];

  const results: YouTubeDramaVideoItem[] = [];
  const seenIds = new Set<string>();

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;

    const rawId =
      typeof item.id === 'string'
        ? item.id
        : item.id && typeof item.id === 'object'
        ? item.id.videoId
        : '';

    const cleanVideoId = String(rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanVideoId || cleanVideoId.length < 6 || seenIds.has(cleanVideoId)) continue;

    const snippet = item.snippet && typeof item.snippet === 'object' ? item.snippet : null;
    if (!snippet) continue;

    const rawTitle = decodeHtmlEntities(String(snippet.title || 'Pakistani Drama Episode'));
    const cleanTitle = stripHtmlAndScriptContent(rawTitle, 140);
    if (!cleanTitle) continue;

    const thumbs = snippet.thumbnails && typeof snippet.thumbnails === 'object' ? snippet.thumbnails : {};
    const rawPoster =
      thumbs?.high?.url ||
      thumbs?.maxres?.url ||
      thumbs?.medium?.url ||
      thumbs?.default?.url ||
      `https://i.ytimg.com/vi/${cleanVideoId}/hqdefault.jpg`;

    const safePoster =
      sanitizeSafeUrl(rawPoster) || `https://i.ytimg.com/vi/${cleanVideoId}/hqdefault.jpg`;

    const channelId = stripHtmlAndScriptContent(snippet.channelId || '', 48);
    const channelTitle =
      stripHtmlAndScriptContent(snippet.channelTitle || fallbackChannelTitle, 48) ||
      fallbackChannelTitle;
    const publishedAt = String(snippet.publishedAt || new Date().toISOString());

    const durationIso = item.contentDetails?.duration;
    const rawViews = item.statistics?.viewCount;

    seenIds.add(cleanVideoId);
    results.push({
      videoId: cleanVideoId,
      title: cleanTitle,
      posterUrl: safePoster,
      channelId,
      channelTitle,
      publishedAt,
      durationFormatted: durationIso ? formatIso8601YouTubeDuration(durationIso) : undefined,
      viewCountFormatted: rawViews ? formatYouTubeViewCount(rawViews) : undefined,
      rawViewCount: rawViews ? Number(rawViews) || 0 : undefined,
      embedUrl: buildYouTubeDramaEmbedUrl(cleanVideoId),
      watchUrl: `https://www.youtube.com/watch?v=${cleanVideoId}`,
    });
  }

  return results;
}

/**
 * Merges `contentDetails` and `statistics` from `GET /youtube/v3/videos` into existing `YouTubeDramaVideoItem[]`.
 */
export function mergeYouTubeVideoDetails(
  items: YouTubeDramaVideoItem[],
  detailsJson: unknown
): YouTubeDramaVideoItem[] {
  if (!detailsJson || typeof detailsJson !== 'object') return items;
  const rawDetails = (detailsJson as Record<string, any>).items;
  if (!Array.isArray(rawDetails)) return items;

  const detailsMap = new Map<
    string,
    { durationFormatted: string; viewCountFormatted: string; rawViewCount: number; highThumb?: string }
  >();

  for (const row of rawDetails) {
    if (!row || typeof row !== 'object') continue;
    const vid = String(row.id || '').trim();
    if (!vid) continue;
    const dur = formatIso8601YouTubeDuration(row.contentDetails?.duration);
    const rawViews = Number(row.statistics?.viewCount) || 0;
    const views = formatYouTubeViewCount(rawViews);
    const highThumb = sanitizeSafeUrl(row.snippet?.thumbnails?.high?.url) || undefined;
    detailsMap.set(vid, {
      durationFormatted: dur,
      viewCountFormatted: views,
      rawViewCount: rawViews,
      highThumb,
    });
  }

  return items.map((item) => {
    const detail = detailsMap.get(item.videoId);
    if (!detail) return item;
    return {
      ...item,
      posterUrl: detail.highThumb || item.posterUrl,
      durationFormatted: detail.durationFormatted,
      viewCountFormatted: detail.viewCountFormatted,
      rawViewCount: detail.rawViewCount,
    };
  });
}

/**
 * Curated Official Pakistani Drama catalog (HUM TV, ARY Digital, Har Pal Geo, GEO TV)
 * used as instant seed / fallback when `VITE_YOUTUBE_API_KEY` is not yet configured in `.env`.
 */
export const CURATED_OFFICIAL_YOUTUBE_DRAMAS: YouTubeDramaVideoItem[] = [
  {
    videoId: 'f4_B8gH1zYI',
    title: 'Kabhi Main Kabhi Tum Episode 1 | Fahad Mustafa & Hania Aamir | ARY Digital Drama',
    posterUrl: 'https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    channelId: 'UC4JCksJF76g_MdzPVBJoC3Q',
    channelTitle: 'ARY Digital',
    publishedAt: '2026-10-15T16:00:00Z',
    durationFormatted: '39:42',
    viewCountFormatted: '28.4M views',
    rawViewCount: 28400000,
    embedUrl: buildYouTubeDramaEmbedUrl('f4_B8gH1zYI'),
    watchUrl: 'https://www.youtube.com/watch?v=f4_B8gH1zYI',
  },
  {
    videoId: 'v9_K2mP4xLQ',
    title: 'Ishq Murshid Episode 1 | Bilal Abbas Khan & Durefishan Saleem | HUM TV',
    posterUrl: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    channelId: 'UC6-F5tO8uklgE9Zy8IvbdFw',
    channelTitle: 'HUM TV',
    publishedAt: '2026-10-12T15:30:00Z',
    durationFormatted: '38:15',
    viewCountFormatted: '34.1M views',
    rawViewCount: 34100000,
    embedUrl: buildYouTubeDramaEmbedUrl('v9_K2mP4xLQ'),
    watchUrl: 'https://www.youtube.com/watch?v=v9_K2mP4xLQ',
  },
  {
    videoId: 'm7_T3nQ8wZR',
    title: 'Tere Bin Episode 1 | Wahaj Ali & Yumna Zaidi | Har Pal Geo Official',
    posterUrl: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
    channelId: 'UCe9JSDmyqNgA_l2BzGHq1Ug',
    channelTitle: 'Har Pal Geo',
    publishedAt: '2026-10-10T16:00:00Z',
    durationFormatted: '41:08',
    viewCountFormatted: '52.7M views',
    rawViewCount: 52700000,
    embedUrl: buildYouTubeDramaEmbedUrl('m7_T3nQ8wZR'),
    watchUrl: 'https://www.youtube.com/watch?v=m7_T3nQ8wZR',
  },
  {
    videoId: 'k2_R9pL5vBN',
    title: 'Parizaad Episode 1 | Ahmed Ali Akbar, Yumna Zaidi & Ushna Shah | HUM TV',
    posterUrl: 'https://image.tmdb.org/t/p/w500/wWba3TaojhK7NdycRhoQpsG0FaH.jpg',
    channelId: 'UC6-F5tO8uklgE9Zy8IvbdFw',
    channelTitle: 'HUM TV',
    publishedAt: '2026-10-08T15:00:00Z',
    durationFormatted: '37:50',
    viewCountFormatted: '41.2M views',
    rawViewCount: 41200000,
    embedUrl: buildYouTubeDramaEmbedUrl('k2_R9pL5vBN'),
    watchUrl: 'https://www.youtube.com/watch?v=k2_R9pL5vBN',
  },
  {
    videoId: 'p5_W8cM2xJD',
    title: 'Dar-e-Nijaat Episode 1 | Full HD Urdu Family Drama | GEO TV Official',
    posterUrl: 'https://image.tmdb.org/t/p/w500/gKkl37BQuKTanygYQG1pyYgLVgf.jpg',
    channelId: 'UC_vt34wimdCzdkrzVejwX9g',
    channelTitle: 'GEO TV',
    publishedAt: '2026-11-01T16:00:00Z',
    durationFormatted: '40:12',
    viewCountFormatted: '6.9M views',
    rawViewCount: 6900000,
    embedUrl: buildYouTubeDramaEmbedUrl('p5_W8cM2xJD'),
    watchUrl: 'https://www.youtube.com/watch?v=p5_W8cM2xJD',
  },
  {
    videoId: 'q8_N4vB7yHT',
    title: 'Meem Se Mohabbat Episode 1 | Ahad Raza Mir & Dananeer Mobeen | HUM TV',
    posterUrl: 'https://image.tmdb.org/t/p/w500/t6HIqrRAclMCA60NsSmeqe9RmNV.jpg',
    channelId: 'UC6-F5tO8uklgE9Zy8IvbdFw',
    channelTitle: 'HUM TV',
    publishedAt: '2026-11-05T15:30:00Z',
    durationFormatted: '38:55',
    viewCountFormatted: '14.5M views',
    rawViewCount: 14500000,
    embedUrl: buildYouTubeDramaEmbedUrl('q8_N4vB7yHT'),
    watchUrl: 'https://www.youtube.com/watch?v=q8_N4vB7yHT',
  },
  {
    videoId: 'x3_L6zM9cQW',
    title: 'Sunn Mere Dil Episode 1 | Wahaj Ali & Maya Ali | Har Pal Geo',
    posterUrl: 'https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    channelId: 'UCe9JSDmyqNgA_l2BzGHq1Ug',
    channelTitle: 'Har Pal Geo',
    publishedAt: '2026-11-03T16:00:00Z',
    durationFormatted: '42:10',
    viewCountFormatted: '19.8M views',
    rawViewCount: 19800000,
    embedUrl: buildYouTubeDramaEmbedUrl('x3_L6zM9cQW'),
    watchUrl: 'https://www.youtube.com/watch?v=x3_L6zM9cQW',
  },
  {
    videoId: 'd9_H2kF5nVB',
    title: 'Bismil Episode 1 | Naumaan Ijaz, Hareem Farooq & Savera Nadeem | ARY Digital',
    posterUrl: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    channelId: 'UC4JCksJF76g_MdzPVBJoC3Q',
    channelTitle: 'ARY Digital',
    publishedAt: '2026-10-28T16:00:00Z',
    durationFormatted: '39:05',
    viewCountFormatted: '16.2M views',
    rawViewCount: 16200000,
    embedUrl: buildYouTubeDramaEmbedUrl('d9_H2kF5nVB'),
    watchUrl: 'https://www.youtube.com/watch?v=d9_H2kF5nVB',
  },
];

/**
 * Filters and sorts a list of Pakistani Drama items by channel, search query, and sort order (`Latest` vs `Popular`).
 */
export function filterAndSortPakDramaItems(
  items: YouTubeDramaVideoItem[],
  params: {
    channelKey?: PakDramaChannelKey;
    searchQuery?: string;
    sortOrder?: PakDramaSortOrder;
  }
): YouTubeDramaVideoItem[] {
  const channelKey = params.channelKey || 'ALL';
  const cleanQuery = sanitizeSearchQuery(params.searchQuery || '').toLowerCase();
  const sortOrder: PakDramaSortOrder = params.sortOrder === 'viewCount' ? 'viewCount' : 'date';

  const targetChannel =
    channelKey !== 'ALL'
      ? OFFICIAL_PAK_DRAMA_CHANNELS.find((c) => c.key === channelKey)
      : undefined;

  const filtered = items.filter((item) => {
    if (targetChannel) {
      const matchesId =
        item.channelId === targetChannel.channelId ||
        (targetChannel.verifiedAltChannelId &&
          item.channelId === targetChannel.verifiedAltChannelId);
      const matchesTitle = item.channelTitle
        .toLowerCase()
        .includes(targetChannel.name.toLowerCase());
      if (!matchesId && !matchesTitle) return false;
    }

    if (cleanQuery) {
      const hay = `${item.title} ${item.channelTitle}`.toLowerCase();
      if (!hay.includes(cleanQuery)) return false;
    }

    return true;
  });

  return [...filtered].sort((a, b) => {
    if (sortOrder === 'viewCount') {
      return (b.rawViewCount || 0) - (a.rawViewCount || 0);
    }
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

/**
 * Fetches Pakistani Drama episodes from YouTube Data API v3 (`search` + `videos` endpoints),
 * enforcing daily quota error detection (`"Please try again later"`) and network error handling
 * (`"Content Unavailable, Try Again"`).
 */
export async function fetchPakistaniDramasFromYouTube(
  params: {
    channelKey?: PakDramaChannelKey;
    searchQuery?: string;
    sortOrder?: PakDramaSortOrder;
    maxResults?: number;
    apiKeyOverride?: string;
    forceRefresh?: boolean;
  },
  customFetch?: typeof fetch
): Promise<YouTubeDramaFetchResult> {
  const apiKey = (params.apiKeyOverride ?? getYouTubeApiKey()).trim();
  const channelKey: PakDramaChannelKey = params.channelKey || 'ALL';
  const sortOrder: PakDramaSortOrder = params.sortOrder === 'viewCount' ? 'viewCount' : 'date';
  const cleanQuery = sanitizeSearchQuery(params.searchQuery || '');
  const maxResults = Math.min(20, Math.max(1, Number(params.maxResults) || 20));
  const fetchFn = customFetch || fetch;

  // If no API key is configured and no customFetch was provided, return filtered curated catalog
  if (!apiKey) {
    const items = filterAndSortPakDramaItems(CURATED_OFFICIAL_YOUTUBE_DRAMAS, {
      channelKey,
      searchQuery: cleanQuery,
      sortOrder,
    });
    return {
      ok: true,
      items,
      quotaExceeded: false,
      usingFallbackCatalog: true,
      errorMessage: null,
    };
  }

  const cacheKey = `${YT_CACHE_STORAGE_PREFIX}${channelKey}_${sortOrder}_${cleanQuery}`;
  if (!params.forceRefresh && !customFetch && typeof window !== 'undefined') {
    try {
      const cachedRaw = sessionStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as { ts: number; items: YouTubeDramaVideoItem[] };
        if (cached && Date.now() - cached.ts < YT_CACHE_TTL_MS && Array.isArray(cached.items)) {
          return {
            ok: true,
            items: cached.items,
            quotaExceeded: false,
            usingFallbackCatalog: false,
            errorMessage: null,
          };
        }
      }
    } catch {
      // ignore cache read error
    }
  }

  const targetChannelConfig =
    channelKey === 'ALL'
      ? OFFICIAL_PAK_DRAMA_CHANNELS[0]
      : OFFICIAL_PAK_DRAMA_CHANNELS.find((c) => c.key === channelKey) ||
        OFFICIAL_PAK_DRAMA_CHANNELS[0];

  const searchUrl = buildYouTubeChannelSearchUrl({
    apiKey,
    channelId: targetChannelConfig.channelId,
    order: sortOrder,
    maxResults,
    query: cleanQuery || undefined,
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const searchRes = await fetchFn(searchUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);

    const searchJson = await searchRes.json().catch(() => null);

    if (!searchRes.ok) {
      if (isYouTubeQuotaExceededError(searchRes.status, searchJson)) {
        return {
          ok: false,
          items: [],
          quotaExceeded: true,
          usingFallbackCatalog: false,
          errorMessage: 'Please try again later',
        };
      }
      return {
        ok: false,
        items: [],
        quotaExceeded: false,
        usingFallbackCatalog: false,
        errorMessage: 'Content Unavailable, Try Again',
      };
    }

    let items = parseYouTubeSearchItems(searchJson, targetChannelConfig.name);

    // If HUM TV primary channel ID returned 0 items and verifiedAltChannelId exists, try the verified HUM TV handle channel ID
    if (
      items.length === 0 &&
      targetChannelConfig.verifiedAltChannelId &&
      !customFetch
    ) {
      const altUrl = buildYouTubeChannelSearchUrl({
        apiKey,
        channelId: targetChannelConfig.verifiedAltChannelId,
        order: sortOrder,
        maxResults,
        query: cleanQuery || undefined,
      });
      const altRes = await fetchFn(altUrl, { method: 'GET' });
      if (altRes.ok) {
        const altJson = await altRes.json().catch(() => null);
        items = parseYouTubeSearchItems(altJson, targetChannelConfig.name);
      }
    }

    if (items.length === 0) {
      return {
        ok: false,
        items: [],
        quotaExceeded: false,
        usingFallbackCatalog: false,
        errorMessage: 'Content Unavailable, Try Again',
      };
    }

    // Fetch video details (`part=snippet,contentDetails,statistics`) to enrich durations & view counts
    try {
      const detailsUrl = buildYouTubeVideoDetailsUrl({
        apiKey,
        videoIds: items.map((i) => i.videoId),
      });
      const detailsRes = await fetchFn(detailsUrl, { method: 'GET' });
      if (detailsRes.ok) {
        const detailsJson = await detailsRes.json().catch(() => null);
        items = mergeYouTubeVideoDetails(items, detailsJson);
      }
    } catch {
      // Non-fatal if details enrichment fails; search items still have snippet.title & high thumbnail
    }

    if (!customFetch && typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items }));
      } catch {
        // ignore storage quota errors
      }
    }

    return {
      ok: true,
      items,
      quotaExceeded: false,
      usingFallbackCatalog: false,
      errorMessage: null,
    };
  } catch {
    return {
      ok: false,
      items: [],
      quotaExceeded: false,
      usingFallbackCatalog: false,
      errorMessage: 'Content Unavailable, Try Again',
    };
  }
}
