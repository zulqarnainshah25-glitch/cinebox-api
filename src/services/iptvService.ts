import {
  IptvCategorySummary,
  IptvChannel,
  IptvOrgApiCategory,
  IptvOrgApiChannel,
  IptvOrgApiGuide,
  IptvOrgApiLogo,
  IptvOrgApiStream,
  IptvPlaylistParseResult,
  IptvPlaylistSourceId,
  LiveEpgProgramme,
  LivePlaybackStatus,
  LiveRightsStatus,
  LiveSourceCheckRecord,
  LiveSourceRecord,
  LiveStreamFormat,
  NormalizedLiveChannel,
} from '../types/movie';
import { getSupabaseCredentials } from './supabaseClient';
import { sanitizeSafeUrl, stripHtmlAndScriptContent } from '../utils/securityValidator';

// =============================================================================
// STAGE 2: API + M3U DISCOVERY ENDPOINTS & PRESETS
// =============================================================================

// iptv-org API Endpoints (https://iptv-org.github.io/api)
export const IPTV_ORG_API_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
export const IPTV_ORG_API_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
export const IPTV_ORG_API_LOGOS_URL = 'https://iptv-org.github.io/api/logos.json';
export const IPTV_ORG_API_GUIDES_URL = 'https://iptv-org.github.io/api/guides.json';
export const IPTV_ORG_API_CATEGORIES_URL = 'https://iptv-org.github.io/api/categories.json';

// Candidate M3U Discovery & Regional Playlist Sources
export const IPTV_PAKISTAN_PLAYLIST_URL =
  'https://iptv-org.github.io/iptv/countries/pk.m3u';
export const IPTV_INDIA_PLAYLIST_URL =
  'https://diljankhehra-cpu.github.io/IPTV/in.m3u';
export const IPTV_INDIA_ORG_FALLBACK_URL =
  'https://iptv-org.github.io/iptv/countries/in.m3u';
export const IPTV_SPORTS_PLAYLIST_URL =
  'https://iptv-org.github.io/iptv/categories/sports.m3u';
export const IPTV_NEWS_PLAYLIST_URL =
  'https://iptv-org.github.io/iptv/categories/news.m3u';
export const IPTV_MOVIES_PLAYLIST_URL =
  'https://iptv-org.github.io/iptv/categories/movies.m3u';
export const IPTV_ENTERTAINMENT_PLAYLIST_URL =
  'https://iptv-org.github.io/iptv/categories/entertainment.m3u';
export const IPTV_ALL_CHANNELS_PLAYLIST_URL =
  'https://iptv-org.github.io/iptv/index.m3u';
export const IPTV_FREETV_PLAYLIST_URL =
  'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8';

// Unapproved third-party candidate preserved ONLY for admin inspection (never public default)
export const IPTV_NEXONIC_UNAPPROVED_CANDIDATE_URL =
  'https://raw.githubusercontent.com/Shahrukhalid/nexonic-iptv/main/playlists/verified.m3u';
export const IPTV_NEXONIC_UNAPPROVED_MIRROR_URL =
  'https://shahrukhalid.github.io/nexonic-iptv/playlists/verified.m3u';
export const IPTV_NEXONIC_UNAPPROVED_ROOT_URL =
  'https://raw.githubusercontent.com/Shahrukhalid/nexonic-iptv/main/verified.m3u';

/** @deprecated Legacy alias kept only for backward compatibility with existing helpers/tests */
export const IPTV_NEXONIC_VERIFIED_PLAYLIST_URL = IPTV_NEXONIC_UNAPPROVED_CANDIDATE_URL;
/** @deprecated Legacy alias */
export const IPTV_NEXONIC_VERIFIED_MIRROR_URL = IPTV_NEXONIC_UNAPPROVED_MIRROR_URL;
/** @deprecated Legacy alias */
export const IPTV_NEXONIC_VERIFIED_ROOT_URL = IPTV_NEXONIC_UNAPPROVED_ROOT_URL;

export const DEFAULT_LIVE_TV_PROXY_URL =
  'https://myeammfiwahmmemkoqif.supabase.co/functions/v1/live-tv-proxy';
export const DEFAULT_LIVE_CATALOG_URL =
  'https://myeammfiwahmmemkoqif.supabase.co/functions/v1/live-catalog';

// Honest, Non-Misleading Playback Error Messages
export const IPTV_BROWSER_BLOCKED_ERROR_MESSAGE =
  'This stream is blocked by browser CORS or mixed-content rules. Try playing in the Android APK or select another approved source.';
export const IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE =
  'Channel stream is currently offline or unreachable.';
export const IPTV_GEO_BLOCKED_ERROR_MESSAGE =
  'Channel is geo-restricted in your region by the broadcaster.';
export const IPTV_TIMEOUT_ERROR_MESSAGE =
  'Connection to stream timed out. Please retry or choose another channel.';
export const IPTV_INVALID_MANIFEST_ERROR_MESSAGE =
  'Stream playlist or manifest is invalid or corrupted.';
export const IPTV_UNSUPPORTED_FORMAT_ERROR_MESSAGE =
  'This stream format is not supported by the current player.';
export const IPTV_PROXY_DISALLOWED_ERROR_MESSAGE =
  'Browser proxy playback is disabled for this source because it is not on the approved allowlist.';
export const IPTV_PAKISTAN_GEO_NOTICE =
  'Note: Broadcaster regional rights may restrict playback outside Pakistan.';

export const MAX_IPTV_CHANNELS = 6000;
export const IPTV_FETCH_TIMEOUT_MS = 15_000;
export const IPTV_CACHE_TTL_MS = 15 * 60 * 1000;
export const EPG_CACHE_TTL_MS = 30 * 60 * 1000;
export const API_METADATA_CACHE_TTL_MS = 30 * 60 * 1000;

export interface IptvPlaylistFetchResult extends IptvPlaylistParseResult {
  sourceUrl: string;
  fromCache: boolean;
  fetchedAt: number;
}

interface CachedIptvPlaylistEntry {
  result: IptvPlaylistFetchResult;
  expiresAt: number;
}

const playlistCache = new Map<string, CachedIptvPlaylistEntry>();
const epgCache = new Map<string, { programmes: LiveEpgProgramme[]; expiresAt: number }>();
let cachedApiMetadata: {
  data: IptvOrgMetadataBundle;
  expiresAt: number;
} | null = null;

const PRIORITY_CATEGORY_ORDER = [
  'Pakistan',
  'India',
  'Sports',
  'News',
  'Movies',
  'Entertainment',
  'Series',
  'Music',
  'Kids',
  'Documentary',
  'General',
];

// =============================================================================
// STABLE IDS, FORMAT DETECTION & SECURITY GUARDS
// =============================================================================

function fnv1aHashHex(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generates a deterministic, stable channel ID from reliable identifiers (`tvgId`, API ID, or canonical name+country).
 * Never uses array index positions so favorites, watch history, and EPG schedules stay consistent.
 */
export function generateStableChannelId(params: {
  tvgId?: string | null;
  apiChannelId?: string | null;
  name: string;
  country?: string | null;
  streamUrl?: string | null;
}): string {
  const apiId = stripHtmlAndScriptContent(params.apiChannelId || '', 96)
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .trim();
  if (apiId) return apiId;

  const tvgId = stripHtmlAndScriptContent(params.tvgId || '', 96)
    .replace(/[^a-zA-Z0-9._@-]/g, '')
    .trim();
  if (tvgId) return tvgId;

  const cleanSlug = (params.name || 'channel')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  const countryCode = (params.country || 'intl').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'INTL';
  const digest = fnv1aHashHex(
    `${(params.name || '').trim().toLowerCase()}::${countryCode}::${params.streamUrl || ''}`
  );
  return `ch-${cleanSlug || 'live'}-${countryCode.toLowerCase()}-${digest}`;
}

export function generateStableSourceId(channelId: string, streamUrl: string): string {
  return `src-${fnv1aHashHex(`${channelId}::${streamUrl.trim()}`)}`;
}

export function detectStreamFormatFromUrl(
  url: string | null | undefined,
  contentType?: string | null
): LiveStreamFormat {
  const lowerUrl = (url || '').toLowerCase();
  const lowerCt = (contentType || '').toLowerCase();

  if (
    lowerUrl.includes('.mpd') ||
    lowerCt.includes('application/dash+xml')
  ) {
    return 'dash';
  }
  if (
    lowerUrl.includes('.m3u8') ||
    lowerUrl.includes('/hls/') ||
    lowerCt.includes('mpegurl') ||
    lowerCt.includes('x-mpegurl')
  ) {
    return 'hls';
  }
  return 'unknown';
}

export function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const host = (hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.endsWith('.arpa') ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('ff') // IPv6 multicast
  ) {
    return true;
  }

  // Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
  const v4Candidate = host.startsWith('::ffff:') ? host.slice(7) : host;

  const ipv4Match = v4Candidate.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 127 || a === 10 || a === 0) return true; // Loopback / Private / "this" net
    if (a === 169 && b === 254) return true; // Link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // Private RFC1918
    if (a === 192 && b === 168) return true; // Private RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC6598
    if (a >= 224) return true; // Multicast (224-239) & Reserved (240-255)
  }

  return false;
}

export function resolveIptvPlaylistUrl(
  sourceIdOrUrl: IptvPlaylistSourceId | string
): string | null {
  if (sourceIdOrUrl === 'pakistan') return IPTV_PAKISTAN_PLAYLIST_URL;
  if (sourceIdOrUrl === 'india') return IPTV_INDIA_PLAYLIST_URL;
  if (sourceIdOrUrl === 'sports') return IPTV_SPORTS_PLAYLIST_URL;
  if (sourceIdOrUrl === 'news') return IPTV_NEWS_PLAYLIST_URL;
  if (sourceIdOrUrl === 'movies') return IPTV_MOVIES_PLAYLIST_URL;
  if (sourceIdOrUrl === 'entertainment') return IPTV_ENTERTAINMENT_PLAYLIST_URL;
  if (sourceIdOrUrl === 'freetv') return IPTV_FREETV_PLAYLIST_URL;
  if (sourceIdOrUrl === 'all') return IPTV_ALL_CHANNELS_PLAYLIST_URL;
  if (sourceIdOrUrl === 'nexonic_unapproved_candidate' || sourceIdOrUrl === 'verified') {
    return IPTV_NEXONIC_UNAPPROVED_CANDIDATE_URL;
  }
  return sanitizeSafeUrl(sourceIdOrUrl);
}

export function resolveIptvPlaylistCandidates(
  sourceIdOrUrl: IptvPlaylistSourceId | string
): string[] {
  if (sourceIdOrUrl === 'india') {
    return [IPTV_INDIA_PLAYLIST_URL, IPTV_INDIA_ORG_FALLBACK_URL];
  }
  if (sourceIdOrUrl === 'nexonic_unapproved_candidate' || sourceIdOrUrl === 'verified') {
    return [
      IPTV_NEXONIC_UNAPPROVED_CANDIDATE_URL,
      IPTV_NEXONIC_UNAPPROVED_MIRROR_URL,
      IPTV_NEXONIC_UNAPPROVED_ROOT_URL,
    ];
  }
  const single = resolveIptvPlaylistUrl(sourceIdOrUrl);
  return single ? [single] : [];
}

export function clearIptvPlaylistCache(): void {
  playlistCache.clear();
  epgCache.clear();
  cachedApiMetadata = null;
}

// =============================================================================
// M3U PARSER (PRESERVED & ENHANCED WITH RELATIVE URLS + STABLE CHANNEL IDS)
// =============================================================================

