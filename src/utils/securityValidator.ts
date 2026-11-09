import {
  AlternateLanguageStream,
  AppConfigRecord,
  AppUserRecord,
  MovieLinkRecord,
  UserAccountStatus,
  UserRole,
} from '../types/movie';

/**
 * Security & Input Sanitization Utilities
 * Protects against XSS, Path Traversal in Capacitor Filesystem, SQL/NoSQL injection patterns,
 * and Admin PIN brute-force attacks.
 */

const ALLOWED_URL_PROTOCOLS = ['https:', 'http:', 'blob:', 'capacitor:'];

/**
 * Validates and sanitizes a URL string.
 * Blocks `javascript:`, `data:text/html`, `vbscript:`, and malformed URLs.
 */
export function sanitizeSafeUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  // Allow safe data:image/* URIs for local SVG posters
  if (trimmed.startsWith('data:image/svg+xml') || trimmed.startsWith('data:image/png') || trimmed.startsWith('data:image/jpeg')) {
    return trimmed;
  }

  // Block dangerous schemes immediately
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:') ||
    lower.includes('<script') ||
    lower.includes('onerror=') ||
    lower.includes('onload=')
  ) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Sanitizes a movie title into a safe filesystem filename, preventing
 * path traversal (`../`, `/`, `\`, null bytes) when writing to Capacitor Directory.Data or Directory.Documents.
 */
export function sanitizeFileName(rawTitle: string, quality: string = '720p', ext: string = 'mp4'): string {
  const safeBase = (rawTitle || 'movie')
    .replace(/\.\.+/g, '')
    .replace(/[/\\?%*:|"<>#\0]/g, '')
    .replace(/\[|\]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);

  const normalizedBase = safeBase.length > 0 ? safeBase : 'CineBox_Movie';
  const safeQuality = (quality || '720p').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || '720p';
  const safeExt = (ext || 'mp4').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'mp4';

  return `${normalizedBase}_${safeQuality}.${safeExt}`;
}

/**
 * Constructs a safe public device storage path `/Download/[AppName]/[FileName]`
 * with strict path traversal prevention.
 */
export function buildPublicExportPath(appName: string, movieTitle: string, quality: string = '720p'): string {
  const safeAppFolder = (appName || 'CineBox')
    .replace(/\.\.+/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32) || 'CineBox';

  const fileName = sanitizeFileName(movieTitle, quality, 'mp4');
  return `Download/${safeAppFolder}/${fileName}`;
}

/**
 * Sanitizes HTML snippet used in `banner_ad_html` to strip `<script>`, `<iframe>`,
 * `<object>`, `<embed>`, inline event handlers (`onerror`, `onclick`, `onload`), and `javascript:` links.
 */
export function sanitizeBannerHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return '';
  }
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<(object|embed|form|meta|link|style|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:')
    .trim();
}

export interface PinRateLimitState {
  failedAttempts: number;
  lockedUntilMs: number;
}

/**
 * Rate-limited Admin PIN verification to block brute-force attempts on the hidden Admin Panel.
 * Locks out for 60 seconds after 5 consecutive failed attempts.
 */
export function verifyAdminPinWithRateLimit(
  inputPin: string,
  expectedPin: string,
  state: PinRateLimitState,
  nowMs: number = Date.now()
): { allowed: boolean; locked: boolean; remainingLockSeconds: number; nextState: PinRateLimitState } {
  if (state.lockedUntilMs > nowMs) {
    const remainingLockSeconds = Math.ceil((state.lockedUntilMs - nowMs) / 1000);
    return {
      allowed: false,
      locked: true,
      remainingLockSeconds,
      nextState: state,
    };
  }

  const cleanInput = (inputPin || '').trim();
  const cleanExpected = (expectedPin || '1234').trim();

  // Constant-length check
  let isMatch = cleanInput.length === cleanExpected.length && cleanInput.length >= 4;
  for (let i = 0; i < cleanExpected.length; i++) {
    if (cleanInput.charCodeAt(i) !== cleanExpected.charCodeAt(i)) {
      isMatch = false;
    }
  }

  if (isMatch) {
    return {
      allowed: true,
      locked: false,
      remainingLockSeconds: 0,
      nextState: { failedAttempts: 0, lockedUntilMs: 0 },
    };
  }

  const nextFailed = state.failedAttempts + 1;
  const maxAttempts = 5;
  const lockDurationMs = 60_000;

  if (nextFailed >= maxAttempts) {
    return {
      allowed: false,
      locked: true,
      remainingLockSeconds: 60,
      nextState: {
        failedAttempts: nextFailed,
        lockedUntilMs: nowMs + lockDurationMs,
      },
    };
  }

  return {
    allowed: false,
    locked: false,
    remainingLockSeconds: 0,
    nextState: {
      failedAttempts: nextFailed,
      lockedUntilMs: 0,
    },
  };
}

/**
 * Validates and normalizes `movie_links` payload before saving to Supabase.
 */
export function validateMovieLinkInput(input: Partial<MovieLinkRecord>): {
  valid: boolean;
  error?: string;
  sanitized?: MovieLinkRecord;
} {
  const tmdbId = Number(input.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 999_999_999) {
    return { valid: false, error: 'TMDb ID must be a valid positive integer.' };
  }

  const directUrl = input.direct_video_url ? sanitizeSafeUrl(input.direct_video_url) : null;
  if (input.direct_video_url && !directUrl) {
    return { valid: false, error: 'Direct Video URL is invalid or uses an unsafe protocol.' };
  }

  const streamUrl = input.stream_url ? sanitizeSafeUrl(input.stream_url) : null;
  if (input.stream_url && !streamUrl) {
    return { valid: false, error: 'Stream Embed URL is invalid or uses an unsafe protocol.' };
  }

  const dl480 = input.download_480p ? sanitizeSafeUrl(input.download_480p) : null;
  if (input.download_480p && !dl480) {
    return { valid: false, error: 'Download 480p URL is invalid or uses an unsafe protocol.' };
  }

  const dl720 = input.download_720p ? sanitizeSafeUrl(input.download_720p) : null;
  if (input.download_720p && !dl720) {
    return { valid: false, error: 'Download 720p URL is invalid or uses an unsafe protocol.' };
  }

  const hindiDubbedUrl = input.hindi_dubbed_video_url
    ? sanitizeSafeUrl(input.hindi_dubbed_video_url)
    : null;
  if (input.hindi_dubbed_video_url && !hindiDubbedUrl) {
    return { valid: false, error: 'Hindi Dubbed Video URL is invalid or uses an unsafe protocol.' };
  }

  const urduDubbedUrl = input.urdu_dubbed_video_url
    ? sanitizeSafeUrl(input.urdu_dubbed_video_url)
    : null;
  if (input.urdu_dubbed_video_url && !urduDubbedUrl) {
    return { valid: false, error: 'Urdu Dubbed Video URL is invalid or uses an unsafe protocol.' };
  }

  const safeLanguage = stripHtmlAndScriptContent(input.language || 'Hindi', 32) || 'Hindi';
  const safeTitle = stripHtmlAndScriptContent(input.title || '', 120);

  const sanitizedAlternateStreams = sanitizeAlternateStreamsList(input.alternate_streams);

  return {
    valid: true,
    sanitized: {
      tmdb_id: tmdbId,
      title: safeTitle,
      language: safeLanguage,
      direct_video_url: directUrl,
      hindi_dubbed_video_url: hindiDubbedUrl,
      urdu_dubbed_video_url: urduDubbedUrl,
      alternate_streams:
        sanitizedAlternateStreams.length > 0 ? sanitizedAlternateStreams : undefined,
      stream_url: streamUrl,
      download_480p: dl480,
      download_720p: dl720,
      download_1080p: input.download_1080p ? sanitizeSafeUrl(input.download_1080p) : dl720,
      file_size_480p: input.file_size_480p || '450.0MB',
      file_size_720p: input.file_size_720p || '1020.6MB',
      file_size_1080p: input.file_size_1080p || '2150.0MB',
    },
  };
}

/**
 * Valid ISO 639-1 / 639-2 / BCP-47 language code allowlist for stream metadata validation.
 */
const VALID_ISO_LANGUAGE_CODES = new Set([
  'en', 'eng', 'en-us', 'en-gb',
  'hi', 'hin', 'hi-in',
  'ur', 'urd', 'ur-pk',
  'ar', 'ara',
  'ta', 'tam',
  'te', 'tel',
  'ml', 'mal',
  'kn', 'kan',
  'pa', 'pan',
  'bn', 'ben',
  'es', 'spa',
  'fr', 'fra', 'fre',
  'de', 'deu', 'ger',
  'ja', 'jpn',
  'ko', 'kor',
  'zh', 'zho', 'chi',
  'ru', 'rus',
  'pt', 'por', 'pt-br',
  'it', 'ita',
  'tr', 'tur',
  'el', 'fa', 'id', 'ms', 'th', 'vi', 'nl', 'pl', 'uk', 'und',
]);

/**
 * Strips full `<script>...</script>`, `<style>...</style>`, HTML tags, inline JS handlers,
 * `javascript:`/`vbscript:`/`data:` schemes, JS execution patterns (`alert(...)`, `eval(...)`),
 * and control characters, then enforces `maxLen`.
 */
export function stripHtmlAndScriptContent(raw: unknown, maxLen: number = 64): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\bon\w+\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi, '')
    .replace(/\b(javascript|vbscript|data)\s*:/gi, '')
    .replace(/\b(alert|eval|prompt|confirm|Function|setTimeout|setInterval)\s*\([^)]*\)/gi, '')
    .replace(/\b(document|window|globalThis|localStorage|sessionStorage)\.[a-zA-Z0-9_$.]+/g, '')
    .replace(/[<>'"`;\r\n\t\0]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, maxLen));
}

