// Supabase Edge Function: supabase/functions/live-tv-proxy/index.ts
// Hardened Live TV Proxy (Stage Five):
// - Enforces approved sourceId / domain allowlist + DB rights check (no open proxy)
// - Resolves DNS (A/AAAA) & blocks private, loopback, link-local, CGNAT, multicast, reserved IPs
// - Uses manual redirect validation (max 4 hops) to defeat open-redirect & DNS-rebinding SSRF
// - Per-IP sliding-window rate limit + playlist/segment size limits
// - Origin-checked CORS (never unrestricted wildcard for unknown origins when configured)
// - Restricted methods (GET, HEAD, OPTIONS) & fixed server headers (never forwards client headers)
// - Accurate status codes (`X-Cinebox-Error-Code`), never falsely blaming geo-blocking for 403/404/502/timeouts

declare const Deno: any;

export const UPSTREAM_TIMEOUT_MS = 10_000;
export const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024; // 2 MB manifest cap
export const MAX_SEGMENT_BYTES = 20 * 1024 * 1024; // 20 MB segment cap
export const MAX_REDIRECT_HOPS = 4;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 120;

const DEFAULT_ALLOWED_ORIGINS = [
  'https://cineboxmovies.ai.studio',
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export interface ProxyApprovedSourceEntry {
  id: string;
  sourceUrl: string;
  allowedDomain: string;
  pathPrefix: string;
  rightsStatus: string;
  isEnabled: boolean;
  allowBrowserProxy: boolean;
}

export interface LiveTvProxyRuntimeDeps {
  resolveDns?: (hostname: string, recordType: 'A' | 'AAAA') => Promise<string[]>;
  fetchImpl?: typeof fetch;
  lookupApprovedSource?: (params: {
    sourceId?: string;
    targetUrl?: URL;
  }) => Promise<ProxyApprovedSourceEntry | null>;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  nowMs?: () => number;
  rateLimitMax?: number;
}

const ipRateBuckets = new Map<string, number[]>();

export function resetProxyRateLimitForTests(): void {
  ipRateBuckets.clear();
}

export function isForbiddenIpAddress(ipRaw: string): boolean {
  const ip = (ipRaw || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!ip) return true;

  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') {
    return true;
  }
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('ff')) {
    return true; // Link-local, ULA, multicast
  }

  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    const d = Number(m[4]);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 0 || a === 10 || a === 127) return true; // This network / RFC1918 / Loopback
    if (a === 169 && b === 254) return true; // Link-local / Cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true; // Benchmarking / TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // Multicast (224-239) & Reserved (240-255)
    return false;
  }

  // Only allow syntactically valid IPv6 hex addresses; reject malformed non-IPs
  if (!/^[0-9a-f:]+$/i.test(ip)) return true;
  return false;
}

export function isForbiddenPrivateOrLoopbackHost(hostname: string): boolean {
  const host = (hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    return true;
  }

  // If literal IPv4 or IPv6, verify directly
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return isForbiddenIpAddress(host);
  }

  return false;
}

function buildCorsHeaders(req: Request, allowedOriginsOverride?: string[]): Record<string, string> {
  const origin = (req.headers.get('origin') || '').trim();
  const envOrigins = (
    typeof Deno !== 'undefined' ? Deno.env.get('ALLOWED_CORS_ORIGINS') || '' : ''
  )
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean);

  const allowlist = allowedOriginsOverride || [...DEFAULT_ALLOWED_ORIGINS, ...envOrigins];

  const isRunAppOrigin =
    origin.startsWith('https://') &&
    (origin.endsWith('.run.app') || origin.endsWith('.ai.studio'));

  const allowOrigin =
    !origin
      ? allowlist[0]
      : allowlist.includes(origin) || isRunAppOrigin
      ? origin
      : 'null';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Content-Type, X-Cinebox-Error-Code',
  };
}

function logSecurityEvent(event: string, meta: Record<string, string | number | boolean>): void {
  // Never log raw signed stream URLs, query tokens, or user JWTs
  console.warn(
    JSON.stringify({
      scope: 'live-tv-proxy-security',
      event,
      ts: new Date().toISOString(),
      ...meta,
    })
  );
}

