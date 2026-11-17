import { sanitizeSafeUrl } from './securityValidator';
import {
  CURATED_AD_DOMAINS,
  DEFAULT_CURATED_AD_DOMAIN_SET,
  buildInFrameAdBlockScriptlet,
  isAdRequestUrl,
  isDomainInBlocklist,
  isHtmlEmbedProviderHost,
  isPrivateOrReservedIp,
  parseHostsTextIntoSet,
  requiresDirectOriginForVerification,
  rewriteEmbedHtmlWithAdBlocker,
  validateProxyTargetUrl,
} from './adblockEngine';

/**
 * CineBox Robust Real Iframe Video AdBlocker Utility (v1.0.13)
 *
 * Dual-layer real adblocker across ALL third-party embed video sources
 * (`VidSrc.sh`, `VidLink.pro`, `VidFast`, `2Embed`, and Custom Embeds):
 * - Web: Routes non-Turnstile embeds (`VidLink.pro`, `2Embed`, Custom) through SSRF-hardened
 *   `/api/adblock-proxy` with fast DNS/static-asset caching + prewarm, while preserving genuine
 *   browser origin + Smart Click-Shield/focus/redirect guards for Cloudflare Turnstile providers
 *   (`VidSrc.sh`, `VidFast`) so verification never fails.
 * - Android Native APK: Backed by `MainActivity.java` WebView interception + HTML scriptlet injection +
 *   `onCreateWindow -> false` using bundled `adblock_domains.txt` across all sources.
 * - Non-embed direct `.mp4`/`.m3u8` streams, Live TV, and official YouTube links remain untouched.
 *
 * IMPORTANT: Never applies HTML `<iframe sandbox>` (which triggers VidSrc.sh / 2Embed anti-sandbox errors).
 */

export {
  buildInFrameAdBlockScriptlet,
  isHtmlEmbedProviderHost,
  isPrivateOrReservedIp,
  parseHostsTextIntoSet,
  requiresDirectOriginForVerification,
  rewriteEmbedHtmlWithAdBlocker,
  validateProxyTargetUrl,
};

export const ADBLOCK_PROXY_ENDPOINT = '/api/adblock-proxy';
export const ADBLOCK_PREWARM_ENDPOINT = '/api/adblock-proxy/prewarm';
export const ADBLOCK_HEALTH_ENDPOINT = '/api/health';
export const CLICK_SHIELD_UNLOCK_WINDOW_MS = 10_000;
export const CLICK_SHIELD_REARM_IDLE_MS = 15_000;
export const ADBLOCK_TOAST_ENABLED = '🛡️ AdBlocker Enabled';
export const ADBLOCK_TOAST_DISABLED = '⚠️ AdBlocker Disabled';
export const ADBLOCK_TOAST_TRAP_BLOCKED = '🛡️ Popup Ad Trap Blocked — Tap again to play';

export const AD_SERVING_DOMAINS: readonly string[] = [
  ...CURATED_AD_DOMAINS,
];

export const VIDSRC_AD_BLOCKLIST_DOMAINS: string[] = [...AD_SERVING_DOMAINS];
export const EMBED_AD_BLOCKLIST_DOMAINS = VIDSRC_AD_BLOCKLIST_DOMAINS;

const AD_SERVING_DOMAIN_SET: Set<string> = new Set(DEFAULT_CURATED_AD_DOMAIN_SET);

export function registerExtraAdBlockDomains(domains: readonly string[]): number {
  let added = 0;
  for (const d of domains) {
    const clean = String(d || '').trim().toLowerCase();
    if (clean && !AD_SERVING_DOMAIN_SET.has(clean)) {
      AD_SERVING_DOMAIN_SET.add(clean);
      added += 1;
    }
  }
  return added;
}

const STRIPPABLE_TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'clickid',
  'zoneid',
  'adunit',
  'popunder',
  'aff_id',
  'subid',
]);

const REDIRECT_PARAM_KEYS = ['url', 'redirect', 'redir', 'dest', 'target', 'next', 'out', 'adurl', 'u'];

export type EmbedIframeProviderKey =
  | 'vidsrc'
  | 'vidlink'
  | 'vidfast'
  | '2embed'
  | 'custom'
  | 'none';

export type VidSrcInterceptKind =
  | 'fetch'
  | 'xhr'
  | 'popup'
  | 'redirect'
  | 'dom-node'
  | 'focus-steal'
  | 'clickjack-shield';

export interface AdBlockerStats {
  totalBlocked: number;
  byKind: Record<VidSrcInterceptKind, number>;
}

