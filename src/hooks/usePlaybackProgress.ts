import { useCallback, useEffect, useRef, useState } from 'react';
import { MovieItem } from '../types/movie';
import {
  getLoggedInUser,
  getSavedWatchHistoryEntry,
  syncWatchHistoryEntry,
} from '../services/supabaseClient';

export interface UserPlaybackPreferences {
  playbackSpeed: number;
  preferredAudioLang: string;
  preferredSubtitleLang: string;
}

const PLAYBACK_PREFS_STORAGE_KEY = 'cinebox_user_playback_prefs_v2';
const memoryPlaybackPrefs: Record<string, string> = {};

function safeGet(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // fallback
  }
  return memoryPlaybackPrefs[key] ?? null;
}

function safeSet(key: string, val: string): void {
  memoryPlaybackPrefs[key] = val;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, val);
    }
  } catch {
    // ignore
  }
}

export function getSavedUserPlaybackPreferences(userId: string = 'guest'): UserPlaybackPreferences {
  const key = `${PLAYBACK_PREFS_STORAGE_KEY}::${userId || 'guest'}`;
  const raw = safeGet(key) || safeGet(PLAYBACK_PREFS_STORAGE_KEY);
  if (!raw) {
    return {
      playbackSpeed: 1,
      preferredAudioLang: 'en',
      preferredSubtitleLang: 'en',
    };
  }
  try {
    const parsed = JSON.parse(raw);
    const spd = Number(parsed.playbackSpeed);
    const validSpeed =
      Number.isFinite(spd) && spd >= 0.25 && spd <= 3 ? spd : 1;
    return {
      playbackSpeed: validSpeed,
      preferredAudioLang:
        typeof parsed.preferredAudioLang === 'string' && parsed.preferredAudioLang.trim()
          ? parsed.preferredAudioLang.trim()
          : 'en',
      preferredSubtitleLang:
        typeof parsed.preferredSubtitleLang === 'string' && parsed.preferredSubtitleLang.trim()
          ? parsed.preferredSubtitleLang.trim()
          : 'en',
    };
  } catch {
    return {
      playbackSpeed: 1,
      preferredAudioLang: 'en',
      preferredSubtitleLang: 'en',
    };
  }
}

export function saveUserPlaybackPreferences(
  prefs: Partial<UserPlaybackPreferences>,
  userId: string = 'guest'
): UserPlaybackPreferences {
  const current = getSavedUserPlaybackPreferences(userId);
  const merged: UserPlaybackPreferences = {
    ...current,
    ...prefs,
  };
  const key = `${PLAYBACK_PREFS_STORAGE_KEY}::${userId || 'guest'}`;
  const str = JSON.stringify(merged);
  safeSet(key, str);
  safeSet(PLAYBACK_PREFS_STORAGE_KEY, str);
  return merged;
}

/**
 * Phase 2 (4): Determines whether the "Skip Intro" button should be displayed.
 */
export function shouldShowSkipIntro(
  currentTimeSeconds: number,
  introStart?: number | null,
  introEnd?: number | null
): boolean {
  if (typeof introStart !== 'number' || typeof introEnd !== 'number') return false;
  if (!Number.isFinite(introStart) || !Number.isFinite(introEnd)) return false;
  if (introEnd <= introStart || introStart < 0) return false;
  return currentTimeSeconds >= introStart && currentTimeSeconds < introEnd;
}

export interface UsePlaybackProgressOptions {
  movie: MovieItem;
  season: number;
  episode: number;
  totalEpisodesInSeason: number;
  introStart?: number | null;
  introEnd?: number | null;
  onProgressUpdate: (movie: MovieItem, currentSeconds: number, durationSeconds: number) => void;
  onAdvanceEpisode?: (nextEpisode: number) => void;
}

