import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import {
  AppConfigRecord,
  AppUserRecord,
  AuditLogRow,
  MovieItem,
  MovieLinkRecord,
  UserAppSettings,
} from '../types/movie';
import {
  generateAllottedUserId,
  isAdminJwtUser,
  isForbiddenServiceRoleKey,
  sanitizeAlternateStreamsList,
  sanitizeBannerHtml,
  sanitizeDatabaseTextField,
  sanitizeSafeUrl,
  validateAppUserInput,
  validateMovieLinkInput,
} from '../utils/securityValidator';
import {
  applyReferralRewardToReferrer,
  buildInitialTrialAndReferralFields,
  buildProductionShareUrl,
  detectAppPlatform,
  generateUniqueReferralCode,
  normalizeReferralCode,
} from './platformTrialReferralService';
import {
  DEFAULT_CURRENT_APP_VERSION,
  DEFAULT_GLOBAL_APK_DOWNLOAD_URL,
  DEFAULT_GLOBAL_APK_RELEASE_NOTES,
  DEFAULT_OFFICIAL_WEBSITE_URL,
  decodeGlobalApkConfigCarrier,
  encodeGlobalApkConfigCarrier,
  extractGoogleDriveFileId,
  normalizeOfficialWebsiteUrl,
  toGoogleDriveDirectDownloadUrl,
} from './inAppUpdateService';

export {
  DEFAULT_GLOBAL_APK_DOWNLOAD_URL,
  DEFAULT_OFFICIAL_WEBSITE_URL,
  extractGoogleDriveFileId,
  normalizeOfficialWebsiteUrl,
  toGoogleDriveDirectDownloadUrl,
};

/**
 * Phase 1 Security Architecture:
 * - Zero hardcoded secrets or service_role keys in source code.
 * - Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` strictly from environment variables.
 * - Admin authentication uses Supabase Auth (`signInWithPassword` / `signInWithOtp`) and checks
 *   the JWT claim `app_metadata.role === 'admin'` via `isAdminJwtUser`.
 * - `admin_pin_hash` and `admin_email` have been completely removed from schema, types, and config.
 * - Fake/demo users and fake/demo movie links have been removed.
 */

const LOCAL_LINKS_KEY = 'cinebox_movie_links_v1';
const LOCAL_CONFIG_KEY = 'cinebox_app_config_v1';
const LOCAL_USERS_KEY = 'cinebox_app_users_v1';
const LOCAL_AUTH_HASHES_KEY = 'cinebox_local_auth_hashes_v1';

export const PUBLIC_APP_CONFIG_COLUMNS =
  'id,is_ads_enabled,ad_network_provider,admob_app_id,admob_banner_id,admob_interstitial_id,admob_app_open_id,banner_ad_html,popup_ad_link,popup_ad_image,app_name,primary_theme,featured_movie_ids,maintenance_mode,allow_guest_downloads,announcement_banner,official_website,apk_download_url,apk_latest_version,apk_release_notes,updated_at';

export const DEFAULT_APP_CONFIG: AppConfigRecord = {
  id: 1,
  is_ads_enabled: false,
  ad_network_provider: 'none',
  admob_app_id: '',
  admob_banner_id: '',
  admob_interstitial_id: '',
  admob_app_open_id: '',
  banner_ad_html: '',
  popup_ad_link: '',
  popup_ad_image: '',
  direct_ad_link: '',
  app_name: 'CineBox',
  primary_theme: 'neon-green',
  featured_movie_ids: '533535,872585,693134,550',
  maintenance_mode: false,
  allow_guest_downloads: true,
  announcement_banner: 'Welcome to CineBox — Unlimited HD Movies & Series Streaming!',
  official_website: DEFAULT_OFFICIAL_WEBSITE_URL,
  apk_download_url: DEFAULT_GLOBAL_APK_DOWNLOAD_URL,
  apk_latest_version: DEFAULT_CURRENT_APP_VERSION,
  apk_release_notes: DEFAULT_GLOBAL_APK_RELEASE_NOTES,
  updated_at: new Date().toISOString(),
};

/**
 * Phase 1 General Rule: No fake/demo data anywhere.
 */
export const INITIAL_APP_USERS: Record<string, AppUserRecord> = {};
export const INITIAL_MOVIE_LINKS: Record<number, MovieLinkRecord> = {};

let cachedClient: SupabaseClient | null = null;
let cachedClientKey = '';

const memoryStorageFallback: Record<string, string> = {};

function safeStorageGet(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // Fallback to in-memory store in Node test runner
  }
  return memoryStorageFallback[key] ?? null;
}

function safeStorageSet(key: string, value: string): void {
  memoryStorageFallback[key] = value;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function getSupabaseCredentials(): { url: string; anonKey: string; isConfigured: boolean } {
  const envUrl = String((import.meta as any).env?.VITE_SUPABASE_URL || '').trim();
  const envKey = String((import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '').trim();

  const isPlaceholderUrl =
    !envUrl ||
    envUrl.includes('your-project-id.supabase.co') ||
    envUrl.includes('your-project.supabase.co');
  const isPlaceholderKey = !envKey || envKey === 'your-public-anon-jwt-key';

  const safeUrl = isPlaceholderUrl ? '' : sanitizeSafeUrl(envUrl) || '';
  const safeAnonKey =
    isPlaceholderKey || isForbiddenServiceRoleKey(envKey) ? '' : envKey;

  return {
    url: safeUrl,
    anonKey: safeAnonKey,
    isConfigured: Boolean(safeUrl && safeAnonKey),
  };
}

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  if (!isConfigured) return null;

  const cacheSignature = `${url}::${anonKey}`;
  if (cachedClient && cachedClientKey === cacheSignature) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: typeof window !== 'undefined',
        autoRefreshToken: typeof window !== 'undefined',
        detectSessionInUrl: typeof window !== 'undefined',
      },
    });
    cachedClientKey = cacheSignature;
    return cachedClient;
  } catch {
    return null;
  }
}

function sanitizeMovieLinkFromDatabase(raw: any): MovieLinkRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const tmdbId = Number(raw.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;

  return {
    tmdb_id: tmdbId,
    title: sanitizeDatabaseTextField(raw.title || '', 120),
    language: sanitizeDatabaseTextField(raw.language || 'Hindi / English', 40) || 'Hindi / English',
    direct_video_url: sanitizeSafeUrl(raw.direct_video_url),
    hindi_dubbed_video_url: sanitizeSafeUrl(raw.hindi_dubbed_video_url),
    urdu_dubbed_video_url: sanitizeSafeUrl(raw.urdu_dubbed_video_url),
    alternate_streams: sanitizeAlternateStreamsList(raw.alternate_streams, 12),
    subtitles: Array.isArray(raw.subtitles) ? raw.subtitles : [],
    intro_start: typeof raw.intro_start === 'number' ? raw.intro_start : null,
    intro_end: typeof raw.intro_end === 'number' ? raw.intro_end : null,
    stream_url: sanitizeSafeUrl(raw.stream_url),
    download_480p: sanitizeSafeUrl(raw.download_480p),
    download_720p: sanitizeSafeUrl(raw.download_720p),
    download_1080p: sanitizeSafeUrl(raw.download_1080p),
    file_size_480p: sanitizeDatabaseTextField(raw.file_size_480p || '450.0MB', 20),
    file_size_720p: sanitizeDatabaseTextField(raw.file_size_720p || '1020.6MB', 20),
    file_size_1080p: sanitizeDatabaseTextField(raw.file_size_1080p || '2150.0MB', 20),
    is_trending: raw.is_trending ?? true,
    updated_at: raw.updated_at || new Date().toISOString(),
  };
}