function splitExtinfHeaderAndTitle(extinfLine: string): {
  header: string;
  trailingTitle: string;
} {
  const withoutPrefix = extinfLine.replace(/^#EXTINF\s*:/i, '');
  let activeQuote: '"' | "'" | null = null;

  for (let i = 0; i < withoutPrefix.length; i++) {
    const ch = withoutPrefix[i];
    if (ch === '"' || ch === "'") {
      if (activeQuote === null) {
        activeQuote = ch;
      } else if (activeQuote === ch) {
        activeQuote = null;
      }
      continue;
    }

    if (ch === ',' && activeQuote === null) {
      return {
        header: withoutPrefix.slice(0, i),
        trailingTitle: withoutPrefix.slice(i + 1).trim(),
      };
    }
  }

  return {
    header: withoutPrefix,
    trailingTitle: '',
  };
}

export interface ParsedExtinfMetadata {
  tvgId: string;
  tvgName: string;
  name: string;
  logoUrl: string | null;
  groupTitle: string;
  categories: string[];
  tvgCountry?: string;
  tvgLanguage?: string;
}

/**
 * Sanitizes channel logo URLs and unwraps 403-prone image fetch wrappers (e.g. videoready.tv)
 * to their direct public CDN URL while blocking private/loopback hostnames.
 */
export function normalizeChannelLogoUrl(rawUrl: string | null | undefined): string | null {
  const safe = sanitizeSafeUrl(rawUrl);
  if (!safe) return null;

  try {
    const parsed = new URL(safe);
    if (isPrivateOrLoopbackHostname(parsed.hostname)) return null;

    if (
      parsed.hostname.toLowerCase().endsWith('videoready.tv') &&
      parsed.pathname.includes('/image/fetch/')
    ) {
      const embeddedMatch = safe.match(/\/image\/fetch\/[^/]+\/(https?:\/\/.+)$/i);
      if (embeddedMatch?.[1]) {
        const innerSafe = sanitizeSafeUrl(embeddedMatch[1]);
        if (innerSafe) {
          const innerHost = new URL(innerSafe).hostname;
          if (!isPrivateOrLoopbackHostname(innerHost)) {
            return innerSafe;
          }
        }
        return null;
      }
    }
    return safe;
  } catch {
    return null;
  }
}

/**
 * Parses a single `#EXTINF:` metadata line cleanly, sanitizing all text and URL fields against XSS.
 */
export function parseM3uExtinfLine(extinfLine: string): ParsedExtinfMetadata {
  const { header, trailingTitle } = splitExtinfHeaderAndTitle(extinfLine);
  const attrs: Record<string, string> = {};

  const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]*))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(header)) !== null) {
    const key = match[1].toLowerCase();
    const rawVal = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = rawVal;
  }

  const cleanTvgName = stripHtmlAndScriptContent(attrs['tvg-name'] || '', 120);
  const cleanTrailing = stripHtmlAndScriptContent(trailingTitle || '', 120);
  const cleanTvgId = stripHtmlAndScriptContent(attrs['tvg-id'] || '', 100);

  const resolvedName = cleanTvgName || cleanTrailing || 'Live Channel';
  const resolvedTvgName = cleanTvgName || cleanTrailing || resolvedName;

  const rawGroup = attrs['group-title'] || '';
  const seenCats = new Set<string>();
  const categories: string[] = [];

  for (const piece of rawGroup.split(/[;|]/)) {
    const cleanCat = stripHtmlAndScriptContent(piece, 48);
    if (!cleanCat) continue;
    const normalizedKey = cleanCat.toLowerCase();
    if (!seenCats.has(normalizedKey)) {
      seenCats.add(normalizedKey);
      categories.push(cleanCat);
    }
  }

  if (categories.length === 0) {
    categories.push('General');
  }

  const logoUrl = normalizeChannelLogoUrl(attrs['tvg-logo'] || null);
  const tvgCountry = stripHtmlAndScriptContent(attrs['tvg-country'] || '', 12).toUpperCase();
  const tvgLanguage = stripHtmlAndScriptContent(attrs['tvg-language'] || '', 24);

  return {
    tvgId: cleanTvgId,
    tvgName: resolvedTvgName,
    name: resolvedName,
    logoUrl,
    groupTitle: categories[0],
    categories,
    ...(tvgCountry ? { tvgCountry } : {}),
    ...(tvgLanguage ? { tvgLanguage } : {}),
  };
}

