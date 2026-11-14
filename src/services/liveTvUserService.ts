import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  IptvChannel,
  LiveEpgProgramme,
  UserLiveFavoriteRecord,
  UserLiveHistoryRecord,
} from '../types/movie';
import { getSupabaseClient } from './supabaseClient';
import { sanitizeDatabaseTextField, sanitizeSafeUrl } from '../utils/securityValidator';

const GUEST_FAVORITES_KEY = 'cinebox_live_favorites_v1';
const GUEST_HISTORY_KEY = 'cinebox_live_history_v1';
const MAX_LIVE_HISTORY = 20;
const HISTORY_DEDUPE_WINDOW_MS = 15_000;

const inMemoryFallback: Record<string, string> = {};
const recentWatchTimestamps = new Map<string, number>();

function storageGet(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // ignore storage errors
  }
  return inMemoryFallback[key] ?? null;
}

function storageSet(key: string, val: string): void {
  inMemoryFallback[key] = val;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, val);
    }
  } catch {
    // ignore storage errors
  }
}

function storageRemove(key: string): void {
  delete inMemoryFallback[key];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function loadGuestFavorites(): UserLiveFavoriteRecord[] {
  try {
    const raw = storageGet(GUEST_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadGuestHistory(): UserLiveHistoryRecord[] {
  try {
    const raw = storageGet(GUEST_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getAuthenticatedSupabaseUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getUser();
    return data?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Loads Live TV favorites from `user_live_favorites` (RLS-enforced) for authenticated users,
 * or safely from local guest storage when browsing as guest.
 */
export async function loadLiveFavorites(): Promise<UserLiveFavoriteRecord[]> {
  const client = getSupabaseClient();
  const authUid = await getAuthenticatedSupabaseUserId();

  if (client && authUid) {
    try {
      const { data, error } = await client
        .from('user_live_favorites')
        .select('id,user_id,channel_id,channel_name,logo_url,country,category,created_at')
        .eq('user_id', authUid)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const mapped: UserLiveFavoriteRecord[] = data.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          channelId: String(row.channel_id),
          channelName: sanitizeDatabaseTextField(row.channel_name, 120),
          logoUrl: sanitizeSafeUrl(row.logo_url),
          country: sanitizeDatabaseTextField(row.country || 'INTL', 12),
          category: sanitizeDatabaseTextField(row.category || 'General', 48),
          createdAt: String(row.created_at || new Date().toISOString()),
        }));
        storageSet(GUEST_FAVORITES_KEY, JSON.stringify(mapped));
        return mapped;
      }
    } catch {
      // fall back cleanly to local cache
    }
  }

  return loadGuestFavorites();
}

export async function toggleLiveFavorite(
  channel: Pick<IptvChannel, 'id' | 'name' | 'logoUrl' | 'country' | 'groupTitle'>,
  currentFavorites: UserLiveFavoriteRecord[]
): Promise<{ favorites: UserLiveFavoriteRecord[]; isFavorite: boolean }> {
  const exists = currentFavorites.some((f) => f.channelId === channel.id);
  const authUid = await getAuthenticatedSupabaseUserId();
  const client = getSupabaseClient();

  let nextFavorites: UserLiveFavoriteRecord[];
  if (exists) {
    nextFavorites = currentFavorites.filter((f) => f.channelId !== channel.id);
    if (client && authUid) {
      await client
        .from('user_live_favorites')
        .delete()
        .eq('user_id', authUid)
        .eq('channel_id', channel.id);
    }
  } else {
    const newEntry: UserLiveFavoriteRecord = {
      userId: authUid || 'guest',
      channelId: channel.id,
      channelName: sanitizeDatabaseTextField(channel.name, 120),
      logoUrl: sanitizeSafeUrl(channel.logoUrl),
      country: sanitizeDatabaseTextField(channel.country || 'INTL', 12),
      category: sanitizeDatabaseTextField(channel.groupTitle || 'General', 48),
      createdAt: new Date().toISOString(),
    };
    nextFavorites = [newEntry, ...currentFavorites.filter((f) => f.channelId !== channel.id)];

    if (client && authUid) {
      await client.from('user_live_favorites').upsert(
        [
          {
            user_id: authUid,
            channel_id: newEntry.channelId,
            channel_name: newEntry.channelName,
            logo_url: newEntry.logoUrl,
            country: newEntry.country,
            category: newEntry.category,
          },
        ],
        { onConflict: 'user_id,channel_id' }
      );
    }
  }

  storageSet(GUEST_FAVORITES_KEY, JSON.stringify(nextFavorites));
  return { favorites: nextFavorites, isFavorite: !exists };
}

export async function loadLiveHistory(): Promise<UserLiveHistoryRecord[]> {
  const client = getSupabaseClient();
  const authUid = await getAuthenticatedSupabaseUserId();

  if (client && authUid) {
    try {
      const { data, error } = await client
        .from('user_live_history')
        .select('id,user_id,channel_id,source_id,channel_name,logo_url,country,category,last_watched_at')
        .eq('user_id', authUid)
        .order('last_watched_at', { ascending: false })
        .limit(MAX_LIVE_HISTORY);

      if (!error && Array.isArray(data)) {
        const mapped: UserLiveHistoryRecord[] = data.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          channelId: String(row.channel_id),
          sourceId: row.source_id ? String(row.source_id) : null,
          channelName: sanitizeDatabaseTextField(row.channel_name, 120),
          logoUrl: sanitizeSafeUrl(row.logo_url),
          country: sanitizeDatabaseTextField(row.country || 'INTL', 12),
          category: sanitizeDatabaseTextField(row.category || 'General', 48),
          lastWatchedAt: String(row.last_watched_at || new Date().toISOString()),
        }));
        storageSet(GUEST_HISTORY_KEY, JSON.stringify(mapped));
        return mapped;
      }
    } catch {
      // fall back to guest local store
    }
  }

  return loadGuestHistory();
}