function getLocalLinksMap(): Record<number, MovieLinkRecord> {
  try {
    const raw = safeStorageGet(LOCAL_LINKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const cleaned: Record<number, MovieLinkRecord> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const sanitized = sanitizeMovieLinkFromDatabase(v);
      if (sanitized) cleaned[Number(k)] = sanitized;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function saveLocalLinksMap(map: Record<number, MovieLinkRecord>): void {
  safeStorageSet(LOCAL_LINKS_KEY, JSON.stringify(map));
}

function getLocalUsersMap(): Record<string, AppUserRecord> {
  try {
    const raw = safeStorageGet(LOCAL_USERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalUsersMap(map: Record<string, AppUserRecord>): void {
  safeStorageSet(LOCAL_USERS_KEY, JSON.stringify(map));
}

/**
 * Logs an admin action into `public.audit_log` when Supabase is connected.
 */
export async function recordAdminAuditLog(entry: Omit<AuditLogRow, 'id' | 'created_at'>): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.from('audit_log').insert([
      {
        admin_email: sanitizeDatabaseTextField(entry.admin_email, 100),
        action: sanitizeDatabaseTextField(entry.action, 60),
        target_table: sanitizeDatabaseTextField(entry.target_table, 40),
        target_row_id: sanitizeDatabaseTextField(entry.target_row_id, 80),
        before_data: entry.before_data ?? null,
        after_data: entry.after_data ?? null,
      },
    ]);
  } catch {
    // Non-blocking audit log write
  }
}

/**
 * Fetches all rows from `movie_links` in Supabase (and sanitizes every database field).
 */
export async function fetchAllMovieLinks(): Promise<MovieLinkRecord[]> {
  const localMap = getLocalLinksMap();
  const client = getSupabaseClient();

  if (!client) {
    return Object.values(localMap);
  }

  try {
    const { data, error } = await client.from('movie_links').select('*');
    if (error || !data) {
      return Object.values(localMap);
    }

    const merged: Record<number, MovieLinkRecord> = { ...localMap };
    for (const row of data as any[]) {
      const cleanRow = sanitizeMovieLinkFromDatabase(row);
      if (cleanRow) {
        merged[cleanRow.tmdb_id] = cleanRow;
      }
    }
    saveLocalLinksMap(merged);
    return Object.values(merged);
  } catch {
    return Object.values(localMap);
  }
}

export async function fetchMovieLinkByTmdbId(tmdbId: number): Promise<MovieLinkRecord | null> {
  const all = await fetchAllMovieLinks();
  return all.find((r) => r.tmdb_id === tmdbId) || null;
}

export async function upsertMovieLink(
  input: Partial<MovieLinkRecord>
): Promise<{
  ok: boolean;
  error: string | null;
  record: MovieLinkRecord | null;
  syncedToCloud?: boolean;
}> {
  const validation = validateMovieLinkInput(input);
  if (!validation.valid || !validation.sanitized) {
    return { ok: false, error: validation.error, record: null };
  }

  const record = validation.sanitized;
  const currentMap = getLocalLinksMap();
  const previousRecord = currentMap[record.tmdb_id] || null;
  currentMap[record.tmdb_id] = record;
  saveLocalLinksMap(currentMap);

  const client = getSupabaseClient();
  let syncedToCloud = false;

  if (client) {
    try {
      const fullPayload = {
        tmdb_id: record.tmdb_id,
        title: record.title || '',
        language: record.language,
        direct_video_url: record.direct_video_url || '',
        hindi_dubbed_video_url: record.hindi_dubbed_video_url || '',
        urdu_dubbed_video_url: record.urdu_dubbed_video_url || '',
        alternate_streams: record.alternate_streams || [],
        subtitles: record.subtitles || [],
        intro_start: record.intro_start ?? null,
        intro_end: record.intro_end ?? null,
        stream_url: record.stream_url || '',
        download_480p: record.download_480p || '',
        download_720p: record.download_720p || '',
        download_1080p: record.download_1080p || '',
        file_size_480p: record.file_size_480p || '450.0MB',
        file_size_720p: record.file_size_720p || '1020.6MB',
        file_size_1080p: record.file_size_1080p || '2150.0MB',
        is_trending: record.is_trending ?? true,
        updated_at: record.updated_at,
      };

      const { error } = await client
        .from('movie_links')
        .upsert(fullPayload, { onConflict: 'tmdb_id' });

      if (!error) {
        syncedToCloud = true;
        await recordAdminAuditLog({
          admin_email: 'admin',
          action: 'UPSERT_MOVIE_LINK',
          target_table: 'movie_links',
          target_row_id: String(record.tmdb_id),
          before_data: previousRecord as any,
          after_data: record as any,
        });
      }
    } catch {
      // Saved locally
    }
  }

  return { ok: true, error: null, record, syncedToCloud };
}

export async function bulkUpsertMovieLinks(records: MovieLinkRecord[]): Promise<{
  ok: boolean;
  error: string | null;
  savedCount: number;
  syncedToCloud: boolean;
  errors: string[];
}> {
  if (!records || records.length === 0) {
    return {
      ok: false,
      error: 'No records provided.',
      savedCount: 0,
      syncedToCloud: false,
      errors: ['No records provided.'],
    };
  }

  const currentMap = getLocalLinksMap();
  const validList: MovieLinkRecord[] = [];
  const errors: string[] = [];

  for (const r of records) {
    const res = validateMovieLinkInput(r);
    if (res.valid && res.sanitized) {
      currentMap[res.sanitized.tmdb_id] = res.sanitized;
      validList.push(res.sanitized);
    } else if (res.error) {
      errors.push(`TMDb #${r.tmdb_id}: ${res.error}`);
    }
  }

  saveLocalLinksMap(currentMap);

  let syncedToCloud = false;
  const client = getSupabaseClient();
  if (client && validList.length > 0) {
    try {
      const fullPayload = validList.map((record) => ({
        tmdb_id: record.tmdb_id,
        title: record.title || '',
        language: record.language,
        direct_video_url: record.direct_video_url || '',
        hindi_dubbed_video_url: record.hindi_dubbed_video_url || '',
        urdu_dubbed_video_url: record.urdu_dubbed_video_url || '',
        alternate_streams: record.alternate_streams || [],
        subtitles: record.subtitles || [],
        intro_start: record.intro_start ?? null,
        intro_end: record.intro_end ?? null,
        stream_url: record.stream_url || '',
        download_480p: record.download_480p || '',
        download_720p: record.download_720p || '',
        download_1080p: record.download_1080p || '',
        file_size_480p: record.file_size_480p || '450.0MB',
        file_size_720p: record.file_size_720p || '1020.6MB',
        file_size_1080p: record.file_size_1080p || '2150.0MB',
        is_trending: record.is_trending ?? true,
        updated_at: record.updated_at || new Date().toISOString(),
      }));

      const { error } = await client
        .from('movie_links')
        .upsert(fullPayload, { onConflict: 'tmdb_id' });
      if (!error) {
        syncedToCloud = true;
      }
    } catch {
      // Saved locally
    }
  }

  return {
    ok: validList.length > 0,
    error: validList.length === 0 ? errors[0] || 'No valid movie links found.' : null,
    savedCount: validList.length,
    syncedToCloud,
    errors,
  };
}

export async function deleteMovieLink(tmdbId: number): Promise<void> {
  const currentMap = getLocalLinksMap();
  const prev = currentMap[tmdbId] || null;
  delete currentMap[tmdbId];
  saveLocalLinksMap(currentMap);

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('movie_links').delete().eq('tmdb_id', tmdbId);
      await recordAdminAuditLog({
        admin_email: 'admin',
        action: 'DELETE_MOVIE_LINK',
        target_table: 'movie_links',
        target_row_id: String(tmdbId),
        before_data: prev as any,
        after_data: null,
      });
    } catch {
      // Ignore network errors
    }
  }
}

export async function fetchAllAppUsers(): Promise<AppUserRecord[]> {
  const localMap = getLocalUsersMap();
  const client = getSupabaseClient();

  if (client) {
    try {
      const { data, error } = await client
        .from('app_users')
        .select('*')
        .order('last_active', { ascending: false });

      if (!error && Array.isArray(data)) {
        const merged: Record<string, AppUserRecord> = { ...localMap };
        for (const row of data as AppUserRecord[]) {
          if (row && row.id) {
            merged[row.id] = {
              ...row,
              username: sanitizeDatabaseTextField(row.username, 60),
              notes: sanitizeDatabaseTextField(row.notes, 200),
            };
          }
        }
        saveLocalUsersMap(merged);
        return Object.values(merged);
      }
    } catch {
      // Fallback to local
    }
  }

  return Object.values(localMap);
}

export async function upsertAppUser(
  input: Partial<AppUserRecord>
): Promise<{
  ok: boolean;
  error: string | null;
  record: AppUserRecord | null;
  user: AppUserRecord | null;
  syncedToCloud: boolean;
}> {
  const validation = validateAppUserInput(input);
  if (!validation.valid || !validation.sanitized) {
    return {
      ok: false,
      error: validation.error,
      record: null,
      user: null,
      syncedToCloud: false,
    };
  }

  const record = validation.sanitized;
  const currentMap = getLocalUsersMap();
  currentMap[record.id] = record;
  saveLocalUsersMap(currentMap);

  let syncedToCloud = false;
  const client = getSupabaseClient();
  if (client) {
    try {
      const { error } = await client
        .from('app_users')
        .upsert(record, { onConflict: 'id' });
      if (!error) {
        syncedToCloud = true;
      }
    } catch {
      // Saved locally
    }
  }

  return { ok: true, error: null, record, user: record, syncedToCloud };
}

export async function deleteAppUser(userId: string): Promise<void> {
  const currentMap = getLocalUsersMap();
  delete currentMap[userId];
  saveLocalUsersMap(currentMap);

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('app_users').delete().eq('id', userId);
    } catch {
      // Ignore
    }
  }
}

// =============================================================================
// REAL SUPABASE AUTHENTICATION (ADMIN & USER)
// =============================================================================

/**
 * Deterministic salted hash used only for offline/local-dev credential verification
 * when `VITE_SUPABASE_URL` is not configured. Never stores plaintext passwords.
 */