export function extractIptvCategories(
  channels: Pick<IptvChannel, 'categories' | 'groupTitle'>[]
): IptvCategorySummary[] {
  const counts = new Map<string, { name: string; count: number }>();

  for (const channel of channels) {
    const cats =
      Array.isArray(channel.categories) && channel.categories.length > 0
        ? channel.categories
        : [channel.groupTitle || 'General'];

    for (const cat of cats) {
      const clean = stripHtmlAndScriptContent(cat, 48) || 'General';
      const key = clean.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { name: clean, count: 1 });
      }
    }
  }

  return Array.from(counts.values()).sort((a, b) => {
    const idxA = PRIORITY_CATEGORY_ORDER.findIndex(
      (p) => p.toLowerCase() === a.name.toLowerCase()
    );
    const idxB = PRIORITY_CATEGORY_ORDER.findIndex(
      (p) => p.toLowerCase() === b.name.toLowerCase()
    );

    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
}

export interface ParseM3uPlaylistOptions {
  maxChannels?: number;
  baseUrl?: string;
  defaultCountry?: string;
  defaultLanguage?: string;
  provider?: string;
  defaultRightsStatus?: LiveRightsStatus;
}

function resolveCandidateStreamUrl(
  rawStreamLine: string | null,
  baseUrl?: string
): string | null {
  if (!rawStreamLine || typeof rawStreamLine !== 'string') return null;
  const trimmed = rawStreamLine.trim();
  if (!trimmed) return null;

  // Explicitly block dangerous schemes BEFORE baseUrl resolution
  if (/^(javascript|data|vbscript|file|blob|ftp):/i.test(trimmed)) {
    return null;
  }

  const directSafe = sanitizeSafeUrl(trimmed);
  if (directSafe) return directSafe;

  // Support relative URLs when a valid http/https playlist baseUrl is supplied
  if (baseUrl) {
    const safeBase = sanitizeSafeUrl(baseUrl);
    if (safeBase) {
      try {
        const resolved = new URL(trimmed, safeBase);
        return sanitizeSafeUrl(resolved.toString());
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Parses an M3U playlist string into sanitized IptvChannel items with stable IDs and category summaries.
 */
export function parseM3uPlaylist(
  rawText: string,
  optionsOrMaxChannels: number | ParseM3uPlaylistOptions = MAX_IPTV_CHANNELS
): IptvPlaylistParseResult {
  if (!rawText || typeof rawText !== 'string') {
    return { channels: [], categories: [], rejectedCount: 0 };
  }

  const opts: ParseM3uPlaylistOptions =
    typeof optionsOrMaxChannels === 'number'
      ? { maxChannels: optionsOrMaxChannels }
      : optionsOrMaxChannels;
  const maxChannels = opts.maxChannels ?? MAX_IPTV_CHANNELS;

  const lines = rawText.split(/\r?\n/);
  const channels: IptvChannel[] = [];
  const seenKeys = new Set<string>();
  const seenChannelIds = new Set<string>();
  let rejectedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (channels.length >= maxChannels) break;

    const line = lines[i]?.trim();
    if (!line || line.length > 4096) continue;
    if (!line.toUpperCase().startsWith('#EXTINF:')) continue;

    let streamLine: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j]?.trim();
      if (!candidate) continue;
      if (candidate.toUpperCase().startsWith('#EXTINF:')) {
        break;
      }
      if (candidate.startsWith('#')) {
        continue;
      }
      if (candidate.length <= 2048) {
        streamLine = candidate;
      }
      i = j;
      break;
    }

    const safeStreamUrl = resolveCandidateStreamUrl(streamLine, opts.baseUrl);
    if (!safeStreamUrl) {
      rejectedCount += 1;
      continue;
    }

    const meta = parseM3uExtinfLine(line);
    const dedupeKey = `${meta.name.toLowerCase()}::${safeStreamUrl}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const resolvedCountry = meta.tvgCountry || opts.defaultCountry || 'INTL';
    const resolvedLanguage = meta.tvgLanguage || opts.defaultLanguage || 'und';
    let stableId = generateStableChannelId({
      tvgId: meta.tvgId,
      name: meta.name,
      country: resolvedCountry,
      streamUrl: safeStreamUrl,
    });
    if (seenChannelIds.has(stableId)) {
      stableId = `${stableId}::${fnv1aHashHex(safeStreamUrl)}`;
    }
    seenChannelIds.add(stableId);

    channels.push({
      id: stableId,
      name: meta.name,
      tvgName: meta.tvgName,
      tvgId: meta.tvgId,
      logoUrl: meta.logoUrl,
      groupTitle: meta.groupTitle,
      categories: meta.categories,
      streamUrl: safeStreamUrl,
      isHttpInsecure: safeStreamUrl.toLowerCase().startsWith('http://'),
      country: resolvedCountry,
      language: resolvedLanguage,
      format: detectStreamFormatFromUrl(safeStreamUrl),
      provider: opts.provider || 'm3u',
      rightsStatus: opts.defaultRightsStatus || 'pending',
      playbackStatus: 'not_tested_from_pk',
      lastCheckedAt: null,
      pkTested: false,
      allowBrowserProxy: false,
      sourceId: generateStableSourceId(stableId, safeStreamUrl),
    });
  }

  return {
    channels,
    categories: extractIptvCategories(channels),
    rejectedCount,
  };
}

const NEXONIC_SPORTS_KEYWORD_REGEX =
  /\b(sports?|esports?|cricket|football|soccer|tennis|golf|racing|motorsport|formula\s*1|f1|nba|nfl|nhl|mlb|ufc|mma|wwe|boxing|fight|dazn|espn|beinsports?|bein|supersport|tensports|ptvsports|asports|starsports|skysports|foxsports|cbssports|nbcsports|olympic|athletic|outdoor|rally|red\s*bull|redbull|pga|atp|wta|fifa|uefa|snooker|billiard|speedway|extreme)\b/i;

/**
 * Utility keyword filter (used only for manual client-side filtering; sports source fetches iptv-org sports.m3u directly).
 */
export function filterNexonicSportsChannels(channels: IptvChannel[]): IptvChannel[] {
  return channels.filter((ch) => {
    const searchableMeta = `${ch.name} ${ch.tvgName} ${ch.tvgId} ${ch.groupTitle} ${ch.categories.join(' ')}`;
    return NEXONIC_SPORTS_KEYWORD_REGEX.test(searchableMeta);
  });
}

export function filterIptvChannels(
  channels: IptvChannel[],
  options: {
    query?: string;
    category?: string;
    country?: string;
    language?: string;
    favoriteIds?: Set<string>;
    favoritesOnly?: boolean;
  } = {}
): IptvChannel[] {
  const cleanQuery = stripHtmlAndScriptContent(options.query || '', 80).toLowerCase();
  const targetCategory = (options.category || 'All').trim().toLowerCase();
  const filterByCat = Boolean(targetCategory && targetCategory !== 'all');
  const targetCountry = (options.country || 'ALL').trim().toUpperCase();
  const filterByCountry = Boolean(targetCountry && targetCountry !== 'ALL');
  const targetLang = (options.language || 'all').trim().toLowerCase();
  const filterByLang = Boolean(targetLang && targetLang !== 'all');
  const favoritesOnly = Boolean(options.favoritesOnly);

  return channels.filter((ch) => {
    if (favoritesOnly && options.favoriteIds && !options.favoriteIds.has(ch.id)) {
      return false;
    }

    if (filterByCountry) {
      const chCountry = (ch.country || '').toUpperCase();
      if (chCountry !== targetCountry) return false;
    }

    if (filterByLang) {
      const chLang = (ch.language || '').toLowerCase();
      if (chLang !== targetLang && !chLang.includes(targetLang)) return false;
    }

    if (filterByCat) {
      const catMatch =
        ch.groupTitle.toLowerCase() === targetCategory ||
        ch.categories.some((c) => c.toLowerCase() === targetCategory);
      if (!catMatch) return false;
    }

    if (cleanQuery) {
      const haystack = `${ch.name} ${ch.tvgName} ${ch.categories.join(' ')} ${ch.country || ''}`.toLowerCase();
      if (!haystack.includes(cleanQuery)) return false;
    }

    return true;
  });
}

// =============================================================================
// STAGE 2: IPTV-ORG API INGESTION & NORMALIZED MERGING
// =============================================================================

export interface IptvOrgMetadataBundle {
  channels: IptvOrgApiChannel[];
  streams: IptvOrgApiStream[];
  logos: IptvOrgApiLogo[];
  guides: IptvOrgApiGuide[];
  categories: IptvOrgApiCategory[];
  fetchedAt: number;
  partialErrors: string[];
}

function titleCaseCategoryName(raw: string): string {
  const clean = stripHtmlAndScriptContent(raw, 48);
  if (!clean) return 'General';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Infers accurate Live TV categories (Sports, News, Movies, Kids, Music, Documentary, Entertainment)
 * when an M3U feed (e.g., diljankhehra-cpu Indian playlist) omits `group-title` attributes.
 */
export function inferLiveChannelCategories(
  name: string,
  tvgId?: string | null,
  existingCategories: string[] = []
): string[] {
  const nonGeneral = existingCategories
    .map((c) => titleCaseCategoryName(c))
    .filter((c) => c.toLowerCase() !== 'general');
  if (nonGeneral.length > 0) return nonGeneral;

  const haystack = `${name || ''} ${tvgId || ''}`.toLowerCase();
  const inferred: string[] = [];

  if (
    /\b(sports?|cricket|football|soccer|tennis|golf|racing|f1|wwe|fight|espn|starsports|star\s*sports|sonysports|sony\s*sports|tensports|ten\s*sports|ptvsports|ptv\s*sports|asports|a\s*sports|supersport|eurosport|dd\s*sports|ipl|t20)\b/i.test(
      haystack
    )
  ) {
    inferred.push('Sports');
  }
  if (
    /\b(news|aaj\s*tak|abp|ndtv|cnn|bbc|wion|republic|times\s*now|tv9|cnbc|zee\s*news|news18|india\s*today|geo\s*news|ary\s*news|samaa|dunya|dawn|92\s*news|express\s*news|hum\s*news|aljazeera|al\s*jazeera|dw|euronews|dd\s*news)\b/i.test(
      haystack
    )
  ) {
    inferred.push('News');
  }
  if (
    /\b(movies?|cinema|cineplex|sony\s*max|sonymax|star\s*gold|stargold|zee\s*cinema|zeecinema|b4u\s*movies|utv\s*movies|filmy|pictures|&pictures|and\s*pictures|hbo|bollywood|hollywood|action)\b/i.test(
      haystack
    )
  ) {
    inferred.push('Movies');
  }
  if (
    /\b(nick|nickelodeon|disney|pogo|cartoon|sonic|hungama|discovery\s*kids|sony\s*yay|chintu|kids|baby|anime|toon)\b/i.test(
      haystack
    )
  ) {
    inferred.push('Kids');
  }
  if (
    /\b(music|mtv|9xm|9x\s*jalwa|mastiii|masti|zing|b4u\s*music|vh1|sangeet|beats|songs|fm)\b/i.test(
      haystack
    )
  ) {
    inferred.push('Music');
  }
  if (
    /\b(discovery|nat\s*geo|national\s*geographic|animal\s*planet|history|science|nasa|tlc|travel|documentary|epic|fyi)\b/i.test(
      haystack
    )
  ) {
    inferred.push('Documentary');
  }
  if (
    inferred.length === 0 &&
    /\b(sony|zee|star|colors|sab|&tv|and\s*tv|ptc|dangal|shemaroo|hum|ary|geo|ptv|tv|entertainment|drama|comedy|hd)\b/i.test(
      haystack
    )
  ) {
    inferred.push('Entertainment');
  }

  return inferred.length > 0 ? inferred : ['General'];
}

async function fetchJsonSafe<T>(
  url: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal
): Promise<T[]> {
  const internalCtrl = new AbortController();
  const timeoutId = setTimeout(() => internalCtrl.abort(), IPTV_FETCH_TIMEOUT_MS);
  const onAbort = () => internalCtrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      signal: internalCtrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    return Array.isArray(json) ? (json as T[]) : [];
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Fetches iptv-org public APIs (`channels.json`, `streams.json`, `logos.json`, `guides.json`, `categories.json`)
 * gracefully handling individual endpoint failures without crashing the catalogue.
 */
export async function fetchIptvOrgApiMetadata(options: {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  forceRefresh?: boolean;
  nowMs?: number;
  includeStreams?: boolean;
  includeLogos?: boolean;
} = {}): Promise<IptvOrgMetadataBundle> {
  const now = options.nowMs ?? Date.now();
  const shouldFetchLogos = options.includeLogos === true;
  if (
    !options.forceRefresh &&
    cachedApiMetadata &&
    cachedApiMetadata.expiresAt > now &&
    (options.includeStreams === false || cachedApiMetadata.data.streams.length > 0) &&
    (!shouldFetchLogos || cachedApiMetadata.data.logos.length > 0)
  ) {
    return cachedApiMetadata.data;
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const partialErrors: string[] = [];

  const [channelsRes, streamsRes, logosRes, guidesRes, categoriesRes] = await Promise.allSettled([
    fetchJsonSafe<IptvOrgApiChannel>(IPTV_ORG_API_CHANNELS_URL, fetchFn, options.signal),
    options.includeStreams === false
      ? Promise.resolve([] as IptvOrgApiStream[])
      : fetchJsonSafe<IptvOrgApiStream>(IPTV_ORG_API_STREAMS_URL, fetchFn, options.signal),
    shouldFetchLogos
      ? fetchJsonSafe<IptvOrgApiLogo>(IPTV_ORG_API_LOGOS_URL, fetchFn, options.signal)
      : Promise.resolve([] as IptvOrgApiLogo[]),
    fetchJsonSafe<IptvOrgApiGuide>(IPTV_ORG_API_GUIDES_URL, fetchFn, options.signal),
    fetchJsonSafe<IptvOrgApiCategory>(IPTV_ORG_API_CATEGORIES_URL, fetchFn, options.signal),
  ]);

  const channels =
    channelsRes.status === 'fulfilled'
      ? channelsRes.value
      : (partialErrors.push(`channels.json: ${channelsRes.reason?.message || 'failed'}`), []);
  const streams =
    streamsRes.status === 'fulfilled'
      ? streamsRes.value
      : (partialErrors.push(`streams.json: ${streamsRes.reason?.message || 'failed'}`), []);
  const logos =
    logosRes.status === 'fulfilled'
      ? logosRes.value
      : (partialErrors.push(`logos.json: ${logosRes.reason?.message || 'failed'}`), []);
  const guides =
    guidesRes.status === 'fulfilled'
      ? guidesRes.value
      : (partialErrors.push(`guides.json: ${guidesRes.reason?.message || 'failed'}`), []);
  const categories =
    categoriesRes.status === 'fulfilled'
      ? categoriesRes.value
      : (partialErrors.push(`categories.json: ${categoriesRes.reason?.message || 'failed'}`), []);

  const bundle: IptvOrgMetadataBundle = {
    channels,
    streams,
    logos,
    guides,
    categories,
    fetchedAt: now,
    partialErrors,
  };

  if (channels.length > 0 || categories.length > 0) {
    cachedApiMetadata = {
      data: bundle,
      expiresAt: now + API_METADATA_CACHE_TTL_MS,
    };
  }

  return bundle;
}

/**
 * Builds deduplicated, playable IptvChannel items directly from the iptv-org API bundle
 * (channels + streams + logos + guides + categories), prioritizing HTTPS streams first.
 */
export function buildChannelsFromIptvOrgApi(
  bundle: Pick<IptvOrgMetadataBundle, 'channels' | 'streams' | 'logos' | 'guides' | 'categories'>,
  options: { maxChannels?: number; countryFilter?: string } = {}
): IptvPlaylistParseResult {
  const maxChannels = options.maxChannels ?? 12_000;
  const targetCountry = (options.countryFilter || '').trim().toUpperCase();

  const categoryNameById = new Map<string, string>();
  for (const cat of bundle.categories || []) {
    if (cat?.id && cat?.name) {
      categoryNameById.set(cat.id.toLowerCase(), stripHtmlAndScriptContent(cat.name, 48));
    }
  }

  const logoByChannel = new Map<string, string>();
  for (const logo of bundle.logos || []) {
    if (!logo?.channel || !logo?.url) continue;
    if (logo.in_use === false) continue;
    const key = logo.channel.toLowerCase();
    if (logoByChannel.has(key)) continue;
    const safeLogo = sanitizeSafeUrl(logo.url);
    if (safeLogo) {
      logoByChannel.set(key, safeLogo);
    }
  }

  const langByChannel = new Map<string, string>();
  for (const g of bundle.guides || []) {
    if (g?.channel && g?.lang && !langByChannel.has(g.channel.toLowerCase())) {
      langByChannel.set(g.channel.toLowerCase(), stripHtmlAndScriptContent(g.lang, 24));
    }
  }

  const channelMetaById = new Map<string, IptvOrgApiChannel>();
  const channelIdByLowerName = new Map<string, string>();
  const blockedChannelIds = new Set<string>();
  for (const ch of bundle.channels || []) {
    if (!ch?.id || !ch?.name) continue;
    if (ch.closed || ch.is_nsfw) {
      blockedChannelIds.add(ch.id.toLowerCase());
      continue;
    }
    channelMetaById.set(ch.id.toLowerCase(), ch);
    const cleanNameKey = ch.name.trim().toLowerCase();
    if (cleanNameKey && !channelIdByLowerName.has(cleanNameKey)) {
      channelIdByLowerName.set(cleanNameKey, ch.id.toLowerCase());
    }
  }

  const groupedStreams = new Map<string, { meta: IptvOrgApiChannel | null; title: string; streams: { url: string; quality?: string | null }[] }>();
  const seenUrls = new Set<string>();
  let rejectedCount = 0;

  for (const st of bundle.streams || []) {
    if (!st?.url) continue;
    const rawChannelId = st.channel ? st.channel.toLowerCase() : '';
    if (rawChannelId && blockedChannelIds.has(rawChannelId)) continue;

    const safeUrl = sanitizeSafeUrl(st.url);
    if (!safeUrl) {
      rejectedCount += 1;
      continue;
    }

    let hostname = '';
    try {
      hostname = new URL(safeUrl).hostname.toLowerCase();
    } catch {
      rejectedCount += 1;
      continue;
    }
    if (isPrivateOrLoopbackHostname(hostname)) {
      rejectedCount += 1;
      continue;
    }

    const chIdKey =
      rawChannelId ||
      (st.title ? channelIdByLowerName.get(st.title.trim().toLowerCase()) || '' : '');
    if (chIdKey && blockedChannelIds.has(chIdKey)) continue;
    const meta = chIdKey ? channelMetaById.get(chIdKey) || null : null;
    if (meta && (meta.closed || meta.is_nsfw)) continue;

    if (targetCountry && targetCountry !== 'ALL') {
      const chCountry = (meta?.country || '').toUpperCase();
      if (chCountry !== targetCountry) continue;
    }

    const groupKey = meta ? meta.id.toLowerCase() : `stream::${(st.title || safeUrl).trim().toLowerCase()}`;
    const dedupeStreamKey = `${groupKey}::${safeUrl}`;
    if (seenUrls.has(dedupeStreamKey)) continue;
    seenUrls.add(dedupeStreamKey);

    const existing = groupedStreams.get(groupKey);
    if (existing) {
      existing.streams.push({ url: safeUrl, quality: st.quality });
    } else {
      const displayName = stripHtmlAndScriptContent(meta?.name || st.title || 'Live Channel', 120);
      if (!displayName) continue;
      groupedStreams.set(groupKey, {
        meta,
        title: displayName,
        streams: [{ url: safeUrl, quality: st.quality }],
      });
    }
  }

  const builtChannels: IptvChannel[] = [];
  for (const entry of groupedStreams.values()) {
    const meta = entry.meta;
    // Prefer HTTPS streams first so browser playback works reliably
    const sortedStreams = [...entry.streams].sort((a, b) => {
      const aHttps = a.url.toLowerCase().startsWith('https://') ? 0 : 1;
      const bHttps = b.url.toLowerCase().startsWith('https://') ? 0 : 1;
      if (aHttps !== bHttps) return aHttps - bHttps;
      const aHls = detectStreamFormatFromUrl(a.url) === 'hls' ? 0 : 1;
      const bHls = detectStreamFormatFromUrl(b.url) === 'hls' ? 0 : 1;
      return aHls - bHls;
    });

    const primary = sortedStreams[0];
    if (!primary) continue;

    const country = (meta?.country || 'INTL').toUpperCase();
    const stableId = generateStableChannelId({
      apiChannelId: meta?.id || null,
      name: entry.title,
      country,
      streamUrl: primary.url,
    });

    const rawCats = Array.isArray(meta?.categories) && meta!.categories.length > 0
      ? meta!.categories.map((c) => categoryNameById.get(c.toLowerCase()) || titleCaseCategoryName(c))
      : inferLiveChannelCategories(entry.title, meta?.id || stableId);

    const categories = Array.from(new Set(rawCats.filter(Boolean)));
    if (categories.length === 0) categories.push('General');

    const language = (meta?.id && langByChannel.get(meta.id.toLowerCase())) || 'und';
    const logoUrl = (meta?.id && logoByChannel.get(meta.id.toLowerCase())) || null;

    const alternateSources: LiveSourceRecord[] = sortedStreams.map((s, idx) => {
      let domain = '';
      try {
        domain = new URL(s.url).hostname.toLowerCase();
      } catch {
        domain = '';
      }
      return {
        id: generateStableSourceId(stableId, s.url),
        channelId: stableId,
        provider: 'iptv-org-api',
        sourceUrl: s.url,
        allowedDomain: domain,
        format: detectStreamFormatFromUrl(s.url),
        country,
        language,
        rightsStatus: 'approved',
        availableCountries: ['GLOBAL'],
        permissionEvidence: null,
        allowBrowserProxy: false,
        reviewedAt: null,
        lastCheckedAt: null,
        playbackStatus: 'not_tested_from_pk',
        isEnabled: true,
        priority: 10 + idx,
      };
    });

    builtChannels.push({
      id: stableId,
      name: entry.title,
      tvgName: entry.title,
      tvgId: meta?.id || stableId,
      logoUrl,
      groupTitle: categories[0],
      categories,
      streamUrl: primary.url,
      isHttpInsecure: primary.url.toLowerCase().startsWith('http://'),
      country,
      language,
      format: detectStreamFormatFromUrl(primary.url),
      provider: 'iptv-org-api',
      alternateSources,
    });
  }

  // Sort channels cleanly: HTTPS first, PK/IN/US/GB/INTL boosted, channels with logos boosted, then alphabetical
  const countryRank = (c?: string): number => {
    const code = (c || '').toUpperCase();
    if (code === 'PK') return 0;
    if (code === 'IN') return 1;
    if (code === 'US' || code === 'GB' || code === 'UK' || code === 'AE' || code === 'INTL') return 2;
    return 3;
  };

  builtChannels.sort((a, b) => {
    if (a.isHttpInsecure !== b.isHttpInsecure) return a.isHttpInsecure ? 1 : -1;
    const rankDiff = countryRank(a.country) - countryRank(b.country);
    if (rankDiff !== 0) return rankDiff;
    const aHasLogo = a.logoUrl ? 0 : 1;
    const bHasLogo = b.logoUrl ? 0 : 1;
    if (aHasLogo !== bHasLogo) return aHasLogo - bHasLogo;
    return a.name.localeCompare(b.name);
  });

  const sliced = builtChannels.slice(0, maxChannels);
  return {
    channels: sliced,
    categories: extractIptvCategories(sliced),
    rejectedCount,
  };
}

/**
 * Fetches and builds the complete Live TV catalogue directly from https://iptv-org.github.io/api
 * (with 30-minute memory caching).
 */
export async function fetchIptvOrgApiCatalog(options: {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  forceRefresh?: boolean;
  nowMs?: number;
  countryFilter?: string;
  maxChannels?: number;
} = {}): Promise<IptvPlaylistFetchResult> {
  const now = options.nowMs ?? Date.now();
  const hadCacheBefore = Boolean(!options.forceRefresh && cachedApiMetadata && cachedApiMetadata.expiresAt > now);

  const bundle = await fetchIptvOrgApiMetadata({
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    forceRefresh: options.forceRefresh,
    nowMs: now,
    includeStreams: true,
    includeLogos: true,
  });

  if (bundle.channels.length === 0 || bundle.streams.length === 0) {
    throw new Error('Unable to load iptv-org API channels right now. Please try again.');
  }

  const built = buildChannelsFromIptvOrgApi(bundle, {
    countryFilter: options.countryFilter,
    maxChannels: options.maxChannels,
  });

  return {
    sourceUrl: IPTV_ORG_API_STREAMS_URL,
    channels: built.channels,
    categories: built.categories,
    rejectedCount: built.rejectedCount,
    fromCache: hadCacheBefore,
    fetchedAt: bundle.fetchedAt,
  };
}

/**
 * Merges and deduplicates iptv-org API records and parsed M3U records into a unified normalized model.
 * Keeps rights_status strictly `'pending'` unless already explicitly approved by rights governance.
 */
export function normalizeAndMergeApiAndM3uData(params: {
  apiChannels?: IptvOrgApiChannel[];
  apiStreams?: IptvOrgApiStream[];
  apiGuides?: IptvOrgApiGuide[];
  m3uChannels?: IptvChannel[];
  defaultRightsStatus?: LiveRightsStatus;
}): NormalizedLiveChannel[] {
  const defaultRights = params.defaultRightsStatus || 'pending';
  const channelMap = new Map<string, NormalizedLiveChannel>();
  const nameToIdMap = new Map<string, string>();
  const guidesByChannel = new Map<string, IptvOrgApiGuide>();

  for (const g of params.apiGuides || []) {
    if (g.channel && !guidesByChannel.has(g.channel.toLowerCase())) {
      guidesByChannel.set(g.channel.toLowerCase(), g);
    }
  }

  const upsertSourceIntoChannel = (
    channel: NormalizedLiveChannel,
    rawUrl: string,
    provider: string,
    country: string,
    language: string
  ) => {
    const safeUrl = sanitizeSafeUrl(rawUrl);
    if (!safeUrl) return;
    let domain = '';
    try {
      domain = new URL(safeUrl).hostname.toLowerCase();
    } catch {
      return;
    }
    if (isPrivateOrLoopbackHostname(domain)) return;

    if (channel.sources.some((s) => s.sourceUrl === safeUrl)) return;

    channel.sources.push({
      id: generateStableSourceId(channel.id, safeUrl),
      channelId: channel.id,
      provider,
      sourceUrl: safeUrl,
      allowedDomain: domain,
      format: detectStreamFormatFromUrl(safeUrl),
      country,
      language,
      rightsStatus: defaultRights,
      availableCountries: [],
      permissionEvidence: null,
      allowBrowserProxy: false,
      reviewedAt: null,
      lastCheckedAt: null,
      playbackStatus: 'not_tested_from_pk',
      isEnabled: defaultRights === 'approved',
      priority: 100 + channel.sources.length,
    });
  };

  // 1. Ingest API channels
  for (const apiCh of params.apiChannels || []) {
    if (!apiCh || !apiCh.id || !apiCh.name || apiCh.closed) continue;
    if (apiCh.is_nsfw) continue;

    const cleanName = stripHtmlAndScriptContent(apiCh.name, 120);
    if (!cleanName) continue;

    const country = (apiCh.country || 'INTL').toUpperCase();
    const guide = guidesByChannel.get(apiCh.id.toLowerCase());
    const language = guide?.lang || 'und';
    const cats = Array.isArray(apiCh.categories) && apiCh.categories.length > 0
      ? apiCh.categories.map((c) => stripHtmlAndScriptContent(c, 48)).filter(Boolean)
      : ['General'];

    const normalized: NormalizedLiveChannel = {
      id: apiCh.id,
      tvgId: apiCh.id,
      name: cleanName,
      logoUrl: null,
      country,
      language,
      categories: cats.length > 0 ? cats : ['General'],
      website: sanitizeSafeUrl(apiCh.website),
      isNsfw: false,
      rightsStatus: defaultRights,
      playbackStatus: 'not_tested_from_pk',
      lastCheckedAt: null,
      pkTested: false,
      sources: [],
    };

    channelMap.set(apiCh.id.toLowerCase(), normalized);
    nameToIdMap.set(`${cleanName.toLowerCase()}::${country}`, apiCh.id.toLowerCase());
    nameToIdMap.set(cleanName.toLowerCase(), apiCh.id.toLowerCase());
  }

  // 2. Attach API streams to matching channels
  for (const st of params.apiStreams || []) {
    if (!st || !st.url) continue;
    const keyById = st.channel ? st.channel.toLowerCase() : '';
    const keyByTitle = st.title ? nameToIdMap.get(st.title.toLowerCase()) || '' : '';
    const target = channelMap.get(keyById) || channelMap.get(keyByTitle);
    if (target) {
      upsertSourceIntoChannel(target, st.url, 'iptv-org-api', target.country, target.language);
    }
  }

  // 3. Merge M3U candidate entries (fills logos, extra streams, and Free-TV / country channels)
  for (const m3u of params.m3uChannels || []) {
    const tvgKey = (m3u.tvgId || '').toLowerCase();
    const idKey = (m3u.id || '').toLowerCase();
    const country = (m3u.country || 'INTL').toUpperCase();
    const nameCountryKey = `${m3u.name.toLowerCase()}::${country}`;
    const nameKey = m3u.name.toLowerCase();

    const matchedKey =
      (tvgKey && channelMap.has(tvgKey) && tvgKey) ||
      (idKey && channelMap.has(idKey) && idKey) ||
      nameToIdMap.get(nameCountryKey) ||
      nameToIdMap.get(nameKey) ||
      null;

    if (matchedKey && channelMap.has(matchedKey)) {
      const existing = channelMap.get(matchedKey)!;
      if (!existing.logoUrl && m3u.logoUrl) {
        existing.logoUrl = m3u.logoUrl;
      }
      if (existing.language === 'und' && m3u.language && m3u.language !== 'und') {
        existing.language = m3u.language;
      }
      for (const cat of m3u.categories) {
        if (!existing.categories.some((c) => c.toLowerCase() === cat.toLowerCase())) {
          existing.categories.push(cat);
        }
      }
      upsertSourceIntoChannel(
        existing,
        m3u.streamUrl,
        m3u.provider || 'm3u',
        existing.country,
        existing.language
      );
    } else {
      const stableId = generateStableChannelId({
        tvgId: m3u.tvgId,
        name: m3u.name,
        country,
        streamUrl: m3u.streamUrl,
      });
      const created: NormalizedLiveChannel = {
        id: stableId,
        tvgId: m3u.tvgId || stableId,
        name: m3u.name,
        logoUrl: m3u.logoUrl,
        country,
        language: m3u.language || 'und',
        categories: m3u.categories.length > 0 ? [...m3u.categories] : ['General'],
        website: null,
        isNsfw: false,
        rightsStatus: m3u.rightsStatus || defaultRights,
        playbackStatus: m3u.playbackStatus || 'not_tested_from_pk',
        lastCheckedAt: null,
        pkTested: false,
        sources: [],
      };
      upsertSourceIntoChannel(
        created,
        m3u.streamUrl,
        m3u.provider || 'm3u',
        created.country,
        created.language
      );
      if (created.sources.length > 0) {
        channelMap.set(stableId.toLowerCase(), created);
        nameToIdMap.set(nameCountryKey, stableId.toLowerCase());
        nameToIdMap.set(nameKey, stableId.toLowerCase());
      }
    }
  }

  return Array.from(channelMap.values()).filter((ch) => ch.sources.length > 0);
}

// =============================================================================
// STAGE 3: RIGHTS APPROVAL GATE & PUBLIC CATALOGUE
// =============================================================================

/**
 * Enforces Stage 3 product policy: Only sources with `rightsStatus === 'approved'` and
 * `isEnabled === true` may appear in the public production catalogue.
 */
export function filterApprovedPublicLiveChannels(
  channels: NormalizedLiveChannel[]
): NormalizedLiveChannel[] {
  const approved: NormalizedLiveChannel[] = [];
  for (const ch of channels) {
    if (ch.isNsfw) continue;
    const usableSources = (ch.sources || []).filter(
      (s) => s.rightsStatus === 'approved' && s.isEnabled === true
    );
    if (usableSources.length === 0) continue;

    approved.push({
      ...ch,
      rightsStatus: 'approved',
      sources: usableSources.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)),
    });
  }
  return approved;
}

export function normalizedChannelToIptvChannel(
  channel: NormalizedLiveChannel
): IptvChannel | null {
  const primary = channel.sources[0];
  if (!primary) return null;
  return {
    id: channel.id,
    name: channel.name,
    tvgName: channel.name,
    tvgId: channel.tvgId,
    logoUrl: channel.logoUrl,
    groupTitle: channel.categories[0] || 'General',
    categories: channel.categories,
    streamUrl: primary.sourceUrl,
    isHttpInsecure: primary.sourceUrl.toLowerCase().startsWith('http://'),
    country: channel.country,
    language: channel.language,
    format: primary.format,
    provider: primary.provider,
    rightsStatus: primary.rightsStatus,
    playbackStatus: primary.playbackStatus,
    lastCheckedAt: primary.lastCheckedAt,
    pkTested: primary.playbackStatus === 'verified',
    allowBrowserProxy: primary.allowBrowserProxy,
    sourceId: primary.id,
    alternateSources: channel.sources,
  };
}

export interface LiveCatalogResponse {
  version: string;
  updatedAt: string | null;
  channels: IptvChannel[];
  epgProgrammes: LiveEpgProgramme[];
  fromBackend: boolean;
  schemaReady?: boolean;
  diagnostic?: string | null;
  notice?: string;
}

export function getActiveLiveCatalogUrl(): string {
  const envCatalog = sanitizeSafeUrl(
    String((import.meta as any)?.env?.VITE_LIVE_CATALOG_URL || '').trim()
  );
  if (envCatalog) return envCatalog.replace(/\/+$/, '');
  const { url: supabaseUrl } = getSupabaseCredentials();
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/live-catalog`;
  }
  return DEFAULT_LIVE_CATALOG_URL;
}

function mapDirectDbRowsToApprovedChannels(
  dbChannels: any[],
  dbSources: any[],
  filters: {
    country?: string;
    category?: string;
    language?: string;
    search?: string;
    channelId?: string;
  }
): IptvChannel[] {
  const countryFilter = (filters.country || '').trim().toUpperCase();
  const categoryFilter = (filters.category || '').trim().toLowerCase();
  const languageFilter = (filters.language || '').trim().toLowerCase();
  const searchFilter = (filters.search || '').trim().toLowerCase();
  const channelIdFilter = (filters.channelId || '').trim().toLowerCase();

  const srcByChan = new Map<string, LiveSourceRecord[]>();
  for (const src of dbSources || []) {
    if (!src || src.rights_status !== 'approved' || src.is_enabled !== true) continue;
    const list = srcByChan.get(src.channel_id) || [];
    list.push({
      id: String(src.id),
      channelId: String(src.channel_id),
      provider: String(src.provider || 'curated'),
      sourceUrl: String(src.source_url),
      allowedDomain: String(src.allowed_domain || ''),
      format: src.format === 'dash' ? 'dash' : src.format === 'unknown' ? 'unknown' : 'hls',
      country: String(src.country || 'INTL'),
      language: String(src.language || 'und'),
      rightsStatus: 'approved',
      availableCountries: Array.isArray(src.available_countries) ? src.available_countries : [],
      permissionEvidence: null,
      allowBrowserProxy: Boolean(src.allow_browser_proxy),
      reviewedAt: src.reviewed_at || null,
      lastCheckedAt: src.last_checked_at || null,
      playbackStatus: (src.playback_status || 'not_tested_from_pk') as LivePlaybackStatus,
      isEnabled: true,
      priority: typeof src.priority === 'number' ? src.priority : 100,
    });
    srcByChan.set(src.channel_id, list);
  }

  const normalized: NormalizedLiveChannel[] = [];
  for (const ch of dbChannels || []) {
    if (!ch || ch.is_nsfw === true || ch.is_published !== true) continue;
    const sources = (srcByChan.get(ch.id) || []).sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100)
    );
    if (sources.length === 0) continue;

    if (channelIdFilter && String(ch.id).toLowerCase() !== channelIdFilter) continue;
    if (
      countryFilter &&
      countryFilter !== 'ALL' &&
      String(ch.country || '').toUpperCase() !== countryFilter
    ) {
      continue;
    }

    const cats: string[] = Array.isArray(ch.categories) && ch.categories.length > 0
      ? ch.categories.map((c: any) => String(c))
      : ['General'];
    if (
      categoryFilter &&
      categoryFilter !== 'all' &&
      !cats.some((c) => c.toLowerCase() === categoryFilter)
    ) {
      continue;
    }

    const chLang = String(ch.language || 'und').toLowerCase();
    if (languageFilter && languageFilter !== 'all' && chLang !== languageFilter) continue;

    if (searchFilter) {
      const hay = `${ch.name || ''} ${ch.country || ''} ${cats.join(' ')}`.toLowerCase();
      if (!hay.includes(searchFilter)) continue;
    }

    const primary = sources[0];
    normalized.push({
      id: String(ch.id),
      tvgId: String(ch.tvg_id || ch.id),
      name: String(ch.name || ''),
      logoUrl: sanitizeSafeUrl(ch.logo_url),
      country: String(ch.country || 'INTL'),
      language: String(ch.language || 'und'),
      categories: cats,
      website: sanitizeSafeUrl(ch.website),
      isNsfw: false,
      rightsStatus: 'approved',
      playbackStatus: primary.playbackStatus,
      lastCheckedAt: primary.lastCheckedAt,
      pkTested: primary.playbackStatus === 'verified',
      sources,
    });
  }

  return filterApprovedPublicLiveChannels(normalized)
    .map(normalizedChannelToIptvChannel)
    .filter((c): c is IptvChannel => Boolean(c));
}

