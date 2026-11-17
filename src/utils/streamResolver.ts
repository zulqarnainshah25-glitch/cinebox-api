import {
  AlternateLanguageStream,
  EmbedServerOption,
  MovieLinkRecord,
  ResolvedPlaybackPlan,
} from '../types/movie';
import { sanitizeSafeUrl } from './securityValidator';
import {
  buildCentralizedManagedSources,
  detectVerifiedAudioTracks,
  resolveAlternateLanguageStreams,
  VerifiedAudioTrack,
} from '../services/streamSourceManager';
import {
  build2EmbedFallbackUrl,
  buildVidFastEmbedUrl,
  buildVidLinkEmbedUrl,
  buildVidSrcEmbedUrl,
} from '../services/vidsrcService';

export type { AlternateLanguageStream, EmbedServerOption, VerifiedAudioTrack };

export const PREFERRED_EMBED_SERVER_ID = 'auto-server-vidlink';
export const CONTROLS_AUTO_HIDE_MS = 3000;
export const FULLSCREEN_CONTROLS_AUTO_HIDE_MS = 3000;
export {
  ADBLOCK_HEALTH_ENDPOINT,
  ADBLOCK_PROXY_ENDPOINT,
  ADBLOCK_TOAST_DISABLED,
  ADBLOCK_TOAST_ENABLED,
  ADBLOCK_TOAST_TRAP_BLOCKED,
  AD_SERVING_DOMAINS,
  buildAdBlockProxiedEmbedUrl,
  buildEmbedAdBlockCssRules,
  buildInFrameAdBlockScriptlet,
  buildVidSrcAdBlockCssRules,
  CLICK_SHIELD_REARM_IDLE_MS,
  CLICK_SHIELD_UNLOCK_WINDOW_MS,
  createBlurHijackEvaluator,
  createIframeRequestInterceptor,
  EMBED_AD_BLOCKLIST_DOMAINS,
  extractSafeHostname,
  getAdBlockerIframeSandbox,
  getCleanIframeAttributes,
  getEmbedAdBlockerIframeAttributes,
  getEmbedIframeProviderKey,
  getVidSrcPlayerIframeAttributes,
  installEmbedIframeAdInterceptor,
  installVidSrcNetworkAdInterceptor,
  isAdServingRequestUrl,
  isEmbedAdNetworkUrl,
  isEmbedIframeVideoSourceUrl,
  isHtmlEmbedProviderHost,
  isKnownAdServingDomain,
  isPrivateOrReservedIp,
  isVidSrcAdNetworkUrl,
  isVidSrcProviderUrl,
  parseAdBlockTelemetryMessage,
  parseHostsTextIntoSet,
  probeAdBlockProxyHealth,
  registerExtraAdBlockDomains,
  resolveEffectiveEmbedTargetUrl,
  rewriteEmbedHtmlWithAdBlocker,
  sanitizeEmbedIframeRequestUrl,
  validateProxyTargetUrl,
  VIDSRC_AD_BLOCKLIST_DOMAINS,
} from './adblocker';
export type {
  AdBlockerStats,
  BlurHijackEvaluation,
  EmbedIframeProviderKey,
  IframeRequestInterceptorOptions,
  InFrameAdBlockTelemetry,
  VidSrcInterceptKind,
} from './adblocker';

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
 * Builds active Auto-Embed servers for Movies (`movie`) and TV Series (`tv`):
 * - Source 1: VidSrc.sh (`auto-server-1`)
 * - Source 2: VidLink.pro (`auto-server-vidlink` — Preferred Default, verified proxied playback + AdBlocker)
 * - Source 3: VidFast (`auto-server-vidfast`)
 * - Source 4: 2Embed (`auto-server-3`)
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

  const epTag = mediaType === 'tv' ? ` S${safeSeason}:E${safeEpisode}` : '';

  servers.push(
    {
      id: 'auto-server-1',
      label: `Source 1 (VidSrc.sh${epTag})`,
      url: buildVidSrcEmbedUrl({
        tmdbId: safeTmdbId,
        mediaType,
        season: safeSeason,
        episode: safeEpisode,
        dsLang: 'en',
      }),
      isCustom: false,
      providerName: 'VidSrc.sh',
      audioType: 'provider-controlled',
    },
    {
      id: 'auto-server-vidlink',
      label: `Source 2 (VidLink.pro${epTag})`,
      url: buildVidLinkEmbedUrl({
        tmdbId: safeTmdbId,
        mediaType,
        season: safeSeason,
        episode: safeEpisode,
      }),
      isCustom: false,
      providerName: 'VidLink.pro',
      audioType: 'provider-controlled',
    },
    {
      id: 'auto-server-vidfast',
      label: `Source 3 (VidFast${epTag})`,
      url: buildVidFastEmbedUrl({
        tmdbId: safeTmdbId,
        mediaType,
        season: safeSeason,
        episode: safeEpisode,
      }),
      isCustom: false,
      providerName: 'VidFast',
      audioType: 'provider-controlled',
    },
    {
      id: 'auto-server-3',
      label: `Source 4 (2Embed${epTag})`,
      url: build2EmbedFallbackUrl({
        tmdbId: safeTmdbId,
        mediaType,
        season: safeSeason,
        episode: safeEpisode,
      }),
      isCustom: false,
      providerName: '2Embed',
      audioType: 'provider-controlled',
    }
  );

  return servers;
}

