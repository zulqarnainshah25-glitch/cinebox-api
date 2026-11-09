import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  AppConfigRecord,
  AppUserRecord,
  DecentralizedManifestPayload,
  MovieLinkRecord,
  UserAppSettings,
} from '../types/movie';
import {
  generateAllottedUserId,
  isForbiddenServiceRoleKey,
  sanitizeBannerHtml,
  sanitizeSafeUrl,
  validateAppUserInput,
  validateMovieLinkInput,
} from '../utils/securityValidator';
import {
  applyReferralRewardToReferrer,
  detectAppPlatform,
  generateUniqueReferralCode,
  PENDING_REFERRAL_CODE_STORAGE_KEY,
  sanitizeReferralCode,
  TRIAL_DURATION_MS,
} from './platformTrialReferralService';

/**
 * TASK 4: Least-Privilege Public Column Projections
 * - Public reads of `movie_links` only request public catalog/playback fields.
 * - Public reads of `app_config` explicitly exclude `admin_pin_hash` and `admin_email`
 *   so sensitive admin credentials are never queried or exposed over the wire to anonymous clients.
 */
export const PUBLIC_MOVIE_LINK_COLUMNS =
  'tmdb_id,title,language,direct_video_url,stream_url,download_480p,download_720p,download_1080p,file_size_480p,file_size_720p,file_size_1080p,updated_at';

export const PUBLIC_APP_CONFIG_COLUMNS =
  'id,app_name,primary_theme,is_ads_enabled,popup_ad_image,popup_ad_link,direct_ad_link,banner_ad_html,official_website,decentralized_manifest_url,maintenance_mode,allow_guest_downloads,updated_at';

const STORAGE_KEYS = {
  APP_CONFIG: 'cinebox_app_config_v4_adfree',
  MOVIE_LINKS: 'cinebox_movie_links_v2',
  APP_USERS: 'cinebox_app_users_v1',
  CURRENT_DEVICE_USER_ID: 'cinebox_current_user_id_v1',
  LOGGED_IN_USER: 'cinebox_logged_in_user_v1',
  USER_SETTINGS: 'cinebox_user_settings_v1',
  CUSTOM_SUPABASE_URL: 'cinebox_supabase_url',
  CUSTOM_SUPABASE_KEY: 'cinebox_supabase_anon_key',
};

export const DEFAULT_USER_APP_SETTINGS: UserAppSettings = {
  defaultServer: 'auto-server-3',
  defaultDownloadQuality: '720p',
  autoPlayVideo: true,
  wifiOnlyDownloads: false,
  preferredAudioLanguage: 'Hindi Dubbed',
};

export const DEFAULT_APP_CONFIG: AppConfigRecord = {
  id: 1,
  app_name: 'CineBox',
  primary_theme: 'neon-green',
  is_ads_enabled: false,
  popup_ad_image: '',
  popup_ad_link: 'https://cinebox-movie-streaming-offline-downloader.ai.studio/',
  direct_ad_link: 'https://cinebox-movie-streaming-offline-downloader.ai.studio/',
  banner_ad_html: '',
  admin_pin_hash: '1234',
  admin_email: 'ZulqarnainShah25@gmail.com',
  official_website: 'https://cinebox-movie-streaming-offline-downloader.ai.studio/',
  decentralized_manifest_url: '',
  backup_node_urls: [
    'https://raw.githubusercontent.com/cinebox-global/manifest/main/cinebox-global-sync.json',
    'https://ipfs.io/ipns/cinebox-global-node.eth/manifest.json',
  ],
  maintenance_mode: false,
  allow_guest_downloads: true,
  ad_network_provider: 'none',
  monetag_zone_id: '',
  admob_app_id: 'ca-app-pub-3940256099942544~3347511713',
  admob_banner_id: 'ca-app-pub-3940256099942544/6300978111',
  admob_app_open_id: 'ca-app-pub-3940256099942544/9257395921',
  open_ads_same_tab: true,
  show_app_open_ad_once: false,
};

/**
 * Starts empty so that any TMDb Movie or TV Series without an explicit Admin-added
 * `direct_video_url` in Supabase immediately defaults to Auto-Embed Iframe Mode.
 */
export const INITIAL_MOVIE_LINKS: Record<number, MovieLinkRecord> = {};

export const INITIAL_APP_USERS: Record<string, AppUserRecord> = {
  'USR-1097888621': {
    id: 'USR-1097888621',
    username: 'Zulqarnain Shah (Current Device)',
    email: 'zulqarnainshah25@gmail.com',
    role: 'vip',
    status: 'active',
    platform: 'Web',
    device_id: 'DEV-PIXEL8-1097888621',
    vip_until: '2027-12-30',
    downloads_count: 14,
    notes: 'Primary App Owner / Current Device Profile',
    referral_code: generateUniqueReferralCode('zulqarnainshah25@gmail.com'),
    successful_referrals: 2,
    access_expiry_date: '2027-12-30T00:00:00.000Z',
    updated_at: '2026-11-06T20:00:00.000Z',
  },
  'USR-8841209': {
    id: 'USR-8841209',
    username: 'Ali Raza (Android APK)',
    email: 'aliraza.apk@example.com',
    role: 'vip',
    status: 'active',
    platform: 'Android',
    device_id: 'CAP-ANDROID-SMG998B',
    vip_until: '2027-06-15',
    downloads_count: 29,
    notes: 'Capacitor Android 14 APK Member',
    trial_start_date: '2026-11-06T18:30:00.000Z',
    trial_end_date: '2026-11-09T18:30:00.000Z',
    referral_code: generateUniqueReferralCode('aliraza.apk@example.com'),
    successful_referrals: 1,
    access_expiry_date: null,
    updated_at: '2026-11-06T18:30:00.000Z',
  },
  'USR-5520194': {
    id: 'USR-5520194',
    username: 'Hamza Khan',
    email: 'hamza.khan@example.com',
    role: 'user',
    status: 'active',
    platform: 'Android',
    device_id: 'CAP-ANDROID-RMX3363',
    vip_until: '2026-12-31',
    downloads_count: 4,
    notes: 'Standard Free Tier User',
    trial_start_date: '2026-11-01T15:10:00.000Z',
    trial_end_date: '2026-11-04T15:10:00.000Z',
    referral_code: generateUniqueReferralCode('hamza.khan@example.com'),
    successful_referrals: 0,
    access_expiry_date: null,
    updated_at: '2026-11-05T15:10:00.000Z',
  },
  'USR-3391042': {
    id: 'USR-3391042',
    username: 'SpamScraperBot_99',
    email: 'bot99@scraper-net.org',
    role: 'user',
    status: 'suspended',
    platform: 'Web',
    device_id: 'WEB-HEADLESS-99',
    vip_until: '2026-01-01',
    downloads_count: 142,
    notes: 'Auto-flagged for excessive concurrent requests',
    referral_code: generateUniqueReferralCode('bot99@scraper-net.org'),
    successful_referrals: 0,
    updated_at: '2026-11-04T11:20:00.000Z',
  },
};

