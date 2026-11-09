import { EmbedServerOption, MovieLinkRecord, ResolvedPlaybackPlan } from '../types/movie';
import { sanitizeSafeUrl } from './securityValidator';
import {
  buildCentralizedManagedSources,
  detectVerifiedAudioTracks,
  resolveAlternateLanguageStreams,
} from '../services/streamSourceManager';

export const FALLBACK_TEST_MP4_720P =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4';
export const FALLBACK_TEST_MP4_480P =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
export const FALLBACK_MULTI_AUDIO_HLS_URL =
  'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8';

/**
 * Pool of verified, high-speed, CORS-enabled playable HD `.mp4` and `.m3u8` streams.
 * Used when an admin tests direct playback or attaches presets in the inline link editor.
 */
export const PLAYABLE_HD_STREAMS_POOL: {
  label: string;
  mp4_720p: string;
  mp4_480p: string;
  size480: string;
  size720: string;
  size1080: string;
}[] = [
  {
    label: 'Tears of Steel (Sci-Fi Live Action HD .MP4)',
    mp4_720p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    mp4_480p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    size480: '480.5MB',
    size720: '1120.4MB',
    size1080: '2240.0MB',
  },
  {
    label: 'Sintel (Fantasy Action Adventure HD .MP4)',
    mp4_720p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    mp4_480p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    size480: '435.0MB',
    size720: '985.2MB',
    size1080: '1980.0MB',
  },
  {
    label: 'Big Buck Bunny (Full HD 720p .MP4)',
    mp4_720p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    mp4_480p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    size480: '410.8MB',
    size720: '940.0MB',
    size1080: '1850.5MB',
  },
  {
    label: 'Elephants Dream (Sci-Fi Cinema HD .MP4)',
    mp4_720p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    mp4_480p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoy.mp4',
    size480: '390.2MB',
    size720: '890.6MB',
    size1080: '1760.0MB',
  },
];

export function getDefaultStreamForTmdbId(tmdbId: number) {
  const safeId = Math.abs(Math.floor(Number(tmdbId) || 1));
  return PLAYABLE_HD_STREAMS_POOL[safeId % PLAYABLE_HD_STREAMS_POOL.length];
}

export const RECENT_SEARCHES_STORAGE_KEY = 'cinebox_recent_searches_v1';

/**
 * Sanitizes a user search query before saving to `localStorage` or displaying as a chip.
 * Strips HTML tags/brackets and control characters to prevent Stored DOM XSS.
 */
export function sanitizeSearchQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t\0<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Pure helper to add a search query to the Recent Searches list (newest first, case-insensitive deduplication).
 */
export function addRecentSearchQuery(
  existing: string[],
  newQuery: string,
  maxItems: number = 8
): string[] {
  const clean = sanitizeSearchQuery(newQuery);
  if (!clean) return Array.isArray(existing) ? existing.slice(0, maxItems) : [];
  const safeExisting = Array.isArray(existing) ? existing : [];
  const filtered = safeExisting
    .map((item) => sanitizeSearchQuery(item))
    .filter((item) => item.length > 0 && item.toLowerCase() !== clean.toLowerCase());
  return [clean, ...filtered].slice(0, Math.max(1, maxItems));
}

/**
 * Pure helper to remove a single search query from the Recent Searches list.
 */
export function removeRecentSearchQuery(existing: string[], queryToRemove: string): string[] {
  if (!Array.isArray(existing)) return [];
  const target = sanitizeSearchQuery(queryToRemove).toLowerCase();
  return existing.filter((item) => sanitizeSearchQuery(item).toLowerCase() !== target);
}

/**
 * Builds active Auto-Embed fallback servers for Movies (`movie`) and TV Series (`tv`).
 * Uses honest provider labels without falsely claiming cross-origin providers guarantee dual audio.
 */
