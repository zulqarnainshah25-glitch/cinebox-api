import {
  AlternateLanguageStreamOption,
  AppConfigRecord,
  AppUserPlatform,
  AppUserRecord,
  AppUserRole,
  AppUserStatus,
  MovieLinkRecord,
} from '../types/movie';

/**
 * Validates that a URL is a safe HTTP or HTTPS URL.
 * Blocks `javascript:`, `data:`, `vbscript:`, `file:`, and malformed URLs to prevent XSS/SSRF.
 */
export function sanitizeSafeUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Sanitizes a movie title into a safe filesystem filename (blocks path traversal `../`, null bytes, and shell chars).
 */
export function sanitizeFileName(rawTitle: string, quality: string, ext = 'mp4'): string {
  const safeBase = (rawTitle || 'movie')
    .replace(/\.\.+/g, '')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);

  const safeQuality = (quality || '720p').replace(/[^a-zA-Z0-9]/g, '');
  const safeExt = (ext || 'mp4').replace(/[^a-zA-Z0-9]/g, '');
  return `${safeBase || 'cinebox_video'}_${safeQuality}.${safeExt}`;
}

/**
 * Builds a clean public export path (`Download/<AppName>/<File>.mp4`) preventing directory traversal.
 */
export function buildPublicExportPath(
  appName: string | undefined,
  movieTitle: string,
  quality: string
): string {
  const cleanFolder = (appName || 'CineBox')
    .replace(/\.\.+/g, '')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  const safeFolder = cleanFolder || 'CineBox';
  const fileName = sanitizeFileName(movieTitle, quality, 'mp4');
  return `Download/${safeFolder}/${fileName}`;
}

/**
 * Sanitizes HTML snippet for the compact top banner (`banner_ad_html`)
 * by stripping `<script>`, `<iframe>`, `<object>`, `<embed>`, and inline event handlers (`on*=`).
 */
export function sanitizeBannerHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  return rawHtml
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<(object|embed|form|meta|link|style)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:')
    .trim();
}

/**
 * Strict Static-Only Banner Sanitizer:
 * - Strips `<script>`, `<iframe>`, `window.open`, redirects, and inline JS handlers.
 * - Neutralizes `<a>` anchor tags into non-clickable `<span>` elements (`pointer-events-none`)
 *   so clicking a banner never opens a popup or redirects the browser.
 */
export function sanitizeStaticBannerAdCode(rawHtml: string | null | undefined): string {
  const baseClean = sanitizeBannerHtml(rawHtml);
  if (!baseClean) return '';

  return baseClean
    .replace(/window\.open\s*\([^)]*\)/gi, '')
    .replace(/location\.(href|assign|replace)\s*=/gi, '')
    .replace(/<a\b[^>]*>/gi, '<span class="pointer-events-none select-none">')
    .replace(/<\/a>/gi, '</span>')
    .trim();
}

/**
 * Verifies that an HTML snippet contains zero external ad scripts, popunders, or inline JS handlers.
 */
export function verifyAdFreeHtmlGuard(rawHtml: string | null | undefined): {
  isAdFree: boolean;
  sanitizedHtml: string;
  blockedPatterns: string[];
} {
  if (!rawHtml || typeof rawHtml !== 'string' || !rawHtml.trim()) {
    return { isAdFree: true, sanitizedHtml: '', blockedPatterns: [] };
  }

  const blockedPatterns: string[] = [];
  if (/<script\b/i.test(rawHtml)) blockedPatterns.push('script-tag');
  if (/window\.open/i.test(rawHtml)) blockedPatterns.push('window.open-popunder');
  if (/\son[a-z]+\s*=/i.test(rawHtml)) blockedPatterns.push('inline-event-handler');
  if (/javascript\s*:/i.test(rawHtml)) blockedPatterns.push('javascript-uri');

  if (blockedPatterns.length > 0) {
    return {
      isAdFree: false,
      sanitizedHtml: '',
      blockedPatterns,
    };
  }

  return {
    isAdFree: true,
    sanitizedHtml: sanitizeStaticBannerAdCode(rawHtml),
    blockedPatterns: [],
  };
}