async function queryDirectSupabaseApprovedCatalog(
  supabaseUrl: string,
  anonKey: string,
  filters: {
    country?: string;
    category?: string;
    language?: string;
    search?: string;
    channelId?: string;
  },
  fetchFn: typeof fetch,
  signal?: AbortSignal
): Promise<{
  ok: boolean;
  schemaReady: boolean;
  channels: IptvChannel[];
  epgProgrammes: LiveEpgProgramme[];
  diagnostic?: string | null;
}> {
  if (!supabaseUrl || !anonKey) {
    return { ok: false, schemaReady: true, channels: [], epgProgrammes: [] };
  }

  const base = supabaseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json',
  };

  try {
    const nowIso = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const [chRes, srcRes, epgRes] = await Promise.all([
      fetchFn(
        `${base}/rest/v1/live_channels?is_published=eq.true&is_nsfw=eq.false&select=id,tvg_id,name,country,language,categories,logo_url,website,is_nsfw,is_published`,
        { method: 'GET', headers, signal }
      ),
      fetchFn(
        `${base}/rest/v1/live_sources?rights_status=eq.approved&is_enabled=eq.true&select=id,channel_id,provider,source_url,allowed_domain,format,country,language,rights_status,available_countries,allow_browser_proxy,reviewed_at,last_checked_at,playback_status,is_enabled,priority`,
        { method: 'GET', headers, signal }
      ),
      fetchFn(
        `${base}/rest/v1/live_epg_programmes?end_at=gte.${encodeURIComponent(nowIso)}&select=id,channel_id,tvg_id,title,description,category,language,start_at,end_at&limit=500`,
        { method: 'GET', headers, signal }
      ),
    ]);

    if (!chRes.ok || !srcRes.ok) {
      const chBody = !chRes.ok ? await chRes.text().catch(() => '') : '';
      const srcBody = !srcRes.ok ? await srcRes.text().catch(() => '') : '';
      const combined = `${chBody} ${srcBody}`;
      const missingTable =
        chRes.status === 404 ||
        srcRes.status === 404 ||
        /does not exist|42P01|PGRST205/i.test(combined);
      return {
        ok: false,
        schemaReady: !missingTable,
        channels: [],
        epgProgrammes: [],
        diagnostic: missingTable
          ? 'Live TV SQL tables (live_channels / live_sources) are not created in Supabase yet. Run supabase/migrations/20261114_live_tv_upgrade.sql in Supabase SQL Editor.'
          : `Supabase REST query returned HTTP ${chRes.status}/${srcRes.status}.`,
      };
    }

    const dbChannels = await chRes.json();
    const dbSources = await srcRes.json();
    const dbEpg = epgRes.ok ? await epgRes.json() : [];

    const channels = mapDirectDbRowsToApprovedChannels(
      Array.isArray(dbChannels) ? dbChannels : [],
      Array.isArray(dbSources) ? dbSources : [],
      filters
    );
    const allowedIds = new Set(channels.map((c) => c.id));
    const epgProgrammes: LiveEpgProgramme[] = Array.isArray(dbEpg)
      ? dbEpg
          .filter((p: any) => allowedIds.has(p.channel_id))
          .map((p: any) => ({
            id: String(p.id),
            channelId: String(p.channel_id),
            tvgId: String(p.tvg_id || p.channel_id),
            title: String(p.title || ''),
            description: String(p.description || ''),
            category: String(p.category || ''),
            language: String(p.language || 'und'),
            startAtUtc: String(p.start_at),
            endAtUtc: String(p.end_at),
          }))
      : [];

    return { ok: true, schemaReady: true, channels, epgProgrammes };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { ok: false, schemaReady: true, channels: [], epgProgrammes: [] };
  }
}

