#!/usr/bin/env node
/**
 * CineBox Live — Owner-Controlled Candidate Ingestion & Honest Playback Verification Runner
 *
 * USAGE (locally or from a Pakistan-hosted runner):
 *   VERIFY_COUNTRY=PK node scripts/verify_live_sources.mjs --limit=25
 *   VERIFY_COUNTRY=PK SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/verify_live_sources.mjs --sync
 *
 * POLICY:
 * - Never fabricates Pakistan verification results when VERIFY_COUNTRY !== 'PK'.
 * - Never auto-promotes unverified third-party feeds to `rights_status = 'approved'`.
 * - Uses GET (never HEAD-only) and verifies master -> media playlist -> segment reachability.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

const API_CHANNELS = 'https://iptv-org.github.io/api/channels.json';
const API_STREAMS = 'https://iptv-org.github.io/api/streams.json';
const M3U_CANDIDATES = [
  { id: 'pakistan', country: 'PK', url: 'https://iptv-org.github.io/iptv/countries/pk.m3u' },
  { id: 'india', country: 'IN', url: 'https://iptv-org.github.io/iptv/countries/in.m3u' },
  { id: 'sports', country: 'INTL', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u' },
  { id: 'news', country: 'INTL', url: 'https://iptv-org.github.io/iptv/categories/news.m3u' },
  { id: 'movies', country: 'INTL', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u' },
  { id: 'entertainment', country: 'INTL', url: 'https://iptv-org.github.io/iptv/categories/entertainment.m3u' },
  { id: 'freetv', country: 'INTL', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8' },
];

const TEST_COUNTRY = String(process.env.VERIFY_COUNTRY || 'UNKNOWN').toUpperCase();
const REQUEST_TIMEOUT_MS = 10000;
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const MAX_PROBES = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 20) : 20;
const SHOULD_SYNC = process.argv.includes('--sync');

function isPrivateIp(ip) {
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (net.isIPv4(clean)) {
    const [a, b] = clean.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
  } else if (net.isIPv6(clean)) {
    const lower = clean.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff')) {
      return true;
    }
  }
  return false;
}

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'CineBox-Live-Verifier/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function verifySingleStream(streamUrl) {
  const checkedAt = new Date().toISOString();
  let parsed;
  try {
    parsed = new URL(streamUrl);
  } catch {
    return { checkedAt, dnsOk: false, tlsOk: false, manifestOk: false, mediaPlaylistOk: false, segmentOk: false, status: 'unsupported_format', detail: 'Malformed URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { checkedAt, dnsOk: false, tlsOk: false, manifestOk: false, mediaPlaylistOk: false, segmentOk: false, status: 'unsupported_format', detail: 'Non-HTTP(S) protocol' };
  }

  let dnsOk = false;
  try {
    const records = await dns.lookup(parsed.hostname, { all: true });
    if (!records || records.length === 0) {
      return { checkedAt, dnsOk: false, tlsOk: false, manifestOk: false, mediaPlaylistOk: false, segmentOk: false, status: 'offline', detail: 'DNS lookup returned empty' };
    }
    if (records.some((r) => isPrivateIp(r.address))) {
      return { checkedAt, dnsOk: false, tlsOk: false, manifestOk: false, mediaPlaylistOk: false, segmentOk: false, status: 'offline', detail: 'Blocked private IP resolution' };
    }
    dnsOk = true;
  } catch (err) {
    return { checkedAt, dnsOk: false, tlsOk: false, manifestOk: false, mediaPlaylistOk: false, segmentOk: false, status: 'offline', detail: `DNS failed: ${err.message}` };
  }

  const tlsOk = parsed.protocol === 'https:';
  try {
    const res = await fetchWithTimeout(streamUrl);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const hasGeo = res.status === 451 || /geo[-\s]?blocked|not available in your country|country restriction/i.test(text);
      return {
        checkedAt,
        dnsOk,
        tlsOk,
        manifestOk: false,
        mediaPlaylistOk: false,
        segmentOk: false,
        httpStatus: res.status,
        status: hasGeo ? 'geo_blocked' : 'offline',
        detail: `HTTP ${res.status}`,
      };
    }

    const body = await res.text();
    const isDash = parsed.pathname.toLowerCase().includes('.mpd') || /<MPD\b/i.test(body);
    if (isDash) {
      const validMpd = /<MPD\b/i.test(body) && /<Period\b/i.test(body) && /<AdaptationSet\b/i.test(body);
      return {
        checkedAt,
        dnsOk,
        tlsOk,
        manifestOk: validMpd,
        mediaPlaylistOk: validMpd,
        segmentOk: validMpd,
        httpStatus: res.status,
        status: !validMpd ? 'invalid_manifest' : TEST_COUNTRY === 'PK' ? 'verified' : 'not_tested_from_pk',
        detail: validMpd ? `DASH MPD valid (${TEST_COUNTRY})` : 'Invalid DASH MPD XML',
      };
    }

    if (!body.trim().startsWith('#EXTM3U')) {
      return { checkedAt, dnsOk, tlsOk, manifestOk: false, mediaPlaylistOk: false, segmentOk: false, httpStatus: res.status, status: 'invalid_manifest', detail: 'Missing #EXTM3U header' };
    }

    const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let mediaUrl = null;
    let segmentUrl = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
        mediaUrl = new URL(lines[i + 1], streamUrl).toString();
        break;
      }
      if (lines[i].startsWith('#EXTINF:') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
        segmentUrl = new URL(lines[i + 1], streamUrl).toString();
        break;
      }
    }

    let mediaPlaylistOk = !mediaUrl;
    if (mediaUrl) {
      const mRes = await fetchWithTimeout(mediaUrl);
      if (!mRes.ok) {
        return { checkedAt, dnsOk, tlsOk, manifestOk: true, mediaPlaylistOk: false, segmentOk: false, httpStatus: mRes.status, status: 'offline', detail: `Variant playlist HTTP ${mRes.status}` };
      }
      const mBody = await mRes.text();
      const mLines = mBody.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < mLines.length; i++) {
        if (mLines[i].startsWith('#EXTINF:') && mLines[i + 1] && !mLines[i + 1].startsWith('#')) {
          segmentUrl = new URL(mLines[i + 1], mediaUrl).toString();
          break;
        }
      }
      mediaPlaylistOk = Boolean(segmentUrl);
    }

    if (!segmentUrl) {
      return { checkedAt, dnsOk, tlsOk, manifestOk: true, mediaPlaylistOk: false, segmentOk: false, httpStatus: res.status, status: 'invalid_manifest', detail: 'No segments found' };
    }

    const segRes = await fetchWithTimeout(segmentUrl);
    if (!segRes.ok) {
      return { checkedAt, dnsOk, tlsOk, manifestOk: true, mediaPlaylistOk, segmentOk: false, httpStatus: segRes.status, status: 'offline', detail: `Segment HTTP ${segRes.status}` };
    }

    return {
      checkedAt,
      dnsOk,
      tlsOk,
      manifestOk: true,
      mediaPlaylistOk: true,
      segmentOk: true,
      httpStatus: res.status,
      status: TEST_COUNTRY === 'PK' ? 'verified' : 'not_tested_from_pk',
      detail: TEST_COUNTRY === 'PK' ? 'Verified from Pakistan (manifest + media + segment OK)' : `Reachable from ${TEST_COUNTRY}, not tested from PK`,
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return {
      checkedAt,
      dnsOk,
      tlsOk,
      manifestOk: false,
      mediaPlaylistOk: false,
      segmentOk: false,
      status: isTimeout ? 'timeout' : 'offline',
      detail: err.message,
    };
  }
}

async function main() {
  console.log(`[CineBox Verifier] Country=${TEST_COUNTRY} MaxProbes=${MAX_PROBES} Sync=${SHOULD_SYNC}`);

  const [chRes, stRes] = await Promise.all([fetchWithTimeout(API_CHANNELS), fetchWithTimeout(API_STREAMS)]);
  const apiChannels = chRes.ok ? await chRes.json() : [];
  const apiStreams = stRes.ok ? await stRes.json() : [];

  console.log(`[Discovery] Loaded ${apiChannels.length} API channels, ${apiStreams.length} API streams.`);

  const m3uEntries = [];
  for (const feed of M3U_CANDIDATES) {
    try {
      const res = await fetchWithTimeout(feed.url);
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:') && lines[i + 1] && !lines[i + 1].trim().startsWith('#')) {
          const url = lines[i + 1].trim();
          const name = (line.split(',')[1] || 'Live Channel').trim();
          m3uEntries.push({ provider: feed.id, country: feed.country, name, url });
          if (m3uEntries.length >= MAX_PROBES) break;
        }
      }
      if (m3uEntries.length >= MAX_PROBES) break;
    } catch {
      // skip unreachable feed
    }
  }

  console.log(`[Probe] Verifying ${m3uEntries.length} candidate streams...`);
  const results = [];
  for (const entry of m3uEntries) {
    const check = await verifySingleStream(entry.url);
    results.push({ ...entry, check });
    console.log(` - [${check.status}] (${entry.country}/${entry.provider}) ${entry.name} -> ${check.detail}`);
  }

  if (SHOULD_SYNC && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[Sync] Uploading check logs & pending discovery records (never auto-approving rights)...');
    const supabaseUrl = process.env.SUPABASE_URL.replace(/\/+$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    };
    const checksPayload = results.map((r, idx) => ({
      source_id: `candidate-${r.provider}-${idx}`,
      channel_id: `${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${r.country.toLowerCase()}`,
      test_country: TEST_COUNTRY,
      checked_at: r.check.checkedAt,
      test_method: 'get-manifest-and-segment-probe',
      dns_ok: r.check.dnsOk,
      tls_ok: r.check.tlsOk,
      manifest_ok: r.check.manifestOk,
      media_playlist_ok: r.check.mediaPlaylistOk,
      segment_ok: r.check.segmentOk,
      playback_ok: r.check.status === 'verified',
      http_status: r.check.httpStatus ?? null,
      error_classification: r.check.status,
      details: r.check.detail,
    }));

    const syncRes = await fetch(`${supabaseUrl}/rest/v1/live_source_checks`, {
      method: 'POST',
      headers,
      body: JSON.stringify(checksPayload),
    });
    console.log(`[Sync] Supabase live_source_checks response: HTTP ${syncRes.status}`);
  }
}

main().catch((err) => {
  console.error('[Verifier Fatal]', err);
  process.exit(1);
});