// Re-exported from ./adblocker at top of file.

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

export const STICKY_EMBED_SCROLL_THRESHOLD_PX = 48;

export interface StickyPlayerScrollConfigInput {
  isFullscreen: boolean;
  hasPlaybackStarted: boolean;
  isAndroidPlatform: boolean;
  stickyFlagEnabled?: boolean;
  cssStickySupported?: boolean;
  hasBrokenStickyAncestor?: boolean;
  playerMode?: 'direct' | 'embed' | 'pak-drama' | 'trailer' | 'blob';
  isScrolledPastThreshold?: boolean;
}

/**
 * Checks whether the current browser / Android WebView supports `position: sticky`
 * (or `-webkit-sticky`) via `CSS.supports('position', 'sticky')`.
 */
export function supportsCssStickyPosition(
  cssObj?: { supports?: (prop: string, val: string) => boolean } | null
): boolean {
  const targetCss =
    cssObj !== undefined
      ? cssObj
      : typeof CSS !== 'undefined'
      ? CSS
      : null;

  if (!targetCss || typeof targetCss.supports !== 'function') {
    return false;
  }

  try {
    return (
      Boolean(targetCss.supports('position', 'sticky')) ||
      Boolean(targetCss.supports('position', '-webkit-sticky'))
    );
  } catch {
    return false;
  }
}

/**
 * Audits every ancestor between `stickyElement` and `scrollContainer` for CSS properties
 * that silently break `position: sticky`:
 * - `transform !== 'none'`
 * - `filter !== 'none'`
 * - `perspective !== 'none'`
 * - `overflow` / `overflowX` / `overflowY` set to `hidden`, `clip`, `scroll`, or `auto`
 */
export function auditStickyAncestors(
  stickyElement: HTMLElement | null | undefined,
  scrollContainer?: HTMLElement | null
): { hasBreakingAncestor: boolean; issues: string[] } {
  if (!stickyElement || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return { hasBreakingAncestor: false, issues: [] };
  }

  const issues: string[] = [];
  let current: HTMLElement | null = stickyElement.parentElement;

  while (current && current !== scrollContainer && current !== document.body && current !== document.documentElement) {
    try {
      const style = window.getComputedStyle(current);
      if (style.transform && style.transform !== 'none') {
        issues.push(`transform:${style.transform}`);
      }
      if (style.filter && style.filter !== 'none') {
        issues.push(`filter:${style.filter}`);
      }
      if (style.perspective && style.perspective !== 'none') {
        issues.push(`perspective:${style.perspective}`);
      }
      const overflows = [style.overflow, style.overflowX, style.overflowY];
      if (overflows.some((ov) => ov === 'hidden' || ov === 'clip' || ov === 'scroll' || ov === 'auto')) {
        issues.push(`overflow:${style.overflow}`);
      }
    } catch {
      // ignore computed style errors
    }
    current = current.parentElement;
  }

  return {
    hasBreakingAncestor: issues.length > 0,
    issues,
  };
}

/**
 * Fix 1: Sticky Video Player on Scroll
 * - Returns `true` ONLY when video playback has started (`hasPlaybackStarted === true`),
 *   the player is not in fullscreen mode (`!isFullscreen`), and the app is running on
 *   Android/Capacitor (`isAndroidPlatform === true`) or an explicit sticky flag is enabled.
 * - In cross-origin `embed` / `pak-drama` / `trailer` iframe modes, also requires the user to have
 *   actually scrolled past the sticky threshold (`isScrolledPastThreshold === true`, `scrollTop > 48px`)
 *   so clicking inside an iframe never triggers a false-positive sticky state while at the top of the page.
 * - Leaves desktop/browser playback unchanged unless the flag is enabled.
 */
export function shouldEnableStickyPlayerOnScroll(
  input: StickyPlayerScrollConfigInput
): boolean {
  if (input.isFullscreen) return false;
  if (!input.hasPlaybackStarted) return false;
  if (
    input.playerMode &&
    input.playerMode !== 'direct' &&
    input.playerMode !== 'blob' &&
    !input.isScrolledPastThreshold
  ) {
    return false;
  }
  return Boolean(input.isAndroidPlatform || input.stickyFlagEnabled);
}