/**
 * Strictly validates an ISO language code against `VALID_ISO_LANGUAGE_CODES`.
 */
export function validateIsoLanguageCode(raw: unknown): {
  valid: boolean;
  code: string;
} {
  if (typeof raw !== 'string') {
    return { valid: false, code: 'und' };
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { valid: false, code: 'und' };
  }
  if (!VALID_ISO_LANGUAGE_CODES.has(normalized)) {
    return { valid: false, code: 'und' };
  }
  const base = normalized.split('-')[0];
  return { valid: true, code: base.length === 3 && base === 'eng' ? 'en' : base === 'hin' ? 'hi' : base === 'urd' ? 'ur' : normalized };
}

/**
 * TASK 2:
 * Strictly validates and sanitizes an `alternate_streams` array:
 * - Rejects non-arrays, null/primitive items, and nested arrays.
 * - Rejects invalid or unsafe URLs via `sanitizeSafeUrl`.
 * - Rejects invalid language codes via `validateIsoLanguageCode`.
 * - Strips HTML tags and script-like expressions from `label`, `languageName`, and `id`.
 * - Enforces strict length limits (`id` <= 48, `label` <= 64, `languageName` <= 32, `languageCode` <= 12).
 * - Rejects duplicate `id`s and duplicate URLs.
 */