/**
 * Phase 1 Security: Verifies if a Supabase Auth user or session has `app_metadata.role === 'admin'`.
 * Never trusts client-side PINs, user_metadata (which users can edit themselves), or hardcoded emails.
 */
export function isAdminJwtUser(userOrSession: unknown): boolean {
  if (!userOrSession || typeof userOrSession !== 'object') return false;
  const candidate = userOrSession as Record<string, any>;
  const userObj = candidate.user && typeof candidate.user === 'object' ? candidate.user : candidate;
  const role = userObj?.app_metadata?.role;
  return role === 'admin';
}

/**
 * Verifies if a Supabase Auth user or session has `app_metadata.role` in `['admin', 'moderator']`.
 */
export function isModeratorOrAdminJwtUser(userOrSession: unknown): boolean {
  if (!userOrSession || typeof userOrSession !== 'object') return false;
  const candidate = userOrSession as Record<string, any>;
  const userObj = candidate.user && typeof candidate.user === 'object' ? candidate.user : candidate;
  const role = userObj?.app_metadata?.role;
  return role === 'admin' || role === 'moderator';
}

/**
 * Strips `<script>...</script>`, `<style>...</style>`, HTML tags, and control characters from untrusted text.
 */
export function stripHtmlAndScriptContent(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/javascript\s*:/gi, '')
    .replace(/on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Sanitizes any database record fields before rendering in the UI.
 */
export function sanitizeDatabaseTextField(
  raw: string | null | undefined,
  maxLen = 240
): string {
  return stripHtmlAndScriptContent(raw || '', maxLen);
}

const ALLOWED_ISO_LANGUAGE_CODES = new Set([
  'en',
  'en-us',
  'en-gb',
  'hi',
  'hi-in',
  'ur',
  'ur-pk',
  'ta',
  'te',
  'ml',
  'kn',
  'bn',
  'pa',
  'mr',
  'gu',
  'ko',
  'ja',
  'zh',
  'es',
  'fr',
  'de',
  'ru',
  'ar',
  'tr',
  'pt',
  'it',
  'id',
  'th',
  'vi',
  'multi',
  'und',
]);

/**
 * Strictly validates and sanitizes an untrusted `alternate_streams` array from database JSONB or admin input.
 */
export function sanitizeAlternateStreamsList(
  rawList: unknown,
  maxItems = 12
): AlternateLanguageStreamOption[] {
  if (!Array.isArray(rawList)) return [];

  const sanitizedStreams: AlternateLanguageStreamOption[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (const item of rawList) {
    if (sanitizedStreams.length >= maxItems) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const candidate = item as Record<string, unknown>;
    const safeUrl = sanitizeSafeUrl(
      typeof candidate.url === 'string' ? candidate.url : null
    );
    if (!safeUrl) continue;

    const rawLangCode =
      typeof candidate.languageCode === 'string'
        ? candidate.languageCode
            .toLowerCase()
            .replace(/[^a-z-]/g, '')
            .slice(0, 12)
        : '';
    if (!rawLangCode || !ALLOWED_ISO_LANGUAGE_CODES.has(rawLangCode)) {
      continue;
    }

    const cleanLabel = stripHtmlAndScriptContent(candidate.label, 64);
    const cleanLanguageName = stripHtmlAndScriptContent(candidate.languageName, 32);
    if (!cleanLabel || !cleanLanguageName) continue;

    const rawId =
      typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
        : `alt-${rawLangCode}-${sanitizedStreams.length + 1}`;
    if (!rawId || seenIds.has(rawId) || seenUrls.has(safeUrl)) {
      continue;
    }

    const rawAudioType = candidate.audioType;
    const safeAudioType: 'original' | 'dubbed' | 'multi' =
      rawAudioType === 'original' || rawAudioType === 'dubbed' || rawAudioType === 'multi'
        ? rawAudioType
        : 'dubbed';

    const rawFormat = candidate.format;
    const safeFormat: 'hls' | 'mp4' | 'embed' =
      rawFormat === 'hls' || rawFormat === 'mp4' || rawFormat === 'embed'
        ? rawFormat
        : safeUrl.toLowerCase().includes('.m3u8')
        ? 'hls'
        : 'mp4';

    seenIds.add(rawId);
    seenUrls.add(safeUrl);

    sanitizedStreams.push({
      id: rawId,
      label: cleanLabel,
      languageCode: rawLangCode,
      languageName: cleanLanguageName,
      audioType: safeAudioType,
      url: safeUrl,
      format: safeFormat,
      verified: Boolean(candidate.verified),
    });
  }

  return sanitizedStreams;
}

/**
 * Rejects Supabase `service_role` secret keys on the client so a privileged key can never be saved in browser storage.
 */
export function isForbiddenServiceRoleKey(rawKey: string | null | undefined): boolean {
  if (!rawKey || typeof rawKey !== 'string') return false;
  const trimmed = rawKey.trim();
  if (!trimmed) return false;

  if (/service_role/i.test(trimmed) || /^sb_secret_/i.test(trimmed)) {
    return true;
  }

  const parts = trimmed.split('.');
  if (parts.length === 3) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const jsonPayload =
        typeof atob === 'function'
          ? atob(padded)
          : Buffer.from(padded, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonPayload);
      if (parsed && (parsed.role === 'service_role' || parsed.role === 'supabase_admin')) {
        return true;
      }
    } catch {
      // Ignore malformed JWT segments
    }
  }

  return false;
}