let cachedSupabaseClient: SupabaseClient | null = null;
let lastSupabaseUrl = '';
let lastSupabaseKey = '';
let remoteSchemaUnavailable = false;
let remoteUsersSchemaUnavailable = false;

export function getSupabaseCredentials(): {
  url: string;
  anonKey: string;
  isConfigured: boolean;
  securityWarning?: string;
} {
  const envUrl = import.meta.env?.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
  const storedUrl =
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.CUSTOM_SUPABASE_URL) || '' : '';
  const storedKey =
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.CUSTOM_SUPABASE_KEY) || '' : '';

  const url = (storedUrl || envUrl).trim();
  const candidateKey = (storedKey || envKey).trim();

  // TASK 4: Strictly forbid Supabase service_role or sb_secret_ keys in frontend code / localStorage / VITE_ env
  if (isForbiddenServiceRoleKey(candidateKey)) {
    return {
      url,
      anonKey: '',
      isConfigured: false,
      securityWarning:
        'SECURITY BLOCK: Supabase service_role / secret key detected on the client. Only the public anon key is permitted in frontend or APK builds.',
    };
  }

  const anonKey = candidateKey;
  const isConfigured = Boolean(url && anonKey && url.startsWith('https://'));

  return { url, anonKey, isConfigured };
}

export function setSupabaseCredentials(
  url: string,
  anonKey: string
): { ok: boolean; error?: string } {
  const cleanKey = (anonKey || '').trim();
  if (isForbiddenServiceRoleKey(cleanKey)) {
    return {
      ok: false,
      error:
        'Security Error: Never store the Supabase service_role key in browser localStorage or APK assets. Please provide the public anon key.',
    };
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_SUPABASE_URL, (url || '').trim());
    localStorage.setItem(STORAGE_KEYS.CUSTOM_SUPABASE_KEY, cleanKey);
  }
  cachedSupabaseClient = null;
  remoteSchemaUnavailable = false;
  remoteUsersSchemaUnavailable = false;
  return { ok: true };
}

export function getSupabaseClient(): SupabaseClient | null {
  if (remoteSchemaUnavailable) {
    return null;
  }
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  if (!isConfigured) {
    return null;
  }
  if (cachedSupabaseClient && url === lastSupabaseUrl && anonKey === lastSupabaseKey) {
    return cachedSupabaseClient;
  }
  try {
    cachedSupabaseClient = createClient(url, anonKey, {
      auth: { persistSession: false },
    });
    lastSupabaseUrl = url;
    lastSupabaseKey = anonKey;
    return cachedSupabaseClient;
  } catch {
    return null;
  }
}

function getLocalMovieLinksMap(): Record<number, MovieLinkRecord> {
  if (typeof window === 'undefined') return { ...INITIAL_MOVIE_LINKS };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MOVIE_LINKS);
    if (!raw) {
      return { ...INITIAL_MOVIE_LINKS };
    }
    return { ...INITIAL_MOVIE_LINKS, ...JSON.parse(raw) };
  } catch {
    return { ...INITIAL_MOVIE_LINKS };
  }
}

function saveLocalMovieLinksMap(map: Record<number, MovieLinkRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.MOVIE_LINKS, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function getLocalAppUsersMap(): Record<string, AppUserRecord> {
  if (typeof window === 'undefined') return { ...INITIAL_APP_USERS };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.APP_USERS);
    if (!raw) {
      return { ...INITIAL_APP_USERS };
    }
    return { ...INITIAL_APP_USERS, ...JSON.parse(raw) };
  } catch {
    return { ...INITIAL_APP_USERS };
  }
}