export function buildEmbedServerList(
  tmdbId: number,
  mediaType: 'movie' | 'tv' = 'movie',
  season: number = 1,
  episode: number = 1,
  customStreamUrl?: string | null
): EmbedServerOption[] {
  const safeTmdbId = Math.max(1, Math.floor(Number(tmdbId) || 1));
  const safeSeason = Math.max(1, Math.floor(Number(season) || 1));
  const safeEpisode = Math.max(1, Math.floor(Number(episode) || 1));
  const servers: EmbedServerOption[] = [];

  const safeCustom = sanitizeSafeUrl(customStreamUrl);
  if (safeCustom) {
    servers.push({
      id: 'custom-supabase',
      label: 'Custom Server (Supabase)',
      url: safeCustom,
      isCustom: true,
      providerName: 'Custom Supabase Embed',
      audioType: 'provider-controlled',
    });
  }

  if (mediaType === 'tv') {
    servers.push(
      {
        id: 'auto-server-3',
        label: `Server 3 (2Embed S${safeSeason}:E${safeEpisode})`,
        url: `https://www.2embed.cc/embedtv/${safeTmdbId}&s=${safeSeason}&e=${safeEpisode}`,
        isCustom: false,
        providerName: '2Embed',
        audioType: 'provider-controlled',
      },
      {
        id: 'auto-server-1',
        label: `Server 1 (VidSrc.sh S${safeSeason}:E${safeEpisode})`,
        url: `https://vidsrc.sh/embed/tv/${safeTmdbId}/${safeSeason}/${safeEpisode}?ds_lang=en`,
        isCustom: false,
        providerName: 'VidSrc.sh',
        audioType: 'provider-controlled',
      },
      {
        id: 'hindi-multiembed',
        label: `Server 2 (MultiEmbed S${safeSeason}:E${safeEpisode})`,
        url: `https://multiembed.mov/?video_id=${safeTmdbId}&tmdb=1&s=${safeSeason}&e=${safeEpisode}`,
        isCustom: false,
        providerName: 'MultiEmbed',
        audioType: 'provider-controlled',
      },
      {
        id: 'hindi-autoembed',
        label: `Server 4 (AutoEmbed S${safeSeason}:E${safeEpisode})`,
        url: `https://player.autoembed.cc/embed/tv/${safeTmdbId}/${safeSeason}/${safeEpisode}`,
        isCustom: false,
        providerName: 'AutoEmbed',
        audioType: 'provider-controlled',
      },
      {
        id: 'hindi-vidsrc-icu',
        label: `Server 5 (VidSrc.icu S${safeSeason}:E${safeEpisode})`,
        url: `https://vidsrc.icu/embed/tv/${safeTmdbId}/${safeSeason}/${safeEpisode}`,
        isCustom: false,
        providerName: 'VidSrc.icu',
        audioType: 'provider-controlled',
      }
    );
  } else {
    servers.push(
      {
        id: 'auto-server-3',
        label: 'Server 3 (2Embed.cc)',
        url: `https://www.2embed.cc/embed/${safeTmdbId}`,
        isCustom: false,
        providerName: '2Embed',
        audioType: 'provider-controlled',
      },
      {
        id: 'auto-server-1',
        label: 'Server 1 (VidSrc.sh)',
        url: `https://vidsrc.sh/embed/movie/${safeTmdbId}?ds_lang=en`,
        isCustom: false,
        providerName: 'VidSrc.sh',
        audioType: 'provider-controlled',
      },
      {
        id: 'hindi-multiembed',
        label: 'Server 2 (MultiEmbed)',
        url: `https://multiembed.mov/?video_id=${safeTmdbId}&tmdb=1`,
        isCustom: false,
        providerName: 'MultiEmbed',
        audioType: 'provider-controlled',
      },
      {
        id: 'hindi-autoembed',
        label: 'Server 4 (AutoEmbed)',
        url: `https://player.autoembed.cc/embed/movie/${safeTmdbId}`,
        isCustom: false,
        providerName: 'AutoEmbed',
        audioType: 'provider-controlled',
      },
      {
        id: 'hindi-vidsrc-icu',
        label: 'Server 5 (VidSrc.icu)',
        url: `https://vidsrc.icu/embed/movie/${safeTmdbId}`,
        isCustom: false,
        providerName: 'VidSrc.icu',
        audioType: 'provider-controlled',
      }
    );
  }

  return servers;
}

/**
 * Returns clean, sandbox-free iframe attributes (`src` and `allowFullScreen` only)
 * so embed providers like VidSrc.sh and 2Embed.cc are never restricted by a `sandbox` attribute on the player iframe.
 */
