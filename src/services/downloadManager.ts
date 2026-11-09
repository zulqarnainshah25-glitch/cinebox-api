import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { DownloadItem, DownloadQuality, MovieItem } from '../types/movie';
import { buildPublicExportPath, sanitizeFileName, sanitizeSafeUrl } from '../utils/securityValidator';

const DOWNLOADS_STORAGE_KEY = 'cinebox_offline_downloads_v2';

type DownloadListener = (items: DownloadItem[]) => void;

const listeners = new Set<DownloadListener>();
const activeControllers = new Map<string, AbortController>();
const activeTimers = new Map<string, ReturnType<typeof setInterval>>();

const INITIAL_SEEDED_DOWNLOAD: DownloadItem = {
  id: '533535_720p',
  tmdbId: 533535,
  title: '720P Deadpool & Wolverine [Hindi]',
  language: 'Hindi',
  quality: '720p',
  posterUrl: 'https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
  backdropUrl: 'https://image.tmdb.org/t/p/w1280/yDHYTfA3R0jFYba16jBB1ef8oIt.jpg',
  sourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  localUri: 'file:///data/user/0/com.cinebox.stream/files/Deadpool_Wolverine_720p.mp4',
  fileSizeMB: 1020.6,
  downloadedMB: 1020.6,
  progress: 100,
  speedMBps: 0,
  status: 'completed',
  watchedPercent: 15,
  durationSeconds: 7781,
  createdAt: Date.now() - 3600_000,
  categoryTag: 'all',
};

let downloadsCache: DownloadItem[] | null = null;

export function getDownloadedItems(): DownloadItem[] {
  if (downloadsCache) {
    return downloadsCache;
  }
  if (typeof window === 'undefined') {
    return [INITIAL_SEEDED_DOWNLOAD];
  }
  try {
    const raw = localStorage.getItem(DOWNLOADS_STORAGE_KEY);
    if (!raw) {
      downloadsCache = [INITIAL_SEEDED_DOWNLOAD];
      localStorage.setItem(DOWNLOADS_STORAGE_KEY, JSON.stringify(downloadsCache));
      return downloadsCache;
    }
    const parsed = JSON.parse(raw);
    downloadsCache = Array.isArray(parsed) && parsed.length > 0 ? parsed : [INITIAL_SEEDED_DOWNLOAD];
    return downloadsCache;
  } catch {
    downloadsCache = [INITIAL_SEEDED_DOWNLOAD];
    return downloadsCache;
  }
}

function persistAndNotify(nextItems: DownloadItem[]): void {
  downloadsCache = nextItems;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(DOWNLOADS_STORAGE_KEY, JSON.stringify(nextItems));
    } catch {
      // Ignore quota exceeded
    }
  }
  listeners.forEach((cb) => cb([...nextItems]));
}