export function usePlaybackProgress({
  movie,
  season,
  episode,
  totalEpisodesInSeason,
  introStart,
  introEnd,
  onProgressUpdate,
  onAdvanceEpisode,
}: UsePlaybackProgressOptions) {
  const activeUserId = getLoggedInUser()?.id || 'guest';
  const [savedResumePosition, setSavedResumePosition] = useState<number>(0);
  const [savedDuration, setSavedDuration] = useState<number>(0);
  const [syncSource, setSyncSource] = useState<'supabase' | 'local'>('local');
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState<number | null>(null);
  const lastSyncedSecRef = useRef<number>(0);

  // Load saved resume position from Supabase (or localStorage fallback) when movie/episode changes
  useEffect(() => {
    let active = true;
    setNextEpisodeCountdown(null);
    lastSyncedSecRef.current = 0;

    getSavedWatchHistoryEntry({
      user_id: activeUserId,
      tmdb_id: movie.id,
      media_type: movie.mediaType,
      season,
      episode,
    })
      .then((res) => {
        if (!active) return;
        if (res && res.position_seconds > 5) {
          setSavedResumePosition(res.position_seconds);
          setSavedDuration(res.duration_seconds);
          setSyncSource(res.source);
        } else {
          setSavedResumePosition(0);
          setSavedDuration(0);
        }
      })
      .catch(() => {
        if (!active) return;
        setSavedResumePosition(0);
      });

    return () => {
      active = false;
    };
  }, [activeUserId, movie.id, movie.mediaType, season, episode]);

  // Throttled save of playback progress to local state + Supabase watch_history table
  const reportPlaybackProgress = useCallback(
    (currentSeconds: number, durationSeconds: number) => {
      if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return;
      const validDur =
        Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;

      if (validDur > 0) {
        onProgressUpdate(movie, currentSeconds, validDur);
      }

      // Sync to localStorage & Supabase every 5 seconds of playback progress
      if (Math.abs(currentSeconds - lastSyncedSecRef.current) >= 5) {
        lastSyncedSecRef.current = currentSeconds;
        setSavedResumePosition(Math.round(currentSeconds));
        if (validDur > 0) setSavedDuration(Math.round(validDur));

        void syncWatchHistoryEntry({
          user_id: activeUserId,
          tmdb_id: movie.id,
          media_type: movie.mediaType,
          season,
          episode,
          position_seconds: currentSeconds,
          duration_seconds: validDur,
          title: movie.title,
          poster_url: movie.posterUrl,
        });
      }
    },
    [activeUserId, movie, season, episode, onProgressUpdate]
  );

  // 5-second Auto-Play Next Episode Countdown for TV Series
  const startNextEpisodeCountdown = useCallback(() => {
    if (movie.mediaType !== 'tv') return;
    if (episode >= totalEpisodesInSeason) return;
    setNextEpisodeCountdown(5);
  }, [movie.mediaType, episode, totalEpisodesInSeason]);

  const cancelNextEpisodeCountdown = useCallback(() => {
    setNextEpisodeCountdown(null);
  }, []);

  const playNextEpisodeImmediately = useCallback(() => {
    setNextEpisodeCountdown(null);
    if (movie.mediaType === 'tv' && episode < totalEpisodesInSeason) {
      onAdvanceEpisode?.(episode + 1);
    }
  }, [movie.mediaType, episode, totalEpisodesInSeason, onAdvanceEpisode]);

  useEffect(() => {
    if (nextEpisodeCountdown === null) return;
    if (nextEpisodeCountdown <= 0) {
      setNextEpisodeCountdown(null);
      if (movie.mediaType === 'tv' && episode < totalEpisodesInSeason) {
        onAdvanceEpisode?.(episode + 1);
      }
      return;
    }

    const timer = setTimeout(() => {
      setNextEpisodeCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [nextEpisodeCountdown, movie.mediaType, episode, totalEpisodesInSeason, onAdvanceEpisode]);

  return {
    activeUserId,
    savedResumePosition,
    savedDuration,
    syncSource,
    reportPlaybackProgress,
    nextEpisodeCountdown,
    startNextEpisodeCountdown,
    cancelNextEpisodeCountdown,
    playNextEpisodeImmediately,
    canShowSkipIntro: (currentTime: number) =>
      shouldShowSkipIntro(currentTime, introStart, introEnd),
  };
}