/**
 * Validates a MovieLinkRecord before saving to Supabase `movie_links`.
 */
export function validateMovieLinkInput(input: Partial<MovieLinkRecord>): {
  valid: boolean;
  error: string | null;
  sanitized: MovieLinkRecord | null;
} {
  const tmdbId = Number(input.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return {
      valid: false,
      error: 'Valid positive integer tmdb_id is required.',
      sanitized: null,
    };
  }

  const checkOptionalUrl = (
    url: string | null | undefined,
    fieldName: string
  ): { ok: boolean; clean: string | null; err?: string } => {
    if (!url || url.trim() === '') return { ok: true, clean: null };
    const safe = sanitizeSafeUrl(url);
    if (!safe) {
      return {
        ok: false,
        clean: null,
        err: `${fieldName} must be a valid http:// or https:// URL.`,
      };
    }
    return { ok: true, clean: safe };
  };

  const directCheck = checkOptionalUrl(input.direct_video_url, 'direct_video_url');
  if (!directCheck.ok) return { valid: false, error: directCheck.err!, sanitized: null };

  const hindiCheck = checkOptionalUrl(input.hindi_dubbed_video_url, 'hindi_dubbed_video_url');
  if (!hindiCheck.ok) return { valid: false, error: hindiCheck.err!, sanitized: null };

  const urduCheck = checkOptionalUrl(input.urdu_dubbed_video_url, 'urdu_dubbed_video_url');
  if (!urduCheck.ok) return { valid: false, error: urduCheck.err!, sanitized: null };

  const streamCheck = checkOptionalUrl(input.stream_url, 'stream_url');
  if (!streamCheck.ok) return { valid: false, error: streamCheck.err!, sanitized: null };

  const dl480Check = checkOptionalUrl(input.download_480p, 'download_480p');
  if (!dl480Check.ok) return { valid: false, error: dl480Check.err!, sanitized: null };

  const dl720Check = checkOptionalUrl(input.download_720p, 'download_720p');
  if (!dl720Check.ok) return { valid: false, error: dl720Check.err!, sanitized: null };

  const dl1080Check = checkOptionalUrl(input.download_1080p, 'download_1080p');
  if (!dl1080Check.ok) return { valid: false, error: dl1080Check.err!, sanitized: null };

  const sanitizedAlternateStreams = sanitizeAlternateStreamsList(input.alternate_streams, 12);
  const sanitizedSubtitles = Array.isArray(input.subtitles)
    ? input.subtitles
        .filter((s) => s && typeof s === 'object' && !Array.isArray(s))
        .map((s) => {
          const safeSubUrl = sanitizeSafeUrl(typeof s.url === 'string' ? s.url : null);
          if (!safeSubUrl) return null;
          const lang =
            typeof s.lang === 'string' && s.lang.trim()
              ? s.lang.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12)
              : 'en';
          const label =
            stripHtmlAndScriptContent(s.label, 48) ||
            (lang === 'ur' ? 'Urdu (اردو)' : lang === 'hi' ? 'Hindi (हिन्दी)' : 'English');
          return { lang: lang || 'en', label, url: safeSubUrl };
        })
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .slice(0, 16)
    : [];

  return {
    valid: true,
    error: null,
    sanitized: {
      tmdb_id: tmdbId,
      title: stripHtmlAndScriptContent(input.title || '', 120),
      language: stripHtmlAndScriptContent(input.language || 'Hindi / English', 40) || 'Hindi / English',
      direct_video_url: directCheck.clean,
      hindi_dubbed_video_url: hindiCheck.clean,
      urdu_dubbed_video_url: urduCheck.clean,
      alternate_streams: sanitizedAlternateStreams.length > 0 ? sanitizedAlternateStreams : [],
      subtitles: sanitizedSubtitles,
      intro_start:
        typeof input.intro_start === 'number' && input.intro_start >= 0
          ? Math.floor(input.intro_start)
          : null,
      intro_end:
        typeof input.intro_end === 'number' && input.intro_end >= 0
          ? Math.floor(input.intro_end)
          : null,
      stream_url: streamCheck.clean,
      download_480p: dl480Check.clean,
      download_720p: dl720Check.clean,
      download_1080p: dl1080Check.clean,
      file_size_480p: (input.file_size_480p || '450.0MB').trim().slice(0, 20),
      file_size_720p: (input.file_size_720p || '1020.6MB').trim().slice(0, 20),
      file_size_1080p: (input.file_size_1080p || '2150.0MB').trim().slice(0, 20),
      is_trending: input.is_trending ?? true,
      updated_at: new Date().toISOString(),
    },
  };
}