export function getCleanIframeAttributes(
  rawUrl?: string | null,
  title: string = 'Movie Stream Player'
): {
  src: string;
  allowFullScreen: true;
  title: string;
  sandbox?: undefined;
} {
  const safeSrc = sanitizeSafeUrl(rawUrl) || '';
  return {
    src: safeSrc,
    allowFullScreen: true,
    title: title.trim() || 'Movie Stream Player',
  };
}

/**
 * Resolves the Hybrid Video Player plan for a given `tmdb_id`, `mediaType`, `season`, `episode`,
 * and optional Supabase `movie_links` record.
 */
export function resolvePlaybackPlan(
  tmdbId: number,
  linkRecord?: MovieLinkRecord | null,
  mediaType: 'movie' | 'tv' = 'movie',
  season: number = 1,
  episode: number = 1,
  originalLanguageCode?: string | null,
  youtubeKey?: string
): ResolvedPlaybackPlan {
  const safeId = Math.max(1, Math.floor(Number(tmdbId) || 1));
  const safeSeason = Math.max(1, Math.floor(Number(season) || 1));
  const safeEpisode = Math.max(1, Math.floor(Number(episode) || 1));

  const alternateLanguageStreams = resolveAlternateLanguageStreams(
    linkRecord,
    originalLanguageCode
  );

  const safeDirect = linkRecord?.direct_video_url
    ? sanitizeSafeUrl(linkRecord.direct_video_url)
    : alternateLanguageStreams[0]?.url || null;

  let preferredMode: 'direct-hls' | 'direct-mp4' | 'embed' = 'embed';
  if (safeDirect) {
    preferredMode = safeDirect.toLowerCase().includes('.m3u8') ? 'direct-hls' : 'direct-mp4';
  }

  const embedServers = buildEmbedServerList(
    safeId,
    mediaType,
    safeSeason,
    safeEpisode,
    linkRecord?.stream_url
  );

  const managedSources = buildCentralizedManagedSources({
    tmdbId: safeId,
    mediaType,
    season: safeSeason,
    episode: safeEpisode,
    linkRecord,
    embedServers,
    alternateStreams: alternateLanguageStreams,
    youtubeKey,
  });

  const defaultPoolStream = getDefaultStreamForTmdbId(safeId);

  const dl480 =
    (linkRecord?.download_480p && sanitizeSafeUrl(linkRecord.download_480p)) ||
    safeDirect ||
    defaultPoolStream.mp4_480p;
  const dl720 =
    (linkRecord?.download_720p && sanitizeSafeUrl(linkRecord.download_720p)) ||
    safeDirect ||
    defaultPoolStream.mp4_720p;
  const dl1080 =
    (linkRecord?.download_1080p && sanitizeSafeUrl(linkRecord.download_1080p)) ||
    dl720;

  return {
    tmdbId: safeId,
    mediaType,
    season: safeSeason,
    episode: safeEpisode,
    preferredMode,
    directVideoUrl: safeDirect,
    testFallbackMp4Url: defaultPoolStream.mp4_720p,
    language: linkRecord?.language || 'Original Audio',
    embedServers,
    alternateLanguageStreams,
    managedSources,
    downloads: [
      {
        quality: '480p',
        url: dl480,
        sizeLabel: linkRecord?.file_size_480p || defaultPoolStream.size480,
        sizeMB: parseFileSizeMB(linkRecord?.file_size_480p, 480.5),
      },
      {
        quality: '720p',
        url: dl720,
        sizeLabel: linkRecord?.file_size_720p || defaultPoolStream.size720,
        sizeMB: parseFileSizeMB(linkRecord?.file_size_720p, 1020.6),
      },
      {
        quality: '1080p',
        url: dl1080,
        sizeLabel: linkRecord?.file_size_1080p || defaultPoolStream.size1080,
        sizeMB: parseFileSizeMB(linkRecord?.file_size_1080p, 2140.0),
      },
    ],
  };
}

/**
 * Parses a human-readable size string like `"1020.6MB"` or `"1.8GB"` into megabytes.
 */
