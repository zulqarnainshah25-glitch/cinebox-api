import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import {
  DEFAULT_CURATED_AD_DOMAIN_SET,
  isAdRequestUrl,
  isHtmlEmbedProviderHost,
  isPrivateOrReservedIp,
  parseHostsTextIntoSet,
  rewriteDashMpdManifest,
  rewriteEmbedHtmlWithAdBlocker,
  rewriteHlsM3u8Manifest,
  validateProxyTargetUrl,
} from './src/utils/adblockEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const PROXY_MAX_BYTES = 8 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 15_000;
const PROXY_STREAM_TIMEOUT_MS = 45_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 400;

let activeBlocklistSet: Set<string> = new Set(DEFAULT_CURATED_AD_DOMAIN_SET);
let lastRemoteSyncAt = 0;

function loadBundledBlocklist(): void {
  try {
    const assetPath = path.resolve(__dirname, 'android/app/src/main/assets/adblock_domains.txt');
    if (fs.existsSync(assetPath)) {
      const text = fs.readFileSync(assetPath, 'utf8');
      activeBlocklistSet = parseHostsTextIntoSet(text, DEFAULT_CURATED_AD_DOMAIN_SET);
    }
  } catch {
    // Fallback safely to curated domains
  }
}

async function refreshRemoteBlocklistSafely(): Promise<void> {
  const now = Date.now();
  if (now - lastRemoteSyncAt < 6 * 60 * 60 * 1000) return;
  lastRemoteSyncAt = now;
  try {
    const res = await fetch(
      'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const text = await res.text();
      if (text.length > 1000) {
        activeBlocklistSet = parseHostsTextIntoSet(text, activeBlocklistSet);
      }
    }
  } catch {
    // Keep bundled domain set offline or on transient network errors
  }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (rateBuckets.size > 5000) {
    rateBuckets.clear();
  }
  const existing = rateBuckets.get(ip);
  if (!existing || now > existing.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  existing.count += 1;
  return existing.count <= RATE_LIMIT_MAX_REQUESTS;
}

const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const STATIC_ASSET_CACHE_TTL_MS = 30 * 60 * 1000;
const STATIC_ASSET_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const STATIC_ASSET_MAX_TOTAL_BYTES = 24 * 1024 * 1024;

const dnsSsrfCache = new Map<string, { ok: boolean; expiresAt: number }>();

async function verifyHostnameNotSsrf(targetUrl: string): Promise<{ ok: boolean; reason?: string }> {
  const validation = validateProxyTargetUrl(targetUrl);
  if (!validation.valid) {
    return { ok: false, reason: validation.reason };
  }
  try {
    const parsed = new URL(validation.normalizedUrl);
    const hostKey = parsed.hostname.toLowerCase();
    const cached = dnsSsrfCache.get(hostKey);
    const now = Date.now();
    if (cached && cached.ok && now < cached.expiresAt) {
      return { ok: true };
    }
    const records = await dns.lookup(parsed.hostname, { all: true });
    if (!records || records.length === 0) {
      return { ok: false, reason: 'dns-empty' };
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        dnsSsrfCache.delete(hostKey);
        return { ok: false, reason: 'dns-private-ip' };
      }
    }
    if (dnsSsrfCache.size > 2000) {
      dnsSsrfCache.clear();
    }
    dnsSsrfCache.set(hostKey, { ok: true, expiresAt: now + DNS_CACHE_TTL_MS });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'dns-lookup-failed' };
  }
}

