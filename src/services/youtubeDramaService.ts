import { MovieItem, MovieLinkRecord } from '../types/movie';
import { sanitizeSafeUrl } from '../utils/securityValidator';

/**
 * Official YouTube Data API v3 Integration for Pakistani Dramas
 * Phase 1 Security: Reads `VITE_YOUTUBE_API_KEY` from environment only (no client localStorage key storage).
 */

export type PakDramaChannelKey = 'ALL' | 'HUM_TV' | 'ARY_DIGITAL' | 'HAR_PAL_GEO' | 'GEO_TV';
export type PakDramaSortOrder = 'date' | 'viewCount' | 'relevance';

export interface OfficialPakDramaChannel {
  key: PakDramaChannelKey;
  name: string;
  label: string;
  channelId: string;
  networkName: string;
}

export const OFFICIAL_PAK_DRAMA_CHANNELS: OfficialPakDramaChannel[] = [
  {
    key: 'ALL',
    name: 'All Channels',
    label: 'All Channels (HUM • ARY • GEO)',
    channelId: 'UC6-F5tO8uklgE9Zy8IvbdFw',
    networkName: 'All Official Networks',
  },
  {
    key: 'HUM_TV',
    name: 'HUM TV',
    label: 'HUM TV Official',
    channelId: 'UC6-F5tO8uklgE9Zy8IvbdFw',
    networkName: 'HUM TV',
  },
  {
    key: 'ARY_DIGITAL',
    name: 'ARY Digital',
    label: 'ARY Digital HD',
    channelId: 'UC4JCksJF76g_MdzPVBJoC3Q',
    networkName: 'ARY Digital',
  },
  {
    key: 'HAR_PAL_GEO',
    name: 'Har Pal Geo',
    label: 'Har Pal Geo',
    channelId: 'UCe9JSDmyqNgA_l2BzGHq1Ug',
    networkName: 'Har Pal Geo',
  },
  {
    key: 'GEO_TV',
    name: 'GEO TV',
    label: 'GEO TV Official',
    channelId: 'UC_vt34wimdCzdkrzVejwX9g',
    networkName: 'GEO TV',
  },
];

export interface YouTubeDramaEpisodeItem {
  videoId: string;
  numericId: number;
  title: string;
  description: string;
  posterUrl: string;
  backdropUrl: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  releaseYear: string;
  durationFormatted: string;
  viewCountFormatted: string;
  embedUrl: string;
  watchUrl: string;
}

export type YouTubeDramaVideoItem = YouTubeDramaEpisodeItem;