export function shouldRecordHistoryHit(channelId: string, nowMs = Date.now()): boolean {
  const lastMs = recentWatchTimestamps.get(channelId);
  if (lastMs && nowMs - lastMs < HISTORY_DEDUPE_WINDOW_MS) {
    return false;
  }
  recentWatchTimestamps.set(channelId, nowMs);
  return true;
}

export function resetHistoryThrottleForTests(): void {
  recentWatchTimestamps.clear();
}

export async function recordLiveWatchHistory(
  channel: Pick<IptvChannel, 'id' | 'sourceId' | 'name' | 'logoUrl' | 'country' | 'groupTitle'>,
  currentHistory: UserLiveHistoryRecord[],
  nowMs = Date.now()
): Promise<UserLiveHistoryRecord[]> {
  if (!channel?.id) return currentHistory;
  if (!shouldRecordHistoryHit(channel.id, nowMs)) {
    return currentHistory;
  }

  const authUid = await getAuthenticatedSupabaseUserId();
  const client = getSupabaseClient();
  const nowIso = new Date(nowMs).toISOString();

  const entry: UserLiveHistoryRecord = {
    userId: authUid || 'guest',
    channelId: channel.id,
    sourceId: channel.sourceId || null,
    channelName: sanitizeDatabaseTextField(channel.name, 120),
    logoUrl: sanitizeSafeUrl(channel.logoUrl),
    country: sanitizeDatabaseTextField(channel.country || 'INTL', 12),
    category: sanitizeDatabaseTextField(channel.groupTitle || 'General', 48),
    lastWatchedAt: nowIso,
  };

  const next = [entry, ...currentHistory.filter((h) => h.channelId !== channel.id)].slice(
    0,
    MAX_LIVE_HISTORY
  );
  storageSet(GUEST_HISTORY_KEY, JSON.stringify(next));

  if (client && authUid) {
    try {
      await client.from('user_live_history').upsert(
        [
          {
            user_id: authUid,
            channel_id: entry.channelId,
            source_id: entry.sourceId,
            channel_name: entry.channelName,
            logo_url: entry.logoUrl,
            country: entry.country,
            category: entry.category,
            last_watched_at: entry.lastWatchedAt,
          },
        ],
        { onConflict: 'user_id,channel_id' }
      );
    } catch {
      // ignore network transient failure; local store updated
    }
  }

  return next;
}