export function sanitizeAlternateStreamsList(rawList: unknown): AlternateLanguageStream[] {
  if (!Array.isArray(rawList)) return [];

  const result: AlternateLanguageStream[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (let idx = 0; idx < rawList.length; idx++) {
    const item = rawList[idx];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const rec = item as Record<string, unknown>;
    const safeStreamUrl = typeof rec.url === 'string' ? sanitizeSafeUrl(rec.url) : null;
    if (!safeStreamUrl) {
      continue;
    }

    const normUrlKey = safeStreamUrl.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(normUrlKey)) {
      continue;
    }

    // Validate languageCode strictly
    const langCheck = validateIsoLanguageCode(rec.languageCode);
    if (!langCheck.valid) {
      continue;
    }
    const cleanLangCode = langCheck.code.slice(0, 12);

    // Validate & sanitize id; reject malformed or duplicate IDs
    let cleanId = '';
    if (typeof rec.id === 'string' && rec.id.trim()) {
      const strippedId = stripHtmlAndScriptContent(rec.id, 48)
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 48);
      if (!strippedId) {
        continue;
      }
      cleanId = strippedId;
    } else {
      cleanId = `alt-${cleanLangCode}-${idx}`;
    }

    if (seenIds.has(cleanId.toLowerCase())) {
      continue;
    }

    // Sanitize languageName & label and enforce length limits
    const cleanLangName = stripHtmlAndScriptContent(rec.languageName, 32);
    const cleanLabel = stripHtmlAndScriptContent(rec.label, 64);

    // If caller supplied a non-empty label or languageName that consisted exclusively of malicious script/HTML, reject it
    if (typeof rec.label === 'string' && rec.label.trim().length > 0 && !cleanLabel) {
      continue;
    }
    if (typeof rec.languageName === 'string' && rec.languageName.trim().length > 0 && !cleanLangName) {
      continue;
    }

    const finalLangName = cleanLangName || 'Audio';
    const audioType: 'original' | 'dubbed' =
      rec.audioType === 'original' ? 'original' : 'dubbed';
    const finalLabel =
      cleanLabel || (audioType === 'dubbed' ? `${finalLangName} Dubbed` : `Original (${finalLangName})`);

    const format: 'hls' | 'mp4' | 'dash' =
      rec.format === 'hls' || rec.format === 'dash' || rec.format === 'mp4'
        ? rec.format
        : safeStreamUrl.toLowerCase().includes('.m3u8')
        ? 'hls'
        : safeStreamUrl.toLowerCase().includes('.mpd')
        ? 'dash'
        : 'mp4';

    seenIds.add(cleanId.toLowerCase());
    seenUrls.add(normUrlKey);

    result.push({
      id: cleanId,
      label: finalLabel,
      languageCode: cleanLangCode,
      languageName: finalLangName,
      audioType,
      url: safeStreamUrl,
      format,
      verified: rec.verified !== false,
    });
  }

  return result;
}