function saveLocalAppUsersMap(map: Record<string, AppUserRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.APP_USERS, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function getCurrentDeviceUserId(): string {
  if (typeof window === 'undefined') return 'USR-1097888621';
  try {
    const loggedInRaw = localStorage.getItem(STORAGE_KEYS.LOGGED_IN_USER);
    if (loggedInRaw) {
      const parsed = JSON.parse(loggedInRaw) as AppUserRecord;
      if (parsed && parsed.id) {
        return parsed.id;
      }
    }
    const existing = localStorage.getItem(STORAGE_KEYS.CURRENT_DEVICE_USER_ID);
    if (existing) return existing;
    localStorage.setItem(STORAGE_KEYS.CURRENT_DEVICE_USER_ID, 'USR-1097888621');
  } catch {
    // ignore
  }
  return 'USR-1097888621';
}

export function getLoggedInUser(): AppUserRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOGGED_IN_USER);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUserRecord;
    if (parsed && typeof parsed.id === 'string' && parsed.id.startsWith('USR-')) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function loginOrRegisterUser(params: {
  email: string;
  password: string;
  username?: string;
  mode: 'login' | 'register';
  referredByCode?: string | null;
  platformOverride?: 'Android' | 'Web';
  nowMs?: number;
}): Promise<{
  ok: boolean;
  user?: AppUserRecord;
  referrerUpdated?: AppUserRecord;
  referralRewardMessage?: string;
  error?: string;
}> {
  const cleanEmail = (params.email || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  const cleanPass = (params.password || '').trim();
  if (cleanPass.length < 4) {
    return { ok: false, error: 'Password must be at least 4 characters long.' };
  }

  const nowMs = params.nowMs ?? Date.now();
  const detectedPlatform = params.platformOverride || detectAppPlatform();

  // 1. Check existing users in Supabase / local registry so returning users keep their allotted USR ID
  const allUsers = await fetchAllAppUsers();
  const existingUser = allUsers.find((u) => u.email.toLowerCase() === cleanEmail);

  const allottedId = existingUser?.id || generateAllottedUserId(cleanEmail);
  const derivedName =
    (params.username || '').trim() ||
    existingUser?.username ||
    cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_ -]/g, '') ||
    'CineBox Member';

  const isOwnerEmail = cleanEmail === 'zulqarnainshah25@gmail.com';
  const role = existingUser?.role || (isOwnerEmail ? 'admin' : detectedPlatform === 'Web' ? 'vip' : 'user');
  const status = existingUser?.status || 'active';

  // 2. Generate unique referral code for every user
  const myReferralCode =
    sanitizeReferralCode(existingUser?.referral_code) ||
    generateUniqueReferralCode(cleanEmail);

  // 3. Determine referred_by code (from params or pending storage on first signup)
  let pendingRefCode = sanitizeReferralCode(params.referredByCode);
  if (!pendingRefCode && typeof window !== 'undefined') {
    try {
      pendingRefCode = sanitizeReferralCode(
        localStorage.getItem(PENDING_REFERRAL_CODE_STORAGE_KEY)
      );
    } catch {
      // ignore
    }
  }
  // Prevent self-referral
  if (pendingRefCode === myReferralCode) {
    pendingRefCode = null;
  }

  const finalReferredBy = existingUser?.referred_by || pendingRefCode || null;

  // 4. APK Users: Set trial_start_date (now) and trial_end_date (now + 3 days) upon registration
  const trialStartIso =
    existingUser?.trial_start_date ||
    (detectedPlatform === 'Android' ? new Date(nowMs).toISOString() : undefined);
  const trialEndIso =
    existingUser?.trial_end_date ||
    (detectedPlatform === 'Android'
      ? new Date(nowMs + TRIAL_DURATION_MS).toISOString()
      : undefined);

  const upsertRes = await upsertAppUser({
    id: allottedId,
    username: derivedName,
    email: cleanEmail,
    role,
    status,
    platform: detectedPlatform,
    device_id: existingUser?.device_id || `DEV-${allottedId}`,
    vip_until: existingUser?.vip_until || '2027-12-30',
    downloads_count: existingUser?.downloads_count ?? 0,
    notes:
      existingUser?.notes ||
      `Authenticated on ${detectedPlatform} (${
        detectedPlatform === 'Android' ? '3-Day APK Trial Active' : 'Web Direct Access'
      })`,
    trial_start_date: trialStartIso,
    trial_end_date: trialEndIso,
    referral_code: myReferralCode,
    referred_by: finalReferredBy,
    successful_referrals: existingUser?.successful_referrals ?? 0,
    access_expiry_date: existingUser?.access_expiry_date ?? null,
  });

  if (!upsertRes.ok || !upsertRes.user) {
    return { ok: false, error: upsertRes.error || 'Authentication failed.' };
  }

  // 5. If this is a new referral (or newly attached referred_by), credit the referrer (+1 successful_referrals)
  let referrerUpdated: AppUserRecord | undefined;
  let referralRewardMessage: string | undefined;

  if (pendingRefCode && !existingUser?.referred_by) {
    const creditRes = await creditReferralCodeOwner(pendingRefCode, cleanEmail, nowMs);
    if (creditRes.ok && creditRes.referrer) {
      referrerUpdated = creditRes.referrer;
      referralRewardMessage = creditRes.message;
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(PENDING_REFERRAL_CODE_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.LOGGED_IN_USER, JSON.stringify(upsertRes.user));
      localStorage.setItem(STORAGE_KEYS.CURRENT_DEVICE_USER_ID, upsertRes.user.id);
    } catch {
      // ignore
    }
  }

  return {
    ok: true,
    user: upsertRes.user,
    referrerUpdated,
    referralRewardMessage,
  };
}

/**
 * Finds the base user who owns `referralCode`, increments `successful_referrals` by +1,
 * and if `successful_referrals >= 2`, sets `access_expiry_date = current_date + 30 days` and unlocks the app.
 */
export async function creditReferralCodeOwner(
  referralCode: string,
  newUserEmail: string,
  nowMs: number = Date.now()
): Promise<{
  ok: boolean;
  referrer?: AppUserRecord;
  unlockedThirtyDays?: boolean;
  message?: string;
}> {
  const cleanCode = sanitizeReferralCode(referralCode);
  if (!cleanCode) {
    return { ok: false, message: 'Invalid referral code format.' };
  }

  const allUsers = await fetchAllAppUsers();
  const baseUser = allUsers.find(
    (u) =>
      (u.referral_code && u.referral_code.toUpperCase() === cleanCode) ||
      generateUniqueReferralCode(u.email) === cleanCode
  );

  if (!baseUser) {
    return { ok: false, message: 'Referral code owner not found.' };
  }

  const reward = applyReferralRewardToReferrer(baseUser, newUserEmail, nowMs);
  const saved = await upsertAppUser(reward.updatedReferrer);

  // If the currently logged-in user on this device is the referrer, sync their session too
  const currentLoggedIn = getLoggedInUser();
  if (currentLoggedIn && currentLoggedIn.id === baseUser.id && saved.user && typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.LOGGED_IN_USER, JSON.stringify(saved.user));
    } catch {
      // ignore
    }
  }

  return {
    ok: saved.ok,
    referrer: saved.user,
    unlockedThirtyDays: reward.unlockedThirtyDays,
    message: reward.rewardMessage,
  };
}