export async function clearLiveHistory(): Promise<UserLiveHistoryRecord[]> {
  storageRemove(GUEST_HISTORY_KEY);
  recentWatchTimestamps.clear();

  const authUid = await getAuthenticatedSupabaseUserId();
  const client = getSupabaseClient();
  if (client && authUid) {
    try {
      await client.from('user_live_history').delete().eq('user_id', authUid);
    } catch {
      // ignore
    }
  }

  return [];
}

// =============================================================================
// STAGE 10: NATIVE ANDROID MEDIA3 CAPACITOR BRIDGE
// =============================================================================

export interface NativeLivePlayerLaunchOptions {
  channelId: string;
  channelName: string;
  streamUrl: string;
  format: 'hls' | 'dash' | 'unknown';
  category?: string;
  country?: string;
  epgTitle?: string;
  alternateSourcesJson?: string;
}

export interface CineboxLivePlayerPlugin {
  isAvailable(): Promise<{ available: boolean; engine: string }>;
  playStream(options: NativeLivePlayerLaunchOptions): Promise<{ started: boolean; error?: string }>;
  switchChannel(options: NativeLivePlayerLaunchOptions): Promise<{ switched: boolean }>;
  stopPlayback(): Promise<{ stopped: boolean }>;
}

const CineboxLivePlayer = registerPlugin<CineboxLivePlayerPlugin>('CineboxLivePlayer');

export function isNativeAndroidLivePlatform(): boolean {
  try {
    return (
      typeof Capacitor !== 'undefined' &&
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android'
    );
  } catch {
    return false;
  }
}

/**
 * Launches native Kotlin + AndroidX Media3 ExoPlayer on Android using the approved direct HLS/DASH URL.
 * Strictly avoids any HTML iframe or WebView video fallback on Android.
 */
export async function launchNativeMedia3LivePlayer(
  channel: IptvChannel,
  currentProgramme?: LiveEpgProgramme | null,
  pluginOverride?: CineboxLivePlayerPlugin
): Promise<{ launched: boolean; error?: string }> {
  const safeStreamUrl = sanitizeSafeUrl(channel.streamUrl);
  if (!safeStreamUrl) {
    return { launched: false, error: 'Approved stream URL is invalid or missing.' };
  }

  if (
    channel.format === 'unknown' &&
    !/(\.(m3u8|mpd)|\.php|\/hls\/)/i.test(safeStreamUrl)
  ) {
    return {
      launched: false,
      error: 'This source format is not supported by native Media3 HLS/DASH playback.',
    };
  }

  const plugin = pluginOverride || CineboxLivePlayer;

  try {
    const probe = await plugin.isAvailable();
    if (!probe?.available) {
      return {
        launched: false,
        error:
          'Native Media3 Live Player plugin is not available in this Android build. Please update or rebuild the APK with Media3 integrated.',
      };
    }

    const res = await plugin.playStream({
      channelId: channel.id,
      channelName: channel.name,
      streamUrl: safeStreamUrl,
      format: channel.format === 'dash' ? 'dash' : 'hls',
      category: channel.groupTitle,
      country: channel.country || 'INTL',
      epgTitle: currentProgramme?.title || '',
      alternateSourcesJson: JSON.stringify(
        (channel.alternateSources || []).map((s) => ({
          id: s.id,
          url: s.sourceUrl,
          format: s.format,
          provider: s.provider,
        }))
      ),
    });

    if (!res?.started) {
      return {
        launched: false,
        error: res?.error || 'Native Media3 failed to start stream playback.',
      };
    }

    return { launched: true };
  } catch (err: unknown) {
    return {
      launched: false,
      error:
        err instanceof Error
          ? `Native Media3 player bridge error: ${err.message}`
          : 'Native Media3 player bridge is unavailable.',
    };
  }
}