/**
 * TASK 4:
 * Detects and blocks Supabase `service_role` keys or secret backend keys from ever being
 * accepted or stored on the frontend client.
 */
export function isForbiddenServiceRoleKey(rawKey: unknown): boolean {
  if (typeof rawKey !== 'string' || !rawKey.trim()) return false;
  const trimmed = rawKey.trim();
  if (trimmed.toLowerCase().startsWith('sb_secret_') || trimmed.toLowerCase().includes('service_role')) {
    return true;
  }
  const parts = trimmed.split('.');
  if (parts.length === 3) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const jsonStr =
        typeof atob === 'function'
          ? atob(base64)
          : Buffer.from(base64, 'base64').toString('utf8');
      const payload = JSON.parse(jsonStr);
      if (payload && payload.role === 'service_role') {
        return true;
      }
    } catch {
      // Not a valid JWT payload
    }
  }
  return false;
}

const ALLOWED_ROLES: UserRole[] = ['user', 'vip', 'moderator', 'admin'];
const ALLOWED_STATUSES: UserAccountStatus[] = ['active', 'suspended', 'banned'];

/**
 * Validates and sanitizes an `AppUserRecord` before saving to Supabase `app_users` or decentralized sync.
 * Prevents XSS in usernames/notes and enforces valid RBAC roles and statuses.
 */