function computeLocalCredentialDigest(email: string, password: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  const payload = `cinebox_auth_v1::${normalizedEmail}::${password}`;
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `pbk_${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

function getLocalCredentialHashes(): Record<string, string> {
  try {
    const raw = safeStorageGet(LOCAL_AUTH_HASHES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalCredentialHash(email: string, digest: string): void {
  const map = getLocalCredentialHashes();
  map[email.trim().toLowerCase()] = digest;
  safeStorageSet(LOCAL_AUTH_HASHES_KEY, JSON.stringify(map));
}

/**
 * Phase 1 Security: Signs in an Admin with Supabase Auth (email + password)
 * and strictly verifies that the returned JWT contains `app_metadata.role === 'admin'`.
 */
export async function signInAdminWithSupabase(
  email: string,
  password: string
): Promise<{
  ok: boolean;
  error: string | null;
  session: Session | null;
  user: User | null;
}> {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return {
      ok: false,
      error: 'Please enter a valid admin email address.',
      session: null,
      user: null,
    };
  }
  if (!password || password.length < 6) {
    return {
      ok: false,
      error: 'Password must be at least 6 characters.',
      session: null,
      user: null,
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      error:
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file to sign in as Admin.',
      session: null,
      user: null,
    };
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error || !data?.session || !data?.user) {
      return {
        ok: false,
        error: error?.message || 'Invalid email or password.',
        session: null,
        user: null,
      };
    }

    if (!isAdminJwtUser(data.session)) {
      await client.auth.signOut();
      return {
        ok: false,
        error:
          'Access denied: Your Supabase account does not have app_metadata.role = "admin".',
        session: null,
        user: null,
      };
    }

    return {
      ok: true,
      error: null,
      session: data.session,
      user: data.user,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Failed to authenticate with Supabase Auth.',
      session: null,
      user: null,
    };
  }
}

/**
 * Sends a Supabase Auth Magic Link OTP to the admin email.
 * When clicked, the returned session is still checked for `app_metadata.role === 'admin'`.
 */
/**
 * Fix 3: Resolves the absolute production Auth Callback URL (`https://[your-domain]/auth/callback`)
 * for Supabase `signInWithOtp` and `resetPasswordForEmail`.
 * Never returns `undefined`, a relative path, `http://localhost`, or `capacitor://localhost`.
 */
export function getSupabaseAuthRedirectUrl(
  callbackPath: string = '/auth/callback',
  baseOriginOverride?: string
): string {
  const safePath = callbackPath && callbackPath.trim() ? callbackPath.trim() : '/auth/callback';
  return buildProductionShareUrl(safePath, {
    baseOriginOverride,
  });
}

export async function sendAdminMagicLink(email: string): Promise<{
  ok: boolean;
  error: string | null;
  message?: string;
}> {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid admin email address.' };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      error:
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.',
    };
  }

  try {
    const redirectTo = getSupabaseAuthRedirectUrl('/auth/callback');
    const { error } = await client.auth.signInWithOtp({
      email: cleanEmail,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return {
      ok: true,
      error: null,
      message: 'Admin Magic Link sent! Check your email inbox.',
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to send Magic Link.' };
  }
}

/**
 * Inspects the active Supabase Auth session and returns it ONLY if `app_metadata.role === 'admin'`.
 */
export async function getActiveAdminSession(): Promise<{
  isAdmin: boolean;
  session: Session | null;
  user: User | null;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { isAdmin: false, session: null, user: null };
  }
  try {
    const { data } = await client.auth.getSession();
    const session = data?.session || null;
    if (session && isAdminJwtUser(session)) {
      return { isAdmin: true, session, user: session.user };
    }
    return { isAdmin: false, session: null, user: null };
  } catch {
    return { isAdmin: false, session: null, user: null };
  }
}

export async function signOutSupabaseSession(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.auth.signOut();
  } catch {
    // Ignore sign-out network errors
  }
}

/**
 * Sends a password reset email via `supabase.auth.resetPasswordForEmail`.
 */
export async function requestPasswordResetEmail(email: string): Promise<{
  ok: boolean;
  error: string | null;
  message?: string;
}> {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      error:
        'Password reset emails require VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to be configured.',
    };
  }

  try {
    const redirectTo = getSupabaseAuthRedirectUrl('/auth/callback');
    const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo,
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return {
      ok: true,
      error: null,
      message: 'Password reset link sent to your email.',
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to send password reset email.' };
  }
}

/**
 * Real User Sign-In / Sign-Up with Supabase Auth + Referral & 3-Day APK Trial Tracking.
 * - Never stores plaintext passwords anywhere.
 * - Verifies credentials via `supabase.auth.signInWithPassword` or `supabase.auth.signUp`.
 * - Credits referrer (+1 referral, and +30 days APK unlock at 2 referrals) only when a real new user registers.
 */
export async function loginOrRegisterUser(input: {
  username?: string;
  email: string;
  password?: string;
  mode?: 'signin' | 'signup' | 'login' | 'register';
  platform?: AppUserRecord['platform'];
  referredByCode?: string | null;
}): Promise<{
  ok: boolean;
  error: string | null;
  user: AppUserRecord | null;
  syncedToCloud: boolean;
  referralCredited?: boolean;
  referrerUnlockedThirtyDays?: boolean;
}> {
  const cleanEmail = (input.email || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return {
      ok: false,
      error: 'Please enter a valid email address.',
      user: null,
      syncedToCloud: false,
    };
  }

  if (!input.password || input.password.trim().length < 6) {
    return {
      ok: false,
      error: 'Password must be at least 6 characters.',
      user: null,
      syncedToCloud: false,
    };
  }

  const password = input.password;
  const authMode: 'signin' | 'signup' =
    input.mode === 'signup' ||
    input.mode === 'register' ||
    (!input.mode && input.username && input.username.trim().length >= 2)
      ? 'signup'
      : 'signin';

  const client = getSupabaseClient();
  let authenticatedUserId = generateAllottedUserId(cleanEmail);

  if (client) {
    try {
      if (authMode === 'signup') {
        const { data, error } = await client.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              username: sanitizeDatabaseTextField(
                input.username || cleanEmail.split('@')[0],
                60
              ),
            },
          },
        });

        if (error) {
          return {
            ok: false,
            error: error.message,
            user: null,
            syncedToCloud: false,
          };
        }
        if (data?.user?.id) {
          authenticatedUserId = data.user.id;
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error || !data?.user) {
          return {
            ok: false,
            error: error?.message || 'Invalid email or password.',
            user: null,
            syncedToCloud: false,
          };
        }
        authenticatedUserId = data.user.id;
      }
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Authentication failed.',
        user: null,
        syncedToCloud: false,
      };
    }
  } else {
    // Offline / local unit-test credential verification (salted digest, never plaintext)
    const hashes = getLocalCredentialHashes();
    const existingDigest = hashes[cleanEmail];
    const incomingDigest = computeLocalCredentialDigest(cleanEmail, password);

    if (authMode === 'signin' && existingDigest && existingDigest !== incomingDigest) {
      return {
        ok: false,
        error: 'Invalid email or password.',
        user: null,
        syncedToCloud: false,
      };
    }
    saveLocalCredentialHash(cleanEmail, incomingDigest);
  }

  const allUsers = await fetchAllAppUsers();
  const existing = allUsers.find(
    (u) => u.id === authenticatedUserId || u.email.toLowerCase() === cleanEmail
  );

  const detectedPlatform: AppUserRecord['platform'] =
    input.platform || detectAppPlatform();

  const normalizedRefCode = normalizeReferralCode(input.referredByCode);

  if (existing) {
    const ensuredReferralCode =
      existing.referral_code || generateUniqueReferralCode(existing.email);
    const updated: AppUserRecord = {
      ...existing,
      id: existing.id || authenticatedUserId,
      username:
        input.username && input.username.trim().length >= 2
          ? sanitizeDatabaseTextField(input.username, 60)
          : existing.username,
      platform: detectedPlatform,
      referral_code: ensuredReferralCode,
      last_active: new Date().toISOString(),
    };
    const res = await upsertAppUser(updated);
    if (res.ok && res.record) {
      setLoggedInUserStorage(res.record);
    }
    return {
      ok: res.ok,
      error: res.error,
      user: res.record,
      syncedToCloud: res.syncedToCloud,
      referralCredited: false,
      referrerUnlockedThirtyDays: false,
    };
  }

  const fallbackName =
    input.username && input.username.trim().length >= 2
      ? sanitizeDatabaseTextField(input.username, 60)
      : cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '') || 'CineBoxUser';

  const nowMs = Date.now();
  const initialTrialFields = buildInitialTrialAndReferralFields({
    email: cleanEmail,
    referredByCode: normalizedRefCode,
    nowMs,
  });

  const referrerUser = normalizedRefCode
    ? allUsers.find(
        (u) =>
          normalizeReferralCode(u.referral_code) === normalizedRefCode &&
          u.email.toLowerCase() !== cleanEmail
      )
    : undefined;

  const newUser: Partial<AppUserRecord> = {
    id: authenticatedUserId,
    username: fallbackName,
    email: cleanEmail,
    role: 'user',
    status: 'active',
    platform: detectedPlatform,
    downloads_count: 0,
    last_active: new Date(nowMs).toISOString(),
    notes: referrerUser
      ? `Registered on ${detectedPlatform} (Referred by ${referrerUser.referral_code})`
      : `Registered on ${detectedPlatform}`,
    trial_start_date: initialTrialFields.trial_start_date,
    trial_end_date: initialTrialFields.trial_end_date,
    referral_code: initialTrialFields.referral_code,
    referred_by: referrerUser ? referrerUser.referral_code : normalizedRefCode,
    successful_referrals: 0,
    access_expiry_date: null,
  };

  const res = await upsertAppUser(newUser);
  if (res.ok && res.record) {
    setLoggedInUserStorage(res.record);
  }
  let referralCredited = false;
  let referrerUnlockedThirtyDays = false;

  if (res.ok && referrerUser) {
    const rewardResult = applyReferralRewardToReferrer(referrerUser, cleanEmail, nowMs);
    await upsertAppUser(rewardResult.updatedReferrer);
    referralCredited = true;
    referrerUnlockedThirtyDays = rewardResult.unlockedThirtyDays;
  }

  return {
    ok: res.ok,
    error: res.error,
    user: res.record,
    syncedToCloud: res.syncedToCloud,
    referralCredited,
    referrerUnlockedThirtyDays,
  };
}