function validateHostMatchesAllowlist(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((allowed) => {
    const clean = allowed.trim().toLowerCase();
    if (!clean) return false;
    return host === clean || host.endsWith(`.${clean}`);
  });
}

async function resolveAndValidateHostIps(
  hostname: string,
  resolveDnsFn?: (hostname: string, recordType: 'A' | 'AAAA') => Promise<string[]>
): Promise<{ safe: boolean; reason?: string }> {
  if (isForbiddenPrivateOrLoopbackHost(hostname)) {
    return { safe: false, reason: 'private-or-loopback-host' };
  }

  // If literal IP, already checked above
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
    return { safe: true };
  }

  const resolver =
    resolveDnsFn ||
    (typeof Deno !== 'undefined' && typeof Deno.resolveDns === 'function'
      ? (h: string, t: 'A' | 'AAAA') => Deno.resolveDns(h, t)
      : null);

  if (!resolver) {
    return { safe: true };
  }

  const [aRes, aaaaRes] = await Promise.allSettled([
    resolver(hostname, 'A'),
    resolver(hostname, 'AAAA'),
  ]);

  const resolvedIps: string[] = [
    ...(aRes.status === 'fulfilled' && Array.isArray(aRes.value) ? aRes.value : []),
    ...(aaaaRes.status === 'fulfilled' && Array.isArray(aaaaRes.value) ? aaaaRes.value : []),
  ];

  if (resolvedIps.length === 0) {
    return { safe: false, reason: 'dns-resolution-empty' };
  }

  for (const ip of resolvedIps) {
    if (isForbiddenIpAddress(ip)) {
      return { safe: false, reason: 'dns-resolved-to-restricted-ip' };
    }
  }

  return { safe: true };
}

async function defaultSupabaseSourceLookup(params: {
  sourceId?: string;
  targetUrl?: URL;
}): Promise<ProxyApprovedSourceEntry | null> {
  if (typeof Deno === 'undefined') return null;
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!supabaseUrl || !serviceKey) return null;

  const restBase = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/live_sources`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: 'application/json',
  };

  if (params.sourceId) {
    const res = await fetch(
      `${restBase}?id=eq.${encodeURIComponent(params.sourceId)}&rights_status=eq.approved&is_enabled=eq.true&allow_browser_proxy=eq.true&select=id,source_url,allowed_domain,rights_status,is_enabled,allow_browser_proxy&limit=1`,
      { headers }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.source_url) return null;
    const parsedSource = new URL(row.source_url);
    const parentDir = parsedSource.pathname.includes('/')
      ? parsedSource.pathname.slice(0, parsedSource.pathname.lastIndexOf('/') + 1)
      : '/';
    return {
      id: row.id,
      sourceUrl: row.source_url,
      allowedDomain: (row.allowed_domain || parsedSource.hostname).toLowerCase(),
      pathPrefix: parentDir,
      rightsStatus: row.rights_status,
      isEnabled: Boolean(row.is_enabled),
      allowBrowserProxy: Boolean(row.allow_browser_proxy),
    };
  }

  if (params.targetUrl) {
    const domain = params.targetUrl.hostname.toLowerCase();
    const res = await fetch(
      `${restBase}?allowed_domain=eq.${encodeURIComponent(domain)}&rights_status=eq.approved&is_enabled=eq.true&allow_browser_proxy=eq.true&select=id,source_url,allowed_domain,rights_status,is_enabled,allow_browser_proxy&limit=5`,
      { headers }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    for (const row of rows) {
      const parsedSource = new URL(row.source_url);
      const parentDir = parsedSource.pathname.includes('/')
        ? parsedSource.pathname.slice(0, parsedSource.pathname.lastIndexOf('/') + 1)
        : '/';
      if (params.targetUrl.pathname.startsWith(parentDir)) {
        return {
          id: row.id,
          sourceUrl: row.source_url,
          allowedDomain: (row.allowed_domain || parsedSource.hostname).toLowerCase(),
          pathPrefix: parentDir,
          rightsStatus: row.rights_status,
          isEnabled: Boolean(row.is_enabled),
          allowBrowserProxy: Boolean(row.allow_browser_proxy),
        };
      }
    }
  }

  return null;
}

function toProxiedResourceUrl(
  rawUri: string,
  baseUpstreamUrl: string,
  proxyEndpoint: string
): string {
  const trimmed = rawUri.trim();
  if (!trimmed) return rawUri;
  if (trimmed.includes('/live-tv-proxy?')) return trimmed;

  try {
    const resolved = new URL(trimmed, baseUpstreamUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return rawUri;
    }
    if (isForbiddenPrivateOrLoopbackHost(resolved.hostname)) {
      return rawUri;
    }
    return `${proxyEndpoint}?url=${encodeURIComponent(resolved.toString())}`;
  } catch {
    return rawUri;
  }
}

export function rewriteM3u8Manifest(
  manifestText: string,
  baseUpstreamUrl: string,
  proxyEndpoint: string
): string {
  const lines = manifestText.split(/\r?\n/);

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        if (/URI\s*=\s*["'][^"']+["']/i.test(line)) {
          return line.replace(
            /(URI\s*=\s*)(["'])([^"']+)(["'])/gi,
            (_m, prefix, q1, uriVal, q2) =>
              `${prefix}${q1}${toProxiedResourceUrl(uriVal, baseUpstreamUrl, proxyEndpoint)}${q2}`
          );
        }
        return line;
      }

      return toProxiedResourceUrl(trimmed, baseUpstreamUrl, proxyEndpoint);
    })
    .join('\n');
}

function resolveProxySelfEndpoint(req: Request): string {
  const incoming = new URL(req.url);
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || incoming.host;
  const proto =
    forwardedProto ||
    (host.endsWith('.supabase.co') ? 'https' : incoming.protocol.replace(':', ''));
  const pathname = incoming.pathname.includes('/live-tv-proxy')
    ? incoming.pathname
    : '/functions/v1/live-tv-proxy';
  return `${proto}://${host}${pathname}`;
}