export interface YouTubeDramaFetchResult {
  ok: boolean;
  items: YouTubeDramaEpisodeItem[];
  quotaExceeded: boolean;
  missingApiKey: boolean;
  errorMessage: string | null;
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Reads the YouTube Data API v3 key strictly from `import.meta.env.VITE_YOUTUBE_API_KEY`.
 */
export function getActiveYouTubeApiKey(): string {
  const envKey = (import.meta as any).env?.VITE_YOUTUBE_API_KEY;
  return typeof envKey === 'string' ? envKey.trim() : '';
}

export function buildYouTubeChannelSearchUrl(params: {
  apiKey: string;
  channelId: string;
  query?: string;
  maxResults?: number;
  order?: 'date' | 'viewCount' | 'relevance';
}): string {
  const cleanKey = (params.apiKey || '').trim();
  const cleanChannelId = (params.channelId || 'UC6-F5tO8uklgE9Zy8IvbdFw').trim();
  const maxResults = Math.min(Math.max(Number(params.maxResults) || 20, 1), 50);
  const order = params.order || 'date';

  const searchParams = new URLSearchParams({
    key: cleanKey,
    channelId: cleanChannelId,
    part: 'snippet,id',
    order,
    maxResults: String(maxResults),
    type: 'video',
  });

  if (params.query && params.query.trim()) {
    searchParams.set('q', params.query.trim());
  }

  return `${YOUTUBE_API_BASE}/search?${searchParams.toString()}`;
}

export function buildYouTubeVideoDetailsUrl(params: {
  apiKey: string;
  videoIds: string[];
}): string {
  const cleanKey = (params.apiKey || '').trim();
  const cleanIds = params.videoIds
    .map((id) => id.replace(/[^a-zA-Z0-9_-]/g, '').trim())
    .filter(Boolean)
    .slice(0, 50);

  const searchParams = new URLSearchParams({
    key: cleanKey,
    id: cleanIds.join(','),
    part: 'snippet,contentDetails,statistics',
  });

  return `${YOUTUBE_API_BASE}/videos?${searchParams.toString()}`;
}

export function buildYouTubeDramaEmbedUrl(videoId: string): string {
  const cleanVideoId = (videoId || '').replace(/[^a-zA-Z0-9_-]/g, '').trim();
  if (!cleanVideoId) return '';
  return `https://www.youtube.com/embed/${cleanVideoId}?autoplay=1`;
}

export function videoIdToDeterministicNumber(videoId: string): number {
  let hash = 5381;
  for (let i = 0; i < videoId.length; i++) {
    hash = (hash * 33) ^ videoId.charCodeAt(i);
  }
  return 900_000_000 + (Math.abs(hash) % 99_000_000);
}

export function formatIso8601Duration(isoDuration: string | null | undefined): string {
  if (!isoDuration || typeof isoDuration !== 'string') return '38m';
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return '38m';

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatViewCount(rawViews: string | number | null | undefined): string {
  const count = Number(rawViews);
  if (!Number.isFinite(count) || count <= 0) return '1.2M views';
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M views`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K views`;
  }
  return `${count} views`;
}

export function isYouTubeQuotaExceededError(statusCode: number, rawPayload: any): boolean {
  if (statusCode !== 403 && statusCode !== 429) return false;
  const errReason =
    rawPayload?.error?.errors?.[0]?.reason ||
    rawPayload?.error?.status ||
    rawPayload?.error?.message ||
    '';
  return /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|quota/i.test(String(errReason));
}

export function parseYouTubeSearchItems(rawSearchJson: any): YouTubeDramaEpisodeItem[] {
  const rawItems = Array.isArray(rawSearchJson?.items) ? rawSearchJson.items : [];
  const results: YouTubeDramaEpisodeItem[] = [];
  const seenIds = new Set<string>();

  for (const item of rawItems) {
    const rawVideoId =
      typeof item?.id === 'string'
        ? item.id
        : typeof item?.id?.videoId === 'string'
        ? item.id.videoId
        : '';

    const cleanVideoId = rawVideoId.replace(/[^a-zA-Z0-9_-]/g, '').trim();
    if (!cleanVideoId || seenIds.has(cleanVideoId)) continue;
    seenIds.add(cleanVideoId);

    const snippet = item?.snippet || {};
    const rawTitle = String(snippet.title || `Pakistani Drama Episode (${cleanVideoId})`)
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/[<>]/g, '')
      .trim();

    const thumbHigh =
      sanitizeSafeUrl(snippet?.thumbnails?.high?.url) ||
      sanitizeSafeUrl(snippet?.thumbnails?.medium?.url) ||
      sanitizeSafeUrl(snippet?.thumbnails?.default?.url) ||
      `https://i.ytimg.com/vi/${cleanVideoId}/hqdefault.jpg`;

    const publishedAt = String(snippet.publishedAt || '2025-01-01T00:00:00Z');
    const releaseYear = publishedAt.slice(0, 4) || '2025';
    const channelTitle = String(snippet.channelTitle || 'Pakistani Drama Official').trim();
    const channelId = String(snippet.channelId || 'UC6-F5tO8uklgE9Zy8IvbdFw').trim();

    results.push({
      videoId: cleanVideoId,
      numericId: videoIdToDeterministicNumber(cleanVideoId),
      title: rawTitle,
      description:
        String(snippet.description || '').trim() ||
        `Watch ${rawTitle} in HD on ${channelTitle} Official YouTube player.`,
      posterUrl: thumbHigh,
      backdropUrl: `https://i.ytimg.com/vi/${cleanVideoId}/maxresdefault.jpg`,
      channelId,
      channelTitle,
      publishedAt,
      releaseYear,
      durationFormatted: '38m',
      viewCountFormatted: 'Official HD',
      embedUrl: buildYouTubeDramaEmbedUrl(cleanVideoId),
      watchUrl: `https://www.youtube.com/watch?v=${cleanVideoId}`,
    });
  }

  return results;
}

export function mergeYouTubeVideoDetails(
  episodes: YouTubeDramaEpisodeItem[],
  rawVideoDetailsJson: any
): YouTubeDramaEpisodeItem[] {
  const detailsList = Array.isArray(rawVideoDetailsJson?.items) ? rawVideoDetailsJson.items : [];
  if (detailsList.length === 0) return episodes;

  const detailsMap = new Map<string, any>();
  for (const d of detailsList) {
    if (d && typeof d.id === 'string') {
      detailsMap.set(d.id, d);
    }
  }

  return episodes.map((ep) => {
    const detail = detailsMap.get(ep.videoId);
    if (!detail) return ep;

    const durationFormatted = formatIso8601Duration(detail?.contentDetails?.duration);
    const viewCountFormatted = formatViewCount(detail?.statistics?.viewCount);

    return {
      ...ep,
      durationFormatted,
      viewCountFormatted,
    };
  });
}