/**
 * Normalizes a URL string safely and returns its lowercase hostname (`''` on invalid/unsafe input).
 */
export function extractSafeHostname(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const parsed = new URL(normalized);
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

/**
 * O(label_count) domain + subdomain suffix check against `AD_SERVING_DOMAIN_SET`.
 */
export function isKnownAdServingDomain(rawUrlOrHost?: string | null): boolean {
  return isDomainInBlocklist(rawUrlOrHost, AD_SERVING_DOMAIN_SET);
}

/**
 * Returns `true` ONLY if the given URL belongs to `vidsrc.sh` (or `*.vidsrc.sh`).
 */
export function isVidSrcProviderUrl(rawUrl?: string | null): boolean {
  const safe = sanitizeSafeUrl(rawUrl);
  if (!safe) return false;
  const host = extractSafeHostname(safe);
  return host === 'vidsrc.sh' || host.endsWith('.vidsrc.sh');
}

/**
 * Classifies an embed iframe video source URL.
 * Returns `'none'` for null/invalid URLs, YouTube official pages/embeds, direct `.mp4`/`.m3u8`/`.ts` streams,
 * and unsafe schemes so the AdBlocker applies STRICTLY to third-party embed video sources.
 */
export function getEmbedIframeProviderKey(rawUrl?: string | null): EmbedIframeProviderKey {
  const safe = sanitizeSafeUrl(rawUrl);
  if (!safe) return 'none';
  try {
    const parsed = new URL(safe);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtu.be' ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com')
    ) {
      return 'none';
    }

    if (/\.(mp4|m3u8|ts|webm|mkv|mp3|aac|ogg)(?:$|\?)/i.test(path)) {
      return 'none';
    }

    if (host === 'vidsrc.sh' || host.endsWith('.vidsrc.sh')) {
      return 'vidsrc';
    }
    if (host === 'vidlink.pro' || host.endsWith('.vidlink.pro')) {
      return 'vidlink';
    }
    if (host === 'vidfast' || /(?:^|\.)vidfast\.(vc|pro|in|io|me|net|pm|xyz|bz)$/i.test(host)) {
      return 'vidfast';
    }
    if (
      host === '2embed.cc' ||
      host.endsWith('.2embed.cc') ||
      host === '2vcdn.skin' ||
      host.endsWith('.2vcdn.skin')
    ) {
      return '2embed';
    }

    return 'custom';
  } catch {
    return 'none';
  }
}

/**
 * Returns `true` for ANY supported third-party iframe video source (`VidSrc.sh`, `VidLink.pro`, `VidFast`, `2Embed`, or custom embed URL),
 * and `false` for non-iframe direct video streams, YouTube official players, or invalid URLs.
 */
export function isEmbedIframeVideoSourceUrl(rawUrl?: string | null): boolean {
  return getEmbedIframeProviderKey(rawUrl) !== 'none';
}

/**
 * Checks whether a request/script/iframe/beacon/redirect URL matches known ad-serving domains,
 * VAST/VPAID/VMAP ad manifests, DGA popunder routes, or wrapped redirect query URLs.
 */