/**
 * Parses bulk movie links from either JSON array or Pipe/CSV lines:
 * Format: `tmdb_id | title | language | direct_video_url | stream_url | download_480p | download_720p`
 */
export function parseDirectBulkMovieLinksInput(rawText: string): {
  validRecords: MovieLinkRecord[];
  errors: string[];
} {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return { validRecords: [], errors: ['Input is empty.'] };

  const validRecords: MovieLinkRecord[] = [];
  const errors: string[] = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      list.forEach((item, idx) => {
        const res = validateMovieLinkInput(item);
        if (res.valid && res.sanitized) {
          validRecords.push(res.sanitized);
        } else {
          errors.push(`Row ${idx + 1}: ${res.error}`);
        }
      });
      return { validRecords, errors };
    } catch {
      errors.push('Invalid JSON format.');
      return { validRecords, errors };
    }
  }

  const lines = trimmed.split('\n');
  lines.forEach((line, idx) => {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) return;

    const parts = (l.includes('|') ? l.split('|') : l.split(',')).map((p) => p.trim());
    if (parts.length < 2) {
      errors.push(`Line ${idx + 1}: Expected at least tmdb_id and title/url.`);
      return;
    }

    const tmdbId = Number(parts[0]);
    const title = parts[1] || `Movie #${tmdbId}`;
    const language = parts[2] || 'Hindi / English';
    const directUrl = parts[3] || '';
    const streamUrl = parts[4] || '';
    const dl480 = parts[5] || directUrl || '';
    const dl720 = parts[6] || directUrl || '';

    const validation = validateMovieLinkInput({
      tmdb_id: tmdbId,
      title,
      language,
      direct_video_url: directUrl,
      stream_url: streamUrl,
      download_480p: dl480,
      download_720p: dl720,
    });

    if (validation.valid && validation.sanitized) {
      validRecords.push(validation.sanitized);
    } else {
      errors.push(`Line ${idx + 1} (${parts[0]}): ${validation.error}`);
    }
  });

  return { validRecords, errors };
}

/**
 * Validates and sanitizes an AppUserRecord for the `app_users` table.
 */