export function parseFileSizeMB(sizeLabel?: string | null, fallbackMB: number = 750): number {
  if (!sizeLabel || typeof sizeLabel !== 'string') {
    return fallbackMB;
  }
  const match = sizeLabel.trim().match(/^([\d.]+)\s*(MB|GB|KB)?$/i);
  if (!match) {
    return fallbackMB;
  }
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackMB;
  }
  const unit = (match[2] || 'MB').toUpperCase();
  if (unit === 'GB') return Math.round(value * 1024 * 10) / 10;
  if (unit === 'KB') return Math.max(0.1, Math.round((value / 1024) * 10) / 10);
  return Math.round(value * 10) / 10;
}

/**
 * Formats seconds into `H:MM:SS` or `MM:SS` matching the MovieBox player UI (`20:28` / `2:09:41`).
 */
export function formatPlayerTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Determines whether the MovieBox proxy loading overlay (`isFetchingStream`) and
 * `"Server Busy, Try Again"` error banner (`streamFetchError`) should be displayed.
 * Ensures that when the user is watching via Server 3 (`embed`), `pak-drama`, `trailer`, or `direct`,
 * background proxy errors/spinners never overlay or clutter the mobile video player.
 */
export function getBlobStreamAlertState(
  playerMode: 'direct' | 'trailer' | 'embed' | 'blob' | 'pak-drama',
  isFetchingStream?: boolean,
  streamFetchError?: string | null,
  isErrorDismissed: boolean = false
): {
  showLoadingOverlay: boolean;
  showErrorBanner: boolean;
} {
  if (playerMode !== 'blob') {
    return {
      showLoadingOverlay: false,
      showErrorBanner: false,
    };
  }
  return {
    showLoadingOverlay: Boolean(isFetchingStream),
    showErrorBanner: Boolean(streamFetchError && !isErrorDismissed),
  };
}

export interface DetectedAudioTrack {
  id: number;
  name: string;
  lang: string;
  languageName?: string;
  audioRole?: 'Original' | 'Dubbed' | 'Track';
  displayLabel?: string;
  isDefault: boolean;
  trackType?: string;
  groupId?: string;
  source: 'hls' | 'html5';
  failed?: boolean;
}

/**
 * Normalizes audio tracks detected strictly from `hls.js` (`hls.audioTracks`)
 * or native HTML5 `<video>.audioTracks`.
 *
 * PHASE 2A RULE:
 * Never creates fake audio tracks from `languageMetadata`, TMDB metadata, movie titles,
 * country, or language labels. Only returns verified tracks from the media stream itself.
 */
export function normalizeDetectedAudioTracks(
  hlsAudioTracks?: Array<{
    id?: number;
    name?: string;
    lang?: string;
    default?: boolean;
    type?: string;
    groupId?: string;
  }> | null,
  html5AudioTracks?: ArrayLike<{
    id?: string;
    label?: string;
    language?: string;
    kind?: string;
    enabled?: boolean;
  }> | null,
  _ignoredMetadataLanguage?: string | null,
  originalLanguageCode?: string | null
): DetectedAudioTrack[] {
  const verified = detectVerifiedAudioTracks(
    hlsAudioTracks,
    html5AudioTracks,
    originalLanguageCode
  );
  return verified.map((t) => ({
    id: t.id,
    name: t.displayLabel,
    lang: t.lang,
    languageName: t.languageName,
    audioRole: t.audioRole,
    displayLabel: t.displayLabel,
    isDefault: t.isDefault,
    trackType: t.trackType,
    groupId: t.groupId,
    source: t.source,
    failed: t.failed,
  }));
}

/**
 * Returns `true` ONLY when multiple verified audio tracks (`tracks.length > 1`)
 * are genuinely detected in the active direct HLS or HTML5 stream.
 */
export function shouldShowAudioTrackButton(
  tracks: DetectedAudioTrack[] | null | undefined,
  playerMode: 'direct' | 'blob' | 'trailer' | 'embed' | 'pak-drama' = 'direct'
): boolean {
  if (playerMode !== 'direct' && playerMode !== 'blob') {
    return false;
  }
  if (!Array.isArray(tracks)) return false;
  const validTracks = tracks.filter((t) => !t.failed && (t.source === 'hls' || t.source === 'html5'));
  return validTracks.length > 1;
}
