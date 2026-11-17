/**
 * CineBox Real Multi-Layer AdBlock Engine & SSRF-Safe Rewriter (v1.0.12)
 *
 * Shared pure TypeScript module compatible with Node v22 native type-stripping,
 * tsx, Vite, and TypeScript (`allowImportingTsExtensions: true`).
 */

export const CURATED_AD_DOMAINS: readonly string[] = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'amazon-adsystem.com',
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'criteo.com',
  'smartadserver.com',
  'mgid.com',
  'revcontent.com',
  'adskeeper.com',
  'bidgear.com',
  'adsterra.com',
  'adcash.com',
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
  's10.histats.com',
  'sstatic1.histats.com',
  'trafficjunky.net',
  'clickadu.com',
  'hilltopads.net',
  'hilltopads.com',
  'admaven.com',
  'galaksion.com',
  'a-ads.com',
  'outbrain.com',
  'taboola.com',
  'mc.yandex.ru',
  'mc.yandex.com',
  'bnhtml.com',
  'roudodu.com',
  'cdn4ads.com',
  'adsco.re',
  'pushame.com',
  'notix.io',
  'tagivi.com',
  'intellipopup.com',
  'adplox.com',
  'rapidadexchange.com',
  'usrpubtrck.com',
  'whos.amung.us',
  'widgets.amung.us',
  'p16-ad-site-sign-sg.tiktokcdn.com',
  'p19-ad-site-sign-sg.tiktokcdn.com',
  'profitablecpmrate.com',
  'highperformanceformat.com',
  'effectiveratecpm.com',
  'monetag.com',
  'alwingulla.com',
  'pubfuture.com',
  'in-page-push.com',
  'clarity.ms',
  'scripts.clarity.ms',
  'rc91gizcl1njbiw.cfd',
  'lhchjg2369ymgg.rest',
  '3omcbggo6pw6x3bn92rlehmtu88b.cfd',
  'ghzfcfwj4ggcqqv7q3lu4rquy.rest',
  'umami.vidfast.vc',
  'umami.vidcore.net',
  'mklwfufdtjbwl.online',
  'jvaxzufsyldqj.space',
  'd3mr7y154d2qg5.cloudfront.net',
  'rxqgeccsz.com',
  'gowwtsfqlwyfxn.com',
  'alchemmauls.com',
  '1414.hexa.su',
  'unfortunatelyejectinflected.com',
  'lahochat.com',
  'createlouisville.org',
  'cloudflareinsights.com',
  'static.cloudflareinsights.com',
];

export const SAFE_HOST_ALLOWLIST: ReadonlySet<string> = new Set([
  'tmdb.org',
  'api.themoviedb.org',
  'image.tmdb.org',
  'supabase.co',
  'vidsrc.sh',
  'vidsrc.me',
  'vidsrc.su',
  'vidsrc.buzz',
  'videm.buzz',
  'vidcore.io',
  'vidlink.pro',
  'vidfast.vc',
  'vidfast.pro',
  'vidfast.in',
  'vidfast.io',
  'vidfast.me',
  'vidfast.net',
  'vidfast.pm',
  'vidfast.xyz',
  'vidfast.bz',
  '2embed.cc',
  'www.2embed.cc',
  'streamsrcs.2embed.cc',
  '2embed.skin',
  'www.2embed.skin',
  '2vcdn.skin',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'googleapis.com',
  'ajax.googleapis.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'wsrv.nl',
]);

export const DEFAULT_CURATED_AD_DOMAIN_SET: Set<string> = new Set(
  CURATED_AD_DOMAINS.map((d) => d.toLowerCase())
);

const REDIRECT_PARAM_KEYS = ['url', 'redirect', 'redir', 'dest', 'target', 'next', 'out', 'adurl', 'u'];

export function parseHostsTextIntoSet(
  hostsText: string,
  baseSet: Set<string> = new Set(DEFAULT_CURATED_AD_DOMAIN_SET)
): Set<string> {
  const result = new Set<string>(baseSet);
  if (!hostsText || typeof hostsText !== 'string') {
    return result;
  }
  const lines = hostsText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const cleaned = line.split('#')[0].trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/\s+/);
    const candidate = (parts.length >= 2 ? parts[1] : parts[0]).toLowerCase().trim();
    if (
      candidate &&
      candidate !== 'localhost' &&
      /^[a-z0-9.-]+\.[a-z]{2,}$/.test(candidate) &&
      !SAFE_HOST_ALLOWLIST.has(candidate)
    ) {
      result.add(candidate);
    }
  }
  return result;
}

export function extractHostnameSafe(rawUrl?: string | null): string {
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

export function isDomainInBlocklist(
  rawUrlOrHost?: string | null,
  domainSet: ReadonlySet<string> = DEFAULT_CURATED_AD_DOMAIN_SET
): boolean {
  if (!rawUrlOrHost || typeof rawUrlOrHost !== 'string') return false;
  const trimmed = rawUrlOrHost.trim().toLowerCase();
  if (!trimmed) return false;

  const host =
    trimmed.includes('://') || trimmed.startsWith('//')
      ? extractHostnameSafe(trimmed)
      : trimmed.split('/')[0].split(':')[0].replace(/\.$/, '');

  if (!host || SAFE_HOST_ALLOWLIST.has(host)) return false;
  if (domainSet.has(host)) return true;

  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i += 1) {
    const suffix = parts.slice(i).join('.');
    if (domainSet.has(suffix) && !SAFE_HOST_ALLOWLIST.has(suffix)) {
      return true;
    }
  }
  return false;
}