/**
 * Fetches curated, rights-approved Live TV channels from the Supabase `live-catalog` backend endpoint
 * (with direct PostgREST RLS fallback when anon key is configured).
 * Never fabricates rights approval or promotes unreviewed playlists into the public production catalogue.
 */
export async function fetchCuratedLiveCatalog(
  filters: {
    country?: string;
    category?: string;
    language?: string;
    search?: string;
    channelId?: string;
  } = {},
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<LiveCatalogResponse> {
  const { url: supabaseUrl, anonKey } = getSupabaseCredentials();
  const baseCatalogUrl = getActiveLiveCatalogUrl();

  const query = new URLSearchParams();
  if (filters.country && filters.country !== 'ALL') query.set('country', filters.country);
  if (filters.category && filters.category !== 'All') query.set('category', filters.category);
  if (filters.language && filters.language !== 'all') query.set('language', filters.language);
  if (filters.search) query.set('search', filters.search);
  if (filters.channelId) query.set('channelId', filters.channelId);

  const querySuffix = query.toString() ? `?${query.toString()}` : '';
  const candidateEndpoints = [
    `${baseCatalogUrl}${querySuffix}`,
    ...(baseCatalogUrl.endsWith('/live-catalog')
      ? [`${baseCatalogUrl.replace(/\/live-catalog$/, '/live-cataloge')}${querySuffix}`]
      : []),
  ];
  const fetchFn = options.fetchImpl ?? fetch;

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (anonKey) {
      headers['apikey'] = anonKey;
      headers['Authorization'] = `Bearer ${anonKey}`;
    }

    let res: Response | null = null;
    for (const endpoint of candidateEndpoints) {
      res = await fetchFn(endpoint, {
        method: 'GET',
        headers,
        signal: options.signal,
      });
      if (res.status !== 404) break;
    }

    if (!res || !res.ok) {
      // Fallback: Try direct RLS-protected Supabase PostgREST query if anon key is available
      const directFallback = await queryDirectSupabaseApprovedCatalog(
        supabaseUrl,
        anonKey,
        filters,
        fetchFn,
        options.signal
      );

      if (directFallback.ok) {
        return {
          version: `rls-${directFallback.channels.length}`,
          updatedAt: new Date().toISOString(),
          channels: directFallback.channels,
          epgProgrammes: directFallback.epgProgrammes,
          fromBackend: true,
          schemaReady: directFallback.schemaReady,
          diagnostic: directFallback.diagnostic || null,
          notice:
            directFallback.channels.length === 0
              ? 'No approved public channels are published yet. An administrator must verify rights permission before channels appear publicly.'
              : undefined,
        };
      }

      if (directFallback.schemaReady === false) {
        return {
          version: 'schema-pending',
          updatedAt: null,
          channels: [],
          epgProgrammes: [],
          fromBackend: false,
          schemaReady: false,
          diagnostic: directFallback.diagnostic || null,
          notice:
            directFallback.diagnostic ||
            'Live TV SQL tables have not been created in Supabase yet. Run the Live TV SQL migration in Supabase SQL Editor.',
        };
      }

      return {
        version: 'unconfigured',
        updatedAt: null,
        channels: [],
        epgProgrammes: [],
        fromBackend: false,
        notice:
          'Curated public Live TV catalogue endpoint is not deployed yet or returned HTTP ' +
          (res ? res.status : 0) +
          (res?.status === 401
            ? ' (Redeploy live-catalog with --no-verify-jwt or set VITE_SUPABASE_ANON_KEY).'
            : '.') +
          ' Only rights-approved sources appear in public production.',
      };
    }

    const payload = await res.json();
    const rawChannels = Array.isArray(payload?.channels)
      ? (payload.channels as NormalizedLiveChannel[])
      : [];
    const strictlyApproved = filterApprovedPublicLiveChannels(rawChannels)
      .map(normalizedChannelToIptvChannel)
      .filter((c): c is IptvChannel => Boolean(c));

    const epgProgrammes = Array.isArray(payload?.epgProgrammes)
      ? (payload.epgProgrammes as LiveEpgProgramme[])
      : [];

    const schemaReady = payload?.schemaReady !== false;
    const diagnostic = typeof payload?.diagnostic === 'string' ? payload.diagnostic : null;

    if (strictlyApproved.length === 0 && !schemaReady && supabaseUrl && anonKey) {
      const directCheck = await queryDirectSupabaseApprovedCatalog(
        supabaseUrl,
        anonKey,
        filters,
        fetchFn,
        options.signal
      );
      if (directCheck.ok && directCheck.channels.length > 0) {
        return {
          version: `rls-${directCheck.channels.length}`,
          updatedAt: new Date().toISOString(),
          channels: directCheck.channels,
          epgProgrammes: directCheck.epgProgrammes,
          fromBackend: true,
          schemaReady: true,
        };
      }
    }

    return {
      version: String(payload?.version || '1.0'),
      updatedAt: payload?.updatedAt ? String(payload.updatedAt) : null,
      channels: strictlyApproved,
      epgProgrammes,
      fromBackend: true,
      schemaReady,
      diagnostic,
      notice:
        !schemaReady && diagnostic
          ? diagnostic
          : strictlyApproved.length === 0
          ? 'No approved public channels are published yet. An administrator must verify rights permission before channels appear publicly.'
          : undefined,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }

    // Attempt direct RLS PostgREST query if Edge Function was unreachable
    const directFallback = await queryDirectSupabaseApprovedCatalog(
      supabaseUrl,
      anonKey,
      filters,
      fetchFn,
      options.signal
    );
    if (directFallback.ok) {
      return {
        version: `rls-${directFallback.channels.length}`,
        updatedAt: new Date().toISOString(),
        channels: directFallback.channels,
        epgProgrammes: directFallback.epgProgrammes,
        fromBackend: true,
        schemaReady: true,
      };
    }

    return {
      version: 'unavailable',
      updatedAt: null,
      channels: [],
      epgProgrammes: [],
      fromBackend: false,
      schemaReady: directFallback.schemaReady,
      diagnostic: directFallback.diagnostic || null,
      notice:
        directFallback.diagnostic ||
        'Unable to reach curated Live TV catalogue backend right now.',
    };
  }
}

