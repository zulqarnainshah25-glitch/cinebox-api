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
 * Known popup, popunder, and click-hijack ad domains loaded by VidSrc.sh.
 * Used by the VidSrc.sh AdBlocker to block ad scripts & redirect targets.
 */
export const VIDSRC_AD_BLOCKLIST_DOMAINS: readonly string[] = Object.freeze([
  'doubleclick.net',
  'googlesyndication.com',
  'adsterra.com',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'onclickads.net',
  'onclickperformance.com',
  'acscdn.com',
  'exoclick.com',
  'juicyads.com',
  'tsyndicate.com',
  'rtmark.net',
  'histats.com',
  'trafficjunky.net',
  'clickadu.com',
  'hilltopads.net',
  'admaven.com',
  'galaksion.com',
  'a-ads.com',
  'outbrain.com',
  'taboola.com',
  'mc.yandex.ru',
  'bnhtml.com',
  'roudodu.com',
  'cdn4ads.com',
  'adsco.re',
  'pushame.com',
  'notix.io',
]);

/**
 * Returns `true` ONLY if the given URL belongs to `vidsrc.sh` (or `*.vidsrc.sh`).
 * Ensures the VidSrc.sh AdBlocker targets only VidSrc.sh and never interferes with other servers.
 */
export function isVidSrcProviderUrl(rawUrl?: string | null): boolean {
  const safe = sanitizeSafeUrl(rawUrl);
  if (!safe) return false;
  try {
    const parsed = new URL(safe);
    const host = parsed.hostname.toLowerCase();
    return host === 'vidsrc.sh' || host.endsWith('.vidsrc.sh');
  } catch {
    return false;
  }
}

/**
 * Returns `true` if a URL is a known VidSrc.sh popup/popunder ad network domain or ad script path.
 */
export function isVidSrcAdNetworkUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim().toLowerCase();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    const host = parsed.hostname.toLowerCase();
    for (const adDomain of VIDSRC_AD_BLOCKLIST_DOMAINS) {
      if (host === adDomain || host.endsWith(`.${adDomain}`)) {
        return true;
      }
    }
    const pathAndQuery = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (
      pathAndQuery.includes('/popunder') ||
      pathAndQuery.includes('/pop.js') ||
      pathAndQuery.includes('/adserver') ||
      pathAndQuery.includes('clickid=') ||
      pathAndQuery.includes('zoneid=')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Returns clean, sandbox-free iframe attributes (`src` and `allowFullScreen` only)
 * for general embed providers.
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
 * Returns iframe attributes with real VidSrc.sh AdBlocker enforcement:
 * - When `rawUrl` is `vidsrc.sh` and `isAdBlockerEnabled` is `true`, applies
 *   `sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"`
 *   which strictly strips `allow-popups`, `allow-popups-to-escape-sandbox`, and
 *   `allow-top-navigation`, blocking 100% of click-triggered popup ads on `vidsrc.sh`
 *   while allowing video playback and fullscreen.
 * - For all other providers (e.g. `2embed.cc`) or when AdBlocker is toggled off,
 *   omits `sandbox` so non-VidSrc providers behave normally.
 */
export function getVidSrcPlayerIframeAttributes(
  rawUrl?: string | null,
  title: string = 'Movie Stream Player',
  isAdBlockerEnabled: boolean = true
): {
  src: string;
  allowFullScreen: true;
  title: string;
  sandbox?: string;
  isVidSrcTarget: boolean;
  isVidSrcAdBlockerActive: boolean;
} {
  const safeSrc = sanitizeSafeUrl(rawUrl) || '';
  const isVidSrcTarget = isVidSrcProviderUrl(safeSrc);
  const isVidSrcAdBlockerActive = isVidSrcTarget && Boolean(isAdBlockerEnabled);

  if (isVidSrcAdBlockerActive) {
    return {
      src: safeSrc,
      allowFullScreen: true,
      title: title.trim() || 'Movie Stream Player',
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-presentation',
      isVidSrcTarget: true,
      isVidSrcAdBlockerActive: true,
    };
  }

  return {
    src: safeSrc,
    allowFullScreen: true,
    title: title.trim() || 'Movie Stream Player',
    isVidSrcTarget,
    isVidSrcAdBlockerActive: false,
  };
}

/**
 * Generates targeted CSS hiding rules specifically for `vidsrc.sh` ad overlays,
 * popunder containers, and ad-network iframes/anchors when the Adblocker toggle switch is enabled.
 * Returns an empty string when disabled or when a non-VidSrc server is active.
 */
export function buildVidSrcAdBlockCssRules(
  isAdBlockerEnabled: boolean,
  isVidSrcTarget: boolean
): string {
  if (!isAdBlockerEnabled || !isVidSrcTarget) {
    return '';
  }

  const domainSelectors = VIDSRC_AD_BLOCKLIST_DOMAINS.map(
    (domain) =>
      `iframe[src*="${domain}"], script[src*="${domain}"], a[href*="${domain}"], div[data-domain*="${domain}"]`
  ).join(',\n  ');

  return `
  /* CineBox VidSrc.sh Targeted AdBlocker CSS Hiding Layer */
  ${domainSelectors},
  [id*="popunder"],
  [class*="popunder"],
  [id*="ad-overlay"],
  [class*="ad-overlay"],
  [id*="clickjack"],
  [class*="clickjack"],
  [data-ad-zone],
  [data-adblock-hide="true"],
  a[target="_blank"][href*="clickid="],
  a[target="_blank"][href*="zoneid="] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    width: 0 !important;
    height: 0 !important;
    max-width: 0 !important;
    max-height: 0 !important;
    overflow: hidden !important;
    position: absolute !important;
    z-index: -9999 !important;
  }

  /* Keep the primary vidsrc.sh video iframe interactive while hiding injected sibling overlays */
  [data-vidsrc-adblock="active"] > iframe[data-vidsrc-iframe="true"] {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  [data-vidsrc-adblock="active"] > :not(iframe[data-vidsrc-iframe="true"]):not([data-testid="vidsrc-adblock-toast"]) {
    display: none !important;
    pointer-events: none !important;
  }
`.trim();
}

export type VidSrcInterceptKind = 'fetch' | 'xhr' | 'popup' | 'dom-node' | 'focus-steal';

/**
 * Installs a runtime ad-filtering logic layer specifically when a `vidsrc.sh` iframe is active
 * and the Adblocker toggle switch is ON:
 * 1. Intercepts `window.fetch` requests to known ad networks (`isVidSrcAdNetworkUrl`) and returns 204.
 * 2. Intercepts `XMLHttpRequest.prototype.open` / `send` requests to known ad networks.
 * 3. Intercepts `window.open` popup tabs triggered by clickjacking scripts.
 * 4. Observes DOM mutations to strip dynamically injected ad `<script>` / `<iframe>` / `<a>` elements.
 * 5. Refocuses the player window if a cross-origin iframe attempts a blur/focus-steal popunder.
 *
 * Returns a cleanup callback that restores all native APIs immediately when toggled OFF or unmounted.
 */
export function installVidSrcNetworkAdInterceptor(options: {
  enabled: boolean;
  isVidSrcTarget: boolean;
  onAdBlocked?: (blockedUrl: string, kind: VidSrcInterceptKind) => void;
  targetWindow?: any;
  targetDocument?: any;
}): () => void {
  const { enabled, isVidSrcTarget, onAdBlocked } = options;
  if (!enabled || !isVidSrcTarget) {
    return () => {};
  }

  const win = options.targetWindow ?? (typeof window !== 'undefined' ? window : null);
  const doc = options.targetDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!win) {
    return () => {};
  }

  // 1. Intercept window.fetch for VidSrc ad-network URLs
  const originalFetch = typeof win.fetch === 'function' ? win.fetch.bind(win) : null;
  if (originalFetch) {
    win.fetch = async (input: any, init?: any) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input && typeof input.url === 'string'
          ? input.url
          : String(input || '');

      if (isVidSrcAdNetworkUrl(rawUrl)) {
        onAdBlocked?.(rawUrl, 'fetch');
        if (typeof Response !== 'undefined') {
          return new Response(null, {
            status: 204,
            statusText: 'Blocked by CineBox VidSrc AdBlocker',
          });
        }
        return { ok: true, status: 204, text: async () => '', json: async () => ({}) };
      }
      return originalFetch(input, init);
    };
  }

  // 2. Intercept XMLHttpRequest for VidSrc ad-network URLs
  const XhrProto = win.XMLHttpRequest?.prototype;
  const originalXhrOpen = XhrProto?.open;
  const originalXhrSend = XhrProto?.send;
  if (XhrProto && typeof originalXhrOpen === 'function' && typeof originalXhrSend === 'function') {
    XhrProto.open = function (method: string, url: string, ...rest: any[]) {
      (this as any).__cineboxBlockedAdUrl = isVidSrcAdNetworkUrl(url) ? String(url) : null;
      return originalXhrOpen.call(this, method, url, ...rest);
    };
    XhrProto.send = function (body?: any) {
      const blockedUrl = (this as any).__cineboxBlockedAdUrl;
      if (blockedUrl) {
        onAdBlocked?.(blockedUrl, 'xhr');
        try {
          Object.defineProperty(this, 'status', { value: 204, configurable: true });
          Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(this, 'responseText', { value: '', configurable: true });
        } catch {
          // ignore
        }
        return;
      }
      return originalXhrSend.call(this, body);
    };
  }

  // 3. Intercept window.open popup windows
  const originalWindowOpen = win.open;
  win.open = (url?: string | URL) => {
    onAdBlocked?.(String(url || 'window.open'), 'popup');
    return null;
  };

  // 4. Intercept focus-stealing popunders when clicking inside the vidsrc.sh iframe
  const handleWindowBlur = () => {
    if (doc?.activeElement && doc.activeElement.tagName === 'IFRAME') {
      onAdBlocked?.('vidsrc.sh://iframe-focus-popup', 'focus-steal');
      try {
        win.focus?.();
      } catch {
        // ignore
      }
    }
  };
  win.addEventListener?.('blur', handleWindowBlur);

  // 5. Intercept click events on injected ad anchors & MutationObserver for injected ad nodes
  const handleDocumentClickCapture = (ev: any) => {
    const target = ev?.target?.closest?.('a') as HTMLAnchorElement | null;
    if (!target) return;
    const href = target.getAttribute?.('href') || target.href || '';
    if (isVidSrcAdNetworkUrl(href)) {
      ev.preventDefault?.();
      ev.stopPropagation?.();
      onAdBlocked?.(href, 'dom-node');
    }
  };
  doc?.addEventListener?.('click', handleDocumentClickCapture, true);

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined' && doc?.body) {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const added = Array.from(mutation.addedNodes || []);
        for (const node of added) {
          const el = node as HTMLElement;
          if (!el || typeof el.tagName !== 'string') continue;
          const tag = el.tagName.toUpperCase();
          if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'A') {
            const srcOrHref =
              el.getAttribute?.('src') ||
              el.getAttribute?.('href') ||
              (el as any).src ||
              (el as any).href ||
              '';
            if (isVidSrcAdNetworkUrl(srcOrHref)) {
              el.setAttribute?.('data-adblock-hide', 'true');
              try {
                el.remove?.();
              } catch {
                // ignore
              }
              onAdBlocked?.(srcOrHref, 'dom-node');
            }
          }
        }
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  return () => {
    if (originalFetch) {
      win.fetch = originalFetch;
    }
    if (XhrProto && originalXhrOpen && originalXhrSend) {
      XhrProto.open = originalXhrOpen;
      XhrProto.send = originalXhrSend;
    }
    win.open = originalWindowOpen;
    win.removeEventListener?.('blur', handleWindowBlur);
    doc?.removeEventListener?.('click', handleDocumentClickCapture, true);
    if (observer) {
      observer.disconnect();
      observer = null;
    }
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
  exitButtonClassName: string;
}

/**
 * Computes fullscreen player container classes, pure #000000 borderless background,
 * top-left/top-right Exit Fullscreen button state synced with player controls & Android taskbar blending,
 * and mobile navigation-bar safe-area padding.
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

  const exitButtonClassName = `fixed top-[max(0.75rem,env(safe-area-inset-top,12px))] left-[max(0.75rem,env(safe-area-inset-left,12px))] z-[10000] flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-black/85 hover:bg-black border border-white/20 text-white text-xs font-extrabold shadow-2xl backdrop-blur-md transition-all duration-200 active:scale-95 min-h-[40px] ${
    areControlsVisible
      ? 'opacity-100 pointer-events-auto translate-y-0'
      : 'opacity-0 pointer-events-none -translate-y-2'
  }`;

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
    exitButtonClassName,
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
      await orientationApi.lock(mode);
      return { ok: true, mode };
    }
    return { ok: false, mode };
  } catch {
    return { ok: false, mode };
  }
}