export function validateAppUserInput(input: Partial<AppUserRecord>): {
  valid: boolean;
  error?: string;
  sanitized?: AppUserRecord;
} {
  const rawUsername = typeof input.username === 'string' ? input.username : '';
  const cleanUsername = rawUsername
    .replace(/[<>'"`;\r\n\t\0]/g, '')
    .trim()
    .slice(0, 60);

  if (!cleanUsername || cleanUsername.length < 2) {
    return { valid: false, error: 'Username must be at least 2 characters long.' };
  }

  const rawEmail = typeof input.email === 'string' ? input.email : '';
  const cleanEmail = rawEmail
    .replace(/[<>'"`;\r\n\t\0\s]/g, '')
    .toLowerCase()
    .slice(0, 100);

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { valid: false, error: 'A valid email address is required.' };
  }

  const rawId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `USR-${Date.now()}`;
  const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || `USR-${Date.now()}`;

  const role: UserRole = ALLOWED_ROLES.includes(input.role as UserRole)
    ? (input.role as UserRole)
    : 'user';

  const status: UserAccountStatus = ALLOWED_STATUSES.includes(input.status as UserAccountStatus)
    ? (input.status as UserAccountStatus)
    : 'active';

  const rawPlatform = typeof input.platform === 'string' ? input.platform.trim() : '';
  const platform: 'Android' | 'Web' | 'Android APK' | 'Web Browser' =
    rawPlatform === 'Android' ||
    rawPlatform === 'Web' ||
    rawPlatform === 'Android APK' ||
    rawPlatform === 'Web Browser'
      ? rawPlatform
      : 'Android';

  const cleanNotes =
    typeof input.notes === 'string'
      ? input.notes.replace(/[<>'"`;]/g, '').trim().slice(0, 160)
      : '';

  const cleanVipUntil =
    typeof input.vip_until === 'string' && input.vip_until.trim()
      ? input.vip_until.replace(/[^0-9-]/g, '').slice(0, 16)
      : '2027-12-30';

  const cleanTrialStart =
    typeof input.trial_start_date === 'string' && Number.isFinite(Date.parse(input.trial_start_date))
      ? new Date(Date.parse(input.trial_start_date)).toISOString()
      : undefined;

  const cleanTrialEnd =
    typeof input.trial_end_date === 'string' && Number.isFinite(Date.parse(input.trial_end_date))
      ? new Date(Date.parse(input.trial_end_date)).toISOString()
      : undefined;

  const cleanAccessExpiry =
    typeof input.access_expiry_date === 'string' && Number.isFinite(Date.parse(input.access_expiry_date))
      ? new Date(Date.parse(input.access_expiry_date)).toISOString()
      : null;

  const cleanReferralCode =
    typeof input.referral_code === 'string' && input.referral_code.trim()
      ? input.referral_code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16)
      : undefined;

  const cleanReferredBy =
    typeof input.referred_by === 'string' && input.referred_by.trim()
      ? input.referred_by.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16)
      : null;

  const cleanSuccessfulReferrals = Math.max(
    0,
    Math.floor(Number(input.successful_referrals) || 0)
  );

  return {
    valid: true,
    sanitized: {
      id: cleanId,
      username: cleanUsername,
      email: cleanEmail,
      role,
      status,
      platform,
      device_id: (input.device_id || cleanId).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64),
      vip_until: cleanVipUntil,
      downloads_count: Math.max(0, Math.floor(Number(input.downloads_count) || 0)),
      notes: cleanNotes,
      trial_start_date: cleanTrialStart,
      trial_end_date: cleanTrialEnd,
      referral_code: cleanReferralCode,
      referred_by: cleanReferredBy,
      successful_referrals: cleanSuccessfulReferrals,
      access_expiry_date: cleanAccessExpiry,
      updated_at: new Date().toISOString(),
    },
  };
}

/**
 * Parses direct bulk movie link uploads in JSON array OR pipe/CSV lines:
 * Format: `tmdb_id | title | language | direct_video_url | stream_url | download_480p | download_720p | download_1080p`
 */
export function parseDirectBulkMovieLinksInput(rawText: string): {
  validRecords: MovieLinkRecord[];
  errors: string[];
} {
  const validRecords: MovieLinkRecord[] = [];
  const errors: string[] = [];

  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return { validRecords, errors: ['Input is empty.'] };
  }

  const trimmed = rawText.trim();

  // 1. Check if JSON array or manifest object
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.movie_links)
        ? parsed.movie_links
        : [];
      list.forEach((item: Partial<MovieLinkRecord>, idx: number) => {
        const res = validateMovieLinkInput(item);
        if (res.valid && res.sanitized) {
          validRecords.push(res.sanitized);
        } else {
          errors.push(`Row ${idx + 1}: ${res.error || 'Invalid movie link object'}`);
        }
      });
      return { validRecords, errors };
    } catch {
      errors.push('Invalid JSON format.');
      return { validRecords, errors };
    }
  }

  // 2. Otherwise parse line-by-line pipe (`|`) or CSV (`,`) rows
  const lines = trimmed.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.startsWith('#') || cleanLine.toLowerCase().startsWith('tmdb_id')) {
      return;
    }

    const parts = (cleanLine.includes('|') ? cleanLine.split('|') : cleanLine.split(',')).map((p) =>
      p.trim()
    );

    const tmdbId = Number(parts[0]);
    const title = parts[1] || `Movie #${tmdbId}`;
    const language = parts[2] || 'Hindi Dubbed';
    const directVideoUrl = parts[3] || null;
    const streamUrl = parts[4] || null;
    const dl480 = parts[5] || directVideoUrl || null;
    const dl720 = parts[6] || directVideoUrl || null;
    const dl1080 = parts[7] || dl720 || directVideoUrl || null;
    const hindiDubbedVideoUrl = parts[8] || null;
    const urduDubbedVideoUrl = parts[9] || null;

    const res = validateMovieLinkInput({
      tmdb_id: tmdbId,
      title,
      language,
      direct_video_url: directVideoUrl,
      hindi_dubbed_video_url: hindiDubbedVideoUrl,
      urdu_dubbed_video_url: urduDubbedVideoUrl,
      stream_url: streamUrl,
      download_480p: dl480,
      download_720p: dl720,
      download_1080p: dl1080,
    });

    if (res.valid && res.sanitized) {
      validRecords.push(res.sanitized);
    } else {
      errors.push(`Line ${idx + 1} ("${cleanLine.slice(0, 35)}..."): ${res.error}`);
    }
  });

  return { validRecords, errors };
}