// =============================================================================
// STAGE 4: HONEST PLAYBACK VERIFICATION & ERROR CLASSIFICATION
// =============================================================================

export interface HlsManifestValidationResult {
  valid: boolean;
  isMasterPlaylist: boolean;
  variantUrl: string | null;
  firstSegmentUrl: string | null;
  reason?: string;
}

/**
 * Validates HLS master/media playlist text without relying on master playlist alone.
 */
export function validateHlsManifestContent(
  manifestText: string,
  manifestUrl: string
): HlsManifestValidationResult {
  if (!manifestText || typeof manifestText !== 'string') {
    return {
      valid: false,
      isMasterPlaylist: false,
      variantUrl: null,
      firstSegmentUrl: null,
      reason: 'Empty playlist body',
    };
  }

  const trimmed = manifestText.trim();
  if (!trimmed.startsWith('#EXTM3U')) {
    return {
      valid: false,
      isMasterPlaylist: false,
      variantUrl: null,
      firstSegmentUrl: null,
      reason: 'Missing #EXTM3U header',
    };
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  const hasMediaSegments = lines.some((l) => l.startsWith('#EXTINF:'));

  let variantUrl: string | null = null;
  let firstSegmentUrl: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF') && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (next && !next.startsWith('#')) {
        try {
          variantUrl = sanitizeSafeUrl(new URL(next, manifestUrl).toString());
          if (variantUrl) break;
        } catch {
          // ignore
        }
      }
    }
    if (line.startsWith('#EXTINF:') && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (next && !next.startsWith('#')) {
        try {
          firstSegmentUrl = sanitizeSafeUrl(new URL(next, manifestUrl).toString());
          if (firstSegmentUrl) break;
        } catch {
          // ignore
        }
      }
    }
  }

  if (!isMaster && !hasMediaSegments) {
    return {
      valid: false,
      isMasterPlaylist: false,
      variantUrl: null,
      firstSegmentUrl: null,
      reason: 'Playlist contains neither #EXT-X-STREAM-INF variants nor #EXTINF media segments',
    };
  }

  return {
    valid: true,
    isMasterPlaylist: isMaster,
    variantUrl,
    firstSegmentUrl,
  };
}

export interface DashManifestValidationResult {
  valid: boolean;
  firstSegmentHint: string | null;
  reason?: string;
}

/**
 * Validates DASH MPD XML structure (`<MPD` and `<Period>` / `<AdaptationSet>`).
 */
export function validateDashManifestContent(
  mpdText: string,
  mpdUrl: string
): DashManifestValidationResult {
  if (!mpdText || typeof mpdText !== 'string') {
    return { valid: false, firstSegmentHint: null, reason: 'Empty DASH MPD body' };
  }
  const hasMpd = /<MPD\b/i.test(mpdText);
  const hasPeriodOrSet = /<Period\b/i.test(mpdText) && /<AdaptationSet\b/i.test(mpdText);
  if (!hasMpd || !hasPeriodOrSet) {
    return {
      valid: false,
      firstSegmentHint: null,
      reason: 'Invalid DASH MPD XML structure (missing <MPD>, <Period>, or <AdaptationSet>)',
    };
  }

  let firstSegmentHint: string | null = null;
  const baseUrlMatch = mpdText.match(/<BaseURL>([^<]+)<\/BaseURL>/i);
  if (baseUrlMatch && baseUrlMatch[1]) {
    try {
      firstSegmentHint = sanitizeSafeUrl(new URL(baseUrlMatch[1].trim(), mpdUrl).toString());
    } catch {
      firstSegmentHint = null;
    }
  }

  return { valid: true, firstSegmentHint };
}

/**
 * Verifies a candidate stream via GET-first manifest retrieval, HLS media playlist & segment probing,
 * or DASH manifest & segment probing. Marks `not_tested_from_pk` whenever testCountry !== 'PK'.
 */