function isHlsPlaylistResponse(targetUrl: URL, contentType: string | null): boolean {
  const ct = (contentType || '').toLowerCase();
  const path = targetUrl.pathname.toLowerCase();
  return (
    path.endsWith('.m3u8') ||
    path.endsWith('.m3u') ||
    ct.includes('mpegurl') ||
    ct.includes('x-mpegurl')
  );
}

function checkRateLimit(clientKey: string, now: number, maxRequests: number): boolean {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const existing = (ipRateBuckets.get(clientKey) || []).filter((ts) => ts > windowStart);
  if (existing.length >= maxRequests) {
    ipRateBuckets.set(clientKey, existing);
    return false;
  }
  existing.push(now);
  ipRateBuckets.set(clientKey, existing);
  return true;
}

export async function handleLiveTvProxyRequest(
  req: Request,
  deps: LiveTvProxyRuntimeDeps = {}
): Promise<Response> {
  const corsHeaders = buildCorsHeaders(req, deps.allowedOrigins);
  const now = deps.nowMs ? deps.nowMs() : Date.now();
  const maxReqPerMin = deps.rateLimitMax ?? RATE_LIMIT_MAX_REQUESTS;

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    logSecurityEvent('unsupported-method', { method: req.method });
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Per-IP rate limiting
  const clientIp =
    req.headers.get('cf-connecting-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  if (!checkRateLimit(clientIp, now, maxReqPerMin)) {
    logSecurityEvent('rate-limit-exceeded', { clientIp: clientIp.slice(0, 18) });
    return new Response(
      JSON.stringify({ error: 'Too many stream proxy requests. Please slow down.' }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      }
    );
  }

  const reqUrl = new URL(req.url);
  const sourceId = (reqUrl.searchParams.get('sourceId') || '').trim();
  const rawUrlParam = (reqUrl.searchParams.get('url') || '').trim();

  const lookupSource = deps.lookupApprovedSource ?? defaultSupabaseSourceLookup;
  const envAllowedHosts = (
    typeof Deno !== 'undefined' ? Deno.env.get('ALLOWED_LIVE_TV_HOSTS') || '' : ''
  )
    .split(',')
    .map((h: string) => h.trim().toLowerCase())
    .filter(Boolean);
  const configuredHostAllowlist = deps.allowedHosts ?? envAllowedHosts;

  let currentUrl: URL | null = null;
  let approvedRecord: ProxyApprovedSourceEntry | null = null;

  if (sourceId) {
    if (!/^[a-zA-Z0-9._-]{3,80}$/.test(sourceId)) {
      return new Response(JSON.stringify({ error: 'Invalid sourceId parameter.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    approvedRecord = await lookupSource({ sourceId });
    if (
      !approvedRecord ||
      approvedRecord.rightsStatus !== 'approved' ||
      !approvedRecord.isEnabled ||
      !approvedRecord.allowBrowserProxy
    ) {
      logSecurityEvent('unapproved-source-blocked', { sourceId });
      return new Response(
        JSON.stringify({
          error: 'Source is pending approval, disabled, or not permitted for browser proxying.',
          code: 'UNAPPROVED_HOST',
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Cinebox-Error-Code': 'UNAPPROVED_HOST',
          },
        }
      );
    }
    currentUrl = new URL(approvedRecord.sourceUrl);
  } else if (rawUrlParam) {
    try {
      const parsed = new URL(rawUrlParam);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid scheme');
      }
      currentUrl = parsed;
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid ?url= parameter.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    approvedRecord = await lookupSource({ targetUrl: currentUrl });
    const hostInEnvAllowlist = validateHostMatchesAllowlist(
      currentUrl.hostname,
      configuredHostAllowlist
    );

    if (!approvedRecord && !hostInEnvAllowlist) {
      logSecurityEvent('disallowed-host-blocked', {
        host: currentUrl.hostname,
      });
      return new Response(
        JSON.stringify({
          error: 'Target host is not on the CineBox approved Live TV allowlist.',
          code: 'UNAPPROVED_HOST',
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Cinebox-Error-Code': 'UNAPPROVED_HOST',
          },
        }
      );
    }

    if (
      approvedRecord &&
      (!approvedRecord.isEnabled ||
        approvedRecord.rightsStatus !== 'approved' ||
        !approvedRecord.allowBrowserProxy ||
        !currentUrl.pathname.startsWith(approvedRecord.pathPrefix))
    ) {
      logSecurityEvent('path-or-rights-blocked', {
        host: currentUrl.hostname,
      });
      return new Response(
        JSON.stringify({
          error: 'Requested stream path or source rights are not approved for browser proxy.',
          code: 'UNAPPROVED_HOST',
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Cinebox-Error-Code': 'UNAPPROVED_HOST',
          },
        }
      );
    }
  } else {
    return new Response(
      JSON.stringify({ error: 'Missing ?sourceId= or allowlisted ?url= parameter.' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const fetchFn = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    // Sanitize forwarded Range header strictly; never forward arbitrary user headers
    const forwardHeaders: Record<string, string> = {
      'User-Agent': 'CineBox-LiveProxy/1.0 (+https://cineboxmovies.ai.studio)',
      Accept: '*/*',
    };
    const rawRange = req.headers.get('range');
    if (rawRange && /^bytes=\d+-\d*$/i.test(rawRange.trim())) {
      forwardHeaders['Range'] = rawRange.trim();
    }

    // Manual redirect loop with DNS + IP validation on EVERY hop
    let upstreamRes: Response | null = null;
    let finalUrl: URL = currentUrl;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const dnsCheck = await resolveAndValidateHostIps(finalUrl.hostname, deps.resolveDns);
      if (!dnsCheck.safe) {
        logSecurityEvent('ssrf-dns-ip-blocked', {
          host: finalUrl.hostname,
          reason: dnsCheck.reason || 'restricted-ip',
          hop,
        });
        return new Response(
          JSON.stringify({
            error: 'Stream host resolved to a forbidden private or reserved IP address.',
            code: 'SSRF_BLOCKED',
          }),
          {
            status: 403,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'X-Cinebox-Error-Code': 'SSRF_BLOCKED',
            },
          }
        );
      }

      const res = await fetchFn(finalUrl.toString(), {
        method: req.method,
        headers: forwardHeaders,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return new Response(JSON.stringify({ error: 'Invalid upstream redirect.' }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (hop === MAX_REDIRECT_HOPS) {
          logSecurityEvent('redirect-limit-exceeded', { host: finalUrl.hostname });
          return new Response(JSON.stringify({ error: 'Too many upstream redirects.' }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const nextUrl = new URL(location, finalUrl);
        if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
          return new Response(
            JSON.stringify({ error: 'Redirect to unsupported protocol blocked.' }),
            {
              status: 403,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'X-Cinebox-Error-Code': 'SSRF_BLOCKED',
              },
            }
          );
        }

        const nextAllowed =
          (approvedRecord &&
            (nextUrl.hostname.toLowerCase() === approvedRecord.allowedDomain ||
              nextUrl.hostname.toLowerCase().endsWith(`.${approvedRecord.allowedDomain}`))) ||
          validateHostMatchesAllowlist(nextUrl.hostname, configuredHostAllowlist);

        if (!nextAllowed) {
          // Still run DNS/private IP guard immediately before blocking disallowed redirect host
          const nextDns = await resolveAndValidateHostIps(nextUrl.hostname, deps.resolveDns);
          logSecurityEvent('redirect-disallowed-host', {
            host: nextUrl.hostname,
            ipSafe: nextDns.safe,
          });
          return new Response(
            JSON.stringify({
              error: 'Redirect to unapproved or restricted host blocked.',
              code: nextDns.safe ? 'UNAPPROVED_HOST' : 'SSRF_BLOCKED',
            }),
            {
              status: 403,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'X-Cinebox-Error-Code': nextDns.safe ? 'UNAPPROVED_HOST' : 'SSRF_BLOCKED',
              },
            }
          );
        }

        finalUrl = nextUrl;
        continue;
      }

      upstreamRes = res;
      break;
    }

    if (!upstreamRes) {
      return new Response(JSON.stringify({ error: 'Upstream failed to respond.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!upstreamRes.ok) {
      const errBody = await upstreamRes.text().catch(() => '');
      const isGeo =
        upstreamRes.status === 451 ||
        /\b(geo[-\s]?blocked|not available in your country|country restriction|outside.*region)\b/i.test(
          errBody
        );
      const errCode = isGeo ? 'GEO_BLOCKED' : 'OFFLINE';

      return new Response(
        JSON.stringify({
          error: isGeo
            ? 'Channel is geo-restricted in your region.'
            : 'Channel stream is currently offline or unreachable.',
          code: errCode,
          upstreamStatus: upstreamRes.status,
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Cinebox-Error-Code': errCode,
          },
        }
      );
    }

    const contentType = upstreamRes.headers.get('content-type');
    const contentLengthHeader = Number(upstreamRes.headers.get('content-length') || '0');
    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (req.method !== 'HEAD' && isHlsPlaylistResponse(finalUrl, contentType)) {
      if (contentLengthHeader > MAX_PLAYLIST_BYTES) {
        return new Response(
          JSON.stringify({ error: 'Upstream HLS playlist exceeds maximum allowed size.' }),
          {
            status: 413,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const text = await upstreamRes.text();
      if (text.length > MAX_PLAYLIST_BYTES) {
        return new Response(
          JSON.stringify({ error: 'Upstream HLS playlist exceeds maximum allowed size.' }),
          {
            status: 413,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const proxyEndpoint = resolveProxySelfEndpoint(req);
      const rewritten = text.includes('#EXT')
        ? rewriteM3u8Manifest(text, finalUrl.toString(), proxyEndpoint)
        : text;

      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return new Response(rewritten, {
        status: 200,
        headers: responseHeaders,
      });
    }

    if (contentLengthHeader > MAX_SEGMENT_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Upstream media segment exceeds maximum allowed size.' }),
        {
          status: 413,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (contentType) responseHeaders.set('Content-Type', contentType);
    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);
    const acceptRanges = upstreamRes.headers.get('accept-ranges');
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    const errCode = timedOut ? 'TIMEOUT' : 'OFFLINE';
    return new Response(
      JSON.stringify({
        error: timedOut
          ? 'Connection to stream timed out.'
          : 'Channel stream is currently offline or unreachable.',
        code: errCode,
        timedOut,
      }),
      {
        status: timedOut ? 504 : 502,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Cinebox-Error-Code': errCode,
        },
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve((req: Request) => handleLiveTvProxyRequest(req));
}