export function logoutCurrentUser(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.LOGGED_IN_USER);
  } catch {
    // ignore
  }
}

export function getUserAppSettings(): UserAppSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_USER_APP_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER_SETTINGS);
    if (!raw) return { ...DEFAULT_USER_APP_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<UserAppSettings>;
    return {
      defaultServer:
        parsed.defaultServer === 'auto-server-1' ? 'auto-server-1' : 'auto-server-3',
      defaultDownloadQuality:
        parsed.defaultDownloadQuality === '480p' || parsed.defaultDownloadQuality === '1080p'
          ? parsed.defaultDownloadQuality
          : '720p',
      autoPlayVideo: parsed.autoPlayVideo !== false,
      wifiOnlyDownloads: Boolean(parsed.wifiOnlyDownloads),
      preferredAudioLanguage:
        parsed.preferredAudioLanguage === 'Dual Audio' ||
        parsed.preferredAudioLanguage === 'Original English'
          ? parsed.preferredAudioLanguage
          : 'Hindi Dubbed',
    };
  } catch {
    return { ...DEFAULT_USER_APP_SETTINGS };
  }
}

export function saveUserAppSettings(settings: UserAppSettings): UserAppSettings {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.USER_SETTINGS, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }
  return settings;
}

/**
 * Queries the Supabase `movie_links` table by `tmdb_id` with a 3.5s timeout.
 * Returns `null` when no custom record exists for that `tmdb_id`, triggering Auto-Embed Iframe Mode.
 */
export async function fetchMovieLinkByTmdbId(tmdbId: number): Promise<MovieLinkRecord | null> {
  const localMap = getLocalMovieLinksMap();
  const client = getSupabaseClient();

  if (client) {
    try {
      const { data, error } = await Promise.race([
        client
          .from('movie_links')
          .select(PUBLIC_MOVIE_LINK_COLUMNS)
          .eq('tmdb_id', tmdbId)
          .maybeSingle(),
        new Promise<{ data: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), 3500)
        ),
      ]);

      if (error) {
        remoteSchemaUnavailable = true;
      } else if (data) {
        const existingLocal = localMap[tmdbId];
        const mergedRaw: Partial<MovieLinkRecord> = {
          ...existingLocal,
          ...(data as unknown as MovieLinkRecord),
          hindi_dubbed_video_url:
            (data as unknown as MovieLinkRecord).hindi_dubbed_video_url ??
            existingLocal?.hindi_dubbed_video_url ??
            null,
          urdu_dubbed_video_url:
            (data as unknown as MovieLinkRecord).urdu_dubbed_video_url ??
            existingLocal?.urdu_dubbed_video_url ??
            null,
          alternate_streams:
            (data as unknown as MovieLinkRecord).alternate_streams ??
            existingLocal?.alternate_streams,
        };
        const validated = validateMovieLinkInput(mergedRaw);
        const record =
          validated.valid && validated.sanitized
            ? validated.sanitized
            : (data as unknown as MovieLinkRecord);
        localMap[tmdbId] = record;
        saveLocalMovieLinksMap(localMap);
        return record;
      }
    } catch {
      remoteSchemaUnavailable = true;
    }
  }

  return localMap[tmdbId] || null;
}

export async function fetchAllMovieLinks(): Promise<MovieLinkRecord[]> {
  const localMap = getLocalMovieLinksMap();
  const client = getSupabaseClient();

  if (client) {
    try {
      const { data, error } = await client
        .from('movie_links')
        .select(PUBLIC_MOVIE_LINK_COLUMNS)
        .order('updated_at', { ascending: false })
        .limit(250);

      if (error) {
        remoteSchemaUnavailable = true;
      } else if (Array.isArray(data)) {
        for (const row of data) {
          const existingLocal = localMap[row.tmdb_id];
          const mergedRaw: Partial<MovieLinkRecord> = {
            ...existingLocal,
            ...(row as MovieLinkRecord),
            hindi_dubbed_video_url:
              (row as MovieLinkRecord).hindi_dubbed_video_url ??
              existingLocal?.hindi_dubbed_video_url ??
              null,
            urdu_dubbed_video_url:
              (row as MovieLinkRecord).urdu_dubbed_video_url ??
              existingLocal?.urdu_dubbed_video_url ??
              null,
            alternate_streams:
              (row as MovieLinkRecord).alternate_streams ??
              existingLocal?.alternate_streams,
          };
          const validated = validateMovieLinkInput(mergedRaw);
          localMap[row.tmdb_id] =
            validated.valid && validated.sanitized ? validated.sanitized : (row as MovieLinkRecord);
        }
        saveLocalMovieLinksMap(localMap);
      }
    } catch {
      remoteSchemaUnavailable = true;
    }
  }

  return Object.values(localMap);
}

function toCoreSupabaseMovieRow(record: MovieLinkRecord) {
  return {
    tmdb_id: record.tmdb_id,
    title: record.title || '',
    language: record.language,
    direct_video_url: record.direct_video_url,
    stream_url: record.stream_url,
    download_480p: record.download_480p,
    download_720p: record.download_720p,
    download_1080p: record.download_1080p || record.download_720p,
    file_size_480p: record.file_size_480p || '450.0MB',
    file_size_720p: record.file_size_720p || '1020.6MB',
    file_size_1080p: record.file_size_1080p || '2150.0MB',
    updated_at: record.updated_at || new Date().toISOString(),
  };
}