export async function claimReferralCodeForUser(
  currentUserId: string,
  referralCodeInput: string
): Promise<{
  ok: boolean;
  error: string | null;
  updatedUser: AppUserRecord | null;
  updatedReferrer: AppUserRecord | null;
  referrerUnlockedThirtyDays: boolean;
}> {
  const cleanCode = normalizeReferralCode(referralCodeInput);
  if (!cleanCode) {
    return {
      ok: false,
      error: 'Please enter a valid referral code (e.g., CBX-XXXXXX).',
      updatedUser: null,
      updatedReferrer: null,
      referrerUnlockedThirtyDays: false,
    };
  }

  const allUsers = await fetchAllAppUsers();
  const currentUser = allUsers.find((u) => u.id === currentUserId);
  if (!currentUser) {
    return {
      ok: false,
      error: 'User profile not found. Please log in again.',
      updatedUser: null,
      updatedReferrer: null,
      referrerUnlockedThirtyDays: false,
    };
  }

  if (normalizeReferralCode(currentUser.referral_code) === cleanCode) {
    return {
      ok: false,
      error: 'You cannot use your own referral code.',
      updatedUser: currentUser,
      updatedReferrer: null,
      referrerUnlockedThirtyDays: false,
    };
  }

  if (currentUser.referred_by) {
    return {
      ok: false,
      error: `You have already applied referral code ${currentUser.referred_by}.`,
      updatedUser: currentUser,
      updatedReferrer: null,
      referrerUnlockedThirtyDays: false,
    };
  }

  const referrer = allUsers.find(
    (u) =>
      normalizeReferralCode(u.referral_code) === cleanCode &&
      u.id !== currentUser.id
  );

  if (!referrer) {
    return {
      ok: false,
      error: `Referral code "${cleanCode}" was not found.`,
      updatedUser: currentUser,
      updatedReferrer: null,
      referrerUnlockedThirtyDays: false,
    };
  }

  const nowMs = Date.now();
  const updatedCurrentUser: AppUserRecord = {
    ...currentUser,
    referred_by: cleanCode,
    last_active: new Date(nowMs).toISOString(),
  };
  await upsertAppUser(updatedCurrentUser);

  const reward = applyReferralRewardToReferrer(referrer, currentUser.email, nowMs);
  await upsertAppUser(reward.updatedReferrer);

  return {
    ok: true,
    error: null,
    updatedUser: updatedCurrentUser,
    updatedReferrer: reward.updatedReferrer,
    referrerUnlockedThirtyDays: reward.unlockedThirtyDays,
  };
}

/**
 * Fetches global `app_config` from Supabase.
 * Sanitizes all database fields (`banner_ad_html`, `announcement_banner`, URLs).
 */
export async function fetchAppConfig(): Promise<AppConfigRecord> {
  let localConfig: AppConfigRecord = DEFAULT_APP_CONFIG;
  try {
    const raw = safeStorageGet(LOCAL_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      delete parsed.admin_pin_hash;
      delete parsed.admin_email;
      localConfig = { ...DEFAULT_APP_CONFIG, ...parsed };
    }
  } catch {
    localConfig = DEFAULT_APP_CONFIG;
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      ...localConfig,
      is_ads_enabled: false,
      ad_network_provider: 'none',
      banner_ad_html: sanitizeBannerHtml(localConfig.banner_ad_html) ? '' : '',
      announcement_banner: sanitizeDatabaseTextField(
        localConfig.announcement_banner || DEFAULT_APP_CONFIG.announcement_banner,
        240
      ),
      official_website: normalizeOfficialWebsiteUrl(localConfig.official_website),
      apk_download_url:
        toGoogleDriveDirectDownloadUrl(localConfig.apk_download_url) ||
        localConfig.apk_download_url ||
        DEFAULT_GLOBAL_APK_DOWNLOAD_URL,
      apk_latest_version: localConfig.apk_latest_version || DEFAULT_CURRENT_APP_VERSION,
      apk_release_notes:
        sanitizeDatabaseTextField(
          localConfig.apk_release_notes || DEFAULT_GLOBAL_APK_RELEASE_NOTES,
          240
        ) || DEFAULT_GLOBAL_APK_RELEASE_NOTES,
    };
  }

  try {
    let data: Record<string, any> | null = null;
    const primaryRes = await client
      .from('app_config')
      .select(PUBLIC_APP_CONFIG_COLUMNS)
      .eq('id', 1)
      .single();

    if (!primaryRes.error && primaryRes.data) {
      data = primaryRes.data as Record<string, any>;
    } else {
      const fallbackRes = await client
        .from('app_config')
        .select('id,is_ads_enabled,banner_ad_html,popup_ad_link,popup_ad_image,updated_at')
        .eq('id', 1)
        .single();
      if (!fallbackRes.error && fallbackRes.data) {
        data = fallbackRes.data as Record<string, any>;
      }
    }

    if (!data) {
      return {
        ...localConfig,
        is_ads_enabled: false,
        ad_network_provider: 'none',
        banner_ad_html: '',
        official_website: normalizeOfficialWebsiteUrl(localConfig.official_website),
      };
    }

    const safePublicData = { ...data };
    delete safePublicData.admin_pin_hash;
    delete safePublicData.admin_email;

    const carrierMeta = decodeGlobalApkConfigCarrier(safePublicData.popup_ad_link);
    const resolvedApkDownloadUrl =
      toGoogleDriveDirectDownloadUrl(safePublicData.apk_download_url) ||
      carrierMeta?.apkUrl ||
      toGoogleDriveDirectDownloadUrl(localConfig.apk_download_url) ||
      DEFAULT_GLOBAL_APK_DOWNLOAD_URL;

    const resolvedApkLatestVersion =
      (typeof safePublicData.apk_latest_version === 'string' &&
      safePublicData.apk_latest_version.trim()
        ? safePublicData.apk_latest_version.trim()
        : carrierMeta?.version) ||
      localConfig.apk_latest_version ||
      DEFAULT_CURRENT_APP_VERSION;

    const resolvedApkReleaseNotes =
      sanitizeDatabaseTextField(
        (typeof safePublicData.apk_release_notes === 'string' &&
        safePublicData.apk_release_notes.trim()
          ? safePublicData.apk_release_notes.trim()
          : carrierMeta?.releaseNotes) ||
          localConfig.apk_release_notes ||
          DEFAULT_GLOBAL_APK_RELEASE_NOTES,
        240
      ) || DEFAULT_GLOBAL_APK_RELEASE_NOTES;

    const resolvedOfficialWebsite = normalizeOfficialWebsiteUrl(
      safePublicData.official_website ||
        carrierMeta?.officialWebsite ||
        localConfig.official_website
    );

    const merged: AppConfigRecord = {
      ...DEFAULT_APP_CONFIG,
      ...localConfig,
      ...safePublicData,
      is_ads_enabled: false,
      ad_network_provider: 'none',
      banner_ad_html: '',
      popup_ad_link: carrierMeta
        ? ''
        : sanitizeSafeUrl(safePublicData.popup_ad_link) || '',
      popup_ad_image: sanitizeSafeUrl(safePublicData.popup_ad_image) || '',
      official_website: resolvedOfficialWebsite,
      apk_download_url: resolvedApkDownloadUrl,
      apk_latest_version: resolvedApkLatestVersion,
      apk_release_notes: resolvedApkReleaseNotes,
    };

    safeStorageSet(LOCAL_CONFIG_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return {
      ...localConfig,
      is_ads_enabled: false,
      ad_network_provider: 'none',
      banner_ad_html: '',
      official_website: normalizeOfficialWebsiteUrl(localConfig.official_website),
    };
  }
}