export async function fetchPakistaniDramasFromYouTube(
  options: {
    channelKey?: OfficialPakDramaChannel['key'];
    query?: string;
    searchQuery?: string;
    sortOrder?: PakDramaSortOrder;
    maxResults?: number;
    forceRefresh?: boolean;
    apiKeyOverride?: string;
  } = {},
  fetchImpl: typeof fetch = fetch
): Promise<YouTubeDramaFetchResult> {
  const apiKey = (options.apiKeyOverride ?? getActiveYouTubeApiKey()).trim();

  if (!apiKey) {
    return {
      ok: false,
      items: [],
      quotaExceeded: false,
      missingApiKey: true,
      errorMessage: 'Content Unavailable, Try Again',
    };
  }

  const channelKey = options.channelKey || 'ALL';
  const targetChannels =
    channelKey === 'ALL'
      ? OFFICIAL_PAK_DRAMA_CHANNELS.filter((c) => c.key !== 'ALL')
      : OFFICIAL_PAK_DRAMA_CHANNELS.filter((c) => c.key === channelKey);

  const perChannelMax =
    channelKey === 'ALL'
      ? Math.max(5, Math.ceil((options.maxResults || 20) / targetChannels.length))
      : options.maxResults || 20;

  try {
    const allEpisodes: YouTubeDramaEpisodeItem[] = [];
    let sawQuotaExceeded = false;

    for (const ch of targetChannels) {
      const searchUrl = buildYouTubeChannelSearchUrl({
        apiKey,
        channelId: ch.channelId,
        query: options.query || options.searchQuery,
        maxResults: perChannelMax,
        order: options.sortOrder || 'date',
      });

      const res = await fetchImpl(searchUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        if (isYouTubeQuotaExceededError(res.status, json)) {
          sawQuotaExceeded = true;
          break;
        }
        continue;
      }

      const parsed = parseYouTubeSearchItems(json);
      allEpisodes.push(...parsed);
    }

    if (sawQuotaExceeded) {
      return {
        ok: false,
        items: [],
        quotaExceeded: true,
        missingApiKey: false,
        errorMessage: 'Please try again later',
      };
    }

    if (allEpisodes.length === 0) {
      return {
        ok: false,
        items: [],
        quotaExceeded: false,
        missingApiKey: false,
        errorMessage: 'Content Unavailable, Try Again',
      };
    }

    let enriched = allEpisodes;
    try {
      const detailsUrl = buildYouTubeVideoDetailsUrl({
        apiKey,
        videoIds: allEpisodes.slice(0, 25).map((e) => e.videoId),
      });
      const detailsRes = await fetchImpl(detailsUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (detailsRes.ok) {
        const detailsJson = await detailsRes.json().catch(() => null);
        enriched = mergeYouTubeVideoDetails(allEpisodes, detailsJson);
      }
    } catch {
      // Keep base search items if video details enrichment fails
    }

    return {
      ok: true,
      items: enriched,
      quotaExceeded: false,
      missingApiKey: false,
      errorMessage: null,
    };
  } catch {
    return {
      ok: false,
      items: [],
      quotaExceeded: false,
      missingApiKey: false,
      errorMessage: 'Content Unavailable, Try Again',
    };
  }
}

export function mapYouTubeDramaToMovieItem(
  ep: YouTubeDramaEpisodeItem,
  linksMap: Record<number, MovieLinkRecord> = {}
): MovieItem {
  const existingLink = linksMap[ep.numericId] || null;
  const linkRecord: MovieLinkRecord = existingLink || {
    tmdb_id: ep.numericId,
    title: ep.title,
    language: 'Urdu / Pak Drama',
    direct_video_url: null,
    stream_url: ep.embedUrl,
    download_480p: null,
    download_720p: null,
  };

  return {
    id: ep.numericId,
    title: ep.title,
    originalTitle: ep.channelTitle,
    overview: `${ep.channelTitle} • ${ep.viewCountFormatted} • ${ep.description}`,
    posterUrl: ep.posterUrl,
    backdropUrl: ep.backdropUrl,
    releaseYear: ep.releaseYear,
    rating: 8.8,
    voteCount: 4200,
    mediaType: 'tv',
    category: 'pak-dramas',
    genres: ['Pakistani Drama', ep.channelTitle],
    language: 'Urdu / Pak Drama',
    languageBadge: `Urdu • ${ep.channelTitle}`,
    qualityBadge: '1080p BluRay',
    duration: ep.durationFormatted,
    runtime: ep.durationFormatted || '38m',
    cast: [],
    linkRecord,
    youtubeVideoId: ep.videoId,
    youtubeChannelTitle: ep.channelTitle,
    youtubeEmbedUrl: ep.embedUrl,
  };
}