export async function verifyCandidateStreamHealth(
  sourceUrl: string,
  options: {
    sourceId?: string;
    channelId?: string;
    testCountry?: string;
    fetchImpl?: typeof fetch;
    nowIso?: string;
  } = {}
): Promise<LiveSourceCheckRecord> {
  const fetchFn = options.fetchImpl ?? fetch;
  const checkedAt = options.nowIso || new Date().toISOString();
  const testCountry = (options.testCountry || 'UNKNOWN').toUpperCase();
  const safeUrl = sanitizeSafeUrl(sourceUrl);
  const sourceId = options.sourceId || generateStableSourceId(options.channelId || 'ch', sourceUrl);
  const channelId = options.channelId || 'unknown';

  const makeCheck = (
    partial: Partial<LiveSourceCheckRecord> & {
      errorClassification: LivePlaybackStatus;
      details: string;
    }
  ): LiveSourceCheckRecord => ({
    sourceId,
    channelId,
    testCountry,
    checkedAt,
    testMethod: 'get-manifest-and-segment-probe',
    dnsOk: false,
    tlsOk: false,
    manifestOk: false,
    mediaPlaylistOk: false,
    segmentOk: false,
    playbackOk: false,
    mimeType: null,
    httpStatus: null,
    stabilitySeconds: 0,
    ...partial,
  });

  if (!safeUrl) {
    return makeCheck({
      errorClassification: 'unsupported_format',
      details: 'Invalid or non-HTTP(S) stream URL.',
    });
  }

  let host = '';
  try {
    host = new URL(safeUrl).hostname;
  } catch {
    return makeCheck({
      errorClassification: 'unsupported_format',
      details: 'Malformed URL.',
    });
  }

  if (isPrivateOrLoopbackHostname(host)) {
    return makeCheck({
      errorClassification: 'offline',
      details: 'Blocked private or loopback host.',
    });
  }

  const tlsOk = safeUrl.toLowerCase().startsWith('https://');
  const format = detectStreamFormatFromUrl(safeUrl);

  try {
    // Always use GET (never rely on HEAD, because CDNs return 403/405 to HEAD while GET works)
    const manifestRes = await fetchFn(safeUrl, { method: 'GET' });
    const httpStatus = manifestRes.status;
    const mimeType = manifestRes.headers.get('content-type');
    const geoHeader = manifestRes.headers.get('x-cinebox-error-code') || '';

    if (!manifestRes.ok) {
      const bodyText = await manifestRes.text().catch(() => '');
      const hasGeoEvidence =
        httpStatus === 451 ||
        geoHeader === 'GEO_BLOCKED' ||
        /\b(geo[-\s]?blocked|not available in your country|country restriction|outside.*region)\b/i.test(
          bodyText
        );

      return makeCheck({
        dnsOk: true,
        tlsOk,
        httpStatus,
        mimeType,
        errorClassification: hasGeoEvidence ? 'geo_blocked' : 'offline',
        details: hasGeoEvidence
          ? `Broadcaster returned explicit geographic restriction (HTTP ${httpStatus}).`
          : `Upstream returned HTTP ${httpStatus} without geographic block evidence.`,
      });
    }

    const bodyText = await manifestRes.text();
    const effectiveFormat = detectStreamFormatFromUrl(safeUrl, mimeType);

    if (effectiveFormat === 'dash' || format === 'dash') {
      const dashCheck = validateDashManifestContent(bodyText, safeUrl);
      if (!dashCheck.valid) {
        return makeCheck({
          dnsOk: true,
          tlsOk,
          httpStatus,
          mimeType,
          errorClassification: 'invalid_manifest',
          details: dashCheck.reason || 'Invalid DASH MPD manifest.',
        });
      }

      let segmentOk = false;
      if (dashCheck.firstSegmentHint) {
        try {
          const segRes = await fetchFn(dashCheck.firstSegmentHint, { method: 'GET' });
          segmentOk = segRes.ok;
        } catch {
          segmentOk = false;
        }
      } else {
        segmentOk = true; // MPD validated when segment template uses runtime $Number$
      }

      if (!segmentOk) {
        return makeCheck({
          dnsOk: true,
          tlsOk,
          manifestOk: true,
          mediaPlaylistOk: true,
          segmentOk: false,
          httpStatus,
          mimeType,
          errorClassification: 'offline',
          details: 'DASH MPD retrieved, but segment probe failed.',
        });
      }

      return makeCheck({
        dnsOk: true,
        tlsOk,
        manifestOk: true,
        mediaPlaylistOk: true,
        segmentOk: true,
        playbackOk: testCountry === 'PK',
        httpStatus,
        mimeType,
        errorClassification: testCountry === 'PK' ? 'verified' : 'not_tested_from_pk',
        details:
          testCountry === 'PK'
            ? 'DASH manifest and media segment verified from Pakistan.'
            : 'DASH manifest and segment reachable, but not tested from Pakistan.',
      });
    }

    // HLS verification (must validate media playlist + at least one segment)
    const hlsCheck = validateHlsManifestContent(bodyText, safeUrl);
    if (!hlsCheck.valid) {
      return makeCheck({
        dnsOk: true,
        tlsOk,
        httpStatus,
        mimeType,
        errorClassification: 'invalid_manifest',
        details: hlsCheck.reason || 'Invalid HLS M3U8 manifest.',
      });
    }

    let firstSegmentUrl = hlsCheck.firstSegmentUrl;
    let mediaPlaylistOk = !hlsCheck.isMasterPlaylist;

    if (hlsCheck.isMasterPlaylist && hlsCheck.variantUrl) {
      const mediaRes = await fetchFn(hlsCheck.variantUrl, { method: 'GET' });
      if (!mediaRes.ok) {
        return makeCheck({
          dnsOk: true,
          tlsOk,
          manifestOk: true,
          mediaPlaylistOk: false,
          httpStatus: mediaRes.status,
          mimeType,
          errorClassification: 'offline',
          details: `Master playlist ok, but variant media playlist returned HTTP ${mediaRes.status}.`,
        });
      }
      const mediaText = await mediaRes.text();
      const mediaParsed = validateHlsManifestContent(mediaText, hlsCheck.variantUrl);
      if (!mediaParsed.valid || !mediaParsed.firstSegmentUrl) {
        return makeCheck({
          dnsOk: true,
          tlsOk,
          manifestOk: true,
          mediaPlaylistOk: false,
          httpStatus: mediaRes.status,
          mimeType,
          errorClassification: 'invalid_manifest',
          details: mediaParsed.reason || 'Variant media playlist invalid or missing segments.',
        });
      }
      mediaPlaylistOk = true;
      firstSegmentUrl = mediaParsed.firstSegmentUrl;
    }

    if (!firstSegmentUrl) {
      return makeCheck({
        dnsOk: true,
        tlsOk,
        manifestOk: true,
        mediaPlaylistOk,
        segmentOk: false,
        httpStatus,
        mimeType,
        errorClassification: 'invalid_manifest',
        details: 'No media segment URL found in HLS playlist.',
      });
    }

    const segRes = await fetchFn(firstSegmentUrl, { method: 'GET' });
    if (!segRes.ok) {
      return makeCheck({
        dnsOk: true,
        tlsOk,
        manifestOk: true,
        mediaPlaylistOk,
        segmentOk: false,
        httpStatus: segRes.status,
        mimeType,
        errorClassification: 'offline',
        details: `HLS segment fetch failed with HTTP ${segRes.status}.`,
      });
    }

    return makeCheck({
      dnsOk: true,
      tlsOk,
      manifestOk: true,
      mediaPlaylistOk: true,
      segmentOk: true,
      playbackOk: testCountry === 'PK',
      httpStatus,
      mimeType,
      errorClassification: testCountry === 'PK' ? 'verified' : 'not_tested_from_pk',
      details:
        testCountry === 'PK'
          ? 'HLS master, media playlist, and segment verified from Pakistan.'
          : 'HLS manifest and segment reachable, but not yet tested from a Pakistan ISP.',
    });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return makeCheck({
      dnsOk: true,
      tlsOk,
      errorClassification: isTimeout ? 'timeout' : 'offline',
      details: isTimeout
        ? 'Manifest request timed out.'
        : err instanceof Error
        ? err.message
        : 'Stream verification network failure.',
    });
  }
}

export interface HlsStreamErrorClassification {
  status: LivePlaybackStatus;
  shouldAbortImmediately: boolean;
  isBrowserCorsOrBlocked: boolean;
  shouldFallbackToDirect?: boolean;
  userMessage: string | null;
}

/**
 * Accurately classifies playback/network failures without falsely blaming geo-blocking for 403/404/502/timeouts.
 * Geo-blocking is reported ONLY when reliable geographic-restriction evidence is provided.
 */
export function classifyLiveStreamError(params: {
  errorType?: string;
  errorDetails?: string;
  httpStatus?: number;
  streamUrl: string;
  isPageHttps: boolean;
  isFatal?: boolean;
  usingProxy?: boolean;
  hasGeoBlockEvidence?: boolean;
  serverErrorCode?: string;
}): HlsStreamErrorClassification {
  const {
    errorType,
    errorDetails,
    httpStatus,
    streamUrl,
    isPageHttps,
    isFatal,
    usingProxy = false,
    hasGeoBlockEvidence = false,
    serverErrorCode = '',
  } = params;

  const normalizedType = (errorType || '').toLowerCase();
  const normalizedDetails = (errorDetails || '').toLowerCase();
  const isTimeout =
    normalizedDetails === 'manifestloadtimeout' ||
    normalizedDetails === 'levelloadtimeout' ||
    normalizedDetails === 'fragloadtimeout' ||
    httpStatus === 504 ||
    serverErrorCode === 'TIMEOUT';

  const isManifestParseFailure =
    normalizedDetails === 'manifestparsingerror' ||
    normalizedDetails === 'levelparsingerror' ||
    serverErrorCode === 'INVALID_MANIFEST';

  const isNetworkLoadFailure =
    normalizedType === 'networkerror' ||
    normalizedDetails === 'manifestloaderror' ||
    normalizedDetails === 'levelloaderror' ||
    normalizedDetails === 'fragloaderror' ||
    isTimeout;

  // Explicit geo-blocking ONLY with reliable evidence (never assumed from generic 403/404/502)
  if (hasGeoBlockEvidence || serverErrorCode === 'GEO_BLOCKED' || httpStatus === 451) {
    return {
      status: 'geo_blocked',
      shouldAbortImmediately: true,
      isBrowserCorsOrBlocked: false,
      shouldFallbackToDirect: false,
      userMessage: IPTV_GEO_BLOCKED_ERROR_MESSAGE,
    };
  }

  if (serverErrorCode === 'UNAPPROVED_HOST' || serverErrorCode === 'SSRF_BLOCKED') {
    return {
      status: 'offline',
      shouldAbortImmediately: true,
      isBrowserCorsOrBlocked: false,
      shouldFallbackToDirect: false,
      userMessage: IPTV_PROXY_DISALLOWED_ERROR_MESSAGE,
    };
  }

  if (isManifestParseFailure) {
    return {
      status: 'invalid_manifest',
      shouldAbortImmediately: true,
      isBrowserCorsOrBlocked: false,
      shouldFallbackToDirect: false,
      userMessage: IPTV_INVALID_MANIFEST_ERROR_MESSAGE,
    };
  }

  if (usingProxy) {
    if (
      isNetworkLoadFailure &&
      (httpStatus === 404 || httpStatus === 401 || httpStatus === 0) &&
      streamUrl.toLowerCase().startsWith('https://')
    ) {
      return {
        status: httpStatus === 0 ? 'cors_blocked' : 'offline',
        shouldAbortImmediately: true,
        isBrowserCorsOrBlocked: false,
        shouldFallbackToDirect: true,
        userMessage: IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE,
      };
    }

    if (isTimeout) {
      return {
        status: 'timeout',
        shouldAbortImmediately: true,
        isBrowserCorsOrBlocked: false,
        shouldFallbackToDirect: false,
        userMessage: IPTV_TIMEOUT_ERROR_MESSAGE,
      };
    }

    if (
      isNetworkLoadFailure &&
      (httpStatus === 0 ||
        httpStatus === 403 ||
        httpStatus === 404 ||
        httpStatus === 405 ||
        httpStatus === 500 ||
        httpStatus === 502 ||
        httpStatus === 503 ||
        httpStatus === undefined)
    ) {
      return {
        status: 'offline',
        shouldAbortImmediately: true,
        isBrowserCorsOrBlocked: false,
        shouldFallbackToDirect: false,
        userMessage: IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE,
      };
    }

    if (isFatal) {
      return {
        status: 'playback_error',
        shouldAbortImmediately: true,
        isBrowserCorsOrBlocked: false,
        shouldFallbackToDirect: false,
        userMessage: IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE,
      };
    }

    return {
      status: 'verified',
      shouldAbortImmediately: false,
      isBrowserCorsOrBlocked: false,
      shouldFallbackToDirect: false,
      userMessage: null,
    };
  }

  // Direct browser playback error handling
  if (isPageHttps && streamUrl.toLowerCase().startsWith('http://')) {
    return {
      status: 'cors_blocked',
      shouldAbortImmediately: true,
      isBrowserCorsOrBlocked: true,
      shouldFallbackToDirect: false,
      userMessage: IPTV_BROWSER_BLOCKED_ERROR_MESSAGE,
    };
  }

  if (isTimeout) {
    return {
      status: 'timeout',
      shouldAbortImmediately: true,
      isBrowserCorsOrBlocked: false,
      shouldFallbackToDirect: false,
      userMessage: IPTV_TIMEOUT_ERROR_MESSAGE,
    };
  }

  // In browsers, HTTP status 0 is CORS / network block; HTTP 403 without geo-evidence may be hotlink/CORS or token expiry
  if (isNetworkLoadFailure && (httpStatus === 0 || httpStatus === 403 || httpStatus === undefined)) {
    return {
      status: 'cors_blocked',
      shouldAbortImmediately: true,
      isBrowserCorsOrBlocked: true,
      shouldFallbackToDirect: false,
      userMessage: IPTV_BROWSER_BLOCKED_ERROR_MESSAGE,
    };
  }

  if (isFatal) {
    return {
      status: normalizedType === 'mediaerror' ? 'playback_error' : 'offline',
      shouldAbortImmediately: true,
      isBrowserCorsOrBlocked: false,
      shouldFallbackToDirect: false,
      userMessage: IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE,
    };
  }

  return {
    status: 'verified',
    shouldAbortImmediately: false,
    isBrowserCorsOrBlocked: false,
    shouldFallbackToDirect: false,
    userMessage: null,
  };
}

// =============================================================================
// STAGE 5: SECURE PROXY URL CONSTRUCTION & MANIFEST REWRITING
// =============================================================================

export function getLiveTvProxyBaseUrl(): string {
  const envProxy = String((import.meta as any).env?.VITE_LIVE_TV_PROXY_URL || '').trim();
  const safeEnvProxy = sanitizeSafeUrl(envProxy);
  if (safeEnvProxy && !safeEnvProxy.includes('your-project')) {
    return safeEnvProxy.replace(/\/+$/, '');
  }

  const envSupabase = String((import.meta as any).env?.VITE_SUPABASE_URL || '').trim();
  const safeSupabase = sanitizeSafeUrl(envSupabase);
  if (safeSupabase && !safeSupabase.includes('your-project')) {
    return `${safeSupabase.replace(/\/+$/, '')}/functions/v1/live-tv-proxy`;
  }

  return DEFAULT_LIVE_TV_PROXY_URL;
}