/**
 * Evaluates whether the current user is allowed to access the app/playback based on global Admin controls
 * (`banned` / `suspended` user status or `maintenance_mode`). Admins always bypass maintenance locks.
 */
export function evaluateGlobalUserAccess(
  user: AppUserRecord | null | undefined,
  config: Partial<AppConfigRecord> | null | undefined,
  isAdminUnlocked: boolean
): {
  allowed: boolean;
  reason?: 'banned' | 'suspended' | 'maintenance';
  message?: string;
} {
  if (isAdminUnlocked || user?.role === 'admin') {
    return { allowed: true };
  }

  if (user?.status === 'banned') {
    return {
      allowed: false,
      reason: 'banned',
      message:
        'Your account or device ID has been banned by the CineBox Global Administrator due to policy violations.',
    };
  }

  if (user?.status === 'suspended') {
    return {
      allowed: false,
      reason: 'suspended',
      message:
        'Your account is temporarily suspended by the Administrator. Please contact support to restore access.',
    };
  }

  if (config?.maintenance_mode) {
    return {
      allowed: false,
      reason: 'maintenance',
      message:
        'CineBox Global Maintenance Mode is active while new movies and CDN servers are being updated. Please check back shortly.',
    };
  }

  return { allowed: true };
}

/**
 * Generates a deterministic allotted `USR-XXXXXXXX` ID from a user's normalized email
 * so the same user receives the same allotted ID across Web & Capacitor Android APK.
 */