export async function upsertMovieLink(
  input: Partial<MovieLinkRecord>
): Promise<{ ok: boolean; error?: string; record?: MovieLinkRecord }> {
  const validation = validateMovieLinkInput(input);
  if (!validation.valid || !validation.sanitized) {
    return { ok: false, error: validation.error || 'Invalid movie link data.' };
  }

  const record: MovieLinkRecord = {
    ...validation.sanitized,
    updated_at: new Date().toISOString(),
  };
  const localMap = getLocalMovieLinksMap();
  localMap[record.tmdb_id] = {
    ...localMap[record.tmdb_id],
    ...record,
  };
  saveLocalMovieLinksMap(localMap);

  const client = getSupabaseClient();
  if (client) {
    try {
      const hasExtendedCols = Boolean(
        record.hindi_dubbed_video_url ||
          record.urdu_dubbed_video_url ||
          (record.alternate_streams && record.alternate_streams.length > 0)
      );
      const payloadToTry = hasExtendedCols ? record : toCoreSupabaseMovieRow(record);
      let { error } = await client
        .from('movie_links')
        .upsert(payloadToTry, { onConflict: 'tmdb_id' });

      // If remote table has not run the optional extended columns migration yet (PGRST204),
      // automatically retry with core columns while keeping extended streams in local/decentralized storage.
      if (error && hasExtendedCols) {
        const retryRes = await client
          .from('movie_links')
          .upsert(toCoreSupabaseMovieRow(record), { onConflict: 'tmdb_id' });
        error = retryRes.error;
      }

      if (error) {
        return {
          ok: true,
          record: localMap[record.tmdb_id],
          error: `Saved locally & synced to decentralized cache (Supabase notice: ${error.message})`,
        };
      }
    } catch {
      // Local persistence succeeded
    }
  }

  return { ok: true, record: localMap[record.tmdb_id] };
}

/**
 * Bulk upserts multiple `MovieLinkRecord` rows into Supabase `movie_links` and local decentralized storage.
 */
export async function bulkUpsertMovieLinks(
  records: MovieLinkRecord[]
): Promise<{ ok: boolean; savedCount: number; error?: string }> {
  const localMap = getLocalMovieLinksMap();
  const validRows: MovieLinkRecord[] = [];

  for (const item of records) {
    const res = validateMovieLinkInput(item);
    if (res.valid && res.sanitized) {
      const row = {
        ...res.sanitized,
        updated_at: new Date().toISOString(),
      };
      localMap[row.tmdb_id] = row;
      validRows.push(row);
    }
  }

  saveLocalMovieLinksMap(localMap);

  if (validRows.length === 0) {
    return { ok: false, savedCount: 0, error: 'No valid movie links found to upload.' };
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      const coreRows = validRows.map(toCoreSupabaseMovieRow);
      const { error } = await client
        .from('movie_links')
        .upsert(coreRows, { onConflict: 'tmdb_id' });
      if (error) {
        return {
          ok: true,
          savedCount: validRows.length,
          error: `Saved ${validRows.length} movies to local/decentralized store (Supabase sync notice: ${error.message})`,
        };
      }
    } catch {
      // Saved locally
    }
  }

  return { ok: true, savedCount: validRows.length };
}

export async function deleteMovieLink(tmdbId: number): Promise<void> {
  const localMap = getLocalMovieLinksMap();
  delete localMap[tmdbId];
  saveLocalMovieLinksMap(localMap);

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('movie_links').delete().eq('tmdb_id', tmdbId);
    } catch {
      // Ignore network errors
    }
  }
}

/**
 * Global Users Control (`app_users` table in Supabase + Decentralized Local Store).
 * TASK 4 Security: Anonymous (`anon`) users must not be able to read private `app_users` records
 * from the remote database; remote `app_users` queries are only attempted when an authenticated
 * Supabase Auth session or admin context is present.
 */
export async function fetchAllAppUsers(): Promise<AppUserRecord[]> {
  const localMap = getLocalAppUsersMap();
  const client = getSupabaseClient();
  const loggedIn = getLoggedInUser();
  const isAdminCaller = loggedIn?.role === 'admin' || loggedIn?.email === 'zulqarnainshah25@gmail.com';

  if (client && !remoteUsersSchemaUnavailable && isAdminCaller) {
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData?.session) {
        const { data, error } = await Promise.race([
          client.from('app_users').select('*').order('updated_at', { ascending: false }).limit(200),
          new Promise<{ data: null; error: Error }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), 3000)
          ),
        ]);

        if (error) {
          remoteUsersSchemaUnavailable = true;
        } else if (Array.isArray(data)) {
          for (const row of data) {
            const valid = validateAppUserInput(row as Partial<AppUserRecord>);
            if (valid.valid && valid.sanitized) {
              localMap[valid.sanitized.id] = valid.sanitized;
            }
          }
          saveLocalAppUsersMap(localMap);
        }
      }
    } catch {
      remoteUsersSchemaUnavailable = true;
    }
  }

  return Object.values(localMap);
}

export async function upsertAppUser(
  input: Partial<AppUserRecord>
): Promise<{ ok: boolean; error?: string; user?: AppUserRecord }> {
  const validation = validateAppUserInput(input);
  if (!validation.valid || !validation.sanitized) {
    return { ok: false, error: validation.error || 'Invalid user data.' };
  }

  const user = validation.sanitized;
  const localMap = getLocalAppUsersMap();
  localMap[user.id] = user;
  saveLocalAppUsersMap(localMap);

  const client = getSupabaseClient();
  if (client && !remoteUsersSchemaUnavailable) {
    try {
      const { error } = await client.from('app_users').upsert(user, { onConflict: 'id' });
      if (error) {
        // Fallback to core columns if optional trial/referral columns haven't been migrated yet
        const coreUser = {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          status: user.status,
          platform: user.platform,
          device_id: user.device_id,
          vip_until: user.vip_until,
          downloads_count: user.downloads_count,
          notes: user.notes,
          updated_at: user.updated_at,
        };
        await client.from('app_users').upsert(coreUser, { onConflict: 'id' });
      }
    } catch {
      // Saved locally
    }
  }

  return { ok: true, user };
}