export async function updateAppConfig(
  partial: Partial<AppConfigRecord>
): Promise<{ ok: boolean; config: AppConfigRecord; syncedToCloud?: boolean }> {
  const current = await fetchAppConfig();
  const normalizedApkDownloadUrl =
    partial.apk_download_url !== undefined
      ? toGoogleDriveDirectDownloadUrl(partial.apk_download_url) ||
        sanitizeSafeUrl(partial.apk_download_url) ||
        current.apk_download_url ||
        DEFAULT_GLOBAL_APK_DOWNLOAD_URL
      : current.apk_download_url || DEFAULT_GLOBAL_APK_DOWNLOAD_URL;

  const normalizedApkVersion =
    (partial.apk_latest_version ?? current.apk_latest_version ?? DEFAULT_CURRENT_APP_VERSION)
      .replace(/[^0-9.]/g, '')
      .trim() || DEFAULT_CURRENT_APP_VERSION;

  const normalizedApkNotes =
    sanitizeDatabaseTextField(
      partial.apk_release_notes ??
        current.apk_release_notes ??
        DEFAULT_GLOBAL_APK_RELEASE_NOTES,
      240
    ) || DEFAULT_GLOBAL_APK_RELEASE_NOTES;

  const normalizedOfficialWebsite = normalizeOfficialWebsiteUrl(
    partial.official_website ?? current.official_website ?? DEFAULT_OFFICIAL_WEBSITE_URL
  );

  const updated: AppConfigRecord = {
    ...current,
    ...partial,
    id: 1,
    is_ads_enabled: false,
    ad_network_provider: 'none',
    banner_ad_html: '',
    popup_ad_link:
      partial.popup_ad_link !== undefined
        ? sanitizeSafeUrl(partial.popup_ad_link) || ''
        : current.popup_ad_link,
    popup_ad_image:
      partial.popup_ad_image !== undefined
        ? sanitizeSafeUrl(partial.popup_ad_image) || ''
        : current.popup_ad_image,
    official_website: normalizedOfficialWebsite,
    apk_download_url: normalizedApkDownloadUrl,
    apk_latest_version: normalizedApkVersion,
    apk_release_notes: normalizedApkNotes,
    updated_at: new Date().toISOString(),
  };

  delete (updated as any).admin_pin_hash;
  delete (updated as any).admin_email;

  safeStorageSet(LOCAL_CONFIG_KEY, JSON.stringify(updated));

  let syncedToCloud = false;
  const client = getSupabaseClient();
  if (client) {
    try {
      const fullPayload = {
        id: 1,
        is_ads_enabled: updated.is_ads_enabled,
        ad_network_provider: updated.ad_network_provider || 'none',
        admob_app_id: updated.admob_app_id || '',
        admob_banner_id: updated.admob_banner_id || '',
        admob_interstitial_id: updated.admob_interstitial_id || '',
        admob_app_open_id: updated.admob_app_open_id || '',
        banner_ad_html: updated.banner_ad_html,
        popup_ad_link: updated.popup_ad_link,
        popup_ad_image: updated.popup_ad_image,
        app_name: sanitizeDatabaseTextField(updated.app_name || 'CineBox', 60) || 'CineBox',
        primary_theme: updated.primary_theme || 'neon-green',
        featured_movie_ids: updated.featured_movie_ids || '533535,872585,693134,550',
        maintenance_mode: updated.maintenance_mode ?? false,
        allow_guest_downloads: updated.allow_guest_downloads ?? true,
        announcement_banner: sanitizeDatabaseTextField(updated.announcement_banner || '', 240),
        official_website: updated.official_website || DEFAULT_OFFICIAL_WEBSITE_URL,
        apk_download_url: updated.apk_download_url || DEFAULT_GLOBAL_APK_DOWNLOAD_URL,
        apk_latest_version: updated.apk_latest_version || DEFAULT_CURRENT_APP_VERSION,
        apk_release_notes: updated.apk_release_notes || DEFAULT_GLOBAL_APK_RELEASE_NOTES,
        updated_at: updated.updated_at,
      };

      const { error } = await client
        .from('app_config')
        .upsert(fullPayload, { onConflict: 'id' });

      if (!error) {
        syncedToCloud = true;
      } else {
        const carrierString = encodeGlobalApkConfigCarrier({
          version: updated.apk_latest_version || DEFAULT_CURRENT_APP_VERSION,
          apkUrl: updated.apk_download_url || DEFAULT_GLOBAL_APK_DOWNLOAD_URL,
          releaseNotes: updated.apk_release_notes || DEFAULT_GLOBAL_APK_RELEASE_NOTES,
          officialWebsite: updated.official_website || DEFAULT_OFFICIAL_WEBSITE_URL,
        });
        const baseRes = await client.from('app_config').upsert(
          {
            id: 1,
            is_ads_enabled: updated.is_ads_enabled,
            banner_ad_html: updated.banner_ad_html,
            popup_ad_link: carrierString || updated.popup_ad_link,
            popup_ad_image: updated.popup_ad_image,
            updated_at: updated.updated_at,
          },
          { onConflict: 'id' }
        );
        if (!baseRes.error) {
          syncedToCloud = true;
        }
      }

      if (syncedToCloud) {
        await recordAdminAuditLog({
          admin_email: 'admin',
          action: 'UPDATE_APP_CONFIG',
          target_table: 'app_config',
          target_row_id: '1',
          before_data: current as any,
          after_data: updated as any,
        });
      }
    } catch {
      // Saved locally
    }
  }

  return { ok: true, config: updated, syncedToCloud };
}

/**
 * Least-Privilege SQL & Migration reference (matches `supabase_schema.sql` in Phase 1).
 * No hardcoded emails, no `admin_pin_hash`, no `admin_email`, and no `FOR ALL TO anon`.
 */
export const SUPABASE_RLS_FIX_SQL = `-- Phase 1 Least-Privilege RLS & Migration SQL for CineBox
ALTER TABLE IF EXISTS public.app_config
  DROP COLUMN IF EXISTS admin_pin_hash CASCADE,
  DROP COLUMN IF EXISTS admin_email CASCADE;

CREATE OR REPLACE FUNCTION public.is_cinebox_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

REVOKE ALL ON TABLE public.movie_links FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_config FROM anon, authenticated;

GRANT SELECT ON TABLE public.movie_links TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.movie_links TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users TO authenticated;

GRANT SELECT ON TABLE public.app_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.app_config TO authenticated;`;