export function isAdRequestUrl(
  rawUrl?: string | null,
  domainSet: ReadonlySet<string> = DEFAULT_CURATED_AD_DOMAIN_SET,
  depth: number = 0
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/html')
  ) {
    return true;
  }

  try {
    const parsed = new URL(lower.startsWith('//') ? `https:${trimmed}` : trimmed);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');

    if (isDomainInBlocklist(host, domainSet)) {
      return true;
    }

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

    if (depth === 0) {
      for (let i = 0; i < REDIRECT_PARAM_KEYS.length; i += 1) {
        const nestedVal = parsed.searchParams.get(REDIRECT_PARAM_KEYS[i]);
        if (
          nestedVal &&
          (nestedVal.startsWith('http://') ||
            nestedVal.startsWith('https://') ||
            nestedVal.startsWith('//'))
        ) {
          if (isAdRequestUrl(nestedVal, domainSet, 1)) {
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

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // Cloud metadata / link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  if (!rawIp || typeof rawIp !== 'string') return true;
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true;

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    return isPrivateOrReservedIpv4(ip);
  }

  // Handle IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1` or hex `::ffff:7f00:0001`)
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length);
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(mapped)) {
      return isPrivateOrReservedIpv4(mapped);
    }
    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const v4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      return isPrivateOrReservedIpv4(v4);
    }
  }

  if (
    ip === '::' ||
    ip === '::1' ||
    ip === '0:0:0:0:0:0:0:1' ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    ip.startsWith('fe80') ||
    ip.startsWith('ff')
  ) {
    return true;
  }

  return false;
}

export interface ProxyUrlValidationResult {
  valid: boolean;
  normalizedUrl: string;
  reason?: string;
}

export function validateProxyTargetUrl(rawUrl?: string | null): ProxyUrlValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, normalizedUrl: '', reason: 'empty-url' };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) {
    return { valid: false, normalizedUrl: '', reason: 'invalid-length' };
  }
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { valid: false, normalizedUrl: '', reason: 'disallowed-protocol' };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, normalizedUrl: '', reason: 'credentials-disallowed' };
    }
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.arpa')
    ) {
      return { valid: false, normalizedUrl: '', reason: 'internal-hostname' };
    }

    // Reject numeric literal IPs (decimal, hex, octal) & IPv6 literals pointing internally
    if (
      /^\d+$/.test(host) ||
      /^0x[0-9a-f]+$/i.test(host) ||
      host.includes(':') ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    ) {
      if (isPrivateOrReservedIp(host)) {
        return { valid: false, normalizedUrl: '', reason: 'private-ip' };
      }
    }

    return { valid: true, normalizedUrl: parsed.toString() };
  } catch {
    return { valid: false, normalizedUrl: '', reason: 'malformed-url' };
  }
}

export function isHtmlEmbedProviderHost(rawHost?: string | null): boolean {
  if (!rawHost) return false;
  const h = rawHost.toLowerCase().trim();
  return (
    h === 'vidsrc.sh' ||
    h.endsWith('.vidsrc.sh') ||
    h.includes('vidsrc') ||
    h.includes('cloudnestra') ||
    h.includes('stellarconductornexus') ||
    h === 'vidlink.pro' ||
    h.endsWith('.vidlink.pro') ||
    h.includes('vidfast') ||
    h === 'vidcore.io' ||
    h.endsWith('.vidcore.io') ||
    h === 'videm.buzz' ||
    h.endsWith('.videm.buzz') ||
    h === '2embed.cc' ||
    h.endsWith('.2embed.cc') ||
    h === '2embed.skin' ||
    h.endsWith('.2embed.skin') ||
    h === '2vcdn.skin' ||
    h.endsWith('.2vcdn.skin') ||
    h.includes('multiembed') ||
    h.includes('superembed') ||
    h.includes('autoembed') ||
    h.includes('smashystream')
  );
}

/**
 * Returns `true` for embed hosts whose player relies on domain-bound Cloudflare Turnstile
 * (`challenges.cloudflare.com` validating `window.location.hostname`) or origin-strict WAF tokens.
 * Proxying these frames through a third-party domain breaks Turnstile verification ("Verification failed. Please reload.").
 * Note: `vidfast.*` does NOT use Turnstile — keeping it false allows full ad-free proxied playback.
 */
export function requiresDirectOriginForVerification(rawUrlOrHost?: string | null): boolean {
  if (!rawUrlOrHost || typeof rawUrlOrHost !== 'string') return false;
  const trimmed = rawUrlOrHost.trim().toLowerCase();
  if (!trimmed) return false;
  const host =
    trimmed.includes('://') || trimmed.startsWith('//')
      ? extractHostnameSafe(trimmed)
      : trimmed.split('/')[0].split(':')[0].replace(/\.$/, '');
  if (!host) return false;
  return (
    host === 'vidsrc.sh' ||
    host.endsWith('.vidsrc.sh') ||
    host.includes('stellarconductornexus') ||
    host.includes('cloudnestra')
  );
}

/**
 * Generates an inline JS shield injected at the top of proxied or native WebView embed HTML `<head>`.
 * Stops `window.open`, popunders, ad `fetch`/`XHR`/`sendBeacon`, VAST manifests, clickjack overlays,
 * and preserves Next.js SPA routes (`vidlink.pro` / `vidfast.vc`) when loaded behind `/api/adblock-proxy`.
 */