/**
 * Resolves the sticky positioning strategy:
 * - `'css-sticky'`: Native CSS `position: sticky; top: 0; z-index: 40` when `CSS.supports('position', 'sticky')`
 *   is true and no ancestor has breaking `transform`/`filter`/`overflow: hidden`.
 * - `'js-fixed-fallback'`: JS-based fallback (stickybits-style) for legacy Android WebViews without
 *   `CSS.supports('position', 'sticky')` or when an ancestor breaks CSS sticky. Uses `fixed top-0 left-0 right-0 z-40`
 *   paired with an exact-height placeholder spacer so page content NEVER jumps.
 * - `'none'`: Normal flow (`relative z-20`).
 */
export function resolveStickyPlayerPositionStrategy(
  input: StickyPlayerScrollConfigInput
): 'css-sticky' | 'js-fixed-fallback' | 'none' {
  if (!shouldEnableStickyPlayerOnScroll(input)) {
    return 'none';
  }
  const stickySupported =
    input.cssStickySupported !== undefined
      ? input.cssStickySupported
      : supportsCssStickyPosition();
  if (!stickySupported || input.hasBrokenStickyAncestor) {
    return 'js-fixed-fallback';
  }
  return 'css-sticky';
}

/**
 * Returns the CSS class string for the player wrapper.
 * - Uses `sticky top-0 z-40` (CSS `position: sticky; top: 0; z-index: 40`) when native sticky mode is active.
 * - Uses `fixed top-0 left-0 right-0 z-40 max-w-6xl mx-auto` ONLY when `resolveStickyPlayerPositionStrategy`
 *   selects `'js-fixed-fallback'` (paired with a layout-preserving spacer element in the component).
 */
export function getStickyPlayerWrapperClassName(
  input: StickyPlayerScrollConfigInput
): string {
  const strategy = resolveStickyPlayerPositionStrategy(input);
  if (strategy === 'css-sticky') {
    return 'sticky top-0 z-40 w-full bg-[#000000] shadow-2xl shadow-black/90 transition-shadow duration-200';
  }
  if (strategy === 'js-fixed-fallback') {
    return 'fixed top-0 left-0 right-0 z-40 w-full max-w-6xl mx-auto bg-[#000000] shadow-2xl shadow-black/90 transition-shadow duration-200';
  }
  return 'relative z-20 w-full bg-[#000000]';
}

export interface FullscreenPlayerLayoutConfig {
  isFullscreen: boolean;
  areControlsVisible: boolean;
  backgroundColor: '#000000';
  viewportWidth: '100vw';
  viewportHeight: '100dvh';
  objectFit: 'contain' | 'cover' | 'fill';
  showAlwaysVisibleExitButton: boolean;
  showControlsSyncedExitButton: boolean;
  containerClassName: string;
  videoObjectFitClass: string;
  bottomControlsSafePaddingClass: string;
  topBarClassName: string;
  exitButtonClassName: string;
  topRightControlsClassName: string;
}

/**
 * Determines whether a window/container activity event should be ignored by the
 * fullscreen Exit-button 3-second auto-hide timer (prevents Android WebView
 * orientation/iframe focus `blur` or synthetic touch `mousemove`/`pointermove`
 * events from keeping the Exit Fullscreen button permanently visible).
 */
export function shouldIgnoreFullscreenWakeEvent(
  eventType: string,
  options?: {
    pointerType?: string;
    fullscreenEnteredAtMs?: number;
    nowMs?: number;
    isDocumentHidden?: boolean;
  }
): boolean {
  const type = String(eventType || '').toLowerCase();
  if (options?.isDocumentHidden) {
    return true;
  }
  const now = options?.nowMs ?? Date.now();
  const enteredAt = options?.fullscreenEnteredAtMs ?? 0;

  if (type === 'blur') {
    // Ignore spurious blur caused by orientation lock / WebView resize / initial iframe focus
    if (enteredAt > 0 && now - enteredAt < 1200) {
      return true;
    }
    return false;
  }

  if (type === 'pointermove' || type === 'mousemove') {
    const pType = String(options?.pointerType || '').toLowerCase();
    // Touch devices emit synthetic mousemove/pointermove that shouldn't keep controls awake
    if (pType === 'touch' || pType === 'pen') {
      return true;
    }
    if (type === 'mousemove' && enteredAt > 0 && now - enteredAt < 600) {
      return true;
    }
  }

  return false;
}

/**
 * Pure helper for player click/tap toggle visibility:
 * - If `forceShow` is true (e.g. tapping the wake strip when hidden), returns `true`.
 * - Otherwise toggles between visible (`true`) and hidden (`false`) on every player tap.
 */
export function computeNextControlsVisibility(
  currentlyVisible: boolean,
  forceShow: boolean = false
): boolean {
  if (forceShow) return true;
  return !currentlyVisible;
}