export interface SupabaseTableHealthStatus {
  table: 'movie_links' | 'app_users' | 'app_config';
  readOk: boolean;
  writeOk: boolean;
  rowCount: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SupabaseLiveDiagnosticsReport {
  configured: boolean;
  projectUrl: string;
  testedAt: string;
  allReadsOk: boolean;
  allWritesOk: boolean;
  rlsBlockingWrites: boolean;
  tables: SupabaseTableHealthStatus[];
}

export async function runSupabaseLiveDiagnostics(): Promise<SupabaseLiveDiagnosticsReport> {
  const { url, isConfigured } = getSupabaseCredentials();
  const client = getSupabaseClient();
  const testedAt = new Date().toISOString();

  if (!isConfigured || !client) {
    return {
      configured: false,
      projectUrl: url || 'Not Configured',
      testedAt,
      allReadsOk: false,
      allWritesOk: false,
      rlsBlockingWrites: false,
      tables: [
        {
          table: 'movie_links',
          readOk: false,
          writeOk: false,
          rowCount: 0,
          errorCode: 'NO_CLIENT',
          errorMessage: 'Supabase credentials are not configured in .env',
        },
        {
          table: 'app_users',
          readOk: false,
          writeOk: false,
          rowCount: 0,
          errorCode: 'NO_CLIENT',
          errorMessage: 'Supabase credentials are not configured in .env',
        },
        {
          table: 'app_config',
          readOk: false,
          writeOk: false,
          rowCount: 0,
          errorCode: 'NO_CLIENT',
          errorMessage: 'Supabase credentials are not configured in .env',
        },
      ],
    };
  }

  const results: SupabaseTableHealthStatus[] = [];

  // 1. Test movie_links
  {
    let readOk = false;
    let writeOk = false;
    let rowCount = 0;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    const readRes = await client.from('movie_links').select('*', { count: 'exact' });
    if (!readRes.error) {
      readOk = true;
      rowCount = readRes.count ?? (Array.isArray(readRes.data) ? readRes.data.length : 0);
    } else {
      errorCode = readRes.error.code || 'READ_ERR';
      errorMessage = readRes.error.message;
    }

    const writeRes = await client.from('movie_links').upsert(
      {
        tmdb_id: 533535,
        language: 'Hindi / English',
        direct_video_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        stream_url: 'https://www.2embed.cc/embed/533535',
        download_480p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        download_720p: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tmdb_id' }
    );

    if (!writeRes.error) {
      writeOk = true;
    } else {
      errorCode = writeRes.error.code || 'WRITE_ERR';
      errorMessage = writeRes.error.message;
    }

    results.push({ table: 'movie_links', readOk, writeOk, rowCount, errorCode, errorMessage });
  }

  // 2. Test app_users
  {
    let readOk = false;
    let writeOk = false;
    let rowCount = 0;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    const readRes = await client.from('app_users').select('*', { count: 'exact' });
    if (!readRes.error) {
      readOk = true;
      rowCount = readRes.count ?? (Array.isArray(readRes.data) ? readRes.data.length : 0);
    } else {
      errorCode = readRes.error.code || 'READ_ERR';
      errorMessage = readRes.error.message;
    }

    results.push({ table: 'app_users', readOk, writeOk, rowCount, errorCode, errorMessage });
  }

  // 3. Test app_config
  {
    let readOk = false;
    let writeOk = false;
    let rowCount = 0;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    const readRes = await client
      .from('app_config')
      .select('id,is_ads_enabled,banner_ad_html,popup_ad_link,popup_ad_image,updated_at', {
        count: 'exact',
      });
    if (!readRes.error) {
      readOk = true;
      rowCount = readRes.count ?? (Array.isArray(readRes.data) ? readRes.data.length : 0);
    } else {
      errorCode = readRes.error.code || 'READ_ERR';
      errorMessage = readRes.error.message;
    }

    const currentCfg = await fetchAppConfig();
    const writeRes = await client.from('app_config').upsert(
      {
        id: 1,
        is_ads_enabled: currentCfg.is_ads_enabled,
        banner_ad_html: currentCfg.banner_ad_html,
        popup_ad_link: currentCfg.popup_ad_link,
        popup_ad_image: currentCfg.popup_ad_image,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (!writeRes.error) {
      writeOk = true;
    } else {
      errorCode = writeRes.error.code || 'WRITE_ERR';
      errorMessage = writeRes.error.message;
    }

    results.push({ table: 'app_config', readOk, writeOk, rowCount, errorCode, errorMessage });
  }

  const allReadsOk = results.every((r) => r.readOk);
  const allWritesOk = results.every((r) => r.writeOk);
  const rlsBlockingWrites = results.some((r) => r.errorCode === '42501');

  return {
    configured: true,
    projectUrl: url,
    testedAt,
    allReadsOk,
    allWritesOk,
    rlsBlockingWrites,
    tables: results,
  };
}

export async function exportDecentralizedManifest(): Promise<{
  version: string;
  exportedAt: string;
  app_config: AppConfigRecord;
  movie_links: MovieLinkRecord[];
  app_users: AppUserRecord[];
}> {
  const [linksList, usersList, config] = await Promise.all([
    fetchAllMovieLinks(),
    fetchAllAppUsers(),
    fetchAppConfig(),
  ]);

  return {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    app_config: config,
    movie_links: linksList,
    app_users: usersList,
  };
}

export async function exportGlobalDatabaseSnapshot(): Promise<string> {
  const manifest = await exportDecentralizedManifest();
  return JSON.stringify(manifest, null, 2);
}

export type SupabaseDiagnosticReport = SupabaseLiveDiagnosticsReport;
export const testSupabaseLiveTables = runSupabaseLiveDiagnostics;
export const importDecentralizedManifestJson = importGlobalDatabaseSnapshot;

const LOGGED_IN_USER_STORAGE_KEY = 'cinebox_logged_in_user_v1';
const DEVICE_USER_ID_STORAGE_KEY = 'cinebox_device_user_id_v1';
const USER_SETTINGS_STORAGE_KEY = 'cinebox_user_app_settings_v1';

export const DEFAULT_USER_APP_SETTINGS: UserAppSettings = {
  defaultServer: 'auto-server-3',
  defaultDownloadQuality: '720p',
  autoPlayVideo: true,
  wifiOnlyDownloads: false,
  preferredQuality: '720p',
  preferredLanguage: 'Hindi',
  appLanguage: 'en',
  autoPlayTrailers: false,
  notificationsEnabled: true,
};

export function getCurrentDeviceUserId(): string {
  const existing = safeStorageGet(DEVICE_USER_ID_STORAGE_KEY);
  if (existing && existing.startsWith('USR-')) return existing;
  const generated = generateAllottedUserId(`device_${Date.now()}`);
  safeStorageSet(DEVICE_USER_ID_STORAGE_KEY, generated);
  return generated;
}

export function getLoggedInUser(): AppUserRecord | null {
  try {
    const raw = safeStorageGet(LOGGED_IN_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

export function setLoggedInUserStorage(user: AppUserRecord | null): void {
  if (!user) {
    safeStorageSet(LOGGED_IN_USER_STORAGE_KEY, '');
    return;
  }
  safeStorageSet(LOGGED_IN_USER_STORAGE_KEY, JSON.stringify(user));
}

export function logoutCurrentUser(): void {
  setLoggedInUserStorage(null);
  void signOutSupabaseSession();
}

export function getUserAppSettings(): UserAppSettings {
  try {
    const raw = safeStorageGet(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_USER_APP_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_USER_APP_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_USER_APP_SETTINGS;
  }
}

export function saveUserAppSettings(
  settings: Partial<UserAppSettings>
): UserAppSettings {
  const merged: UserAppSettings = { ...DEFAULT_USER_APP_SETTINGS, ...settings };
  safeStorageSet(USER_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export async function syncFromRemoteDecentralizedNode(syncUrl?: string): Promise<{
  ok: boolean;
  error: string | null;
  linksImported: number;
  usersImported: number;
  linksSynced: number;
  usersSynced: number;
}> {
  const safeUrl = sanitizeSafeUrl(syncUrl);
  if (!safeUrl) {
    return {
      ok: false,
      error: 'No remote sync URL configured.',
      linksImported: 0,
      usersImported: 0,
      linksSynced: 0,
      usersSynced: 0,
    };
  }
  try {
    const res = await fetch(safeUrl);
    if (!res.ok) {
      return {
        ok: false,
        error: `Remote node returned HTTP ${res.status}`,
        linksImported: 0,
        usersImported: 0,
        linksSynced: 0,
        usersSynced: 0,
      };
    }
    const text = await res.text();
    return await importGlobalDatabaseSnapshot(text);
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Could not reach remote sync node.',
      linksImported: 0,
      usersImported: 0,
      linksSynced: 0,
      usersSynced: 0,
    };
  }
}

export async function importGlobalDatabaseSnapshot(rawJson: string): Promise<{
  ok: boolean;
  error: string | null;
  linksImported: number;
  usersImported: number;
  linksSynced: number;
  usersSynced: number;
}> {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        error: 'Invalid JSON snapshot object.',
        linksImported: 0,
        usersImported: 0,
        linksSynced: 0,
        usersSynced: 0,
      };
    }

    let linksImported = 0;
    let usersImported = 0;

    if (Array.isArray(parsed.movie_links)) {
      const bulkRes = await bulkUpsertMovieLinks(parsed.movie_links);
      linksImported = bulkRes.savedCount;
    }

    if (Array.isArray(parsed.app_users)) {
      for (const u of parsed.app_users) {
        const res = await upsertAppUser(u);
        if (res.ok) usersImported += 1;
      }
    }

    if (parsed.app_config && typeof parsed.app_config === 'object') {
      await updateAppConfig(parsed.app_config);
    }

    return {
      ok: true,
      error: null,
      linksImported,
      usersImported,
      linksSynced: linksImported,
      usersSynced: usersImported,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Failed to parse JSON snapshot.',
      linksImported: 0,
      usersImported: 0,
      linksSynced: 0,
      usersSynced: 0,
    };
  }
}

const LOCAL_WATCH_HISTORY_ROWS_KEY = 'cinebox_watch_history_rows_v2';
const LOCAL_WATCHLIST_STORAGE_KEY = 'cinebox_watchlist_v2';

function getLocalWatchHistoryMap(): Record<string, any> {
  try {
    const raw = safeStorageGet(LOCAL_WATCH_HISTORY_ROWS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalWatchHistoryMap(map: Record<string, any>): void {
  safeStorageSet(LOCAL_WATCH_HISTORY_ROWS_KEY, JSON.stringify(map));
}

/**
 * Fix 7: Resolves canonical `season` and `episode` integers for `watch_history`:
 * - Movies (`media_type === 'movie'`) do NOT have seasons or episodes -> normalized to `season: 0, episode: 0`
 *   (matching `season INTEGER NOT NULL DEFAULT 0, episode INTEGER NOT NULL DEFAULT 0` in PostgreSQL).
 * - TV Shows (`media_type === 'tv'`) use `season >= 1` and `episode >= 1`.
 */
export function resolveWatchHistorySeasonAndEpisode(
  mediaType: 'movie' | 'tv',
  season?: number | null,
  episode?: number | null
): { season: number; episode: number } {
  if (mediaType !== 'tv') {
    return { season: 0, episode: 0 };
  }
  return {
    season: Math.max(1, Math.round(Number(season) || 1)),
    episode: Math.max(1, Math.round(Number(episode) || 1)),
  };
}

/**
 * Fix 7 & Phase 2 (5): Syncs resume position & watch history to Supabase `watch_history` table
 * using a single `progress_seconds` column (`progress_seconds`, `duration_seconds`, `last_watched_at`),
 * while always saving to `localStorage` as an offline/guest fallback.
 */
export async function syncWatchHistoryEntry(entry: {
  user_id?: string | null;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  season?: number | null;
  episode?: number | null;
  progress_seconds: number;
  duration_seconds: number;
  title?: string;
  poster_url?: string;
}): Promise<{
  ok: boolean;
  syncedToCloud: boolean;
  season: number;
  episode: number;
  progress_seconds: number;
}> {
  const tmdbId = Number(entry.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return { ok: false, syncedToCloud: false, season: 0, episode: 0, progress_seconds: 0 };
  }
  const userId = (entry.user_id || getLoggedInUser()?.id || 'guest').trim();
  const { season, episode } = resolveWatchHistorySeasonAndEpisode(
    entry.media_type,
    entry.season,
    entry.episode
  );
  const progressSec = Math.max(0, Math.round(Number(entry.progress_seconds) || 0));
  const durSec = Math.max(0, Math.round(Number(entry.duration_seconds) || 0));
  const nowIso = new Date().toISOString();
  const compositeKey = `${userId}::${entry.media_type}::${tmdbId}::S${season}::E${episode}`;

  const rowPayload = {
    user_id: userId,
    tmdb_id: tmdbId,
    media_type: entry.media_type,
    season,
    episode,
    progress_seconds: progressSec,
    duration_seconds: durSec,
    title: sanitizeDatabaseTextField(entry.title || '', 120),
    poster_url: sanitizeSafeUrl(entry.poster_url) || '',
    last_watched_at: nowIso,
    updated_at: nowIso,
  };

  const localMap = getLocalWatchHistoryMap();
  localMap[compositeKey] = rowPayload;
  saveLocalWatchHistoryMap(localMap);

  const client = getSupabaseClient();
  if (!client || !entry.user_id || userId === 'guest') {
    return {
      ok: true,
      syncedToCloud: false,
      season,
      episode,
      progress_seconds: progressSec,
    };
  }

  try {
    const { error } = await client.from('watch_history').upsert(
      {
        user_id: userId,
        tmdb_id: tmdbId,
        media_type: entry.media_type,
        season,
        episode,
        progress_seconds: progressSec,
        duration_seconds: durSec,
        title: rowPayload.title,
        poster_url: rowPayload.poster_url,
        last_watched_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'user_id,tmdb_id,media_type,season,episode' }
    );
    return {
      ok: true,
      syncedToCloud: !error,
      season,
      episode,
      progress_seconds: progressSec,
    };
  } catch {
    return {
      ok: true,
      syncedToCloud: false,
      season,
      episode,
      progress_seconds: progressSec,
    };
  }
}

export async function getSavedWatchHistoryEntry(params: {
  user_id?: string | null;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  season?: number | null;
  episode?: number | null;
}): Promise<{
  progress_seconds: number;
  duration_seconds: number;
  season: number;
  episode: number;
  last_watched_at: string;
  source: 'supabase' | 'local';
} | null> {
  const tmdbId = Number(params.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;

  const userId = (params.user_id || getLoggedInUser()?.id || 'guest').trim();
  const { season, episode } = resolveWatchHistorySeasonAndEpisode(
    params.media_type,
    params.season,
    params.episode
  );
  const compositeKey = `${userId}::${params.media_type}::${tmdbId}::S${season}::E${episode}`;
  const guestKey = `guest::${params.media_type}::${tmdbId}::S${season}::E${episode}`;

  const localMap = getLocalWatchHistoryMap();
  const localEntry = localMap[compositeKey] || localMap[guestKey] || null;

  const client = getSupabaseClient();
  if (client && params.user_id && userId !== 'guest') {
    try {
      const { data, error } = await client
        .from('watch_history')
        .select('progress_seconds,duration_seconds,last_watched_at,updated_at')
        .eq('user_id', userId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', params.media_type)
        .eq('season', season)
        .eq('episode', episode)
        .maybeSingle();

      if (!error && data && typeof data.progress_seconds === 'number') {
        const syncedRow = {
          progress_seconds: Math.max(0, Math.round(data.progress_seconds)),
          duration_seconds: Math.max(0, Math.round(Number(data.duration_seconds) || 0)),
          season,
          episode,
          last_watched_at: data.last_watched_at || data.updated_at || new Date().toISOString(),
          source: 'supabase' as const,
        };
        localMap[compositeKey] = {
          ...localEntry,
          ...syncedRow,
          user_id: userId,
          tmdb_id: tmdbId,
          media_type: params.media_type,
          season,
          episode,
        };
        saveLocalWatchHistoryMap(localMap);
        return syncedRow;
      }
    } catch {
      // Fallback to local
    }
  }

  if (localEntry && typeof localEntry.progress_seconds === 'number') {
    return {
      progress_seconds: Math.max(0, Math.round(localEntry.progress_seconds)),
      duration_seconds: Math.max(0, Math.round(Number(localEntry.duration_seconds) || 0)),
      season,
      episode,
      last_watched_at:
        localEntry.last_watched_at || localEntry.updated_at || new Date().toISOString(),
      source: 'local',
    };
  }

  return null;
}

/**
 * ============================================================================
 * FIX 7: Real Watchlist Persistence (Supabase `public.watchlist` + `localStorage` Fallback)
 * ============================================================================
 */
function loadLocalWatchlistItems(): MovieItem[] {
  try {
    const raw = safeStorageGet(LOCAL_WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalWatchlistItems(items: MovieItem[]): void {
  safeStorageSet(LOCAL_WATCHLIST_STORAGE_KEY, JSON.stringify(items));
}

export function clearLocalWatchlistForTests(): void {
  try {
    safeStorageSet(LOCAL_WATCHLIST_STORAGE_KEY, '[]');
    safeStorageSet(LOCAL_WATCH_HISTORY_ROWS_KEY, '{}');
  } catch {
    // ignore
  }
}

export async function fetchUserWatchlist(
  userIdOverride?: string | null
): Promise<{ items: MovieItem[]; source: 'supabase' | 'local' }> {
  const localItems = loadLocalWatchlistItems();
  const userId = (userIdOverride ?? getLoggedInUser()?.id ?? '').trim();
  const client = getSupabaseClient();

  if (!client || !userId || userId === 'guest') {
    return { items: localItems, source: 'local' };
  }

  try {
    const { data, error } = await client
      .from('watchlist')
      .select(
        'tmdb_id,media_type,title,poster_path,poster_url,backdrop_url,release_year,rating,language,genres,added_at'
      )
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error || !Array.isArray(data)) {
      return { items: localItems, source: 'local' };
    }

    const cloudItems: MovieItem[] = data.map((row: any) => {
      const poster =
        sanitizeSafeUrl(row.poster_path) ||
        sanitizeSafeUrl(row.poster_url) ||
        'https://image.tmdb.org/t/p/w500/placeholder.jpg';
      const backdrop = sanitizeSafeUrl(row.backdrop_url) || poster;
      return {
        id: Number(row.tmdb_id),
        title: sanitizeDatabaseTextField(row.title || 'Saved Title', 140),
        releaseYear: String(row.release_year || '2025').slice(0, 4),
        rating: Number(row.rating) || 8.0,
        language: sanitizeDatabaseTextField(row.language || 'English', 40),
        languageBadge: 'HD',
        category: 'trending',
        mediaType: row.media_type === 'tv' ? 'tv' : 'movie',
        posterUrl: poster,
        backdropUrl: backdrop,
        overview: '',
        genres: Array.isArray(row.genres) ? row.genres : ['Drama'],
        duration: '2h 00m',
        runtime: '2h 00m',
        cast: [],
      };
    });

    // Merge cloud items with any local items if cloud is empty on first sync
    if (cloudItems.length > 0) {
      saveLocalWatchlistItems(cloudItems);
      return { items: cloudItems, source: 'supabase' };
    }
    return { items: localItems, source: 'local' };
  } catch {
    return { items: localItems, source: 'local' };
  }
}

export async function addWatchlistItemToSupabase(
  movie: MovieItem,
  userIdOverride?: string | null
): Promise<{ ok: boolean; syncedToCloud: boolean; items: MovieItem[] }> {
  const existing = loadLocalWatchlistItems();
  const next = [
    movie,
    ...existing.filter(
      (m) => !(m.id === movie.id && (m.mediaType || 'movie') === (movie.mediaType || 'movie'))
    ),
  ];
  saveLocalWatchlistItems(next);

  const userId = (userIdOverride ?? getLoggedInUser()?.id ?? '').trim();
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest') {
    return { ok: true, syncedToCloud: false, items: next };
  }

  try {
    const safePoster = sanitizeSafeUrl(movie.posterUrl) || '';
    const { error } = await client.from('watchlist').upsert(
      {
        user_id: userId,
        tmdb_id: movie.id,
        media_type: movie.mediaType === 'tv' ? 'tv' : 'movie',
        title: sanitizeDatabaseTextField(movie.title, 140),
        poster_path: safePoster,
        poster_url: safePoster,
        backdrop_url: sanitizeSafeUrl(movie.backdropUrl) || '',
        release_year: String(movie.releaseYear || '2025').slice(0, 4),
        rating: Number(movie.rating) || 8.0,
        language: sanitizeDatabaseTextField(movie.language || 'English', 40),
        added_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,tmdb_id,media_type' }
    );
    return { ok: true, syncedToCloud: !error, items: next };
  } catch {
    return { ok: true, syncedToCloud: false, items: next };
  }
}

export async function removeWatchlistItemFromSupabase(
  tmdbId: number,
  mediaType: 'movie' | 'tv' = 'movie',
  userIdOverride?: string | null
): Promise<{ ok: boolean; syncedToCloud: boolean; items: MovieItem[] }> {
  const existing = loadLocalWatchlistItems();
  const next = existing.filter(
    (m) => !(m.id === tmdbId && (m.mediaType || 'movie') === mediaType)
  );
  saveLocalWatchlistItems(next);

  const userId = (userIdOverride ?? getLoggedInUser()?.id ?? '').trim();
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest') {
    return { ok: true, syncedToCloud: false, items: next };
  }

  try {
    const { error } = await client
      .from('watchlist')
      .delete()
      .eq('user_id', userId)
      .eq('tmdb_id', tmdbId)
      .eq('media_type', mediaType);
    return { ok: true, syncedToCloud: !error, items: next };
  } catch {
    return { ok: true, syncedToCloud: false, items: next };
  }
}

export async function fetchLinkHealthRowsForTmdb(
  tmdbId: number
): Promise<Array<{ source_url: string; status: 'ok' | 'slow' | 'down' | 'unknown'; status_code?: number | null }>> {
  const client = getSupabaseClient();
  if (!client || !Number.isInteger(tmdbId) || tmdbId <= 0) return [];
  try {
    const { data, error } = await client
      .from('link_health')
      .select('source_url,status,status_code')
      .eq('tmdb_id', tmdbId);
    if (error || !Array.isArray(data)) return [];
    return data.map((row: any) => ({
      source_url: String(row.source_url || ''),
      status:
        row.status === 'ok' || row.status === 'slow' || row.status === 'down'
          ? row.status
          : 'unknown',
      status_code: typeof row.status_code === 'number' ? row.status_code : null,
    }));
  } catch {
    return [];
  }
}

/**
 * ============================================================================
 * FIX 8: Hardened User Feedback Submission (Strict Email Regex, Server & Client
 * TRIM + Length Check [3..500], Honeypot Bot Guard, and 3/Hour Rate Limiting)
 * ============================================================================
 */
export type UserFeedbackType = 'bug' | 'feature' | 'other';

export interface UserFeedbackInput {
  type: UserFeedbackType;
  message: string;
  email?: string | null;
  user_id?: string | null;
  website_honeypot?: string;
}

export const STRICT_FEEDBACK_EMAIL_REGEX =
  /^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,15}$/;

export const FEEDBACK_RATE_LIMIT_MAX_PER_HOUR = 3;
export const FEEDBACK_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const FEEDBACK_RATE_LIMIT_STORAGE_KEY = 'cinebox_feedback_rate_limit_v1';

function getRecentFeedbackTimestamps(nowMs: number = Date.now()): number[] {
  try {
    const raw = safeStorageGet(FEEDBACK_RATE_LIMIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((ts) => Number(ts))
      .filter((ts) => Number.isFinite(ts) && nowMs - ts < FEEDBACK_RATE_LIMIT_WINDOW_MS);
  } catch {
    return [];
  }
}

function recordFeedbackTimestamp(nowMs: number = Date.now()): void {
  const recent = getRecentFeedbackTimestamps(nowMs);
  recent.push(nowMs);
  safeStorageSet(FEEDBACK_RATE_LIMIT_STORAGE_KEY, JSON.stringify(recent));
}

export function clearFeedbackRateLimitForTests(): void {
  safeStorageSet(FEEDBACK_RATE_LIMIT_STORAGE_KEY, '[]');
}

export function validateUserFeedbackPayload(input: UserFeedbackInput): {
  valid: boolean;
  error: string | null;
  sanitized: {
    type: UserFeedbackType;
    message: string;
    email: string | null;
    website_honeypot: string;
  } | null;
} {
  // 1. Honeypot anti-bot check: must be empty
  const honeypot = typeof input?.website_honeypot === 'string' ? input.website_honeypot : '';
  if (honeypot.length > 0) {
    return {
      valid: false,
      error: 'Spam submission blocked.',
      sanitized: null,
    };
  }

  // 2. Type validation
  const allowedTypes: UserFeedbackType[] = ['bug', 'feature', 'other'];
  if (!input || !allowedTypes.includes(input.type)) {
    return {
      valid: false,
      error: 'Please select a valid feedback category (Bug, Feature, or Other).',
      sanitized: null,
    };
  }

  // 3. Message TRIM + length check (3 to 500 characters) + strip HTML/script tags
  const rawTrimmedMessage = typeof input.message === 'string' ? input.message.trim() : '';
  const cleanedMessage = sanitizeDatabaseTextField(rawTrimmedMessage, 600).trim();
  if (cleanedMessage.length < 3) {
    return {
      valid: false,
      error: 'Feedback message must be at least 3 characters (after trimming whitespace).',
      sanitized: null,
    };
  }
  if (rawTrimmedMessage.length > 500 || cleanedMessage.length > 500) {
    return {
      valid: false,
      error: 'Feedback message cannot exceed 500 characters.',
      sanitized: null,
    };
  }

  // 4. Strict email regex validation when email is provided
  const rawEmail = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  let validatedEmail: string | null = null;
  if (rawEmail.length > 0) {
    if (
      rawEmail.length < 5 ||
      rawEmail.length > 120 ||
      !STRICT_FEEDBACK_EMAIL_REGEX.test(rawEmail)
    ) {
      return {
        valid: false,
        error: 'Please enter a valid email address (e.g., name@domain.com).',
        sanitized: null,
      };
    }
    validatedEmail = rawEmail;
  }

  return {
    valid: true,
    error: null,
    sanitized: {
      type: input.type,
      message: cleanedMessage,
      email: validatedEmail,
      website_honeypot: '',
    },
  };
}

export async function submitUserFeedback(
  input: UserFeedbackInput,
  options?: { nowMs?: number }
): Promise<{
  ok: boolean;
  syncedToCloud: boolean;
  error: string | null;
  remainingInHour: number;
}> {
  const nowMs = options?.nowMs ?? Date.now();

  // 1. Validate payload first (honeypot, type, trimmed message 3..500, strict email regex)
  const validation = validateUserFeedbackPayload(input);
  if (!validation.valid || !validation.sanitized) {
    const recent = getRecentFeedbackTimestamps(nowMs);
    return {
      ok: false,
      syncedToCloud: false,
      error: validation.error || 'Invalid feedback submission.',
      remainingInHour: Math.max(0, FEEDBACK_RATE_LIMIT_MAX_PER_HOUR - recent.length),
    };
  }

  // 2. Enforce rate limit (max 3 submissions per hour)
  const recentTimestamps = getRecentFeedbackTimestamps(nowMs);
  if (recentTimestamps.length >= FEEDBACK_RATE_LIMIT_MAX_PER_HOUR) {
    return {
      ok: false,
      syncedToCloud: false,
      error: 'Rate limit reached: You can submit up to 3 feedback reports per hour. Please try again later.',
      remainingInHour: 0,
    };
  }

  const loggedIn = getLoggedInUser();
  const rawUserId = (input.user_id ?? loggedIn?.id ?? '').trim();
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const supabaseUserId = uuidRegex.test(rawUserId) ? rawUserId : null;
  const resolvedEmail =
    validation.sanitized.email ||
    (loggedIn?.email && STRICT_FEEDBACK_EMAIL_REGEX.test(loggedIn.email.trim())
      ? loggedIn.email.trim().toLowerCase()
      : null);

  let syncedToCloud = false;
  const client = getSupabaseClient();
  if (client) {
    try {
      const { error } = await client.from('user_feedback').insert({
        user_id: supabaseUserId,
        type: validation.sanitized.type,
        message: validation.sanitized.message,
        email: resolvedEmail,
        website_honeypot: '',
      });
      if (!error) {
        syncedToCloud = true;
      } else if (
        error.message?.toLowerCase().includes('rate') ||
        error.message?.toLowerCase().includes('row-level security')
      ) {
        return {
          ok: false,
          syncedToCloud: false,
          error:
            'Rate limit reached (max 3 feedback reports per hour). Please try again later.',
          remainingInHour: 0,
        };
      }
    } catch {
      syncedToCloud = false;
    }
  }

  recordFeedbackTimestamp(nowMs);
  const updatedTimestamps = getRecentFeedbackTimestamps(nowMs);

  return {
    ok: true,
    syncedToCloud,
    error: null,
    remainingInHour: Math.max(0, FEEDBACK_RATE_LIMIT_MAX_PER_HOUR - updatedTimestamps.length),
  };
}