export function validateAppUserInput(input: Partial<AppUserRecord>): {
  valid: boolean;
  error: string | null;
  sanitized: AppUserRecord | null;
} {
  const cleanUsername = (input.username || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 60);

  if (cleanUsername.length < 2) {
    return {
      valid: false,
      error: 'Username must be at least 2 characters.',
      sanitized: null,
    };
  }

  const cleanEmail = (input.email || '').trim().toLowerCase().slice(0, 100);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return {
      valid: false,
      error: 'Valid email address is required.',
      sanitized: null,
    };
  }

  const validRoles: AppUserRole[] = ['user', 'vip', 'moderator', 'admin'];
  const role: AppUserRole = validRoles.includes(input.role as AppUserRole)
    ? (input.role as AppUserRole)
    : 'user';

  const validStatuses: AppUserStatus[] = ['active', 'suspended', 'banned'];
  const status: AppUserStatus = validStatuses.includes(input.status as AppUserStatus)
    ? (input.status as AppUserStatus)
    : 'active';

  const validPlatforms: AppUserPlatform[] = [
    'Android',
    'Web',
    'Android APK',
    'Web Browser',
    'iOS / Other',
  ];
  const platform: AppUserPlatform = validPlatforms.includes(input.platform as AppUserPlatform)
    ? (input.platform as AppUserPlatform)
    : 'Android';

  const cleanId =
    (input.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) ||
    `usr_${Date.now().toString(36)}`;

  const cleanNotes = (input.notes || '').replace(/[<>]/g, '').trim().slice(0, 200);

  const nowMs = Date.now();
  const defaultTrialStart = new Date(nowMs).toISOString();
  const defaultTrialEnd = new Date(nowMs + 3 * 24 * 60 * 60 * 1000).toISOString();

  return {
    valid: true,
    error: null,
    sanitized: {
      id: cleanId,
      username: cleanUsername,
      email: cleanEmail,
      role,
      status,
      platform,
      downloads_count: Math.max(0, Number(input.downloads_count) || 0),
      last_active: input.last_active || new Date().toISOString(),
      notes: cleanNotes,
      trial_start_date: input.trial_start_date ?? defaultTrialStart,
      trial_end_date: input.trial_end_date ?? defaultTrialEnd,
      referral_code: input.referral_code
        ? String(input.referral_code).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 24)
        : undefined,
      referred_by: input.referred_by
        ? String(input.referred_by).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 24)
        : null,
      successful_referrals: Math.max(0, Number(input.successful_referrals) || 0),
      access_expiry_date: input.access_expiry_date ?? null,
    },
  };
}

/**
 * Generates a deterministic, human-readable Allotted User ID (`USR-XXXXXX`) from a user's email
 * when a Supabase Auth UUID is not yet assigned.
 */
export function generateAllottedUserId(email: string): string {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return 'USR-000000';
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positiveNum = (hash >>> 0).toString(10).padStart(6, '0').slice(0, 10);
  return `USR-${positiveNum}`;
}

/**
 * Evaluates whether the current user is allowed to use the app based on global `app_config`
 * (maintenance_mode) and their `app_users` status (`active`, `suspended`, `banned`).
 */
export function evaluateGlobalUserAccess(
  user: Pick<AppUserRecord, 'status' | 'role'> | null | undefined,
  appConfig: Pick<AppConfigRecord, 'maintenance_mode'> | null | undefined,
  isAdminUnlocked = false
): {
  allowed: boolean;
  reason: string | null;
  message: string;
} {
  if (isAdminUnlocked) {
    return { allowed: true, reason: null, message: '' };
  }

  if (user?.status === 'banned') {
    const msg = 'Your account has been permanently banned by the CineBox Administrator.';
    return {
      allowed: false,
      reason: msg,
      message: msg,
    };
  }

  if (user?.status === 'suspended') {
    const msg = 'Your account is temporarily suspended by the CineBox Administrator.';
    return {
      allowed: false,
      reason: msg,
      message: msg,
    };
  }

  if (appConfig?.maintenance_mode && user?.role !== 'admin') {
    const msg =
      'CineBox is currently undergoing scheduled maintenance. Please check back shortly.';
    return {
      allowed: false,
      reason: msg,
      message: msg,
    };
  }

  return { allowed: true, reason: null, message: '' };
}