export function isAdServingRequestUrl(rawUrl?: string | null, depth: number = 0): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  // Immediately flag inline script/data HTML trap payloads
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html')) {
    return true;
  }

  try {
    const parsed = new URL(lower.startsWith('//') ? `https:${trimmed}` : trimmed);
    const host = parsed.hostname.toLowerCase();

    if (isKnownAdServingDomain(host)) {
      return true;
    }

    // DGA popunder TLDs used by VidSrc / upstream providers
    if (host.endsWith('.u08') || host.endsWith('.olfm') || host.endsWith('.uqa9')) {
      return true;
    }

    const pathAndQuery = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if ((host.endsWith('.cfd') || host.endsWith('.rest')) && pathAndQuery.includes('/vvmro')) {
      return true;
    }

    if (
      pathAndQuery.includes('/popunder') ||
      pathAndQuery.includes('/pop.js') ||
      pathAndQuery.includes('/suv5.js') ||
      pathAndQuery.includes('/aclib.js') ||
      pathAndQuery.includes('/suurl5.php') ||
      pathAndQuery.includes('/adserver') ||
      pathAndQuery.includes('/assets/sbx.js') ||
      pathAndQuery.includes('disable-devtool') ||
      pathAndQuery.includes('/vgmoo') ||
      pathAndQuery.includes('/vvmro') ||
      pathAndQuery.includes('/vast.js') ||
      pathAndQuery.includes('/vast.xml') ||
      pathAndQuery.includes('/vmap.xml') ||
      pathAndQuery.includes('/ad-site-i18n-sg/') ||
      pathAndQuery.includes('clickid=') ||
      pathAndQuery.includes('zoneid=') ||
      pathAndQuery.includes('adunit=') ||
      pathAndQuery.includes('cbcdn=') ||
      pathAndQuery.includes('popundersperip') ||
      /[?&]fmt=suv\d/i.test(pathAndQuery) ||
      /\/api\/(?:mercury|venus)(?:$|\?)/i.test(pathAndQuery) ||
      /\/embed\/[0-9a-f]{32}\.js/.test(pathAndQuery) ||
      /\/fc8e8cab-[0-9a-f-]+/i.test(pathAndQuery)
    ) {
      return true;
    }

    // Check 1 level of wrapped redirect query params (e.g. ?url=https://adplox.com/...)
    if (depth === 0) {
      for (const paramKey of REDIRECT_PARAM_KEYS) {
        const nestedVal = parsed.searchParams.get(paramKey);
        if (nestedVal && (nestedVal.startsWith('http://') || nestedVal.startsWith('https://') || nestedVal.startsWith('//'))) {
          if (isAdServingRequestUrl(nestedVal, 1)) {
            return true;
          }
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

export const isVidSrcAdNetworkUrl = (rawUrl?: string | null): boolean =>
  isAdServingRequestUrl(rawUrl, 0);
export const isEmbedAdNetworkUrl = isVidSrcAdNetworkUrl;

/**
 * Sanitizes an embed iframe `src` URL before mounting:
 * - Returns `null` if URL is missing, unsafe (`javascript:`, `intent:`, etc.), or itself an ad-serving domain.
 * - Strips known ad-tracking query params (`utm_*`, `clickid`, `zoneid`, `adunit`, `aff_id`) while preserving
 *   functional embed parameters (`ds_lang`, `primaryColor`, `theme`, `autoplay`, etc.).
 */
export function sanitizeEmbedIframeRequestUrl(rawUrl?: string | null): string | null {
  const safe = sanitizeSafeUrl(rawUrl);
  if (!safe) return null;
  if (isKnownAdServingDomain(safe)) {
    return null;
  }

  let candidate = safe;
  try {
    const parsed = new URL(safe);
    let mutated = false;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (STRIPPABLE_TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        mutated = true;
      }
    }
    if (mutated) {
      candidate = parsed.toString();
    }
  } catch {
    return safe;
  }

  if (isAdServingRequestUrl(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * Returns clean, un-sandboxed iframe attributes (`src`, `allowFullScreen`, `allow`, `referrerPolicy`)
 * so embed providers like VidSrc.sh, VidLink, VidFast, and 2Embed load and play normally.
 */
export function getCleanIframeAttributes(
  rawUrl?: string | null,
  title: string = 'Movie Stream Player'
): {
  src: string;
  allowFullScreen: true;
  allow: string;
  referrerPolicy: 'origin';
  title: string;
  sandbox?: undefined;
} {
  const safeSrc = sanitizeEmbedIframeRequestUrl(rawUrl) || '';
  return {
    src: safeSrc,
    allowFullScreen: true,
    allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
    referrerPolicy: 'origin',
    title: title.trim() || 'Movie Stream Player',
  };
}

/**
 * Returns un-sandboxed VidSrc-specific iframe attributes for backwards-compatible consumers.
 */
export function getVidSrcPlayerIframeAttributes(
  rawUrl?: string | null,
  title: string = 'Movie Stream Player',
  isAdBlockerEnabled: boolean = true
): {
  src: string;
  allowFullScreen: true;
  allow: string;
  referrerPolicy: 'origin';
  title: string;
  sandbox?: undefined;
  isVidSrcTarget: boolean;
  isVidSrcAdBlockerActive: boolean;
} {
  const safeSrc = isAdBlockerEnabled
    ? sanitizeEmbedIframeRequestUrl(rawUrl) || ''
    : sanitizeSafeUrl(rawUrl) || '';
  const isVidSrcTarget = isVidSrcProviderUrl(safeSrc);
  const isVidSrcAdBlockerActive = isVidSrcTarget && Boolean(isAdBlockerEnabled);

  return {
    src: safeSrc,
    allowFullScreen: true,
    allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
    referrerPolicy: 'origin',
    title: title.trim() || 'Movie Stream Player',
    isVidSrcTarget,
    isVidSrcAdBlockerActive,
  };
}

/**
 * Unified AdBlocker iframe metadata covering ALL embed iframe video sources
 * (VidSrc.sh, VidLink.pro, VidFast, 2Embed.cc, and Custom Embeds).
 * NEVER applies `<iframe sandbox>`.
 */
export function getEmbedAdBlockerIframeAttributes(
  rawUrl?: string | null,
  title: string = 'Movie Stream Player',
  isAdBlockerEnabled: boolean = true
): {
  src: string;
  allowFullScreen: true;
  allow: string;
  referrerPolicy: 'origin';
  title: string;
  sandbox?: undefined;
  providerKey: EmbedIframeProviderKey;
  isEmbedTarget: boolean;
  isEmbedAdBlockerActive: boolean;
} {
  const safeSrc = isAdBlockerEnabled
    ? sanitizeEmbedIframeRequestUrl(rawUrl) || ''
    : sanitizeSafeUrl(rawUrl) || '';
  const providerKey = getEmbedIframeProviderKey(safeSrc);
  const isEmbedTarget = providerKey !== 'none';
  const isEmbedAdBlockerActive = isEmbedTarget && Boolean(isAdBlockerEnabled);

  return {
    src: safeSrc,
    allowFullScreen: true,
    allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
    referrerPolicy: 'origin',
    title: title.trim() || 'Movie Stream Player',
    providerKey,
    isEmbedTarget,
    isEmbedAdBlockerActive,
  };
}

/**
 * Always returns `undefined` so `<iframe sandbox>` is never applied to embed players.
 */
export function getAdBlockerIframeSandbox(_isAdBlockerEnabled: boolean): undefined {
  return undefined;
}

/**
 * Generates targeted CSS hiding rules for ALL embed iframe ad overlays,
 * popunder containers, and ad-network iframes/anchors when Adblocker is active.
 */
export function buildVidSrcAdBlockCssRules(
  isAdBlockerEnabled: boolean,
  isEmbedTarget: boolean
): string {
  if (!isAdBlockerEnabled || !isEmbedTarget) {
    return '';
  }

  const domainSelectors = AD_SERVING_DOMAINS.map(
    (domain) =>
      `iframe[src*="${domain}"], script[src*="${domain}"], a[href*="${domain}"], div[data-domain*="${domain}"]`
  ).join(',\n  ');

  return `
  /* CineBox Multi-Source Iframe Video AdBlocker CSS Hiding Layer */
  ${domainSelectors},
  [id*="popunder"],
  [class*="popunder"],
  [id*="ad-overlay"],
  [class*="ad-overlay"],
  [id*="clickjack"],
  [class*="clickjack"],
  [data-ad-zone],
  [data-adblock-hide="true"],
  a[target="_blank"][href*="adplox"],
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

  /* Keep the primary embed video iframe interactive while hiding injected sibling overlays */
  [data-vidsrc-adblock="active"] > iframe[data-vidsrc-iframe="true"] {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  [data-vidsrc-adblock="active"] > :not(iframe[data-vidsrc-iframe="true"]):not([data-testid="vidsrc-adblock-toast"]):not([data-testid="vidsrc-click-shield-layer"]) {
    display: none !important;
    pointer-events: none !important;
  }
`.trim();
}

export const buildEmbedAdBlockCssRules = buildVidSrcAdBlockCssRules;

export interface BlurHijackEvaluation {
  shouldBlock: boolean;
  reason:
    | 'user-interaction-grace'
    | 'legitimate-iframe-tap'
    | 'non-iframe-blur'
    | 'rapid-hijack-burst';
}

export function createBlurHijackEvaluator(options?: {
  graceWindowMs?: number;
  burstWindowMs?: number;
  burstThreshold?: number;
}) {
  const graceWindowMs = options?.graceWindowMs ?? 2500;
  const burstWindowMs = options?.burstWindowMs ?? 1500;
  const burstThreshold = options?.burstThreshold ?? 3;

  let lastUserInteractionAt = -Infinity;
  let recentBlurTimestamps: number[] = [];

  return {
    markUserInteraction(nowMs: number = Date.now()) {
      lastUserInteractionAt = nowMs;
      recentBlurTimestamps = [];
    },
    evaluateBlur(params: {
      isIframeActive: boolean;
      nowMs?: number;
    }): BlurHijackEvaluation {
      const nowMs = params.nowMs ?? Date.now();
      if (!params.isIframeActive) {
        return { shouldBlock: false, reason: 'non-iframe-blur' };
      }

      if (nowMs - lastUserInteractionAt <= graceWindowMs) {
        return { shouldBlock: false, reason: 'user-interaction-grace' };
      }

      recentBlurTimestamps = recentBlurTimestamps.filter(
        (ts) => nowMs - ts <= burstWindowMs
      );
      recentBlurTimestamps.push(nowMs);

      if (recentBlurTimestamps.length >= burstThreshold) {
        recentBlurTimestamps = [];
        return { shouldBlock: true, reason: 'rapid-hijack-burst' };
      }

      return { shouldBlock: false, reason: 'legitimate-iframe-tap' };
    },
  };
}

export interface IframeRequestInterceptorOptions {
  enabled: boolean;
  isEmbedTarget?: boolean;
  isVidSrcTarget?: boolean;
  onAdBlocked?: (blockedUrl: string, kind: VidSrcInterceptKind) => void;
  onPopupHijackDetected?: () => void;
  isInteractiveGraceActive?: () => boolean;
  targetWindow?: any;
  targetDocument?: any;
  graceWindowMs?: number;
}

/**
 * Installs a multi-layer runtime iframe & network ad-request interceptor when an embed player is active
 * and Adblocker is ON:
 * 1. Intercepts `window.fetch` requests to ad-serving domains/VAST/popunder patterns (`204 No Content`).
 * 2. Intercepts `XMLHttpRequest.prototype.open` & `send` to ad-serving URLs.
 * 3. Intercepts `navigator.sendBeacon` tracking pings.
 * 4. Intercepts dynamic `Element.prototype.setAttribute('src' | 'href', ...)` & `MutationObserver` script/iframe/img/anchor injections before they hit the network.
 * 5. Intercepts `window.open`, programmatic `_blank` `HTMLAnchorElement.prototype.click`, `beforeunload` hijacks, and hidden-tab focus-steals.
 *
 * Returns a deterministic cleanup callback that restores every native prototype & listener immediately on disable or unmount.
 */
export function createIframeRequestInterceptor(options: IframeRequestInterceptorOptions): () => void {
  const {
    enabled,
    onAdBlocked,
    onPopupHijackDetected,
    isInteractiveGraceActive,
    graceWindowMs,
  } = options;
  const isTarget = Boolean(options.isEmbedTarget ?? options.isVidSrcTarget);
  if (!enabled || !isTarget) {
    return () => {};
  }

  const win = options.targetWindow ?? (typeof window !== 'undefined' ? window : null);
  const doc = options.targetDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!win) {
    return () => {};
  }

  const blurEvaluator = createBlurHijackEvaluator({ graceWindowMs });

  const recordBlock = (url: string, kind: VidSrcInterceptKind) => {
    onAdBlocked?.(url, kind);
  };

  // 1. Intercept window.fetch for ad-serving URLs
  const originalFetch = typeof win.fetch === 'function' ? win.fetch.bind(win) : null;
  if (originalFetch) {
    win.fetch = async (input: any, init?: any) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input && typeof input.url === 'string'
          ? input.url
          : String(input || '');

      if (isAdServingRequestUrl(rawUrl)) {
        recordBlock(rawUrl, 'fetch');
        if (typeof Response !== 'undefined') {
          return new Response(null, {
            status: 204,
            statusText: 'Blocked by CineBox AdBlocker',
          });
        }
        return { ok: true, status: 204, text: async () => '', json: async () => ({}) };
      }
      return originalFetch(input, init);
    };
  }

  // 2. Intercept XMLHttpRequest for ad-serving URLs
  const XhrProto = win.XMLHttpRequest?.prototype;
  const originalXhrOpen = XhrProto?.open;
  const originalXhrSend = XhrProto?.send;
  if (XhrProto && typeof originalXhrOpen === 'function' && typeof originalXhrSend === 'function') {
    XhrProto.open = function (method: string, url: string, ...rest: any[]) {
      (this as any).__cineboxBlockedAdUrl = isAdServingRequestUrl(url) ? String(url) : null;
      return originalXhrOpen.call(this, method, url, ...rest);
    };
    XhrProto.send = function (body?: any) {
      const blockedUrl = (this as any).__cineboxBlockedAdUrl;
      if (blockedUrl) {
        recordBlock(blockedUrl, 'xhr');
        try {
          Object.defineProperty(this, 'status', { value: 204, configurable: true });
          Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(this, 'responseText', { value: '', configurable: true });
        } catch {
          // ignore read-only XHR fields
        }
        return;
      }
      return originalXhrSend.call(this, body);
    };
  }

  // 3. Intercept navigator.sendBeacon tracking/ad pings
  const navObj = win.navigator;
  const originalSendBeacon =
    navObj && typeof navObj.sendBeacon === 'function' ? navObj.sendBeacon.bind(navObj) : null;
  if (navObj && originalSendBeacon) {
    try {
      navObj.sendBeacon = (url: string | URL, data?: any) => {
        const rawUrl = String(url || '');
        if (isAdServingRequestUrl(rawUrl)) {
          recordBlock(rawUrl, 'fetch');
          return true;
        }
        return originalSendBeacon(url, data);
      };
    } catch {
      // ignore read-only navigator environments
    }
  }

  // 4. Intercept Element.prototype.setAttribute('src' | 'href', ...) for dynamic ad script/iframe/pixel injection
  const ElementProto = win.Element?.prototype;
  const originalSetAttribute = ElementProto?.setAttribute;
  if (ElementProto && typeof originalSetAttribute === 'function') {
    ElementProto.setAttribute = function (name: string, value: string) {
      const attrName = String(name || '').toLowerCase();
      if (attrName === 'src' || attrName === 'href') {
        const tag = String((this as any).tagName || '').toUpperCase();
        if ((tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'IMG' || tag === 'A') && isAdServingRequestUrl(value)) {
          try {
            originalSetAttribute.call(this, 'data-adblock-hide', 'true');
          } catch {
            // ignore
          }
          recordBlock(String(value), 'dom-node');
          return;
        }
      }
      return originalSetAttribute.call(this, name, value);
    };
  }

  // 5. Intercept window.open popup windows
  const originalWindowOpen = win.open;
  win.open = (url?: string | URL) => {
    recordBlock(String(url || 'window.open'), 'popup');
    onPopupHijackDetected?.();
    return null;
  };

  // 6. Intercept programmatic HTMLAnchorElement.prototype.click() popunder triggers
  const AnchorProto = win.HTMLAnchorElement?.prototype;
  const originalAnchorClick = AnchorProto?.click;
  if (AnchorProto && typeof originalAnchorClick === 'function') {
    AnchorProto.click = function () {
      const href = (this as HTMLAnchorElement).getAttribute?.('href') || (this as HTMLAnchorElement).href || '';
      const target = ((this as HTMLAnchorElement).getAttribute?.('target') || '').toLowerCase();
      if (isAdServingRequestUrl(href) || (target === '_blank' && href && !href.includes('youtube.com/watch'))) {
        recordBlock(href || 'anchor-popup', 'popup');
        onPopupHijackDetected?.();
        return;
      }
      return originalAnchorClick.call(this);
    };
  }

  // 7. Guard against unsolicited top-level navigation / ad redirects
  const handleBeforeUnload = (ev: any) => {
    try {
      ev?.preventDefault?.();
      if (ev && 'returnValue' in ev) {
        ev.returnValue = '';
      }
    } catch {
      // ignore
    }
    recordBlock('top-level-redirect', 'redirect');
    onPopupHijackDetected?.();
  };
  win.addEventListener?.('beforeunload', handleBeforeUnload);

  // 8. Focus-steal & visibility hijack guard
  const handleUserInteractionMark = () => {
    blurEvaluator.markUserInteraction();
  };
  doc?.addEventListener?.('pointerdown', handleUserInteractionMark, true);
  doc?.addEventListener?.('touchstart', handleUserInteractionMark, true);
  doc?.addEventListener?.('mousedown', handleUserInteractionMark, true);

  const handleWindowBlur = () => {
    const activeTag = doc?.activeElement?.tagName?.toUpperCase?.() || '';
    const isIframeActive = activeTag === 'IFRAME';
    const isTabHidden = doc?.visibilityState === 'hidden' || doc?.hidden === true;

    if (isIframeActive && isInteractiveGraceActive?.() && !isTabHidden) {
      return;
    }

    const verdict = blurEvaluator.evaluateBlur({ isIframeActive });
    if (!isIframeActive || isTabHidden || verdict.shouldBlock) {
      recordBlock(isTabHidden ? 'embed://popup-tab-steal' : 'embed://focus-steal', 'focus-steal');
      onPopupHijackDetected?.();
      try {
        win.focus?.();
      } catch {
        // ignore
      }
    }
  };
  win.addEventListener?.('blur', handleWindowBlur);

  const handleVisibilityChange = () => {
    if (doc?.visibilityState === 'hidden') {
      recordBlock('embed://visibility-steal', 'focus-steal');
      onPopupHijackDetected?.();
      try {
        win.focus?.();
      } catch {
        // ignore
      }
    }
  };
  doc?.addEventListener?.('visibilitychange', handleVisibilityChange);

  // 9. Intercept click events on injected ad anchors & MutationObserver for dynamically added ad nodes
  const handleDocumentClickCapture = (ev: any) => {
    blurEvaluator.markUserInteraction();
    const target = ev?.target?.closest?.('a') as HTMLAnchorElement | null;
    if (!target) return;
    const href = target.getAttribute?.('href') || target.href || '';
    if (isAdServingRequestUrl(href)) {
      ev.preventDefault?.();
      ev.stopPropagation?.();
      recordBlock(href, 'dom-node');
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
          if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'A' || tag === 'IMG') {
            const srcOrHref =
              el.getAttribute?.('src') ||
              el.getAttribute?.('href') ||
              (el as any).src ||
              (el as any).href ||
              '';
            if (isAdServingRequestUrl(srcOrHref)) {
              el.setAttribute?.('data-adblock-hide', 'true');
              try {
                el.remove?.();
              } catch {
                // ignore
              }
              recordBlock(srcOrHref, 'dom-node');
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
    if (navObj && originalSendBeacon) {
      try {
        navObj.sendBeacon = originalSendBeacon;
      } catch {
        // ignore
      }
    }
    if (ElementProto && originalSetAttribute) {
      ElementProto.setAttribute = originalSetAttribute;
    }
    win.open = originalWindowOpen;
    if (AnchorProto && originalAnchorClick) {
      AnchorProto.click = originalAnchorClick;
    }
    win.removeEventListener?.('beforeunload', handleBeforeUnload);
    win.removeEventListener?.('blur', handleWindowBlur);
    doc?.removeEventListener?.('visibilitychange', handleVisibilityChange);
    doc?.removeEventListener?.('pointerdown', handleUserInteractionMark, true);
    doc?.removeEventListener?.('touchstart', handleUserInteractionMark, true);
    doc?.removeEventListener?.('mousedown', handleUserInteractionMark, true);
    doc?.removeEventListener?.('click', handleDocumentClickCapture, true);
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

export const installVidSrcNetworkAdInterceptor = createIframeRequestInterceptor;
export const installEmbedIframeAdInterceptor = createIframeRequestInterceptor;

/**
 * Resolves the effective upstream target URL for an embed slot when Web AdBlocker is ON:
 * - On Android APK (`isNativeAndroidEnv: true`) or when AdBlocker is OFF or backend proxy is unavailable,
 *   returns the sanitized `rawUrl` unchanged (Android `MainActivity.java` handles VidSrc.sh Turnstile+adblock natively).
 * - On Web Browser (`!isNativeAndroidEnv`) when `isAdBlockerEnabled && useBackendProxy`:
 *   Cloudflare Turnstile providers (`vidsrc.sh`, `stellarconductornexus`, `cloudnestra`) fail with Error 110200 if proxied
 *   OR leak un-interceptable `aclib.js` / `*.rest` popups if loaded directly across origins. Therefore, S1 automatically
 *   upgrades to the matching Turnstile-free VidFast HD stream (`/movie/{id}` or `/tv/{id}/{s}/{e}`) which streams
 *   100% ad-free through `/api/adblock-proxy` with verified HLS/DASH playback.
 */
export function resolveEffectiveEmbedTargetUrl(
  rawUrl?: string | null,
  options?: {
    isAdBlockerEnabled?: boolean;
    useBackendProxy?: boolean;
    isNativeAndroidEnv?: boolean;
  }
): string {
  const safe = sanitizeEmbedIframeRequestUrl(rawUrl) || sanitizeSafeUrl(rawUrl) || '';
  if (!safe) return '';
  if (
    !options?.isNativeAndroidEnv &&
    options?.isAdBlockerEnabled &&
    options?.useBackendProxy &&
    requiresDirectOriginForVerification(safe)
  ) {
    try {
      const parsed = new URL(safe);
      const tvMatch = parsed.pathname.match(/\/embed\/tv\/(\d+)(?:\/(\d+))?(?:\/(\d+))?/i);
      if (tvMatch) {
        const id = tvMatch[1];
        const s = tvMatch[2] || '1';
        const e = tvMatch[3] || '1';
        return `https://vidfast.vc/tv/${id}/${s}/${e}?theme=10d97b&autoPlay=true&nextButton=true&autoNext=true`;
      }
      const movieMatch = parsed.pathname.match(/\/embed\/movie\/(\d+)/i);
      if (movieMatch) {
        return `https://vidfast.vc/movie/${movieMatch[1]}?theme=10d97b&autoPlay=true&title=true&poster=true`;
      }
    } catch {
      // fall back safely to sanitized rawUrl
    }
  }
  return safe;
}

/**
 * Builds the SSRF-safe server proxy URL for web embed iframes (`/api/adblock-proxy?url=...`)
 * when AdBlocker is enabled and the backend proxy is available (never wraps YouTube, direct streams,
 * non-embed URLs, or already-proxied URLs).
 */
export function buildAdBlockProxiedEmbedUrl(
  rawUrl?: string | null,
  options?: {
    isAdBlockerEnabled?: boolean;
    useBackendProxy?: boolean;
    proxyEndpoint?: string;
    allowTurnstileDirectOrigin?: boolean;
  }
): string {
  const safe = sanitizeEmbedIframeRequestUrl(rawUrl) || sanitizeSafeUrl(rawUrl) || '';
  if (!safe) return '';
  const enabled = options?.isAdBlockerEnabled ?? true;
  const useProxy = options?.useBackendProxy ?? false;
  if (!enabled || !useProxy) return safe;
  if (getEmbedIframeProviderKey(safe) === 'none') return safe;
  if (options?.allowTurnstileDirectOrigin && requiresDirectOriginForVerification(safe)) {
    return safe;
  }
  if (safe.includes(ADBLOCK_PROXY_ENDPOINT)) return safe;
  const endpoint = options?.proxyEndpoint || ADBLOCK_PROXY_ENDPOINT;
  return `${endpoint}?url=${encodeURIComponent(safe)}`;
}

const prewarmedEmbedUrlSet = new Set<string>();

/**
 * Quietly warms the backend proxy DNS, TLS socket, and immutable Next.js/player static chunks
 * while the user is viewing the Movie Detail page so clicking Play starts streams rapidly.
 */
export async function prewarmAdBlockProxyForEmbed(
  rawEmbedUrl?: string | null,
  fetchImpl?: typeof fetch
): Promise<boolean> {
  const safe = sanitizeEmbedIframeRequestUrl(rawEmbedUrl) || sanitizeSafeUrl(rawEmbedUrl) || '';
  if (!safe || getEmbedIframeProviderKey(safe) === 'none' || requiresDirectOriginForVerification(safe)) {
    return false;
  }
  if (prewarmedEmbedUrlSet.has(safe)) {
    return true;
  }
  if (prewarmedEmbedUrlSet.size > 100) {
    prewarmedEmbedUrlSet.clear();
  }
  prewarmedEmbedUrlSet.add(safe);
  try {
    const f = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!f) return false;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 4500) : null;
    try {
      const res = await f(`${ADBLOCK_PREWARM_ENDPOINT}?url=${encodeURIComponent(safe)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: ctrl?.signal,
      });
      return res.ok;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

let cachedAdblockProxyAvailable: boolean | null = null;

export function resetAdBlockProxyHealthCacheForTests(): void {
  cachedAdblockProxyAvailable = null;
}

export async function probeAdBlockProxyHealth(
  fetchImpl?: typeof fetch
): Promise<{ available: boolean; blocklistSize: number }> {
  if (cachedAdblockProxyAvailable === true) {
    return { available: true, blocklistSize: AD_SERVING_DOMAIN_SET.size };
  }
  try {
    const f = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!f) return { available: false, blocklistSize: AD_SERVING_DOMAIN_SET.size };
    const res = await f(ADBLOCK_HEALTH_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      cachedAdblockProxyAvailable = false;
      return { available: false, blocklistSize: AD_SERVING_DOMAIN_SET.size };
    }
    const data = await res.json();
    const ok = Boolean(data?.ok && data?.adblockProxyEnabled);
    cachedAdblockProxyAvailable = ok;
    return {
      available: ok,
      blocklistSize: Number(data?.blocklistSize) || AD_SERVING_DOMAIN_SET.size,
    };
  } catch {
    cachedAdblockProxyAvailable = false;
    return { available: false, blocklistSize: AD_SERVING_DOMAIN_SET.size };
  }
}

export interface InFrameAdBlockTelemetry {
  url: string;
  kind: VidSrcInterceptKind;
}

export function parseAdBlockTelemetryMessage(data: unknown): InFrameAdBlockTelemetry | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (obj.type !== 'CINEBOX_AD_BLOCKED') return null;
  const rawKind = String(obj.kind || 'popup');
  const validKinds: ReadonlySet<string> = new Set([
    'fetch',
    'xhr',
    'popup',
    'redirect',
    'dom-node',
    'focus-steal',
    'clickjack-shield',
  ]);
  const kind: VidSrcInterceptKind = validKinds.has(rawKind)
    ? (rawKind as VidSrcInterceptKind)
    : 'popup';
  const url = String(obj.url || '').slice(0, 240);
  return { url, kind };
}

