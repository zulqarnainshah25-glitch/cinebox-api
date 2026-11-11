import { CLIENT_PROXIES, buildCorsProxyHeaders, buildProxiedUrl } from './movieBoxDirectApi';
import { sanitizeSafeUrl } from '../utils/securityValidator';

export interface ExtractedStreamCandidate {
  url: string;
  format: 'm3u8' | 'mp4';
  sourceServer: 'server-3-2embed' | 'server-1-vidsrc';
}

export interface StreamExtractionResult {
  ok: boolean;
  streamUrl: string | null;
  format: 'm3u8' | 'mp4' | null;
  sourceServer: 'server-3-2embed' | 'server-1-vidsrc' | null;
  triedServers: string[];
  errorMessage: string | null;
}

export const EXTRACTION_UNAVAILABLE_MESSAGE =
  'Download not available for this server, try another';

/**
 * Pure parser (Streambert-style) that scans raw HTML, JSON, or inline player scripts
 * from 2Embed / VidSrc responses and extracts valid `.m3u8` or `.mp4` stream URLs.
 */
export function extractStreamUrlsFromHtml(
  rawText: string,
  sourceServer: 'server-3-2embed' | 'server-1-vidsrc' = 'server-3-2embed'
): ExtractedStreamCandidate[] {
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }

  // Normalize escaped slashes (`https:\/\/cdn.example.com\/master.m3u8`) often found in JSON/JS
  const normalized = rawText.replace(/\\\//g, '/');

  const candidates: ExtractedStreamCandidate[] = [];
  const seen = new Set<string>();

  // 1. Match direct https://...m3u8 or https://...mp4 URLs (with optional query params)
  const streamRegex =
    /https?:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]+\.(?:m3u8|mp4)(?:\?[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/gi;

  const matches = normalized.match(streamRegex) || [];
  for (const rawMatch of matches) {
    // Strip trailing quotes or punctuation if captured
    const cleaned = rawMatch.replace(/['");\\]+$/, '');
    const safe = sanitizeSafeUrl(cleaned);
    if (!safe || seen.has(safe)) continue;

    // Ignore obvious ad/tracker or tiny preview clips
    const lower = safe.toLowerCase();
    if (
      lower.includes('doubleclick.net') ||
      lower.includes('googlesyndication') ||
      lower.includes('flower.mp4')
    ) {
      continue;
    }

    seen.add(safe);
    const format: 'm3u8' | 'mp4' = lower.includes('.m3u8') ? 'm3u8' : 'mp4';
    candidates.push({
      url: safe,
      format,
      sourceServer,
    });
  }

  // Prioritize .mp4 first if available, then .m3u8 playlists
  return candidates.sort((a, b) => {
    if (a.format === b.format) return 0;
    return a.format === 'mp4' ? -1 : 1;
  });
}

/**
 * Extracts nested iframe `src` or `data-hash` RCP URLs from VidSrc / 2Embed wrapper HTML
 * (e.g., `//cloudnestra.com/rcp/...` or `https://www.2embed.cc/ajax/embed/play?id=...`).
 */
export function extractNestedEmbedSourcesFromHtml(
  rawHtml: string,
  baseOrigin: string
): string[] {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return [];
  }

  const nestedUrls: string[] = [];
  const seen = new Set<string>();

  // 1. Look for iframe src="..."
  const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = iframeRegex.exec(rawHtml)) !== null) {
    const rawSrc = match[1].trim();
    const resolved = resolveRelativeOrProtocollessUrl(rawSrc, baseOrigin);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      nestedUrls.push(resolved);
    }
  }

  // 2. Look for VidSrc `data-hash="..."` attributes used to build cloudnestra RCP URLs
  const hashRegex = /data-hash=["']([a-zA-Z0-9+/=_-]{16,})["']/gi;
  while ((match = hashRegex.exec(rawHtml)) !== null) {
    const hash = match[1].trim();
    const rcpUrl = `https://cloudnestra.com/rcp/${hash}`;
    if (!seen.has(rcpUrl)) {
      seen.add(rcpUrl);
      nestedUrls.push(rcpUrl);
    }
  }

  // 3. Look for 2Embed `data-id="..."` server buttons (`https://www.2embed.cc/ajax/embed/play?id=...`)
  const dataIdRegex = /data-id=["']([a-zA-Z0-9_-]{5,})["']/gi;
  while ((match = dataIdRegex.exec(rawHtml)) !== null) {
    const id = match[1].trim();
    if (baseOrigin.includes('2embed')) {
      const ajaxUrl = `https://www.2embed.cc/ajax/embed/play?id=${encodeURIComponent(id)}&_token=1`;
      if (!seen.has(ajaxUrl)) {
        seen.add(ajaxUrl);
        nestedUrls.push(ajaxUrl);
      }
    }
  }

  return nestedUrls.slice(0, 3);
}

function resolveRelativeOrProtocollessUrl(rawUrl: string, baseOrigin: string): string | null {
  if (!rawUrl) return null;
  if (rawUrl.startsWith('//')) {
    return sanitizeSafeUrl(`https:${rawUrl}`);
  }
  if (rawUrl.startsWith('/')) {
    return sanitizeSafeUrl(`${baseOrigin.replace(/\/$/, '')}${rawUrl}`);
  }
  return sanitizeSafeUrl(rawUrl);
}

/**
 * Fetches raw HTML/JSON from a target embed URL via the client-side proxy chain.
 */
async function fetchTextViaClientProxy(targetUrl: string): Promise<string | null> {
  for (const proxyItem of CLIENT_PROXIES) {
    const proxiedUrl = buildProxiedUrl(targetUrl, proxyItem.prefix);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    try {
      const response = await fetch(proxiedUrl, {
        method: 'GET',
        headers: buildCorsProxyHeaders(proxiedUrl),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) continue;
      const text = await response.text();
      if (text && text.length > 20) {
        return text;
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Attempts to extract a direct `.m3u8` or `.mp4` stream URL from:
 * 1. Server 3 (2Embed) (`https://www.2embed.cc/embed/{tmdbId}`)
 * 2. Fallback Server 1 (VidSrc.sh) (`https://vidsrc.sh/embed/...` & `https://vidsrc.xyz/embed/...`)
 *
 * If extraction is blocked by Cloudflare/iframe encryption on the selected server(s),
 * returns `{ ok: false, errorMessage: 'Download not available for this server, try another' }`.
 */
export async function extractStreamFromEmbedServers(params: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  preferredServer?: 'server-3-2embed' | 'server-1-vidsrc';
}): Promise<StreamExtractionResult> {
  const safeId = Math.max(1, Math.floor(Number(params.tmdbId) || 1));
  const safeSeason = Math.max(1, Math.floor(Number(params.season) || 1));
  const safeEpisode = Math.max(1, Math.floor(Number(params.episode) || 1));

  const server3Url =
    params.mediaType === 'tv'
      ? `https://www.2embed.cc/embedtv/${safeId}&s=${safeSeason}&e=${safeEpisode}`
      : `https://www.2embed.cc/embed/${safeId}`;

  const server1Urls =
    params.mediaType === 'tv'
      ? [
          `https://vidsrc.sh/embed/tv/${safeId}/${safeSeason}/${safeEpisode}?ds_lang=en`,
          `https://vidsrc.xyz/embed/tv/${safeId}/${safeSeason}-${safeEpisode}`,
        ]
      : [
          `https://vidsrc.sh/embed/movie/${safeId}?ds_lang=en`,
          `https://vidsrc.xyz/embed/movie/${safeId}`,
        ];

  const queue: {
    serverKey: 'server-3-2embed' | 'server-1-vidsrc';
    label: string;
    urls: string[];
    origin: string;
  }[] =
    params.preferredServer === 'server-1-vidsrc'
      ? [
          {
            serverKey: 'server-1-vidsrc',
            label: 'Server 1 (VidSrc.sh)',
            urls: server1Urls,
            origin: 'https://vidsrc.sh',
          },
          {
            serverKey: 'server-3-2embed',
            label: 'Server 3 (2Embed)',
            urls: [server3Url],
            origin: 'https://www.2embed.cc',
          },
        ]
      : [
          {
            serverKey: 'server-3-2embed',
            label: 'Server 3 (2Embed)',
            urls: [server3Url],
            origin: 'https://www.2embed.cc',
          },
          {
            serverKey: 'server-1-vidsrc',
            label: 'Server 1 (VidSrc.sh)',
            urls: server1Urls,
            origin: 'https://vidsrc.sh',
          },
        ];

  const triedServers: string[] = [];

  for (const target of queue) {
    triedServers.push(target.label);

    for (const url of target.urls) {
      const html = await fetchTextViaClientProxy(url);
      if (!html) continue;

      // 1. Direct scan of the embed page HTML for .m3u8 / .mp4 URLs
      const directMatches = extractStreamUrlsFromHtml(html, target.serverKey);
      if (directMatches.length > 0) {
        return {
          ok: true,
          streamUrl: directMatches[0].url,
          format: directMatches[0].format,
          sourceServer: target.serverKey,
          triedServers,
          errorMessage: null,
        };
      }

      // 2. Scan nested iframe / RCP / AJAX play URLs (second hop)
      const nestedUrls = extractNestedEmbedSourcesFromHtml(html, target.origin);
      for (const nestedUrl of nestedUrls) {
        const nestedHtml = await fetchTextViaClientProxy(nestedUrl);
        if (!nestedHtml) continue;

        const nestedMatches = extractStreamUrlsFromHtml(nestedHtml, target.serverKey);
        if (nestedMatches.length > 0) {
          return {
            ok: true,
            streamUrl: nestedMatches[0].url,
            format: nestedMatches[0].format,
            sourceServer: target.serverKey,
            triedServers,
            errorMessage: null,
          };
        }
      }
    }
  }

  return {
    ok: false,
    streamUrl: null,
    format: null,
    sourceServer: null,
    triedServers,
    errorMessage: EXTRACTION_UNAVAILABLE_MESSAGE,
  };
}