/**
 * Computes fullscreen player container classes, pure #000000 borderless background,
 * unified top fullscreen bar (left "<" back + playing movie name + compact right actions)
 * with smooth 300ms transition & 3-second auto-hide, and mobile safe-area padding.
 */
export function getFullscreenPlayerConfig(
  isFullscreen: boolean,
  fitMode: 'contain' | 'cover' | 'fill' = 'contain',
  areControlsVisible: boolean = true
): FullscreenPlayerLayoutConfig {
  const videoObjectFitClass =
    fitMode === 'cover'
      ? 'object-cover'
      : fitMode === 'fill'
      ? 'object-fill'
      : 'object-contain';

  const containerClassName = isFullscreen
    ? 'cinebox-player-fullscreen fixed inset-0 z-[9999] w-[100vw] h-[100vh] h-[100dvh] max-w-[100vw] max-h-[100dvh] bg-[#000000] overflow-hidden select-none border-0 outline-none ring-0 shadow-none m-0 p-0'
    : 'relative w-full aspect-video min-h-[225px] sm:min-h-[360px] max-h-[68vh] bg-[#000000] overflow-hidden select-none border-0 outline-none ring-0 m-0 p-0';

  const bottomControlsSafePaddingClass = isFullscreen
    ? 'px-4 sm:px-6 pb-[max(1.25rem,calc(env(safe-area-inset-bottom,16px)+12px))] pt-3 bg-gradient-to-t from-black via-black/80 to-transparent'
    : 'px-3 sm:px-4 pb-[max(0.875rem,calc(env(safe-area-inset-bottom,10px)+6px))] pt-2.5 bg-gradient-to-t from-black/95 via-black/75 to-transparent';

  const visibilityMotionClass = areControlsVisible
    ? 'opacity-100 visible pointer-events-auto translate-y-0'
    : 'opacity-0 invisible pointer-events-none -translate-y-3';

  const topBarClassName = `fixed top-0 left-0 right-0 z-[10000] flex items-center justify-between gap-2.5 px-3 sm:px-5 pt-[max(0.75rem,env(safe-area-inset-top,12px))] pb-5 bg-gradient-to-b from-black/95 via-black/70 to-transparent backdrop-blur-[2px] transition-all duration-300 ease-out ${visibilityMotionClass}`;

  const exitButtonClassName = `min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white transition-all duration-300 ease-out active:scale-95 shrink-0 ${visibilityMotionClass}`;

  const topRightControlsClassName = `flex items-center gap-1.5 sm:gap-2 shrink-0 transition-all duration-300 ease-out ${visibilityMotionClass}`;

  return {
    isFullscreen,
    areControlsVisible,
    backgroundColor: '#000000',
    viewportWidth: '100vw',
    viewportHeight: '100dvh',
    objectFit: fitMode,
    showAlwaysVisibleExitButton: isFullscreen,
    showControlsSyncedExitButton: isFullscreen && areControlsVisible,
    containerClassName,
    videoObjectFitClass,
    bottomControlsSafePaddingClass,
    topBarClassName,
    exitButtonClassName,
    topRightControlsClassName,
  };
}

/**
 * Safely locks or unlocks mobile screen orientation (Landscape during video fullscreen/play,
 * Portrait when exiting fullscreen or closing the player) without throwing on desktop browsers.
 */
export async function lockScreenOrientationSafely(
  mode: 'landscape' | 'portrait' | 'unlock',
  screenObj?: {
    orientation?: {
      lock?: (orientation: string) => Promise<void>;
      unlock?: () => void;
    };
  } | null
): Promise<{ ok: boolean; mode: 'landscape' | 'portrait' | 'unlock' }> {
  try {
    const targetScreen =
      screenObj !== undefined
        ? screenObj
        : typeof window !== 'undefined'
        ? (window.screen as any)
        : null;

    const orientationApi = targetScreen?.orientation;
    if (!orientationApi) {
      return { ok: false, mode };
    }

    if (mode === 'unlock') {
      if (typeof orientationApi.unlock === 'function') {
        orientationApi.unlock();
        return { ok: true, mode };
      }
      return { ok: false, mode };
    }

    if (typeof orientationApi.lock === 'function') {
      try {
        await orientationApi.lock(mode);
        return { ok: true, mode };
      } catch {
        if (mode === 'portrait' && typeof orientationApi.unlock === 'function') {
          orientationApi.unlock();
          return { ok: true, mode };
        }
        return { ok: false, mode };
      }
    }

    if (mode === 'portrait' && typeof orientationApi.unlock === 'function') {
      orientationApi.unlock();
      return { ok: true, mode };
    }
    return { ok: false, mode };
  } catch {
    return { ok: false, mode };
  }
}