export function buildInFrameAdBlockScriptlet(
  targetUrl: string,
  proxyBasePath: string = '/api/adblock-proxy',
  extraDomains: readonly string[] = [],
  resolvedBaseUrl?: string
): string {
  let targetOrigin = '';
  let targetPathAndSearch = '/';
  let targetBase = resolvedBaseUrl || targetUrl;
  try {
    const parsed = new URL(targetUrl);
    targetOrigin = parsed.origin;
    targetPathAndSearch = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    if (!resolvedBaseUrl) {
      targetBase = targetUrl;
    }
  } catch {
    targetOrigin = '';
    targetPathAndSearch = '/';
  }

  const embeddedDomains = Array.from(
    new Set([
      ...CURATED_AD_DOMAINS,
      ...extraDomains.slice(0, 200),
    ])
  );

  return `<script data-cinebox-adblock="1">
(function(){
  if (window.__cineboxFrameShieldInstalled) return;
  window.__cineboxFrameShieldInstalled = true;

  var TARGET_URL = ${JSON.stringify(targetUrl)};
  var TARGET_BASE = ${JSON.stringify(targetBase)};
  var TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
  var TARGET_PATH = ${JSON.stringify(targetPathAndSearch)};
  var PROXY_BASE = ${JSON.stringify(proxyBasePath)};
  var AD_DOMAINS = ${JSON.stringify(embeddedDomains)};
  var AD_SET = new Set(AD_DOMAINS);

  // Preserve target SPA pathname (Next.js App Router on vidlink.pro / vidfast.vc) when loaded via /api/adblock-proxy
  if (PROXY_BASE && TARGET_ORIGIN && location.pathname.indexOf(PROXY_BASE) === 0) {
    try {
      window.history.replaceState(window.history.state, '', TARGET_PATH);
    } catch (e) {}
  }

  // Defeat anti-devtool console.table timing traps (>10ms + Function.prototype.toString checks) while keeping native signature
  try {
    if (typeof console !== 'undefined' && typeof console.table === 'function') {
      var origTbl = console.table;
      function table(data) {
        if (Array.isArray(data) && data.length >= 25) return;
        return origTbl.apply(this, arguments);
      }
      var origToStr = Function.prototype.toString;
      var patchedToStr = function toString() {
        if (this === table) return 'function table() { [native code] }';
        if (this === patchedToStr) return 'function toString() { [native code] }';
        return origToStr.call(this);
      };
      Function.prototype.toString = patchedToStr;
      console.table = table;
    }
  } catch (e) {}

  function reportBlocked(url, kind) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'CINEBOX_AD_BLOCKED', url: String(url || ''), kind: String(kind || 'popup') }, '*');
      }
    } catch (e) {}
    try {
      if (window.CineboxAndroidAdBlocker && typeof window.CineboxAndroidAdBlocker.reportBlocked === 'function') {
        window.CineboxAndroidAdBlocker.reportBlocked(String(url || ''), String(kind || 'popup'));
      }
    } catch (e) {}
  }

  function toAbsUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    var t = raw.trim();
    if (!t) return '';
    if (t.indexOf('//') === 0) t = 'https:' + t;
    if (t.indexOf('/') === 0 && TARGET_ORIGIN) {
      return TARGET_ORIGIN + t;
    }
    try {
      return new URL(t, TARGET_BASE || TARGET_URL || TARGET_ORIGIN || location.href).toString();
    } catch (e) {
      return t;
    }
  }

  function isAdHost(host) {
    if (!host) return false;
    var h = host.toLowerCase().replace(/\\.$/, '');
    if (AD_SET.has(h)) return true;
    var parts = h.split('.');
    for (var i = 1; i < parts.length - 1; i++) {
      if (AD_SET.has(parts.slice(i).join('.'))) return true;
    }
    if (/\\.(u08|olfm|uqa9)$/.test(h)) return true;
    return false;
  }

  function isAdUrl(raw) {
    if (!raw || typeof raw !== 'string') return false;
    var lower = raw.trim().toLowerCase();
    if (!lower) return false;
    if (lower.indexOf('javascript:') === 0 || lower.indexOf('vbscript:') === 0 || lower.indexOf('data:text/html') === 0) return true;
    try {
      var u = new URL(toAbsUrl(raw));
      if (isAdHost(u.hostname)) return true;
      var pq = (u.pathname + u.search).toLowerCase();
      if ((u.hostname.endsWith('.cfd') || u.hostname.endsWith('.rest')) && pq.indexOf('/vvmro') !== -1) return true;
      if (
        pq.indexOf('/popunder') !== -1 ||
        pq.indexOf('/pop.js') !== -1 ||
        pq.indexOf('/suv5.js') !== -1 ||
        pq.indexOf('/aclib.js') !== -1 ||
        pq.indexOf('/suurl5.php') !== -1 ||
        pq.indexOf('/adserver') !== -1 ||
        pq.indexOf('/assets/sbx.js') !== -1 ||
        pq.indexOf('disable-devtool') !== -1 ||
        pq.indexOf('/vgmoo') !== -1 ||
        pq.indexOf('/vvmro') !== -1 ||
        pq.indexOf('/vast.js') !== -1 ||
        pq.indexOf('/vast.xml') !== -1 ||
        pq.indexOf('/vmap.xml') !== -1 ||
        pq.indexOf('/ad-site-i18n-sg/') !== -1 ||
        pq.indexOf('clickid=') !== -1 ||
        pq.indexOf('zoneid=') !== -1 ||
        pq.indexOf('adunit=') !== -1 ||
        pq.indexOf('cbcdn=') !== -1 ||
        pq.indexOf('popundersperip') !== -1 ||
        /[?&]fmt=suv\\d/i.test(pq) ||
        /\\/api\\/(?:mercury|venus)(?:$|\\?)/i.test(pq) ||
        /\\/embed\\/[0-9a-f]{32}\\.js/.test(pq) ||
        /\\/fc8e8cab-[0-9a-f-]+/i.test(pq)
      ) return true;
    } catch (e) {}
    return false;
  }

  function isEmbedHost(host) {
    if (!host) return false;
    var h = host.toLowerCase();
    return (
      h.indexOf('vidsrc') !== -1 ||
      h.indexOf('cloudnestra') !== -1 ||
      h.indexOf('stellarconductornexus') !== -1 ||
      h.indexOf('vidlink') !== -1 ||
      h.indexOf('vidfast') !== -1 ||
      h.indexOf('vidcore') !== -1 ||
      h.indexOf('2embed') !== -1 ||
      h.indexOf('2vcdn') !== -1 ||
      h.indexOf('videm') !== -1
    );
  }

  function isDirectPassThroughHost(host) {
    if (!host) return false;
    var h = host.toLowerCase();
    return (
      h === 'tmdb.org' || h.endsWith('.tmdb.org') ||
      h === 'themoviedb.org' || h.endsWith('.themoviedb.org') ||
      h === 'fonts.googleapis.com' ||
      h === 'fonts.gstatic.com' ||
      h === 'challenges.cloudflare.com' ||
      h === 'youtube.com' || h.endsWith('.youtube.com') ||
      h === 'youtu.be' ||
      h === 'youtube-nocookie.com' || h.endsWith('.youtube-nocookie.com') ||
      h === 'cdn.jsdelivr.net' ||
      h === 'cdnjs.cloudflare.com'
    );
  }

  function buildProxiedUrl(abs) {
    var refPart = TARGET_URL ? '&ref=' + encodeURIComponent(TARGET_URL) : '';
    return location.origin + PROXY_BASE + '?url=' + encodeURIComponent(abs) + refPart;
  }

  function rewriteSameOriginOrProxy(raw) {
    var abs = toAbsUrl(raw);
    if (!abs || !PROXY_BASE) return raw;
    if (abs.indexOf('blob:') === 0 || abs.indexOf('data:') === 0 || abs.indexOf('about:') === 0) return raw;
    try {
      var u = new URL(abs);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
      if (u.pathname.indexOf(PROXY_BASE) === 0) return raw;
      if (TARGET_ORIGIN && u.origin === location.origin && TARGET_ORIGIN !== location.origin) {
        u = new URL(TARGET_ORIGIN + u.pathname + u.search + u.hash);
        abs = u.toString();
      }
      if (isDirectPassThroughHost(u.hostname)) {
        return abs;
      }
      if (
        (TARGET_ORIGIN && u.origin === TARGET_ORIGIN) ||
        isEmbedHost(u.hostname) ||
        !isDirectPassThroughHost(u.hostname)
      ) {
        return buildProxiedUrl(abs);
      }
    } catch (e) {}
    return abs;
  }

  function sanitizeMediaSrc(raw) {
    var t = String(raw || '').trim();
    if (!t || t === 'about:blank' || t.indexOf('blob:') === 0 || t.indexOf('data:') === 0 || t.indexOf('mediasource:') === 0) {
      return t;
    }
    var abs = toAbsUrl(t);
    if (!abs) return t;
    if (isAdUrl(abs)) {
      reportBlocked(abs, 'dom-node');
      return '';
    }
    return abs;
  }

  // 1. Lock window.open permanently inside the embed frame AND lock dynamic about:blank iframe contentWindow.open
  var blockedOpen = function(u) {
    reportBlocked(u || 'about:blank', 'popup');
    return null;
  };
  try {
    Object.defineProperty(window, 'open', {
      value: blockedOpen,
      writable: false,
      configurable: false
    });
  } catch (e) {
    window.open = blockedOpen;
  }

  function lockChildWindowOpen(cw) {
    if (!cw) return;
    try {
      if (cw.open !== blockedOpen) {
        try {
          Object.defineProperty(cw, 'open', {
            value: blockedOpen,
            writable: false,
            configurable: false
          });
        } catch (e1) {
          try { cw.open = blockedOpen; } catch (e2) {}
        }
      }
    } catch (e) {}
  }

  if (window.HTMLIFrameElement) {
    try {
      var cwDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      var origCwGet = cwDesc && cwDesc.get;
      if (origCwGet && cwDesc.configurable) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            var cw = origCwGet.call(this);
            lockChildWindowOpen(cw);
            return cw;
          },
          configurable: true
        });
      }
    } catch (e) {}
  }

  // 2. Neutralize _blank Anchor popups, form _blank popunders & dynamic click traps
  if (window.HTMLAnchorElement && HTMLAnchorElement.prototype) {
    var origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      var href = this.getAttribute('href') || this.href || '';
      var target = (this.getAttribute('target') || '').toLowerCase();
      if (isAdUrl(href) || target === '_blank') {
        reportBlocked(href || 'anchor-popup', 'popup');
        return;
      }
      return origAnchorClick.apply(this, arguments);
    };
  }

  if (window.HTMLFormElement && HTMLFormElement.prototype) {
    var origFormSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
      var action = this.getAttribute('action') || this.action || '';
      var target = (this.getAttribute('target') || '').toLowerCase();
      if (target === '_blank' || isAdUrl(action)) {
        reportBlocked(action || 'form-popunder', 'popup');
        return;
      }
      return origFormSubmit.apply(this, arguments);
    };
  }

  document.addEventListener('click', function(ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (a) {
      var href = a.getAttribute('href') || a.href || '';
      var target = (a.getAttribute('target') || '').toLowerCase();
      if (isAdUrl(href) || (target === '_blank' && href && href.indexOf('youtube.com') === -1)) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        reportBlocked(href || 'click-anchor-popup', 'popup');
      }
    }
  }, true);

  // 3. Intercept fetch & XHR & sendBeacon
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function(input, init) {
      var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      var abs = toAbsUrl(urlStr);
      if (isAdUrl(abs)) {
        reportBlocked(abs, 'fetch');
        var isVast = /vast\\.xml|vmap\\.xml/i.test(abs);
        return Promise.resolve(new Response(isVast ? '<VAST version="3.0"></VAST>' : null, {
          status: isVast ? 200 : 204,
          headers: isVast ? { 'Content-Type': 'application/xml' } : undefined
        }));
      }
      var nextUrl = rewriteSameOriginOrProxy(urlStr);
      if (nextUrl && nextUrl !== urlStr) {
        if (typeof input === 'string' || (typeof URL !== 'undefined' && input instanceof URL)) {
          return origFetch.call(this, nextUrl, init);
        }
        try {
          if (typeof Request !== 'undefined' && input instanceof Request) {
            return origFetch.call(this, new Request(nextUrl, input), init);
          }
        } catch (e) {}
      }
      return origFetch.apply(this, arguments);
    };
  }

  if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
    var origXhrOpen = XMLHttpRequest.prototype.open;
    var origXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      var abs = toAbsUrl(url);
      this.__cbxAdBlocked = isAdUrl(abs) ? abs : null;
      if (this.__cbxAdBlocked) {
        return origXhrOpen.call(this, method, 'about:blank', true);
      }
      var args = Array.prototype.slice.call(arguments);
      args[1] = rewriteSameOriginOrProxy(url);
      return origXhrOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.send = function() {
      if (this.__cbxAdBlocked) {
        reportBlocked(this.__cbxAdBlocked, 'xhr');
        try {
          Object.defineProperty(this, 'status', { value: 204, configurable: true });
          Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(this, 'responseText', { value: '', configurable: true });
        } catch (e) {}
        return;
      }
      return origXhrSend.apply(this, arguments);
    };
  }

  if (navigator && typeof navigator.sendBeacon === 'function') {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      var raw = String(url || '');
      var abs = toAbsUrl(raw);
      if (isAdUrl(abs)) {
        reportBlocked(abs, 'fetch');
        return true;
      }
      var target = rewriteSameOriginOrProxy(raw);
      return origBeacon(target || abs || raw, data);
    };
  }

  // 4. Intercept Element.setAttribute, script.src, img.src, and chain nested iframes through PROXY_BASE with &ref=
  function sanitizeFrameSrc(raw) {
    var trimmedRaw = String(raw || '').trim();
    if (!trimmedRaw || trimmedRaw === 'about:blank' || trimmedRaw.indexOf('blob:') === 0 || trimmedRaw.indexOf('data:') === 0) {
      return trimmedRaw;
    }
    var abs = toAbsUrl(trimmedRaw);
    if (!abs) return '';
    if (isAdUrl(abs)) {
      reportBlocked(abs, 'dom-node');
      return 'about:blank';
    }
    try {
      var fu = new URL(abs);
      if (isDirectPassThroughHost(fu.hostname)) {
        return abs;
      }
    } catch (e) {}
    if (PROXY_BASE && (abs.indexOf('https://') === 0 || abs.indexOf('http://') === 0) && abs.indexOf(PROXY_BASE) === -1) {
      return buildProxiedUrl(abs);
    }
    return abs;
  }

  var origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    var attr = String(name || '').toLowerCase();
    var tag = String(this.tagName || '').toUpperCase();
    if ((attr === 'src' || attr === 'href') && (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'IMG' || tag === 'A' || tag === 'LINK' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'SOURCE' || tag === 'TRACK')) {
      var valStr = String(value || '');
      if (isAdUrl(valStr)) {
        reportBlocked(valStr, 'dom-node');
        return;
      }
      if (tag === 'IFRAME' && attr === 'src') {
        return origSetAttr.call(this, name, sanitizeFrameSrc(valStr));
      }
      if ((tag === 'VIDEO' || tag === 'AUDIO' || tag === 'SOURCE' || tag === 'TRACK') && attr === 'src') {
        return origSetAttr.call(this, name, sanitizeMediaSrc(valStr));
      }
      if (tag === 'SCRIPT' && attr === 'src' && PROXY_BASE) {
        var scriptAbs = toAbsUrl(valStr);
        try {
          var su = new URL(scriptAbs);
          if ((TARGET_ORIGIN && su.origin === TARGET_ORIGIN) || isEmbedHost(su.hostname)) {
            return origSetAttr.call(this, name, buildProxiedUrl(scriptAbs));
          }
        } catch (e) {}
      }
    }
    return origSetAttr.call(this, name, value);
  };

  if (window.HTMLScriptElement) {
    var scriptDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    if (scriptDesc && scriptDesc.set) {
      Object.defineProperty(HTMLScriptElement.prototype, 'src', {
        get: scriptDesc.get,
        set: function(v) {
          var rawStr = String(v || '');
          var abs = toAbsUrl(rawStr);
          if (isAdUrl(abs)) {
            reportBlocked(abs, 'dom-node');
            return;
          }
          if (PROXY_BASE && abs && abs.indexOf(PROXY_BASE) === -1) {
            try {
              var su = new URL(abs);
              if ((TARGET_ORIGIN && su.origin === TARGET_ORIGIN) || isEmbedHost(su.hostname)) {
                return scriptDesc.set.call(this, buildProxiedUrl(abs));
              }
            } catch (e) {}
          }
          return scriptDesc.set.call(this, abs || v);
        },
        configurable: true
      });
    }
  }

  if (window.HTMLMediaElement) {
    var mediaDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (mediaDesc && mediaDesc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        get: mediaDesc.get,
        set: function(v) {
          var next = sanitizeMediaSrc(String(v || ''));
          if (!next && String(v || '').trim()) return;
          return mediaDesc.set.call(this, next);
        },
        configurable: true
      });
    }
  }

  if (window.HTMLSourceElement) {
    var sourceDesc = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, 'src');
    if (sourceDesc && sourceDesc.set) {
      Object.defineProperty(HTMLSourceElement.prototype, 'src', {
        get: sourceDesc.get,
        set: function(v) {
          var next = sanitizeMediaSrc(String(v || ''));
          if (!next && String(v || '').trim()) return;
          return sourceDesc.set.call(this, next);
        },
        configurable: true
      });
    }
  }

  if (window.HTMLImageElement) {
    var imgDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (imgDesc && imgDesc.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        get: imgDesc.get,
        set: function(v) {
          var abs = toAbsUrl(String(v || ''));
          if (isAdUrl(abs)) {
            reportBlocked(abs, 'dom-node');
            return imgDesc.set.call(this, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
          }
          if (PROXY_BASE && abs && abs.indexOf(PROXY_BASE) === -1) {
            try {
              var iu = new URL(abs);
              if ((TARGET_ORIGIN && iu.origin === TARGET_ORIGIN) || isEmbedHost(iu.hostname)) {
                return imgDesc.set.call(this, buildProxiedUrl(abs));
              }
            } catch (e) {}
          }
          return imgDesc.set.call(this, v);
        },
        configurable: true
      });
    }
  }

  if (window.HTMLIFrameElement) {
    var iframeDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (iframeDesc && iframeDesc.set) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        get: iframeDesc.get,
        set: function(v) {
          return iframeDesc.set.call(this, sanitizeFrameSrc(String(v || '')));
        },
        configurable: true
      });
    }
  }

  // 5. MutationObserver to remove dynamically injected ad scripts, invisible clickjack overlays & rewrite nested iframes
  function auditNode(node) {
    if (!node || node.nodeType !== 1) return;
    var tag = (node.tagName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'IMG' || tag === 'A' || tag === 'LINK') {
      var src = node.getAttribute('src') || node.getAttribute('href') || '';
      if (isAdUrl(src)) {
        reportBlocked(src, 'dom-node');
        try { node.remove(); } catch (e) {}
        return;
      }
    }
    if (tag === 'IFRAME') {
      try {
        if (node.contentWindow) lockChildWindowOpen(node.contentWindow);
      } catch (e) {}
      var fSrc = node.getAttribute('src') || '';
      if (fSrc && fSrc !== 'about:blank' && fSrc.indexOf(PROXY_BASE) === -1) {
        if (isAdUrl(fSrc)) {
          reportBlocked(fSrc, 'dom-node');
          try { node.remove(); } catch (e) {}
        } else if (PROXY_BASE) {
          origSetAttr.call(node, 'src', sanitizeFrameSrc(fSrc));
        }
      }
    }
    if (tag === 'DIV' || tag === 'INS') {
      try {
        var st = window.getComputedStyle(node);
        var z = parseInt(st.zIndex, 10) || 0;
        var rect = node.getBoundingClientRect();
        if (
          (st.position === 'fixed' || st.position === 'absolute') &&
          z >= 999 &&
          rect.width > 200 &&
          rect.height > 150 &&
          !node.querySelector('video, canvas, iframe, button[aria-label]') &&
          (st.opacity === '0' || st.backgroundColor === 'rgba(0, 0, 0, 0)' || st.backgroundColor === 'transparent')
        ) {
          reportBlocked('overlay://clickjack-z' + z, 'dom-node');
          node.style.setProperty('display', 'none', 'important');
          node.style.setProperty('pointer-events', 'none', 'important');
        }
      } catch (e) {}
    }
  }

  if (typeof MutationObserver !== 'undefined') {
    var mo = new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes || [];
        for (var j = 0; j < added.length; j++) {
          auditNode(added[j]);
        }
      }
    });
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
  }

  try {
    if (document.currentScript && document.currentScript.parentNode) {
      document.currentScript.parentNode.removeChild(document.currentScript);
    }
  } catch (e) {}
})();
</script>`;
}