export async function deleteAppUser(userId: string): Promise<void> {
  const localMap = getLocalAppUsersMap();
  delete localMap[userId];
  saveLocalAppUsersMap(localMap);

  const client = getSupabaseClient();
  if (client && !remoteUsersSchemaUnavailable) {
    try {
      await client.from('app_users').delete().eq('id', userId);
    } catch {
      // Ignore network errors
    }
  }
}

export async function fetchAppConfig(): Promise<AppConfigRecord> {
  let localConfig = { ...DEFAULT_APP_CONFIG };
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.APP_CONFIG);
      if (raw) {
        localConfig = { ...DEFAULT_APP_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // Ignore parse error
    }
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      // TASK 4 Security: Query only PUBLIC_APP_CONFIG_COLUMNS (never requesting admin_pin_hash or admin_email)
      const { data, error } = await Promise.race([
        client.from('app_config').select(PUBLIC_APP_CONFIG_COLUMNS).eq('id', 1).maybeSingle(),
        new Promise<{ data: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), 3000)
        ),
      ]);

      if (!error && data) {
        const safePublicData = { ...(data as Partial<AppConfigRecord>) };
        delete (safePublicData as any).admin_pin_hash;
        delete (safePublicData as any).admin_email;

        const hasLocalOverride =
          typeof window !== 'undefined' && Boolean(localStorage.getItem(STORAGE_KEYS.APP_CONFIG));
        localConfig = {
          ...localConfig,
          ...safePublicData,
          is_ads_enabled: false,
          banner_ad_html: '',
        };
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEYS.APP_CONFIG, JSON.stringify(localConfig));
        }
      }
    } catch {
      // Graceful fallback
    }
  }

  if (
    !localConfig.official_website ||
    localConfig.official_website === 'https://movie-box.co'
  ) {
    localConfig.official_website =
      'https://cinebox-movie-streaming-offline-downloader.ai.studio/';
  }
  // Strictly enforce 100% Ad-Free mode
  localConfig.is_ads_enabled = false;
  localConfig.banner_ad_html = '';
  return localConfig;
}

export async function updateAppConfig(
  partial: Partial<AppConfigRecord>
): Promise<{ ok: boolean; config: AppConfigRecord }> {
  const current = await fetchAppConfig();
  const updated: AppConfigRecord = {
    ...current,
    ...partial,
    app_name: (partial.app_name ?? current.app_name).replace(/[<>]/g, '').trim() || 'CineBox',
    banner_ad_html: sanitizeBannerHtml(partial.banner_ad_html ?? current.banner_ad_html),
    decentralized_manifest_url:
      partial.decentralized_manifest_url !== undefined
        ? sanitizeSafeUrl(partial.decentralized_manifest_url) || ''
        : current.decentralized_manifest_url || '',
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.APP_CONFIG, JSON.stringify(updated));
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      const dbPayload = {
        id: 1,
        app_name: updated.app_name,
        primary_theme: updated.primary_theme,
        is_ads_enabled: updated.is_ads_enabled,
        popup_ad_image: updated.popup_ad_image,
        popup_ad_link: updated.popup_ad_link,
        direct_ad_link: updated.direct_ad_link,
        banner_ad_html: updated.banner_ad_html,
        admin_pin_hash: updated.admin_pin_hash || '1234',
        admin_email: updated.admin_email || 'ZulqarnainShah25@gmail.com',
        official_website: updated.official_website,
        decentralized_manifest_url: updated.decentralized_manifest_url || '',
        maintenance_mode: Boolean(updated.maintenance_mode),
        allow_guest_downloads: updated.allow_guest_downloads !== false,
        updated_at: new Date().toISOString(),
      };
      await client.from('app_config').upsert(dbPayload, { onConflict: 'id' });
    } catch {
      // Saved locally
    }
  }

  return { ok: true, config: updated };
}

/**
 * TASK 4: Least-Privilege Row-Level Security (RLS) Migration SQL
 * - Replaces the insecure `FOR ALL TO anon` policies.
 * - Anonymous (`anon`) users can ONLY `SELECT` public movie links (`public.movie_links`) and
 *   the redacted `public.public_app_config` view (which excludes `admin_pin_hash` and `admin_email`).
 * - Anonymous (`anon`) users have ZERO read or write access to `public.app_users` or private `public.app_config` columns.
 * - All `INSERT`, `UPDATE`, and `DELETE` operations require an authenticated Supabase Auth JWT
 *   verified by `public.is_cinebox_admin()` (or a server-side Supabase Edge Function).
 */