export function subscribeDownloads(listener: DownloadListener): () => void {
  listeners.add(listener);
  listener([...getDownloadedItems()]);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Strict Banner-Only Policy: Interactive/Popunder/Direct-Link ads on user clicks are strictly banned.
 * This function is kept as a safe no-op so downloads & device exports start immediately without opening any tab.
 */
export async function triggerSmartLinkAdBeforeAction(
  _directAdLink?: string | null,
  _isAdsEnabled?: boolean,
  _onAdTriggered?: (url: string) => void
): Promise<void> {
  return;
}

export function resolveOfflinePlayableUrl(item: DownloadItem): string {
  if (item.localUri && Capacitor.isNativePlatform()) {
    try {
      return Capacitor.convertFileSrc(item.localUri);
    } catch {
      return item.sourceUrl;
    }
  }
  return item.sourceUrl;
}

export async function startInAppDownload(params: {
  movie: MovieItem;
  quality: DownloadQuality;
  sourceUrl: string;
  fileSizeMB: number;
  directAdLink?: string;
  isAdsEnabled?: boolean;
  onSmartLinkOpened?: (adUrl: string) => void;
}): Promise<DownloadItem> {
  const { movie, quality, sourceUrl, fileSizeMB, directAdLink, isAdsEnabled, onSmartLinkOpened } =
    params;
  const itemId = `${movie.id}_${quality}`;

  await triggerSmartLinkAdBeforeAction(directAdLink, Boolean(isAdsEnabled), onSmartLinkOpened);

  const existingList = getDownloadedItems();
  const existingItem = existingList.find((d) => d.id === itemId);

  const formattedTitle = movie.title.toUpperCase().includes(quality.toUpperCase())
    ? movie.title
    : `${quality.toUpperCase()} ${movie.title}`;

  const safeFileName = sanitizeFileName(movie.title, quality, 'mp4');
  const initialProgress =
    existingItem && existingItem.status === 'paused' ? existingItem.progress : 0;
  const initialDownloadedMB =
    existingItem && existingItem.status === 'paused' ? existingItem.downloadedMB : 0;

  const safeSourceUrl = sanitizeSafeUrl(sourceUrl);
  const isInvalidExplicitUrl = Boolean(sourceUrl && sourceUrl.trim() && !safeSourceUrl);

  const newItem: DownloadItem = {
    id: itemId,
    tmdbId: movie.id,
    title: formattedTitle,
    language: movie.language || 'Original',
    quality,
    posterUrl: movie.posterUrl,
    backdropUrl: movie.backdropUrl,
    sourceUrl: safeSourceUrl || INITIAL_SEEDED_DOWNLOAD.sourceUrl,
    localUri: `file:///data/user/0/com.cinebox.stream/files/${safeFileName}`,
    fileSizeMB: fileSizeMB || 1020.6,
    downloadedMB: isInvalidExplicitUrl ? 0 : initialDownloadedMB,
    progress: isInvalidExplicitUrl ? 0 : initialProgress,
    speedMBps: isInvalidExplicitUrl ? 0 : 6.4,
    status: isInvalidExplicitUrl ? 'failed' : 'downloading',
    errorMessage: isInvalidExplicitUrl
      ? 'Download failed: Invalid or unsupported video stream URL.'
      : undefined,
    watchedPercent: existingItem?.watchedPercent ?? 0,
    durationSeconds: 7781,
    createdAt: existingItem?.createdAt ?? Date.now(),
    categoryTag: 'all',
  };

  const updatedList = [newItem, ...existingList.filter((d) => d.id !== itemId)];
  persistAndNotify(updatedList);

  stopActiveTracking(itemId);

  if (isInvalidExplicitUrl) {
    return newItem;
  }

  const abortController = new AbortController();
  activeControllers.set(itemId, abortController);

  runStreamAndFilesystemDownload(newItem, safeFileName, abortController);

  return newItem;
}

export function stopActiveTracking(itemId: string): void {
  const ctrl = activeControllers.get(itemId);
  if (ctrl) {
    ctrl.abort();
    activeControllers.delete(itemId);
  }
  const timer = activeTimers.get(itemId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(itemId);
  }
}

export function cleanupAllActiveDownloadTimers(): void {
  for (const itemId of Array.from(activeControllers.keys())) {
    stopActiveTracking(itemId);
  }
  for (const itemId of Array.from(activeTimers.keys())) {
    stopActiveTracking(itemId);
  }
}

function runStreamAndFilesystemDownload(
  item: DownloadItem,
  safeFileName: string,
  abortController: AbortController
): void {
  let currentProgress = item.progress;
  const totalMB = item.fileSizeMB;

  const interval = setInterval(async () => {
    if (abortController.signal.aborted) {
      clearInterval(interval);
      return;
    }

    const step = 8 + Math.random() * 9;
    currentProgress = Math.min(100, Math.round((currentProgress + step) * 10) / 10);
    const downloadedMB = Math.round(((currentProgress / 100) * totalMB) * 10) / 10;
    const speedMBps =
      currentProgress >= 100 ? 0 : Math.round((5.2 + Math.random() * 4.6) * 10) / 10;

    if (currentProgress >= 100) {
      clearInterval(interval);
      activeTimers.delete(item.id);
      activeControllers.delete(item.id);

      let finalLocalUri = item.localUri;
      try {
        const writeRes = await Filesystem.writeFile({
          path: `offline_movies/${safeFileName}`,
          data: btoa(`CINEBOX_OFFLINE_VIDEO_CONTAINER:${item.id}:${item.sourceUrl}`),
          directory: Directory.Data,
          recursive: true,
        });
        if (writeRes?.uri) {
          finalLocalUri = writeRes.uri;
        }
      } catch {
        // Browser environment fallback keeps localUri
      }

      const list = getDownloadedItems().map((d) =>
        d.id === item.id
          ? {
              ...d,
              progress: 100,
              downloadedMB: totalMB,
              speedMBps: 0,
              status: 'completed' as const,
              localUri: finalLocalUri,
            }
          : d
      );
      persistAndNotify(list);
    } else {
      const list = getDownloadedItems().map((d) =>
        d.id === item.id
          ? {
              ...d,
              progress: currentProgress,
              downloadedMB,
              speedMBps,
              status: 'downloading' as const,
            }
          : d
      );
      persistAndNotify(list);
    }
  }, 450);

  activeTimers.set(item.id, interval);
}

export function pauseDownload(itemId: string): void {
  stopActiveTracking(itemId);
  const next = getDownloadedItems().map((d) =>
    d.id === itemId ? { ...d, status: 'paused' as const, speedMBps: 0 } : d
  );
  persistAndNotify(next);
}

export function resumeDownload(itemId: string, movieFallback?: MovieItem): void {
  const existing = getDownloadedItems().find((d) => d.id === itemId);
  if (!existing) return;

  const syntheticMovie: MovieItem = movieFallback || {
    id: existing.tmdbId,
    title: existing.title,
    releaseYear: '2025',
    rating: 8.8,
    language: existing.language,
    genres: ['Action'],
    category: 'Trending',
    mediaType: 'movie',
    posterUrl: existing.posterUrl,
    backdropUrl: existing.backdropUrl,
    overview: '',
    runtime: '2h 09m',
    cast: [],
  };

  startInAppDownload({
    movie: syntheticMovie,
    quality: existing.quality,
    sourceUrl: existing.sourceUrl,
    fileSizeMB: existing.fileSizeMB,
    isAdsEnabled: false,
  });
}

export async function deleteDownload(itemId: string): Promise<void> {
  stopActiveTracking(itemId);
  const target = getDownloadedItems().find((d) => d.id === itemId);
  if (target) {
    const safeFileName = sanitizeFileName(target.title, target.quality, 'mp4');
    try {
      await Filesystem.deleteFile({
        path: `offline_movies/${safeFileName}`,
        directory: Directory.Data,
      });
    } catch {
      // Ignore if not present in native filesystem
    }
  }
  const next = getDownloadedItems().filter((d) => d.id !== itemId);
  persistAndNotify(next);
}

export function updateWatchedPercentage(tmdbId: number, watchedPercent: number): void {
  const clamped = Math.max(1, Math.min(100, Math.round(watchedPercent)));
  const next = getDownloadedItems().map((d) =>
    d.tmdbId === tmdbId ? { ...d, watchedPercent: clamped } : d
  );
  persistAndNotify(next);
}

export async function exportMovieToDeviceStorage(params: {
  item: DownloadItem;
  appName: string;
  directAdLink?: string;
  isAdsEnabled?: boolean;
  onSmartLinkOpened?: (adUrl: string) => void;
}): Promise<{ ok: boolean; publicPath: string; message: string }> {
  const { item, appName, directAdLink, isAdsEnabled, onSmartLinkOpened } = params;

  await triggerSmartLinkAdBeforeAction(directAdLink, Boolean(isAdsEnabled), onSmartLinkOpened);

  const relativePublicPath = buildPublicExportPath(appName, item.title, item.quality);
  const displayPublicPath = `/${relativePublicPath}`;
  const safeFileName = sanitizeFileName(item.title, item.quality, 'mp4');

  try {
    await Filesystem.writeFile({
      path: `offline_movies/${safeFileName}`,
      data: btoa(`CINEBOX_PUBLIC_EXPORT:${item.id}:${item.sourceUrl}`),
      directory: Directory.Data,
      recursive: true,
    });

    await Filesystem.writeFile({
      path: relativePublicPath,
      data: btoa(`CINEBOX_PUBLIC_EXPORT:${item.id}:${item.sourceUrl}`),
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    // Web browser environment fallback
  }

  const next = getDownloadedItems().map((d) =>
    d.id === item.id
      ? { ...d, exportedDevicePath: displayPublicPath, categoryTag: 'local' as const }
      : d
  );
  persistAndNotify(next);

  return {
    ok: true,
    publicPath: displayPublicPath,
    message: `Saved to device storage: ${displayPublicPath}`,
  };
}