/**
 * Builds a proxy URL preferring `?sourceId=<id>` for curated approved sources (safer than arbitrary client `?url=`),
 * or `?url=<encoded>` strictly when SSRF checks pass.
 */
export function buildLiveTvProxyUrl(
  streamUrl: string | null | undefined,
  proxyBaseUrlOverride?: string,
  options?: { sourceId?: string | null }
): string | null {
  const safeTarget = sanitizeSafeUrl(streamUrl);
  if (!safeTarget) return null;

  try {
    const parsedTarget = new URL(safeTarget);
    if (isPrivateOrLoopbackHostname(parsedTarget.hostname)) {
      return null;
    }
  } catch {
    return null;
  }

  if (safeTarget.includes('/live-tv-proxy?')) {
    return safeTarget;
  }

  const rawBase = proxyBaseUrlOverride
    ? sanitizeSafeUrl(proxyBaseUrlOverride)
    : getLiveTvProxyBaseUrl();
  const baseUrl = (rawBase || DEFAULT_LIVE_TV_PROXY_URL).replace(/\/+$/, '');
  const separator = baseUrl.includes('?') ? '&' : '?';

  if (options?.sourceId && /^[a-zA-Z0-9._-]{3,80}$/.test(options.sourceId)) {
    return `${baseUrl}${separator}sourceId=${encodeURIComponent(options.sourceId)}`;
  }

  return `${baseUrl}${separator}url=${encodeURIComponent(safeTarget)}`;
}

export function rewriteHlsManifestForProxy(
  manifestText: string,
  baseUpstreamUrl: string,
  proxyBaseUrlOverride?: string
): string {
  if (!manifestText || typeof manifestText !== 'string') return '';
  const proxyBase = (
    (proxyBaseUrlOverride ? sanitizeSafeUrl(proxyBaseUrlOverride) : null) ||
    getLiveTvProxyBaseUrl()
  ).replace(/\/+$/, '');

  const rewriteUri = (rawUri: string): string => {
    const trimmed = rawUri.trim();
    if (!trimmed) return rawUri;
    if (trimmed.includes('/live-tv-proxy?')) return trimmed;
    try {
      const resolved = new URL(trimmed, baseUpstreamUrl);
      const proxied = buildLiveTvProxyUrl(resolved.toString(), proxyBase);
      return proxied || rawUri;
    } catch {
      return rawUri;
    }
  };

  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        if (/URI\s*=\s*["'][^"']+["']/i.test(line)) {
          return line.replace(
            /(URI\s*=\s*)(["'])([^"']+)(["'])/gi,
            (_m, prefix, q1, uriVal, q2) => `${prefix}${q1}${rewriteUri(uriVal)}${q2}`
          );
        }
        return line;
      }
      return rewriteUri(trimmed);
    })
    .join('\n');
}

// =============================================================================
// STAGE 8: EPG PARSING, UTC/LOCAL CONVERSION & GUIDE MATCHING
// =============================================================================

/**
 * Parses XMLTV timestamp (`20261114143000 +0000` or `+0500`) or ISO UTC string into ISO UTC timestamp.
 */
export function parseXmlTvTimestampToUtcIso(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // XMLTV format: YYYYMMDDHHmmss [+/-HHMM]
  const xmltv = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{2}:?\d{2}|Z))?$/
  );
  if (xmltv) {
    const [, y, m, d, hh, mm, ss, offsetRaw] = xmltv;
    let offset = 'Z';
    if (offsetRaw && offsetRaw !== 'Z') {
      const cleanOff = offsetRaw.replace(':', '');
      offset = `${cleanOff.slice(0, 3)}:${cleanOff.slice(3, 5)}`;
    }
    const isoCandidate = `${y}-${m}-${d}T${hh}:${mm}:${ss}${offset}`;
    const parsed = new Date(isoCandidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function formatEpgLocalTime(
  utcIso: string | null | undefined,
  locale = 'en-US',
  timeZone?: string
): string {
  if (!utcIso) return '--:--';
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) return '--:--';
  try {
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

/**
 * Parses XMLTV guide XML into sanitized LiveEpgProgramme rows (never invents missing programmes).
 */
export function parseXmlTvProgrammes(
  xmlText: string,
  maxProgrammes = 500
): LiveEpgProgramme[] {
  if (!xmlText || typeof xmlText !== 'string' || !xmlText.includes('<programme')) {
    return [];
  }

  const programmes: LiveEpgProgramme[] = [];
  const progRegex = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let match: RegExpExecArray | null;

  while ((match = progRegex.exec(xmlText)) !== null && programmes.length < maxProgrammes) {
    const attrsStr = match[1] || '';
    const inner = match[2] || '';

    const startMatch = attrsStr.match(/start\s*=\s*["']([^"']+)["']/i);
    const stopMatch = attrsStr.match(/stop\s*=\s*["']([^"']+)["']/i);
    const channelMatch = attrsStr.match(/channel\s*=\s*["']([^"']+)["']/i);

    const startAtUtc = parseXmlTvTimestampToUtcIso(startMatch?.[1]);
    const endAtUtc = parseXmlTvTimestampToUtcIso(stopMatch?.[1]);
    const tvgId = stripHtmlAndScriptContent(channelMatch?.[1] || '', 100);
    if (!startAtUtc || !endAtUtc || !tvgId) continue;

    const titleMatch = inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = inner.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/i);
    const catMatch = inner.match(/<category\b[^>]*>([\s\S]*?)<\/category>/i);
    const langMatch = titleMatch?.[0]?.match(/lang\s*=\s*["']([^"']+)["']/i);

    const title = stripHtmlAndScriptContent(titleMatch?.[1] || '', 160);
    if (!title) continue;

    programmes.push({
      id: `epg-${fnv1aHashHex(`${tvgId}::${startAtUtc}::${title}`)}`,
      channelId: tvgId,
      tvgId,
      title,
      description: stripHtmlAndScriptContent(descMatch?.[1] || '', 400),
      category: stripHtmlAndScriptContent(catMatch?.[1] || '', 48),
      language: stripHtmlAndScriptContent(langMatch?.[1] || 'und', 12) || 'und',
      startAtUtc,
      endAtUtc,
    });
  }

  return programmes;
}

export function matchEpgProgrammesForChannel(
  programmes: LiveEpgProgramme[],
  channel: Pick<IptvChannel, 'id' | 'tvgId'>
): LiveEpgProgramme[] {
  const idLower = (channel.id || '').trim().toLowerCase();
  const tvgLower = (channel.tvgId || '').trim().toLowerCase();

  return programmes
    .filter((p) => {
      const pChan = (p.channelId || '').trim().toLowerCase();
      const pTvg = (p.tvgId || '').trim().toLowerCase();
      return (
        (idLower && (pChan === idLower || pTvg === idLower)) ||
        (tvgLower && (pChan === tvgLower || pTvg === tvgLower))
      );
    })
    .sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));
}

export function computeCurrentAndNextEpg(
  programmes: LiveEpgProgramme[],
  nowMs = Date.now()
): {
  current: LiveEpgProgramme | null;
  next: LiveEpgProgramme | null;
  upcoming: LiveEpgProgramme[];
} {
  const valid = programmes
    .filter((p) => {
      const s = Date.parse(p.startAtUtc);
      const e = Date.parse(p.endAtUtc);
      return Number.isFinite(s) && Number.isFinite(e) && e > nowMs;
    })
    .sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));

  const current =
    valid.find((p) => Date.parse(p.startAtUtc) <= nowMs && Date.parse(p.endAtUtc) > nowMs) ||
    null;

  const upcoming = valid.filter((p) => Date.parse(p.startAtUtc) > nowMs);
  const next = upcoming[0] || null;

  return { current, next, upcoming };
}

export function cacheChannelEpgProgrammes(
  channelId: string,
  programmes: LiveEpgProgramme[],
  nowMs = Date.now()
): void {
  epgCache.set(channelId.toLowerCase(), {
    programmes,
    expiresAt: nowMs + EPG_CACHE_TTL_MS,
  });
}

export function getCachedChannelEpgProgrammes(
  channelId: string,
  nowMs = Date.now()
): LiveEpgProgramme[] | null {
  const entry = epgCache.get(channelId.toLowerCase());
  if (!entry || entry.expiresAt <= nowMs) {
    if (entry) epgCache.delete(channelId.toLowerCase());
    return null;
  }
  return entry.programmes;
}

// =============================================================================
// CANDIDATE M3U FETCHING (DISCOVERY / ADMIN INSPECTION — NOT AUTO-APPROVED)
// =============================================================================

export interface FetchIptvPlaylistOptions {
  signal?: AbortSignal;
  forceRefresh?: boolean;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}

export async function fetchIptvPlaylist(
  sourceIdOrUrl: IptvPlaylistSourceId | string,
  options: FetchIptvPlaylistOptions = {}
): Promise<IptvPlaylistFetchResult> {
  const candidates = resolveIptvPlaylistCandidates(sourceIdOrUrl);
  if (candidates.length === 0) {
    throw new Error('Invalid IPTV playlist URL. Only http:// and https:// URLs are allowed.');
  }

  const now = options.nowMs ?? Date.now();
  if (!options.forceRefresh) {
    for (const candidateUrl of candidates) {
      const cached = playlistCache.get(candidateUrl);
      if (cached && cached.expiresAt > now) {
        return {
          ...cached.result,
          fromCache: true,
        };
      }
    }
  }

  if (options.signal?.aborted) {
    throw new DOMException('IPTV playlist fetch aborted.', 'AbortError');
  }

  const fetchFn = options.fetchImpl ?? fetch;
  let lastError: Error | null = null;

  for (const resolvedUrl of candidates) {
    const internalController = new AbortController();
    const timeoutId = setTimeout(() => {
      internalController.abort();
    }, IPTV_FETCH_TIMEOUT_MS);

    const onExternalAbort = () => {
      internalController.abort();
    };
    if (options.signal) {
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const response = await fetchFn(resolvedUrl, {
        method: 'GET',
        signal: internalController.signal,
        headers: {
          Accept: 'application/x-mpegURL, audio/mpegurl, text/plain, */*',
        },
      });

      if (!response.ok) {
        lastError = new Error(`Failed to load M3U playlist (HTTP ${response.status}).`);
        continue;
      }

      const rawText = await response.text();
      if (!rawText || (!rawText.includes('#EXTM3U') && !rawText.includes('#EXTINF'))) {
        lastError = new Error('Playlist response is empty or not a valid M3U file.');
        continue;
      }

      const defaultCountry =
        sourceIdOrUrl === 'pakistan'
          ? 'PK'
          : sourceIdOrUrl === 'india'
          ? 'IN'
          : undefined;

      const parsed = parseM3uPlaylist(rawText, {
        baseUrl: resolvedUrl,
        defaultCountry,
        provider: String(sourceIdOrUrl),
        defaultRightsStatus: 'pending',
      });

      const enrichedChannels = parsed.channels.map((ch) => {
        const enrichedCats = inferLiveChannelCategories(ch.name, ch.tvgId, ch.categories);
        return {
          ...ch,
          groupTitle: enrichedCats[0] || ch.groupTitle,
          categories: enrichedCats,
        };
      });

      const result: IptvPlaylistFetchResult = {
        sourceUrl: resolvedUrl,
        channels: enrichedChannels,
        categories: extractIptvCategories(enrichedChannels),
        rejectedCount: parsed.rejectedCount,
        fromCache: false,
        fetchedAt: now,
      };

      if (enrichedChannels.length > 0) {
        playlistCache.set(resolvedUrl, {
          result,
          expiresAt: now + IPTV_CACHE_TTL_MS,
        });
      }

      return result;
    } catch (err) {
      if (options.signal?.aborted) {
        throw new DOMException('IPTV playlist fetch aborted.', 'AbortError');
      }
      lastError = err instanceof Error ? err : new Error('Failed to fetch M3U playlist.');
    } finally {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  throw lastError || new Error('Failed to load M3U playlist.');
}