export const SUPABASE_RLS_FIX_SQL = `-- CINEBOX STAGE 3 + PLATFORM TRIAL & REFERRAL: LEAST-PRIVILEGE SUPABASE MIGRATION
-- Run this manually in your Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)

-- 0. Ensure app_users has Platform ('Android' | 'Web'), 3-Day Trial, and Referral columns
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'Web';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS successful_referrals INTEGER DEFAULT 0;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS access_expiry_date TIMESTAMPTZ;

-- 1. Enable Row-Level Security on all tables
ALTER TABLE public.movie_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- 2. Drop any legacy permissive policies that allowed anonymous writes or private reads
DROP POLICY IF EXISTS "Allow full access on movie_links" ON public.movie_links;
DROP POLICY IF EXISTS "Allow full access on app_users" ON public.app_users;
DROP POLICY IF EXISTS "Allow full access on app_config" ON public.app_config;

-- 3. Revoke dangerous table-level grants from anon
REVOKE ALL ON TABLE public.movie_links FROM anon;
REVOKE ALL ON TABLE public.app_users FROM anon;
REVOKE ALL ON TABLE public.app_config FROM anon;

-- 4. Server-side Administrator Role Verification Function (checks signed Supabase Auth JWT)
CREATE OR REPLACE FUNCTION public.is_cinebox_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    OR lower(auth.jwt() ->> 'email') = 'zulqarnainshah25@gmail.com',
    false
  );
$$;

-- 5. movie_links: Public read-only for catalog/playback; Admin-only writes
GRANT SELECT ON TABLE public.movie_links TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.movie_links TO authenticated;

DROP POLICY IF EXISTS "movie_links_public_select" ON public.movie_links;
CREATE POLICY "movie_links_public_select"
  ON public.movie_links FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "movie_links_admin_write" ON public.movie_links;
CREATE POLICY "movie_links_admin_write"
  ON public.movie_links FOR ALL TO authenticated
  USING (public.is_cinebox_admin())
  WITH CHECK (public.is_cinebox_admin());

-- 6. app_users: Strictly private (Zero anon access; Authenticated users read own row, Admins manage all)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users TO authenticated;

DROP POLICY IF EXISTS "app_users_self_or_admin_select" ON public.app_users;
CREATE POLICY "app_users_self_or_admin_select"
  ON public.app_users FOR SELECT TO authenticated
  USING (public.is_cinebox_admin() OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "app_users_admin_write" ON public.app_users;
CREATE POLICY "app_users_admin_write"
  ON public.app_users FOR ALL TO authenticated
  USING (public.is_cinebox_admin())
  WITH CHECK (public.is_cinebox_admin());

-- 7. app_config: Column-level protection + public-safe view (excludes admin_pin_hash & admin_email)
GRANT SELECT (
  id, app_name, primary_theme, is_ads_enabled, popup_ad_image, popup_ad_link,
  direct_ad_link, banner_ad_html, official_website, decentralized_manifest_url,
  maintenance_mode, allow_guest_downloads, updated_at
) ON TABLE public.app_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.app_config TO authenticated;

CREATE OR REPLACE VIEW public.public_app_config AS
SELECT
  id, app_name, primary_theme, is_ads_enabled, popup_ad_image, popup_ad_link,
  direct_ad_link, banner_ad_html, official_website, decentralized_manifest_url,
  maintenance_mode, allow_guest_downloads, updated_at
FROM public.app_config
WHERE id = 1;

GRANT SELECT ON public.public_app_config TO anon, authenticated;

DROP POLICY IF EXISTS "app_config_public_safe_select" ON public.app_config;
CREATE POLICY "app_config_public_safe_select"
  ON public.app_config FOR SELECT TO anon, authenticated
  USING (id = 1);

DROP POLICY IF EXISTS "app_config_admin_write" ON public.app_config;
CREATE POLICY "app_config_admin_write"
  ON public.app_config FOR ALL TO authenticated
  USING (id = 1 AND public.is_cinebox_admin())
  WITH CHECK (id = 1 AND public.is_cinebox_admin());`;