function sendBlockedAdResponse(res: Response, targetUrl: string): void {
  res.setHeader('X-Cinebox-Adblock', 'blocked');
  res.setHeader('Cache-Control', 'no-store');
  const lower = targetUrl.toLowerCase();
  if (lower.includes('vast.xml') || lower.includes('vmap.xml')) {
    res.status(200).type('application/xml').send('<VAST version="3.0"></VAST>');
    return;
  }
  if (/\.js(?:[/?#]|$)|\.mjs(?:[/?#]|$)/.test(lower)) {
    res.status(200).type('application/javascript').send('/* Blocked by CineBox AdBlocker */');
    return;
  }
  res.status(204).end();
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return '';
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

function isLocalStaticAssetFile(reqPath: string): boolean {
  const rel = reqPath.replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return false;
  try {
    const pubRoot = path.resolve(__dirname, 'public') + path.sep;
    const pubPath = path.resolve(__dirname, 'public', rel);
    if (pubPath.startsWith(pubRoot) && fs.existsSync(pubPath) && fs.statSync(pubPath).isFile()) {
      return true;
    }
    const distRoot = path.resolve(__dirname, 'dist') + path.sep;
    const distPath = path.resolve(__dirname, 'dist', rel);
    if (distPath.startsWith(distRoot) && fs.existsSync(distPath) && fs.statSync(distPath).isFile()) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isCineboxInternalPath(reqPath: string, refererHeader: string = ''): boolean {
  const p = reqPath.toLowerCase();
  const isFromProxyFrame = refererHeader.includes('/api/adblock-proxy');
  return (
    p === '/' ||
    p === '/index.html' ||
    p === '/version.json' ||
    p === '/manifest.webmanifest' ||
    p === '/sw.js' ||
    p.startsWith('/src/') ||
    p.startsWith('/assets/aistudio/') ||
    (p.startsWith('/assets/') && !isFromProxyFrame && isLocalStaticAssetFile(reqPath)) ||
    p.startsWith('/node_modules/') ||
    p.startsWith('/@') ||
    p.startsWith('/icons/') ||
    p.startsWith('/api/health') ||
    p.startsWith('/api/adblock-proxy')
  );
}

function isCacheableStaticAssetUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const lowerPath = u.pathname.toLowerCase();
    if (
      lowerPath.includes('/api/') ||
      lowerPath.endsWith('.mpd') ||
      lowerPath.endsWith('.m3u8') ||
      lowerPath.endsWith('.m4s') ||
      lowerPath.endsWith('.ts') ||
      lowerPath.endsWith('.mp4') ||
      lowerPath.endsWith('.php')
    ) {
      return false;
    }
    if (lowerPath.includes('/_next/static/')) return true;
    return /\.(js|css|woff2|woff|ttf|svg|png|webp|ico)(?:$)/i.test(lowerPath);
  } catch {
    return false;
  }
}

export function createCineboxServerApp() {
  loadBundledBlocklist();
  void refreshRemoteBlocklistSafely();

  const app = express();
  app.disable('x-powered-by');

  const staticAssetCache = new Map<
    string,
    { status: number; contentType: string; body: Buffer; expiresAt: number }
  >();
  let staticAssetCacheBytes = 0;

  const getCachedStaticAsset = (url: string) => {
    const entry = staticAssetCache.get(url);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      staticAssetCache.delete(url);
      staticAssetCacheBytes = Math.max(0, staticAssetCacheBytes - entry.body.byteLength);
      return null;
    }
    return entry;
  };

  const putCachedStaticAsset = (url: string, status: number, contentType: string, body: Buffer) => {
    if (status !== 200 || body.byteLength === 0 || body.byteLength > STATIC_ASSET_MAX_ENTRY_BYTES) {
      return;
    }
    if (staticAssetCacheBytes + body.byteLength > STATIC_ASSET_MAX_TOTAL_BYTES) {
      staticAssetCache.clear();
      staticAssetCacheBytes = 0;
    }
    const prev = staticAssetCache.get(url);
    if (prev) {
      staticAssetCacheBytes = Math.max(0, staticAssetCacheBytes - prev.body.byteLength);
    }
    staticAssetCache.set(url, {
      status,
      contentType,
      body,
      expiresAt: Date.now() + STATIC_ASSET_CACHE_TTL_MS,
    });
    staticAssetCacheBytes += body.byteLength;
  };

  const upstreamCookieJar = new Map<string, { cookies: Record<string, string>; expiresAt: number }>();

  const readJarCookieHeader = (ip: string, host: string): string => {
    const entry = upstreamCookieJar.get(`${ip}::${host}`);
    if (!entry) return '';
    if (Date.now() > entry.expiresAt) {
      upstreamCookieJar.delete(`${ip}::${host}`);
      return '';
    }
    return Object.entries(entry.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  };

  const writeJarSetCookies = (ip: string, host: string, headers: Headers): void => {
    const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
    const rawCookies = typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : (headers.get('set-cookie') ? [headers.get('set-cookie') as string] : []);
    if (!rawCookies || rawCookies.length === 0) return;

    if (upstreamCookieJar.size > 500) {
      upstreamCookieJar.clear();
    }
    const key = `${ip}::${host}`;
    const existing = upstreamCookieJar.get(key)?.cookies || {};
    for (const line of rawCookies) {
      const firstPair = line.split(';')[0]?.trim();
      const eqIdx = firstPair?.indexOf('=') ?? -1;
      if (firstPair && eqIdx > 0) {
        const name = firstPair.slice(0, eqIdx).trim();
        const val = firstPair.slice(eqIdx + 1).trim();
        if (name && Object.keys(existing).length < 25) {
          existing[name] = val;
        }
      }
    }
    upstreamCookieJar.set(key, {
      cookies: existing,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  };

  const handleProxyForward = async (
    req: Request,
    res: Response,
    rawTarget: string,
    rawRef: string
  ): Promise<void> => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, X-Requested-With');
      res.status(204).end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    const validation = validateProxyTargetUrl(rawTarget);
    if (!validation.valid) {
      res.status(400).json({ error: 'Invalid or disallowed target URL', reason: validation.reason });
      return;
    }

    if (isAdRequestUrl(validation.normalizedUrl, activeBlocklistSet)) {
      sendBlockedAdResponse(res, validation.normalizedUrl);
      return;
    }

    const ssrfCheck = await verifyHostnameNotSsrf(validation.normalizedUrl);
    if (!ssrfCheck.ok) {
      res.status(403).json({ error: 'Blocked unsafe network target', reason: ssrfCheck.reason });
      return;
    }

    const canServeStaticCache =
      req.method === 'GET' && !req.headers.range && isCacheableStaticAssetUrl(validation.normalizedUrl);
    if (canServeStaticCache) {
      const hit = getCachedStaticAsset(validation.normalizedUrl);
      if (hit) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Referrer-Policy', 'origin');
        res.setHeader('X-Cinebox-Adblock', 'filtered');
        res.setHeader('X-Cinebox-Proxy-Cache', 'hit');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.status(hit.status).type(hit.contentType).send(hit.body);
        return;
      }
    }

    const refValidation = rawRef ? validateProxyTargetUrl(rawRef) : null;
    const safeRefUrl =
      refValidation?.valid && !isAdRequestUrl(refValidation.normalizedUrl, activeBlocklistSet)
        ? refValidation.normalizedUrl
        : '';

    try {
      let currentUrl = validation.normalizedUrl;
      let upstream: globalThis.Response | null = null;
      const bodyPayload =
        req.method === 'POST' && Buffer.isBuffer(req.body) && req.body.length > 0
          ? new Uint8Array(req.body)
          : undefined;

      for (let hop = 0; hop < 4; hop += 1) {
        const currentParsed = new URL(currentUrl);
        const currentOrigin = currentParsed.origin;
        let refOrigin = '';
        if (safeRefUrl) {
          try {
            refOrigin = new URL(safeRefUrl).origin;
          } catch {
            refOrigin = '';
          }
        }

        const reqHeaders: Record<string, string> = {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          Accept:
            typeof req.headers.accept === 'string' && req.headers.accept.length > 0
              ? req.headers.accept
              : 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: refOrigin ? `${refOrigin}/` : `${currentOrigin}/`,
        };

        if (
          req.method === 'POST' ||
          (refOrigin &&
            (refOrigin === currentOrigin ||
              currentParsed.hostname.includes('flooderrr') ||
              currentParsed.hostname.includes('hakunaymatata')))
        ) {
          reqHeaders.Origin = refOrigin || currentOrigin;
        }

        if (typeof req.headers['content-type'] === 'string' && req.method === 'POST') {
          reqHeaders['Content-Type'] = req.headers['content-type'];
        }
        if (typeof req.headers['x-requested-with'] === 'string') {
          reqHeaders['X-Requested-With'] = req.headers['x-requested-with'];
        }
        if (typeof req.headers['x-playback-environment'] === 'string') {
          reqHeaders['X-Playback-Environment'] = req.headers['x-playback-environment'];
        }
        for (const [hdrKey, hdrVal] of Object.entries(req.headers)) {
          const lk = hdrKey.toLowerCase();
          if (
            lk.startsWith('x-') &&
            lk !== 'x-forwarded-for' &&
            lk !== 'x-forwarded-host' &&
            lk !== 'x-forwarded-proto' &&
            lk !== 'x-forwarded-port' &&
            lk !== 'x-real-ip' &&
            lk !== 'x-requested-with' &&
            lk !== 'x-playback-environment' &&
            typeof hdrVal === 'string'
          ) {
            reqHeaders[hdrKey] = hdrVal;
          }
        }
        if (typeof req.headers.range === 'string') {
          reqHeaders.Range = req.headers.range;
        }
        if (typeof req.headers['if-range'] === 'string') {
          reqHeaders['If-Range'] = req.headers['if-range'];
        }
        const cookieHeader = readJarCookieHeader(clientIp, currentParsed.hostname.toLowerCase());
        if (cookieHeader) {
          reqHeaders.Cookie = cookieHeader;
        }

        const isLikelyMediaPath = /\.(mp4|m4v|mkv|webm|ts|m4s|mp3|aac)(?:$|\?)/i.test(currentUrl);
        upstream = await fetch(currentUrl, {
          method: req.method,
          redirect: 'manual',
          signal: AbortSignal.timeout(isLikelyMediaPath ? PROXY_STREAM_TIMEOUT_MS : PROXY_TIMEOUT_MS),
          headers: reqHeaders,
          body: hop === 0 ? bodyPayload : undefined,
        });

        writeJarSetCookies(clientIp, currentParsed.hostname.toLowerCase(), upstream.headers);

        if (upstream.status >= 300 && upstream.status < 400) {
          const loc = upstream.headers.get('location');
          if (!loc) break;
          const nextUrl = new URL(loc, currentUrl).toString();
          if (isAdRequestUrl(nextUrl, activeBlocklistSet)) {
            sendBlockedAdResponse(res, nextUrl);
            return;
          }
          const hopSsrf = await verifyHostnameNotSsrf(nextUrl);
          if (!hopSsrf.ok) {
            res.status(403).json({ error: 'Blocked redirect target', reason: hopSsrf.reason });
            return;
          }
          currentUrl = nextUrl;
          continue;
        }
        break;
      }

      if (!upstream) {
        res.status(502).json({ error: 'Upstream unavailable' });
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const lowerType = contentType.toLowerCase();

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Referrer-Policy', 'origin');
      res.setHeader('X-Cinebox-Adblock', 'filtered');

      const acceptRanges = upstream.headers.get('accept-ranges');
      const contentRange = upstream.headers.get('content-range');
      const contentLenHeader = upstream.headers.get('content-length');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (lowerType.includes('text/html')) {
        const contentLenNum = Number(contentLenHeader || '0');
        if (Number.isFinite(contentLenNum) && contentLenNum > PROXY_MAX_BYTES) {
          res.status(413).json({ error: 'Upstream HTML exceeds limit' });
          return;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (buf.byteLength > PROXY_MAX_BYTES) {
          res.status(413).json({ error: 'Upstream HTML exceeds size cap' });
          return;
        }
        try {
          const parsedFinal = new URL(currentUrl);
          if (isHtmlEmbedProviderHost(parsedFinal.hostname)) {
            res.setHeader(
              'Set-Cookie',
              `cbx_embed_origin=${encodeURIComponent(parsedFinal.origin)}; Path=/; HttpOnly; SameSite=Lax`
            );
          }
        } catch {
          // ignore
        }
        const rawHtml = buf.toString('utf8');
        const { html: cleanHtml, strippedCount } = rewriteEmbedHtmlWithAdBlocker(
          rawHtml,
          currentUrl,
          '/api/adblock-proxy',
          activeBlocklistSet
        );
        res.setHeader('X-Cinebox-Stripped-Ads', String(strippedCount));
        res.status(upstream.status).type('text/html; charset=utf-8').send(cleanHtml);
        return;
      }

      if (lowerType.includes('text/css')) {
        const contentLenNum = Number(contentLenHeader || '0');
        if (!Number.isFinite(contentLenNum) || contentLenNum <= PROXY_MAX_BYTES) {
          const cssText = Buffer.from(await upstream.arrayBuffer()).toString('utf8');
          const rewrittenCss = cssText.replace(/url\(\s*(['"]?)(\/[^)'"]+)\1\s*\)/gi, (_m, q, relPath: string) => {
            try {
              const abs = new URL(relPath, currentUrl).toString();
              if (isAdRequestUrl(abs, activeBlocklistSet)) {
                return `url(${q}about:blank${q})`;
              }
              const proxied = `/api/adblock-proxy?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(currentUrl)}`;
              return `url(${q}${proxied}${q})`;
            } catch {
              return `url(${q}${relPath}${q})`;
            }
          });
          res.status(upstream.status).type('text/css; charset=utf-8').send(rewrittenCss);
          return;
        }
      }

      const isDashMpd =
        lowerType.includes('application/dash+xml') || /\.mpd(?:$|\?)/i.test(currentUrl);
      if (isDashMpd && req.method !== 'HEAD') {
        const contentLenNum = Number(contentLenHeader || '0');
        if (!Number.isFinite(contentLenNum) || contentLenNum <= PROXY_MAX_BYTES) {
          const mpdText = Buffer.from(await upstream.arrayBuffer()).toString('utf8');
          const rewrittenMpd = rewriteDashMpdManifest(mpdText, currentUrl);
          res.status(upstream.status).type('application/dash+xml; charset=utf-8').send(rewrittenMpd);
          return;
        }
      }

      const isHlsM3u8 =
        lowerType.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(currentUrl);
      if (isHlsM3u8 && req.method !== 'HEAD') {
        const contentLenNum = Number(contentLenHeader || '0');
        if (!Number.isFinite(contentLenNum) || contentLenNum <= PROXY_MAX_BYTES) {
          const m3u8Text = Buffer.from(await upstream.arrayBuffer()).toString('utf8');
          const rewrittenM3u8 = rewriteHlsM3u8Manifest(m3u8Text, currentUrl);
          res.status(upstream.status).type('application/vnd.apple.mpegurl; charset=utf-8').send(rewrittenM3u8);
          return;
        }
      }

      const resolvedType =
        currentUrl.toLowerCase().includes('.wasm') && !lowerType.includes('wasm')
          ? 'application/wasm'
          : contentType;

      if (
        canServeStaticCache &&
        upstream.status === 200 &&
        !lowerType.includes('text/html') &&
        !upstream.headers.get('set-cookie')
      ) {
        const lenNum = upstream.headers.get('content-encoding') ? 0 : Number(contentLenHeader || '0');
        if (!lenNum || lenNum <= STATIC_ASSET_MAX_ENTRY_BYTES) {
          const assetBuf = Buffer.from(await upstream.arrayBuffer());
          putCachedStaticAsset(validation.normalizedUrl, 200, resolvedType, assetBuf);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.setHeader('X-Cinebox-Proxy-Cache', 'miss');
          res.status(200).type(resolvedType).send(assetBuf);
          return;
        }
      }

      if (canServeStaticCache && upstream.status === 200) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', resolvedType);
      if (contentLenHeader && !upstream.headers.get('content-encoding')) {
        res.setHeader('Content-Length', contentLenHeader);
      }

      if (req.method === 'HEAD' || !upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as any);
      const destroyOnClose = () => {
        try {
          nodeStream.destroy();
        } catch {
          // ignore
        }
      };
      res.on('close', destroyOnClose);
      nodeStream.on('error', () => {
        if (!res.headersSent) {
          res.status(502).end();
        } else {
          res.end();
        }
      });
      nodeStream.pipe(res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Adblock proxy fetch failed',
          detail: err?.name === 'TimeoutError' ? 'timeout' : 'upstream-error',
        });
      } else {
        res.end();
      }
    }
  };

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      version: '1.0.12',
      blocklistSize: activeBlocklistSet.size,
      adblockProxyEnabled: true,
    });
  });

  app.get('/api/adblock-proxy/prewarm', async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
      return;
    }
    const rawTarget = typeof req.query.url === 'string' ? req.query.url : '';
    const ssrf = await verifyHostnameNotSsrf(rawTarget);
    if (!ssrf.ok || isAdRequestUrl(rawTarget, activeBlocklistSet)) {
      res.status(400).json({ ok: false, error: 'Disallowed target' });
      return;
    }
    try {
      const targetParsed = new URL(rawTarget);
      const htmlRes = await fetch(rawTarget, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(4500),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          Referer: `${targetParsed.origin}/`,
        },
      });
      if (!htmlRes.ok) {
        res.json({ ok: false, warmedAssets: 0 });
        return;
      }
      const htmlBuf = Buffer.from(await htmlRes.arrayBuffer());
      if (htmlBuf.byteLength > PROXY_MAX_BYTES) {
        res.json({ ok: false, warmedAssets: 0 });
        return;
      }
      const html = htmlBuf.toString('utf8');
      const assetUrls = new Set<string>();
      const assetRe = /(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
      let m: RegExpExecArray | null;
      while ((m = assetRe.exec(html)) !== null && assetUrls.size < 12) {
        const rawRef = m[1] || m[2] || '';
        if (!rawRef) continue;
        try {
          const abs = new URL(rawRef, rawTarget).toString();
          if (
            isCacheableStaticAssetUrl(abs) &&
            !isAdRequestUrl(abs, activeBlocklistSet) &&
            !getCachedStaticAsset(abs)
          ) {
            const assetSsrf = await verifyHostnameNotSsrf(abs);
            if (assetSsrf.ok) {
              assetUrls.add(abs);
            }
          }
        } catch {
          // ignore
        }
      }

      let warmed = 0;
      await Promise.allSettled(
        Array.from(assetUrls).map(async (u) => {
          try {
            const ar = await fetch(u, {
              method: 'GET',
              redirect: 'manual',
              signal: AbortSignal.timeout(3500),
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                Referer: `${targetParsed.origin}/`,
              },
            });
            if (ar.ok) {
              const ct = ar.headers.get('content-type') || 'application/javascript';
              if (!ct.toLowerCase().includes('text/html')) {
                const buf = Buffer.from(await ar.arrayBuffer());
                if (buf.byteLength <= STATIC_ASSET_MAX_ENTRY_BYTES) {
                  putCachedStaticAsset(u, 200, ct, buf);
                  warmed += 1;
                }
              }
            }
          } catch {
            // ignore individual chunk warm failures
          }
        })
      );
      res.json({ ok: true, warmedAssets: warmed });
    } catch {
      res.json({ ok: false, warmedAssets: 0 });
    }
  });

  app.use(
    '/api/adblock-proxy',
    express.raw({ type: '*/*', limit: '256kb' }),
    async (req: Request, res: Response) => {
      const rawTarget = typeof req.query.url === 'string' ? req.query.url : '';
      const rawRef = typeof req.query.ref === 'string' ? req.query.ref : '';
      await handleProxyForward(req, res, rawTarget, rawRef);
    }
  );

  // Transparent same-origin proxy for Next.js embed root-relative chunks/images (/_next/*, /4k.png, etc.)
  // so Next.js App Router hydration never mismatches HTML attributes (`Minified React error #418`).
  app.use(async (req: Request, res: Response, next) => {
    const refHeader = typeof req.headers.referer === 'string' ? req.headers.referer : '';
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isCineboxInternalPath(req.path, refHeader)) {
      next();
      return;
    }

    let embedOrigin = '';
    if (refHeader) {
      try {
        const refParsed = new URL(refHeader);
        if (refParsed.pathname.startsWith('/api/adblock-proxy')) {
          const refTarget = refParsed.searchParams.get('url');
          if (refTarget) {
            embedOrigin = new URL(refTarget).origin;
          }
        }
      } catch {
        // ignore invalid referer
      }
    }

    if (!embedOrigin) {
      const cookieOrigin = parseCookieValue(req.headers.cookie, 'cbx_embed_origin');
      if (cookieOrigin) {
        embedOrigin = cookieOrigin;
      }
    }

    if (!embedOrigin) {
      next();
      return;
    }

    const isNextAsset = req.path.startsWith('/_next/');
    const fetchDest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
    if (!isNextAsset && fetchDest === 'document') {
      next();
      return;
    }

    try {
      const originParsed = new URL(embedOrigin);
      if (!isHtmlEmbedProviderHost(originParsed.hostname)) {
        next();
        return;
      }
      const targetUrl = new URL(req.originalUrl, originParsed.origin).toString();
      await handleProxyForward(req, res, targetUrl, `${originParsed.origin}/`);
    } catch {
      next();
    }
  });

  return app;
}

async function startServer() {
  const app = createCineboxServerApp();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd && fs.existsSync(path.resolve(__dirname, 'src'))) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CineBox server listening on http://0.0.0.0:${PORT} (adblock domains: ${activeBlocklistSet.size})`);
  });
}

// Start HTTP server only when executed directly as entrypoint
const isMainModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startServer().catch((err) => {
    console.error('Failed to start CineBox server:', err);
    process.exit(1);
  });
}