export function generateAllottedUserId(email: string): string {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) {
    return 'USR-10000001';
  }
  let hash = 2166136261;
  for (let i = 0; i < cleanEmail.length; i++) {
    hash ^= cleanEmail.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positiveDigits = String(Math.abs(hash >>> 0)).padStart(8, '0').slice(0, 10);
  return `USR-${positiveDigits}`;
}

/**
 * Validates an Admin "Forgot PIN" recovery request by verifying the registered Admin email
 * and sanitizing the new PIN.
 */
export function verifyAdminPinRecovery(
  enteredEmail: string,
  configuredAdminEmail: string,
  newPin: string
): { valid: boolean; error?: string; sanitizedPin?: string } {
  const cleanEntered = (enteredEmail || '').trim().toLowerCase();
  const cleanExpected = (configuredAdminEmail || 'zulqarnainshah25@gmail.com').trim().toLowerCase();

  if (!cleanEntered || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEntered)) {
    return { valid: false, error: 'Please enter a valid Admin email address.' };
  }

  if (cleanEntered !== cleanExpected) {
    return {
      valid: false,
      error: 'Entered email does not match the registered Administrator email.',
    };
  }

  const cleanPin = (newPin || '').replace(/[<>'"`;\s]/g, '').trim();
  if (cleanPin.length < 4 || cleanPin.length > 16) {
    return {
      valid: false,
      error: 'New Admin PIN must be between 4 and 16 characters long.',
    };
  }

  return { valid: true, sanitizedPin: cleanPin };
}

/**
 * Verifies that HTML or script snippets do not load external ad-network scripts,
 * popunders, or inline XSS handlers while the app operates in 100% Ad-Free mode.
 */
export function verifyAdFreeHtmlGuard(rawMarkup: string | null | undefined): {
  isAdFree: boolean;
  sanitizedHtml: string;
  blockedReason?: string;
} {
  if (!rawMarkup || typeof rawMarkup !== 'string' || !rawMarkup.trim()) {
    return {
      isAdFree: true,
      sanitizedHtml: '',
    };
  }

  const lower = rawMarkup.toLowerCase();
  if (
    lower.includes('<script') ||
    lower.includes('javascript:') ||
    lower.includes('onerror=') ||
    lower.includes('onload=') ||
    lower.includes('onclick=') ||
    lower.includes('window.open') ||
    lower.includes('popunder')
  ) {
    return {
      isAdFree: false,
      sanitizedHtml: '',
      blockedReason: 'External ad scripts, popunders, and inline event handlers are blocked in Ad-Free mode.',
    };
  }

  return {
    isAdFree: true,
    sanitizedHtml: sanitizeStaticBannerAdCode(rawMarkup),
  };
}

/**
 * Strictly sanitizes any static HTML markup so that:
 * 1. All `<script>` tags that trigger redirects, popups, popunders, or click hijacking are stripped.
 * 2. All clickable `<a href="..." target="_blank">` wrappers and inline mouse/click handlers are neutralized.
 */
export function sanitizeStaticBannerAdCode(rawHtml: string | null | undefined): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return '';
  }

  return rawHtml
    // Strip all <script> blocks (external or inline)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Strip <iframe ...>, <object>, <embed>, <meta http-equiv="refresh">, <form>, <base>
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<(object|embed|form|meta|link|style|base)\b[^>]*>/gi, '')
    // Strip all inline event handlers (onclick, onmousedown, onmouseup, ontouchstart, onerror, onload, etc.)
    .replace(/\son[a-z]+\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi, '')
    // Convert any <a ...> tags into non-interactive <span> elements
    .replace(/<a\b[^>]*>/gi, '<span class="pointer-events-none select-none">')
    .replace(/<\/a>/gi, '</span>')
    // Neutralize javascript: and data: URIs
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:')
    .trim();
}