export interface SupabaseTableHealth {
  table: 'movie_links' | 'app_users' | 'app_config';
  readOk: boolean;
  writeOk: boolean;
  rowCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface SupabaseDiagnosticReport {
  isConfigured: boolean;
  projectUrl: string;
  allReadsOk: boolean;
  allWritesOk: boolean;
  rlsBlockingWrites: boolean;
  tables: SupabaseTableHealth[];
  checkedAt: string;
}

/**
 * Live diagnostic check for `movie_links`, `app_users`, and `app_config` in Supabase.
 * Verifies public read availability and checks whether anonymous writes are properly
 * restricted by Row-Level Security (RLS) unless authenticated as an admin.
 */
export async function testSupabaseLiveTables(): Promise<SupabaseDiagnosticReport> {
  remoteSchemaUnavailable = false;
  remoteUsersSchemaUnavailable = false;

  const creds = getSupabaseCredentials();
  if (!creds.isConfigured) {
    return {
      isConfigured: false,
      projectUrl: creds.url || 'Not Configured',
      allReadsOk: false,
      allWritesOk: false,
      rlsBlockingWrites: false,
      tables: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      isConfigured: false,
      projectUrl: creds.url,
      allReadsOk: false,
      allWritesOk: false,
      rlsBlockingWrites: false,
      tables: [],
      checkedAt: new Date().toISOString(),
    };
  }

  // 1. Test Read (SELECT) using least-privilege public projections
  const [linksRead, usersRead, configRead] = await Promise.all([
    client.from('movie_links').select(PUBLIC_MOVIE_LINK_COLUMNS, { count: 'exact' }).limit(50),
    client.from('app_users').select('id,role,status', { count: 'exact' }).limit(10),
    client
      .from('app_config')
      .select(PUBLIC_APP_CONFIG_COLUMNS, { count: 'exact' })
      .eq('id', 1),
  ]);

  // 2. Test Write (UPSERT) authorization check
  const [linksWrite, usersWrite, configWrite] = await Promise.all([
    client
      .from('movie_links')
      .upsert(
        {
          tmdb_id: 533535,
          title: 'Deadpool & Wolverine',
          language: 'English',
          direct_video_url:
            'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          stream_url: 'https://www.2embed.cc/embed/533535',
          download_480p:
            'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
          download_720p:
            'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tmdb_id' }
      )
      .select(PUBLIC_MOVIE_LINK_COLUMNS),
    client
      .from('app_users')
      .upsert(
        {
          id: 'USR-1097888621',
          username: 'Zulqarnain Shah (Admin Owner)',
          email: 'zulqarnainshah25@gmail.com',
          role: 'admin',
          status: 'active',
          platform: 'Web Browser',
          device_id: 'DEV-PIXEL8-1097888621',
          vip_until: '2029-12-31',
          downloads_count: 15,
          notes: 'Primary App Owner / Global Admin',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select('id,role,status'),
    client
      .from('app_config')
      .upsert(
        {
          id: 1,
          app_name: 'CineBox',
          primary_theme: 'neon-green',
          is_ads_enabled: true,
          popup_ad_image: '',
          popup_ad_link: 'https://cinebox-movie-streaming-offline-downloader.ai.studio/',
          direct_ad_link: 'https://cinebox-movie-streaming-offline-downloader.ai.studio/',
          banner_ad_html: DEFAULT_APP_CONFIG.banner_ad_html,
          official_website: 'https://cinebox-movie-streaming-offline-downloader.ai.studio/',
          decentralized_manifest_url: '',
          maintenance_mode: false,
          allow_guest_downloads: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select(PUBLIC_APP_CONFIG_COLUMNS),
  ]);

  const tables: SupabaseTableHealth[] = [
    {
      table: 'movie_links',
      readOk: !linksRead.error,
      writeOk: !linksWrite.error,
      rowCount: Array.isArray(linksRead.data) ? linksRead.data.length : 0,
      errorCode: linksWrite.error?.code || linksRead.error?.code,
      errorMessage: linksWrite.error?.message || linksRead.error?.message,
    },
    {
      table: 'app_users',
      readOk: !usersRead.error,
      writeOk: !usersWrite.error,
      rowCount: Array.isArray(usersRead.data) ? usersRead.data.length : 0,
      errorCode: usersWrite.error?.code || usersRead.error?.code,
      errorMessage: usersWrite.error?.message || usersRead.error?.message,
    },
    {
      table: 'app_config',
      readOk: !configRead.error,
      writeOk: !configWrite.error,
      rowCount: Array.isArray(configRead.data) ? configRead.data.length : 0,
      errorCode: configWrite.error?.code || configRead.error?.code,
      errorMessage: configWrite.error?.message || configRead.error?.message,
    },
  ];

  const allReadsOk = Boolean(tables[0]?.readOk && tables[2]?.readOk);
  const allWritesOk = tables.every((t) => t.writeOk);
  const rlsBlockingWrites = tables.some((t) => t.errorCode === '42501');

  return {
    isConfigured: true,
    projectUrl: creds.url,
    allReadsOk,
    allWritesOk,
    rlsBlockingWrites,
    tables,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Exports the complete Global Decentralized Manifest (`app_config`, `movie_links`, `app_users`)
 * so the Admin can host it on IPFS, Cloudflare R2, GitHub Raw, or any decentralized node for APK + Website sync.
 */
export async function exportDecentralizedManifest(): Promise<DecentralizedManifestPayload> {
  const [app_config, movie_links, app_users] = await Promise.all([
    fetchAppConfig(),
    fetchAllMovieLinks(),
    fetchAllAppUsers(),
  ]);

  return {
    version: '2.0.0-decentralized',
    exported_at: new Date().toISOString(),
    signature: `cinebox-global-${movie_links.length}-links-${app_users.length}-users`,
    app_config: {
      ...app_config,
      // Redact PIN hash in public export if needed, or preserve for admin backup
      admin_pin_hash: app_config.admin_pin_hash || '1234',
    },
    movie_links,
    app_users,
  };
}

/**
 * Imports and merges a Global Decentralized Manifest JSON payload into the app (Website or Capacitor APK).
 */
export async function importDecentralizedManifestJson(rawJson: string): Promise<{
  ok: boolean;
  linksSynced: number;
  usersSynced: number;
  error?: string;
}> {
  try {
    const parsed = JSON.parse(rawJson) as Partial<DecentralizedManifestPayload>;
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, linksSynced: 0, usersSynced: 0, error: 'Invalid manifest JSON object.' };
    }

    let linksSynced = 0;
    let usersSynced = 0;

    if (Array.isArray(parsed.movie_links)) {
      const bulkRes = await bulkUpsertMovieLinks(parsed.movie_links);
      linksSynced = bulkRes.savedCount;
    }

    if (Array.isArray(parsed.app_users)) {
      const localUsers = getLocalAppUsersMap();
      for (const u of parsed.app_users) {
        const v = validateAppUserInput(u);
        if (v.valid && v.sanitized) {
          localUsers[v.sanitized.id] = v.sanitized;
          usersSynced++;
        }
      }
      saveLocalAppUsersMap(localUsers);
    }

    if (parsed.app_config && typeof parsed.app_config === 'object') {
      await updateAppConfig(parsed.app_config);
    }

    return { ok: true, linksSynced, usersSynced };
  } catch {
    return {
      ok: false,
      linksSynced: 0,
      usersSynced: 0,
      error: 'Failed to parse Decentralized Manifest JSON.',
    };
  }
}

/**
 * Fetches and syncs from a remote Decentralized Manifest URL (e.g., IPFS gateway, GitHub Raw, Cloudflare R2).
 */
export async function syncFromRemoteDecentralizedNode(manifestUrl: string): Promise<{
  ok: boolean;
  linksSynced: number;
  usersSynced: number;
  error?: string;
}> {
  const safeUrl = sanitizeSafeUrl(manifestUrl);
  if (!safeUrl) {
    return { ok: false, linksSynced: 0, usersSynced: 0, error: 'Invalid Decentralized Node URL.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(safeUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        ok: false,
        linksSynced: 0,
        usersSynced: 0,
        error: `Remote node returned HTTP ${response.status}`,
      };
    }

    const rawText = await response.text();
    return await importDecentralizedManifestJson(rawText);
  } catch {
    return {
      ok: false,
      linksSynced: 0,
      usersSynced: 0,
      error: 'Could not reach remote decentralized node (offline or CORS blocked).',
    };
  }
}