/**
 * Rewrites fetched embed HTML:
 * 1. Strips known ad/tracker/popunder/anti-debug `<script>` & inline payloads.
 * 2. Strips ad anchors (`adplox.com`, etc.) and tracking `<img>`/`<link>`.
 * 3. Rewrites nested `<iframe src="...">` through `proxyBasePath` (or kills ad iframes).
 * 4. Prepends `<base href="...">` + `buildInFrameAdBlockScriptlet` at top of `<head>`.
 */
export function rewriteEmbedHtmlWithAdBlocker(
  html: string,
  targetUrl: string,
  proxyBasePath: string = '/api/adblock-proxy',
  domainSet: ReadonlySet<string> = DEFAULT_CURATED_AD_DOMAIN_SET
): { html: string; strippedCount: number } {
  if (!html || typeof html !== 'string') {
    return { html: '', strippedCount: 0 };
  }

  let strippedCount = 0;
  let baseHref = targetUrl;
  let targetOrigin = '';
  try {
    const parsed = new URL(targetUrl);
    targetOrigin = parsed.origin;
    baseHref = new URL('.', parsed).toString();
  } catch {
    baseHref = targetUrl;
  }

  const resolveAgainstTarget = (raw: string): string => {
    const t = raw.trim();
    if (!t) return '';
    if (t.startsWith('//')) return `https:${t}`;
    if (t.startsWith('/') && targetOrigin) return `${targetOrigin}${t}`;
    try {
      return new URL(t, targetUrl).toString();
    } catch {
      return t;
    }
  };

  let out = html;
  const isNextJsDoc = out.includes('/_next/');

  if (isNextJsDoc) {
    // Preserve exact Next.js <script> element count/order & empty children for React 19 hydration while
    // neutralizing external ad/analytics scripts (`umami`, `gtag`) and inline popunder injectors.
    out = out.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs: string, body: string) => {
      const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (srcMatch) {
        const rawSrc = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '';
        const absSrc = resolveAgainstTarget(rawSrc);
        if (isAdRequestUrl(absSrc, domainSet)) {
          strippedCount += 1;
          const blockedProxySrc = proxyBasePath
            ? `${proxyBasePath}?url=${encodeURIComponent(absSrc)}`
            : 'about:blank';
          const cleanedAttrs = attrs
            .replace(/\bintegrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(
              /\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
              `src="${blockedProxySrc}" data-cinebox-blocked="1"`
            );
          return `<script${cleanedAttrs}></script>`;
        }
        return full;
      }
      if (
        body &&
        /unloaded_at|shown_at|acscdn\.com|popads\.net|tagivi\.com|intellipopup\.com|DisableDevtool|disable-devtool|umami\.vid|3omcbggo|ghzfcfwj|alchemmauls|1414\.hexa\.su/i.test(
          body
        )
      ) {
        strippedCount += 1;
        return `<script${attrs}>/* cinebox-adblock: neutralized inline popunder */</script>`;
      }
      return full;
    });

    // Also neutralize Next.js void ad/tracker <link rel="preload" href="https://mc.yandex.ru/..."> without adding text nodes
    out = out.replace(/<link\b([^>]*)>/gi, (full, attrs: string) => {
      const refMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (refMatch) {
        const rawRef = refMatch[1] ?? refMatch[2] ?? '';
        const absRef = resolveAgainstTarget(rawRef);
        if (isAdRequestUrl(absRef, domainSet)) {
          strippedCount += 1;
          const safeStub = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          const updatedAttrs = attrs
            .replace(/\bintegrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(
              /\bhref\s*=\s*(?:"[^"]*"|'[^']*')/i,
              `href="${safeStub}" data-cinebox-blocked="1"`
            );
          return `<link${updatedAttrs}>`;
        }
      }
      return full;
    });
  } else {
    // 1. Strip external ad / anti-devtool / VAST `<script src="...">...</script>`
    out = out.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs: string, body: string) => {
      const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (srcMatch) {
        const rawSrc = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '';
        const absSrc = resolveAgainstTarget(rawSrc);
        if (isAdRequestUrl(absSrc, domainSet)) {
          strippedCount += 1;
          return '<!-- cinebox-adblock: stripped ad script -->';
        }
        return full;
      }

      // Inline script signature check (never strip a large main player bundle that happens to reference keywords)
      const isCorePlayerBundle =
        body.length > 25000 && /bootWhenVisible|hls\.loadSource|jwplayer|video\.play|player\.setup/i.test(body);
      if (
        !isCorePlayerBundle &&
        /acscdn\.com|s10\.histats\.com|Histats\.com|rapidadexchange\.com|usrpubtrck\.com|popads\.net|tagivi\.com|intellipopup\.com|lahochat\.com|\blcban\b|unfortunatelyejectinflected\.com|createlouisville\.org|alchemmauls\.com|1414\.hexa\.su|DisableDevtool|disable-devtool|'ad_slot'|unloaded_at|shown_at/i.test(
          body
        )
      ) {
        strippedCount += 1;
        return '<!-- cinebox-adblock: stripped inline popunder script -->';
      }
      return full;
    });

    // Protect remaining <script>...</script> and <style>...</style> blocks so HTML regexes below
    // (<img>, <link>, <a>, <iframe>, <base>) NEVER mutate embedded HTML strings inside JS bundles!
    const preservedBlocks: string[] = [];
    out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
      const token = `__CBX_PRESERVED_BLOCK_${preservedBlocks.length}__`;
      preservedBlocks.push(block);
      return token;
    });

    // 2. Neutralize tracking <link rel="preload"> / <img src> pixels
    out = out.replace(/<(link|img)\b([^>]*)>/gi, (full, tag: string, attrs: string) => {
      const refMatch = attrs.match(/\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (refMatch) {
        const attrKey = refMatch[1];
        const rawRef = refMatch[2] ?? refMatch[3] ?? '';
        const absRef = resolveAgainstTarget(rawRef);
        if (isAdRequestUrl(absRef, domainSet)) {
          strippedCount += 1;
          if (tag.toLowerCase() === 'img') {
            return '<img data-cinebox-blocked="1" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="" style="display:none !important;" />';
          }
          const safeStub = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          const updatedAttrs = attrs
            .replace(/\bintegrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(
              /\b(?:href|src)\s*=\s*(?:"[^"]*"|'[^']*')/i,
              `${attrKey}="${safeStub}" data-cinebox-blocked="1"`
            );
          return `<link${updatedAttrs}>`;
        }
      }
      return full;
    });

    // 3. Neutralize <a href="adplox.com" target="_blank"> style ad anchors
    out = out.replace(/<a\b([^>]*)href\s*=\s*(?:"([^"]*)"|'([^']*)')([^>]*)>/gi, (full, p1, q1, q2, p2) => {
      const href = q1 ?? q2 ?? '';
      const absHref = resolveAgainstTarget(href);
      if (isAdRequestUrl(absHref, domainSet)) {
        strippedCount += 1;
        return `<a${p1}href="#blocked-ad"${p2} onclick="return false;">`;
      }
      return full;
    });

    // 4. Rewrite static nested <iframe src="..."> through proxyBasePath with &ref= (or drop if ad)
    if (proxyBasePath) {
      out = out.replace(/<iframe\b([^>]*)>/gi, (full, attrs: string) => {
        const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        if (!srcMatch) return full;
        const rawSrc = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '';
        const absSrc = resolveAgainstTarget(rawSrc);
        if (!absSrc || absSrc.startsWith('about:') || absSrc.includes(proxyBasePath)) {
          return full;
        }
        if (isAdRequestUrl(absSrc, domainSet)) {
          strippedCount += 1;
          return '<iframe src="about:blank" style="display:none !important;">';
        }
        const proxied = `${proxyBasePath}?url=${encodeURIComponent(absSrc)}&ref=${encodeURIComponent(targetUrl)}`;
        const updatedAttrs = attrs.replace(
          /\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
          `src="${proxied}"`
        );
        return `<iframe${updatedAttrs}>`;
      });
    }

    // Restore preserved <script> and <style> blocks
    out = out.replace(/__CBX_PRESERVED_BLOCK_(\d+)__/g, (_m, idxStr: string) => {
      const idx = Number(idxStr);
      return Number.isInteger(idx) && idx >= 0 && idx < preservedBlocks.length
        ? preservedBlocks[idx]
        : '';
    });
  }

  // 5. Resolve existing <base href="..."> or inject <base> ONLY when the non-Next.js document contains
  // directory-relative (non-leading-slash) asset URLs; omitting redundant <base> keeps `/api/adblock-proxy`
  // script/modulepreload tags anchored cleanly on local proxy origin.
  let effectiveBaseHref = baseHref;
  const existingBaseMatch = out.match(/<base\b([^>]*)>/i);
  if (existingBaseMatch) {
    const hrefMatch = existingBaseMatch[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (hrefMatch) {
      const rawBase = (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '').trim();
      const absBase = resolveAgainstTarget(rawBase);
      if (absBase) {
        effectiveBaseHref = absBase;
        out = out.replace(/<base\b[^>]*>/i, `<base href="${absBase.replace(/"/g, '&quot;')}">`);
      }
    }
  }

  const hasBareRelativeAsset =
    !isNextJsDoc &&
    !existingBaseMatch &&
    /\b(?:src|href)\s*=\s*(?:"(?![a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\/|#|\?)[^"]+"|'(?![a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\/|#|\?)[^']+')/i.test(
      out
    );

  const baseTag =
    existingBaseMatch || isNextJsDoc || !hasBareRelativeAsset
      ? ''
      : `<base href="${baseHref.replace(/"/g, '&quot;')}">`;
  const scriptlet = buildInFrameAdBlockScriptlet(targetUrl, proxyBasePath, [], effectiveBaseHref);
  const headInjection = baseTag ? `${baseTag}\n${scriptlet}\n` : isNextJsDoc ? scriptlet : `${scriptlet}\n`;

  if (isNextJsDoc) {
    // React 19 / Next.js 15 hydrates <html>/<head> strictly by child index — inject at end of <body>
    // (before </body>) while preserving synchronous execution before webpack chunks or fallback to </html>.
    if (/<\/body>/i.test(out)) {
      out = out.replace(/<\/body>/i, `${headInjection}</body>`);
    } else if (/<\/html>/i.test(out)) {
      out = out.replace(/<\/html>/i, `${headInjection}</html>`);
    } else {
      out = `${out}${headInjection}`;
    }
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n${headInjection}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${headInjection}</head>`);
  } else {
    out = `${headInjection}${out}`;
  }

  return { html: out, strippedCount };
}

/**
 * Rewrites root-relative and directory-relative segment/init/BaseURL references in a DASH `.mpd`
 * manifest against the upstream `currentUrl` origin while preserving `$RepresentationID$` / `$Number$` templates.
 */
export function rewriteDashMpdManifest(mpdText: string, currentUrl: string): string {
  if (!mpdText || typeof mpdText !== 'string') return '';
  let currentParsed: URL;
  try {
    currentParsed = new URL(currentUrl);
  } catch {
    return mpdText;
  }
  const currentBaseDir = new URL('.', currentParsed).toString();
  const resolveDashPath = (rawRef: string): string => {
    const t = rawRef.trim();
    if (!t || /^https?:\/\//i.test(t) || t.startsWith('data:')) return rawRef;
    if (t.startsWith('//')) return `https:${t}`;
    if (t.startsWith('/')) return `${currentParsed.origin}${t}`;
    return `${currentBaseDir}${t}`;
  };
  return mpdText
    .replace(
      /\b(initialization|media|sourceURL)\s*=\s*(["'])([^"']+)\2/gi,
      (_m, attr: string, q: string, val: string) => `${attr}=${q}${resolveDashPath(val)}${q}`
    )
    .replace(
      /<BaseURL>([^<]+)<\/BaseURL>/gi,
      (_m, val: string) => `<BaseURL>${resolveDashPath(val)}</BaseURL>`
    );
}

/**
 * Rewrites relative/root-relative playlist and `URI="..."` references in an HLS `.m3u8`
 * manifest against `currentUrl`.
 */
export function rewriteHlsM3u8Manifest(m3u8Text: string, currentUrl: string): string {
  if (!m3u8Text || typeof m3u8Text !== 'string') return '';
  return m3u8Text
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return line;
      if (trimmedLine.startsWith('#')) {
        return line.replace(/\bURI\s*=\s*(["'])([^"']+)\1/gi, (_m, q: string, u: string) => {
          try {
            const abs = new URL(u, currentUrl).toString();
            return `URI=${q}${abs}${q}`;
          } catch {
            return `URI=${q}${u}${q}`;
          }
        });
      }
      try {
        return new URL(trimmedLine, currentUrl).toString();
      } catch {
        return line;
      }
    })
    .join('\n');
}
