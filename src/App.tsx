import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  ChevronRight,
  Clock,
  Download,
  Flame,
  FolderDown,
  Home,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  AppConfigRecord,
  AppUserRecord,
  CategoryFilter,
  DownloadItem,
  DownloadQuality,
  MovieItem,
  MovieLinkRecord,
  ThemeColorId,
  UserAppSettings,
  WatchHistoryItem,
} from './types/movie';
import {
  DEFAULT_APP_CONFIG,
  fetchAllAppUsers,
  fetchAllMovieLinks,
  fetchAppConfig,
  fetchMovieLinkByTmdbId,
  getCurrentDeviceUserId,
  getLoggedInUser,
  getUserAppSettings,
  saveUserAppSettings,
  syncFromRemoteDecentralizedNode,
  updateAppConfig,
  upsertMovieLink,
} from './services/supabaseClient';
import { evaluateGlobalUserAccess } from './utils/securityValidator';
import {
  fetchBollywoodMovies,
  fetchMediaDetails,
  fetchMoviesByCategory,
  fetchSouthIndianMovies,
  fetchTrendingTvSeries,
  searchMovies,
} from './services/tmdbService';
import {
  fetchMovieBoxStreamViaProxy,
  searchMovieBoxViaProxy,
} from './services/movieBoxDirectApi';
import {
  cleanupAllActiveDownloadTimers,
  deleteDownload,
  exportMovieToDeviceStorage,
  getDownloadedItems,
  pauseDownload,
  resumeDownload,
  startInAppDownload,
  subscribeDownloads,
  updateWatchedPercentage,
} from './services/downloadManager';
import {
  addRecentSearchQuery,
  FALLBACK_TEST_MP4_720P,
  RECENT_SEARCHES_STORAGE_KEY,
  removeRecentSearchQuery,
  sanitizeSearchQuery,
} from './utils/streamResolver';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { DownloadsView } from './components/DownloadsView';
import { ProfileMeView } from './components/ProfileMeView';
import { AdminAndDeliverablesModal } from './components/AdminAndDeliverablesModal';
import { NonIntrusiveBannerAd } from './components/NonIntrusiveBannerAd';
import { PakistaniDramasSection } from './components/PakistaniDramasSection';
import { VidSrcLatestFeedsSection } from './components/VidSrcLatestFeedsSection';

type BottomNavTab = 'home' | 'search' | 'downloads' | 'watchlist' | 'me';

const TOP_CATEGORIES: CategoryFilter[] = [
  'Trending',
  'Pakistani Dramas',
  'Hollywood',
  'Bollywood',
  'South Hindi Dubbed',
  'Action',
  'Series',
  'Anime',
];

const MOVIE_SUB_FILTERS: { label: string; category: CategoryFilter }[] = [
  { label: 'Cinema', category: 'Trending' },
  { label: 'TOP Movies', category: 'Hollywood' },
  { label: 'Bollywood', category: 'Bollywood' },
  { label: 'Hollywood', category: 'Hollywood' },
  { label: 'South Hindi Dubbed', category: 'South Hindi Dubbed' },
  { label: 'Action', category: 'Action' },
];

const SERIES_SUB_FILTERS: { label: string }[] = [
  { label: 'Top Series' },
  { label: 'Pakistani Drama' },
  { label: 'Indian Drama' },
  { label: 'Asian Drama' },
  { label: 'Anime' },
];

const WATCHLIST_STORAGE_KEY = 'cinebox_watchlist_v2';
const HISTORY_STORAGE_KEY = 'cinebox_watch_history_v2';

export default function App() {
  // Navigation & Active Screen State
  const [activeTab, setActiveTab] = useState<BottomNavTab>('home');
  const [selectedTopCategory, setSelectedTopCategory] = useState<CategoryFilter>('Trending');
  const [movieSubFilter, setMovieSubFilter] = useState<string>('Cinema');
  const [seriesSubFilter, setSeriesSubFilter] = useState<string>('Top Series');

  // Search State (Client-Side Proxy + Direct MovieBox API + Recent Searches in localStorage)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<MovieItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchProxyUsed, setSearchProxyUsed] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((q) => sanitizeSearchQuery(q)).filter(Boolean);
        }
      }
    } catch {
      // ignore
    }
    return ['Dar e Nijaat', 'Avatar', 'Deadpool', 'Jawan', 'Squid Game'];
  });

  // 100% Live TMDb Data Sections State
  const [heroAndCategoryMovies, setHeroAndCategoryMovies] = useState<MovieItem[]>([]);
  const [trendingMoviesSection, setTrendingMoviesSection] = useState<MovieItem[]>([]);
  const [trendingSeriesSection, setTrendingSeriesSection] = useState<MovieItem[]>([]);
  const [bollywoodAndSouthSection, setBollywoodAndSouthSection] = useState<MovieItem[]>([]);
  const [activeHeroIndex, setActiveHeroIndex] = useState<number>(0);

  // Supabase App Config & Movie Links State
  const [appConfig, setAppConfig] = useState<AppConfigRecord>(DEFAULT_APP_CONFIG);
  const [movieLinksMap, setMovieLinksMap] = useState<Record<number, MovieLinkRecord>>({});

  // Active Video Player Modal & MovieBox Stream Fetch State
  const [playingMovie, setPlayingMovie] = useState<MovieItem | null>(null);
  const [playingOfflineItem, setPlayingOfflineItem] = useState<DownloadItem | null>(null);
  const [activeMovieLink, setActiveMovieLink] = useState<MovieLinkRecord | null>(null);
  const [isFetchingStream, setIsFetchingStream] = useState<boolean>(false);
  const [streamFetchError, setStreamFetchError] = useState<string | null>(null);
  const [movieBoxDirectStreamUrl, setMovieBoxDirectStreamUrl] = useState<string | null>(null);

  // Downloads, Watchlist & Watch History State
  const [downloads, setDownloads] = useState<DownloadItem[]>(() => getDownloadedItems());
  const [isOfflineSimulated, setIsOfflineSimulated] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [watchlist, setWatchlist] = useState<MovieItem[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return [];
  });

  // Global Users, Real Logged-In User, App Settings & Admin Session State
  const [appUsers, setAppUsers] = useState<AppUserRecord[]>([]);
  const [loggedInUser, setLoggedInUser] = useState<AppUserRecord | null>(() => getLoggedInUser());
  const [userSettings, setUserSettings] = useState<UserAppSettings>(() => getUserAppSettings());
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('cinebox_admin_unlocked') === '1';
    } catch {
      return false;
    }
  });
  const [logoTapCount, setLogoTapCount] = useState<number>(0);
  const [adminModalState, setAdminModalState] = useState<{
    open: boolean;
    tab: 'admin' | 'deliverables';
  }>({ open: false, tab: 'admin' });

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
      toastTimerRef.current = null;
    }, 4200);
  };

  // Subscribe to Download Manager updates and clean up timers on unmount
  useEffect(() => {
    const unsubscribe = subscribeDownloads(setDownloads);
    return () => {
      unsubscribe();
      cleanupAllActiveDownloadTimers();
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  // Load Supabase `app_config`, `movie_links`, `app_users`, and Decentralized Manifest Node on startup
  const refreshSupabaseData = async () => {
    const [cfg, links, users] = await Promise.all([
      fetchAppConfig(),
      fetchAllMovieLinks(),
      fetchAllAppUsers(),
    ]);
    setAppConfig(cfg);
    setAppUsers(users);
    const map: Record<number, MovieLinkRecord> = {};
    for (const row of links) {
      map[row.tmdb_id] = row;
    }
    setMovieLinksMap(map);

    // If a Global Decentralized Manifest URL is configured, automatically sync from it in the background
    if (cfg.decentralized_manifest_url) {
      syncFromRemoteDecentralizedNode(cfg.decentralized_manifest_url)
        .then(async (syncRes) => {
          if (syncRes.ok) {
            const [freshLinks, freshUsers] = await Promise.all([
              fetchAllMovieLinks(),
              fetchAllAppUsers(),
            ]);
            const nextMap: Record<number, MovieLinkRecord> = {};
            for (const r of freshLinks) nextMap[r.tmdb_id] = r;
            setMovieLinksMap(nextMap);
            setAppUsers(freshUsers);
          }
        })
        .catch(() => {});
    }
  };

  useEffect(() => {
    refreshSupabaseData();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('admin') === '1' || window.location.hash === '#admin') {
        setAdminModalState({ open: true, tab: 'admin' });
      }
    }
  }, []);

  // Initial load of live TMDb sections (Bollywood/Hindi, South Indian, Search catalog)
  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchBollywoodMovies(),
      fetchSouthIndianMovies(),
    ])
      .then(([bollywood, south]) => {
        if (!mounted) return;
        const combined = [...bollywood.slice(0, 6), ...south.slice(0, 6)];
        setBollywoodAndSouthSection(combined);
        setSearchResults(combined);
        // Seed Watchlist & Watch History with real TMDb items if empty
        setWatchlist((prev) => {
          if (prev.length > 0) return prev;
          const initial = combined.slice(0, 2);
          try {
            localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(initial));
          } catch {
            // ignore
          }
          return initial;
        });
        setWatchHistory((prev) => {
          if (prev.length > 0) return prev;
          const initialHist: WatchHistoryItem[] = combined.slice(0, 2).map((m, idx) => ({
            tmdbId: m.id,
            title: m.title,
            language: m.language,
            mediaType: m.mediaType,
            backdropUrl: m.backdropUrl,
            posterUrl: m.posterUrl,
            watchedPercent: idx === 0 ? 35 : 60,
            currentTimeSeconds: 1228,
            durationSeconds: 7781,
            updatedAt: Date.now() - idx * 3600_000,
          }));
          try {
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(initialHist));
          } catch {
            // ignore
          }
          return initialHist;
        });
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  // Fetch Hero Banner & Top Category dynamically from live TMDb API
  useEffect(() => {
    let mounted = true;
    fetchMoviesByCategory(selectedTopCategory)
      .then((list) => {
        if (!mounted) return;
        setHeroAndCategoryMovies(list);
        setActiveHeroIndex(0);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [selectedTopCategory]);

  // Fetch "Trending Movies" section dynamically when sub-filter changes
  useEffect(() => {
    let mounted = true;
    const filterObj = MOVIE_SUB_FILTERS.find((f) => f.label === movieSubFilter);
    const targetCategory = filterObj ? filterObj.category : 'Trending';
    fetchMoviesByCategory(targetCategory)
      .then((list) => {
        if (mounted) {
          setTrendingMoviesSection(list);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [movieSubFilter]);

  // Fetch "Trending TV Series" section dynamically from `trending/tv/week` or sub-filter
  useEffect(() => {
    let mounted = true;
    fetchTrendingTvSeries(seriesSubFilter)
      .then((list) => {
        if (mounted) {
          setTrendingSeriesSection(list);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [seriesSubFilter]);

  // Theme Color Dynamic CSS Variable Sync
  const themeAccentHex = useMemo(() => {
    if (appConfig.primary_theme === 'netflix-red') return '#e50914';
    if (appConfig.primary_theme === 'royal-blue') return '#3b82f6';
    return '#10d97b';
  }, [appConfig.primary_theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--brand-accent', themeAccentHex);
  }, [themeAccentHex]);

  const saveQueryToRecentSearches = (rawQuery: string) => {
    const clean = sanitizeSearchQuery(rawQuery);
    if (!clean) return;
    setRecentSearches((prev) => {
      const next = addRecentSearchQuery(prev, clean, 10);
      try {
        localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleRemoveRecentSearch = (queryToRemove: string) => {
    setRecentSearches((prev) => {
      const next = removeRecentSearchQuery(prev, queryToRemove);
      try {
        localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleClearRecentSearches = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  // Requirement 1: Search Function (Client-Side Fetch with Proxy: corsproxy.io -> allorigins.win)
  // Calls https://h5.aoneroom.com/wefeed-h5api-bff/subject/search?keyword={userQuery}
  // with User-Agent & Referer headers. Shows Loading Spinner & "Server Busy, Try Again" on proxy failure.
  const handleSearchSubmit = async (e?: React.FormEvent, overrideQuery?: string) => {
    e?.preventDefault();
    const rawTarget = overrideQuery !== undefined ? overrideQuery : searchQuery;
    if (overrideQuery !== undefined) {
      setSearchQuery(overrideQuery);
    }
    setActiveTab('search');
    setIsSearching(true);
    setSearchError(null);
    setSearchProxyUsed(null);

    try {
      const q = sanitizeSearchQuery(rawTarget);
      if (!q) {
        const results = await searchMovies('');
        setSearchResults(results);
        return;
      }

      // Persist search query in localStorage for Recent Searches chips
      saveQueryToRecentSearches(q);

      // 1. Render TMDb matches immediately (~250ms) so mobile & desktop users never wait on slow CORS proxies
      const tmdbMatches = await searchMovies(q);
      if (tmdbMatches.length > 0) {
        setSearchResults(tmdbMatches);
        setIsSearching(false);
      }

      // 2. Fetch MovieBox proxy results in parallel/background and merge if available
      const mbResult = await searchMovieBoxViaProxy(q);
      if (mbResult.ok && mbResult.items.length > 0) {
        const seenIds = new Set<number>();
        const merged: MovieItem[] = [];
        for (const item of [...tmdbMatches, ...mbResult.items]) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            merged.push(item);
          }
        }
        setSearchResults(merged);
        setSearchProxyUsed(mbResult.proxyUsed || null);
      } else if (tmdbMatches.length === 0) {
        setSearchError(mbResult.error || 'Server Busy, Try Again');
      }
    } catch {
      setSearchError('Server Busy, Try Again');
    } finally {
      setIsSearching(false);
    }
  };

  // 5-Tap Logo Secret Admin Trigger (Works on both Capacitor APK and Website)
  const handleLogoTap = () => {
    const next = logoTapCount + 1;
    if (next >= 5) {
      setLogoTapCount(0);
      setAdminModalState({ open: true, tab: 'admin' });
    } else {
      setLogoTapCount(next);
      if (next >= 3) {
        showToast(`Tap ${5 - next} more time(s) to open Restricted Admin Login`);
      }
    }
  };

  // Requirement 2: Stream Link Fetch (Client-Side Fetch with Proxy)
  // Calls https://h5.aoneroom.com/wefeed-h5api-bff/media/play?subjectId={subjectId}&se=0&ep=0
  // via corsproxy.io / allorigins.win with User-Agent & Referer headers.
  const fetchMovieStreamForItem = async (movie: MovieItem) => {
    setIsFetchingStream(true);
    setStreamFetchError(null);
    setMovieBoxDirectStreamUrl(null);
    try {
      const subjectId = movie.originalTitle || String(movie.id);
      const streamRes = await fetchMovieBoxStreamViaProxy(subjectId, 0, 0);
      if (streamRes.ok && streamRes.streamUrl) {
        setMovieBoxDirectStreamUrl(streamRes.streamUrl);
      } else {
        setStreamFetchError(streamRes.error || 'Server Busy, Try Again');
      }
    } catch {
      setStreamFetchError('Server Busy, Try Again');
    } finally {
      setIsFetchingStream(false);
    }
  };

  const handleOpenMovie = async (movie: MovieItem) => {
    const existingOffline = downloads.find(
      (d) => d.tmdbId === movie.id && d.status === 'completed'
    );
    const link = movieLinksMap[movie.id] || (await fetchMovieLinkByTmdbId(movie.id));
    setActiveMovieLink(link);
    setPlayingOfflineItem(existingOffline || null);
    setPlayingMovie(movie);

    // Only auto-fetch MovieBox proxy stream when the item originates from MovieBox (numeric subjectId)
    if (movie.originalTitle && /^\d{5,}$/.test(movie.originalTitle.trim())) {
      fetchMovieStreamForItem(movie);
    } else {
      setIsFetchingStream(false);
      setStreamFetchError(null);
      setMovieBoxDirectStreamUrl(null);
    }

    // Enrich with full TMDb details (cast, runtime, TV seasons/episodes, watch/providers)
    fetchMediaDetails(movie).then((enriched) => {
      setPlayingMovie((current) => (current && current.id === enriched.id ? enriched : current));
    });
  };

  // Play a downloaded movie directly from the Downloads tab (Offline Mode)
  const handlePlayOfflineItem = async (item: DownloadItem) => {
    const allKnown = [
      ...heroAndCategoryMovies,
      ...trendingMoviesSection,
      ...trendingSeriesSection,
      ...bollywoodAndSouthSection,
    ];
    const matchedMovie: MovieItem = allKnown.find((m) => m.id === item.tmdbId) || {
      id: item.tmdbId,
      title: item.title,
      releaseYear: '2025',
      rating: 8.8,
      language: item.language,
      genres: ['Action', 'Sci-Fi'],
      category: 'Trending',
      mediaType: 'movie',
      posterUrl: item.posterUrl,
      backdropUrl: item.backdropUrl,
      overview:
        'Playing directly from local internal storage (Directory.Data) via Built-In HTML5 Offline Video Player.',
      runtime: '2h 08m',
      cast: [],
    };

    const link = movieLinksMap[item.tmdbId] || null;
    setActiveMovieLink(link);
    setPlayingOfflineItem(item);
    setPlayingMovie(matchedMovie);
  };

  // Start In-App Download (Checks Global Admin Download Policy first)
  const handleStartDownload = async (
    movie: MovieItem,
    quality: DownloadQuality,
    url: string,
    sizeMB: number
  ) => {
    const deviceUserId = getCurrentDeviceUserId();
    const currentDeviceUser = appUsers.find((u) => u.id === deviceUserId) || null;
    if (
      appConfig.allow_guest_downloads === false &&
      !isAdminUnlocked &&
      currentDeviceUser?.role !== 'vip' &&
      currentDeviceUser?.role !== 'admin'
    ) {
      showToast('Downloads are currently restricted to VIP Pro members by the Administrator.');
      return;
    }

    showToast(`Starting ${quality} background download for ${movie.title}...`);

    await startInAppDownload({
      movie,
      quality,
      sourceUrl: url || FALLBACK_TEST_MP4_720P,
      fileSizeMB: sizeMB,
    });

    showToast(`Downloading ${movie.title} (${quality}) — view live progress in Downloads tab!`);
  };

  // Export / Save to Device Public Storage (`/Download/[AppName]/MovieTitle.mp4`)
  const handleExportToDevice = async (
    movie: MovieItem,
    quality: DownloadQuality,
    url: string,
    sizeMB: number
  ) => {
    const existingItem = downloads.find((d) => d.id === `${movie.id}_${quality}`);
    const targetItem: DownloadItem = existingItem || {
      id: `${movie.id}_${quality}`,
      tmdbId: movie.id,
      title: `${quality.toUpperCase()} ${movie.title}`,
      language: movie.language,
      quality,
      posterUrl: movie.posterUrl,
      backdropUrl: movie.backdropUrl,
      sourceUrl: url || FALLBACK_TEST_MP4_720P,
      localUri: `file:///data/user/0/com.cinebox.stream/files/${movie.id}_${quality}.mp4`,
      fileSizeMB: sizeMB,
      downloadedMB: sizeMB,
      progress: 100,
      speedMBps: 0,
      status: 'completed',
      watchedPercent: 15,
      durationSeconds: 7781,
      createdAt: Date.now(),
      categoryTag: 'local',
    };

    const res = await exportMovieToDeviceStorage({
      item: targetItem,
      appName: appConfig.app_name,
      directAdLink: appConfig.direct_ad_link,
      isAdsEnabled: appConfig.is_ads_enabled,
    });

    showToast(res.message);
  };

  const handleExportExistingItemToDevice = async (item: DownloadItem) => {
    const res = await exportMovieToDeviceStorage({
      item,
      appName: appConfig.app_name,
      directAdLink: appConfig.direct_ad_link,
      isAdsEnabled: appConfig.is_ads_enabled,
    });
    showToast(res.message);
  };

  const handleToggleWatchlist = (movie: MovieItem) => {
    setWatchlist((prev) => {
      const exists = prev.some((m) => m.id === movie.id);
      const next = exists ? prev.filter((m) => m.id !== movie.id) : [movie, ...prev];
      try {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      showToast(
        exists ? `Removed ${movie.title} from Watchlist` : `Added ${movie.title} to Watchlist`
      );
      return next;
    });
  };

  const handleProgressUpdate = (movie: MovieItem, currentSec: number, durationSec: number) => {
    const pct = Math.max(
      5,
      Math.min(100, Math.round((currentSec / Math.max(1, durationSec)) * 100))
    );
    updateWatchedPercentage(movie.id, pct);
    setWatchHistory((prev) => {
      const entry: WatchHistoryItem = {
        tmdbId: movie.id,
        title: movie.title,
        language: movie.language,
        mediaType: movie.mediaType,
        backdropUrl: movie.backdropUrl,
        posterUrl: movie.posterUrl,
        watchedPercent: pct,
        currentTimeSeconds: currentSec,
        durationSeconds: durationSec,
        updatedAt: Date.now(),
      };
      const next = [entry, ...prev.filter((h) => h.tmdbId !== movie.id)].slice(0, 12);
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const heroMovies = useMemo(
    () => heroAndCategoryMovies.slice(0, 5),
    [heroAndCategoryMovies]
  );
  const activeHero = heroMovies[activeHeroIndex] || heroAndCategoryMovies[0] || null;

  const allAdminCatalogMovies = useMemo(() => {
    const map = new Map<number, MovieItem>();
    for (const m of [
      ...heroAndCategoryMovies,
      ...trendingMoviesSection,
      ...trendingSeriesSection,
      ...bollywoodAndSouthSection,
    ]) {
      map.set(m.id, m);
    }
    return Array.from(map.values());
  }, [
    heroAndCategoryMovies,
    trendingMoviesSection,
    trendingSeriesSection,
    bollywoodAndSouthSection,
  ]);

  const activeDownloadsCount = downloads.filter((d) => d.status === 'downloading').length;

  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-100 flex flex-col">
      {/* =====================================================================
          STICKY TOP HEADER
         ===================================================================== */}
      <header className="sticky top-0 z-30 bg-[#0b0d12]/95 backdrop-blur-md border-b border-slate-800/70 px-3 sm:px-6 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Brand Logo Button (Tap 5 times to unlock Secret Admin Panel) */}
          <button
            type="button"
            onClick={handleLogoTap}
            aria-label={`${appConfig.app_name} Logo — Tap 5 times for Secret Admin Panel`}
            className="flex items-center gap-2 shrink-0 group focus:outline-none min-h-[40px]"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#06b6d4] via-[#10d97b] to-[#22c55e] flex items-center justify-center shadow-md shadow-[#10d97b]/20 group-active:scale-95 transition-transform">
              <Play className="w-5 h-5 text-slate-950 fill-slate-950 ml-0.5" />
            </div>
            <span className="hidden sm:inline font-display font-extrabold text-lg tracking-tight text-white">
              {appConfig.app_name}
            </span>
          </button>

          {/* Rounded Search Bar */}
          <form onSubmit={handleSearchSubmit} className="flex-1 max-w-2xl">
            <div className="flex items-center bg-[#1c2029] border border-slate-700/70 rounded-xl px-3 py-1.5 focus-within:border-[#10d97b]/70 transition-colors">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="search"
                data-testid="search-input"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                }}
                placeholder="Search movies, series, Hindi dubbed, Pak dramas..."
                aria-label="Search movies and TV series"
                className="w-full bg-transparent px-2 text-xs sm:text-sm text-slate-100 placeholder-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                data-testid="search-submit-btn"
                className="pl-2.5 border-l border-slate-700 text-xs sm:text-sm font-bold text-[#10d97b] hover:opacity-90 shrink-0"
              >
                Search
              </button>
            </div>
          </form>

          {/* Right Action: ONLY shown when Admin Session is Unlocked (Hidden from regular users!) */}
          {isAdminUnlocked && (
            <button
              type="button"
              data-testid="header-admin-console-btn"
              onClick={() => setAdminModalState({ open: true, tab: 'admin' })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-950/90 hover:bg-emerald-900 border border-[#10d97b]/60 text-xs font-extrabold text-[#10d97b] shrink-0 whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Admin Console</span>
            </button>
          )}
        </div>

        {/* Top Horizontal Category Tabs */}
        {activeTab === 'home' && (
          <nav
            aria-label="Movie Categories"
            className="max-w-7xl mx-auto flex items-center gap-5 overflow-x-auto no-scrollbar pt-2 pb-0.5 text-xs sm:text-sm"
          >
            {TOP_CATEGORIES.map((cat) => {
              const isSelected = selectedTopCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  data-testid={`top-category-tab-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                  onClick={() => setSelectedTopCategory(cat)}
                  className={`whitespace-nowrap shrink-0 transition-colors pb-1 ${
                    isSelected
                      ? 'text-white font-extrabold text-sm sm:text-base border-b-2 border-[#10d97b]'
                      : 'text-slate-400 hover:text-slate-200 font-medium'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {/* =====================================================================
          TOAST NOTIFICATION BANNER
         ===================================================================== */}
      {toastMessage && (
        <div
          role="status"
          className="fixed top-20 right-4 z-50 max-w-sm px-4 py-3 rounded-2xl bg-[#112e22] border border-[#10d97b]/60 text-xs font-semibold text-emerald-100 shadow-2xl flex items-center gap-2.5"
        >
          <Sparkles className="w-4 h-4 text-[#10d97b] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* =====================================================================
          MAIN VIEWPORT ROUTER
         ===================================================================== */}
      <main className="flex-1">
        {activeTab === 'home' && (
          <div className="pb-24 max-w-7xl mx-auto space-y-6">
            {/* Dedicated Pakistani Dramas Tab View when 'Pakistani Dramas' Top Category is selected */}
            {selectedTopCategory === 'Pakistani Dramas' ? (
              <div className="px-3 sm:px-6 pt-4 space-y-6">
                <PakistaniDramasSection isFullTab={true} />
                <NonIntrusiveBannerAd config={appConfig} placement="home-top" />
              </div>
            ) : (
              <>
                {/* 1. LIVE TMDB HERO BANNER SLIDER + FLOATING MINI-CARDS */}
                {activeHero && (
                  <section className="relative w-full overflow-hidden">
                    <div className="relative aspect-[16/10] sm:aspect-[21/9] w-full max-h-[440px] bg-slate-950 overflow-hidden">
                      <img
                        src={activeHero.backdropUrl}
                        alt={activeHero.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d12] via-[#0b0d12]/40 to-transparent" />

                      {/* Hero Title & Metadata Overlay */}
                      <div className="absolute bottom-20 left-4 sm:left-6 right-4 max-w-2xl pointer-events-none">
                        <h2 className="font-display font-black text-2xl sm:text-4xl text-white drop-shadow-lg truncate">
                          {activeHero.title}
                        </h2>
                        <p className="mt-1 text-xs sm:text-sm text-slate-200 font-medium drop-shadow">
                          ★ {activeHero.rating.toFixed(1)} · {activeHero.releaseYear} ·{' '}
                          {activeHero.language} · {activeHero.genres.join(' / ')}
                        </p>
                      </div>
                    </div>

                    {/* Floating Hero Carousel Cards Strip at Bottom of Hero */}
                    <div className="px-3 sm:px-6 -mt-14 sm:-mt-16 relative z-10">
                      <div className="flex items-stretch gap-3 overflow-x-auto no-scrollbar pb-1">
                        {heroMovies.map((item, idx) => {
                          const isCurrent = idx === activeHeroIndex;
                          return (
                            <div
                              key={item.id}
                              onClick={() => setActiveHeroIndex(idx)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') setActiveHeroIndex(idx);
                              }}
                              className={`flex items-center justify-between gap-3 p-2.5 rounded-2xl border backdrop-blur-md transition-all cursor-pointer shrink-0 w-[285px] sm:w-[330px] ${
                                isCurrent
                                  ? 'bg-[#1b202b]/95 border-[#10d97b]/50 shadow-lg'
                                  : 'bg-[#141821]/85 border-slate-800/80 opacity-80 hover:opacity-100'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <img
                                  src={item.posterUrl}
                                  alt={item.title}
                                  referrerPolicy="no-referrer"
                                  className="w-11 h-14 rounded-lg object-cover shrink-0 bg-slate-900"
                                />
                                <div className="min-w-0">
                                  <div className="text-xs sm:text-sm font-bold text-white truncate">
                                    {item.title}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-slate-400 flex items-center gap-1.5">
                                    <span className="font-mono uppercase">{item.mediaType}</span>
                                    <span aria-hidden="true">|</span>
                                    <span>{item.releaseYear}</span>
                                    <span aria-hidden="true">|</span>
                                    <span className="truncate">{item.genres[0]}</span>
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenMovie(item);
                                }}
                                aria-label={`Play ${item.title}`}
                                className="w-10 h-10 rounded-full bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 flex items-center justify-center shrink-0 shadow-md transition-transform active:scale-95"
                              >
                                <Play className="w-5 h-5 fill-slate-950 ml-0.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                )}

                <div className="px-3 sm:px-6 space-y-7">
                  {/* Non-Intrusive Same-Tab Compact Banner Ad (Adsterra / Monetag / AdMob Ready) */}
                  <NonIntrusiveBannerAd config={appConfig} placement="home-top" />

                  {/* PART 1 (3): VIDSRC.SH LATEST MOVIES & LATEST TV SHOWS FEEDS */}
                  <VidSrcLatestFeedsSection
                    fallbackMovies={trendingMoviesSection}
                    fallbackSeries={trendingSeriesSection}
                    onSelectMovie={handleOpenMovie}
                  />

                  {/* PART 2: PAKISTANI DRAMAS SECTION (YOUTUBE DATA API V3) */}
                  <PakistaniDramasSection isFullTab={false} />

                  {/* 2. "Get Free Premium" Banner (Matches Reference Screenshot — No Public SQL/APK Exposure) */}
                  <section className="space-y-2.5">
                    <h2 className="text-base sm:text-lg font-bold text-white">Get Free Premium</h2>
                    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-[#242842] via-[#1c313a] to-[#123d31] border border-emerald-500/25 shadow-md">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-[#10d97b]/20 border border-[#10d97b]/40 flex items-center justify-center shrink-0">
                          <Sparkles className="w-6 h-6 text-[#10d97b]" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-slate-300">Invite New Friends,</div>
                          <div className="text-base sm:text-xl font-extrabold text-white truncate">
                            Get Free Premium
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('me');
                          showToast('Share CineBox link with friends to claim Free VIP Pro days!');
                        }}
                        className="px-5 py-2.5 rounded-full bg-gradient-to-r from-[#22e58a] to-[#10b981] text-slate-950 font-extrabold text-sm shadow-md shrink-0 min-h-[42px]"
                      >
                        Go
                      </button>
                    </div>
                  </section>

              {/* 3. TRENDING MOVIES SECTION (100% Live TMDb Data) */}
              <section className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base sm:text-lg font-bold text-white">Trending Movies</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('search')}
                    className="text-xs sm:text-sm text-slate-400 hover:text-white flex items-center gap-0.5"
                  >
                    <span>All</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Sub-category filter pills */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {MOVIE_SUB_FILTERS.map((f) => {
                    const active = movieSubFilter === f.label;
                    return (
                      <button
                        key={f.label}
                        type="button"
                        onClick={() => setMovieSubFilter(f.label)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors min-h-[34px] ${
                          active
                            ? 'bg-[#252a36] text-white font-bold border border-slate-600'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {trendingMoviesSection.slice(0, 12).map((movie, index) => (
                    <div
                      key={movie.id}
                      className="group flex flex-col text-left rounded-xl overflow-hidden bg-transparent"
                    >
                      <button
                        type="button"
                        data-testid={`movie-card-${movie.id}`}
                        onClick={() => handleOpenMovie(movie)}
                        className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-slate-900 focus:outline-none"
                      >
                        <img
                          src={movie.posterUrl}
                          alt={movie.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-slate-100">
                          {movie.language}
                        </span>
                        <span
                          aria-hidden="true"
                          className="absolute bottom-0 right-2 font-display font-black text-5xl sm:text-6xl leading-none text-white/35 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] select-none"
                        >
                          {index + 1}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenMovie(movie)}
                        className="mt-1.5 text-xs sm:text-sm font-medium text-slate-200 truncate text-left group-hover:text-[#10d97b]"
                      >
                        {movie.title}
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Adsterra Native Banner Slot (`container-83b5d9d90d154535d150a2bd3cf1f04e`) */}
              <NonIntrusiveBannerAd config={appConfig} placement="home-native" />

              {/* 4. TRENDING TV SERIES SECTION (100% Live TMDb `/trending/tv/week` Data) */}
              <section className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base sm:text-lg font-bold text-white">Trending TV Series</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTopCategory('Series');
                      setActiveTab('search');
                    }}
                    className="text-xs sm:text-sm text-slate-400 hover:text-white flex items-center gap-0.5"
                  >
                    <span>All</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {SERIES_SUB_FILTERS.map((f) => {
                    const active = seriesSubFilter === f.label;
                    return (
                      <button
                        key={f.label}
                        type="button"
                        onClick={() => setSeriesSubFilter(f.label)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors min-h-[34px] ${
                          active
                            ? 'bg-[#252a36] text-white font-bold border border-slate-600'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {trendingSeriesSection.slice(0, 12).map((series, idx) => (
                    <div key={series.id} className="group flex flex-col text-left">
                      <button
                        type="button"
                        data-testid={`tv-card-${series.id}`}
                        onClick={() => handleOpenMovie(series)}
                        className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-slate-900 focus:outline-none"
                      >
                        <img
                          src={series.posterUrl}
                          alt={series.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-slate-100">
                          {series.language}
                        </span>
                        <span
                          aria-hidden="true"
                          className="absolute bottom-0 right-2 font-display font-black text-5xl leading-none text-white/35 select-none"
                        >
                          {idx + 1}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenMovie(series)}
                        className="mt-1.5 text-xs sm:text-sm font-medium text-slate-200 truncate text-left group-hover:text-[#10d97b]"
                      >
                        {series.title}
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* 5. CATEGORIES STRIP */}
              <section className="space-y-3">
                <h2 className="text-base sm:text-lg font-bold text-white">Categories</h2>
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                  {(
                    [
                      { label: 'All', cat: 'Trending', bg: 'from-emerald-900/70 to-slate-900' },
                      {
                        label: 'All Movies',
                        cat: 'Hollywood',
                        bg: 'from-purple-900/70 to-slate-900',
                      },
                      { label: 'All Dramas', cat: 'Series', bg: 'from-amber-900/70 to-slate-900' },
                      {
                        label: 'South Dubbed',
                        cat: 'South Hindi Dubbed',
                        bg: 'from-cyan-900/70 to-slate-900',
                      },
                      { label: 'Bollywood', cat: 'Bollywood', bg: 'from-rose-900/70 to-slate-900' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setSelectedTopCategory(item.cat)}
                      className={`px-5 py-3.5 rounded-xl bg-gradient-to-r ${item.bg} border border-white/10 text-xs sm:text-sm font-bold text-white whitespace-nowrap shrink-0 hover:border-[#10d97b]/50 transition-colors`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* 6. BOLLYWOOD & SOUTH HINDI HITS SECTION (100% Live TMDb `with_original_language=hi`) */}
              <section className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-1.5">
                    <Flame className="w-5 h-5 text-orange-500 fill-orange-500" />
                    <span>Bollywood &amp; South Hindi Hits</span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTopCategory('Bollywood');
                      setActiveTab('search');
                    }}
                    className="text-xs sm:text-sm text-slate-400 hover:text-white flex items-center gap-0.5"
                  >
                    <span>All</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {bollywoodAndSouthSection.slice(0, 6).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`bollywood-card-${item.id}`}
                      onClick={() => handleOpenMovie(item)}
                      className="group flex flex-col text-left focus:outline-none"
                    >
                      <div className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-slate-900">
                        <img
                          src={item.posterUrl}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-slate-100">
                          {item.language}
                        </span>
                      </div>
                      <span className="mt-1.5 text-xs sm:text-sm font-medium text-slate-200 truncate group-hover:text-[#10d97b]">
                        {item.title}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Watch on TV & Web Banner */}
              <section className="space-y-2.5">
                <h2 className="text-base sm:text-lg font-bold text-white">Watch on TV &amp; Web</h2>
                <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-[#d8f3f6] via-[#a7f3d0] to-[#6ee7b7] text-slate-950 shadow-md">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-base sm:text-lg font-extrabold tracking-tight">
                      Watch on TV &amp; Web
                    </div>
                    <div className="text-xs font-medium text-slate-800">
                      Bigger screen, one premium account.
                    </div>
                    <div className="text-[11px] font-mono text-slate-700 truncate">
                      Official website :{' '}
                      {appConfig.official_website ||
                        'https://cinebox-movie-streaming-offline-downloader.ai.studio/'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      showToast(
                        `Official TV & Web Portal: ${
                          appConfig.official_website ||
                          'https://cinebox-movie-streaming-offline-downloader.ai.studio/'
                        }`
                      );
                    }}
                    className="px-4 py-2 rounded-full bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold text-xs shrink-0 shadow-sm min-h-[38px]"
                  >
                    Download TV
                  </button>
                </div>
              </section>
            </div>
            </>
            )}
          </div>
        )}

        {/* ===================================================================
            TAB 2: SEARCH & BROWSE CATALOG VIEW (Client-Side Proxy + MovieBox API)
           =================================================================== */}
        {activeTab === 'search' && (
          <div className="pb-24 px-3 sm:px-6 pt-4 max-w-7xl mx-auto space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-white">
                  {searchQuery.trim()
                    ? `Search Results for "${searchQuery}"`
                    : 'Search MovieBox API (h5.aoneroom.com via Client-Side Proxy)'}
                </h1>
                {searchProxyUsed && (
                  <p className="text-[11px] font-mono text-[#10d97b] mt-0.5">
                    Loaded via Proxy: {searchProxyUsed} &rarr; h5.aoneroom.com/wefeed-h5api-bff/subject/search
                  </p>
                )}
              </div>

              {/* Quick Search Pills */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {[
                  { label: 'Trending', cat: 'Trending' as const },
                  { label: 'Bollywood (Hindi)', cat: 'Bollywood' as const },
                  { label: 'South Dubbed', cat: 'South Hindi Dubbed' as const },
                  { label: 'TV Series', cat: 'Series' as const },
                  { label: 'Anime', cat: 'Anime' as const },
                  { label: 'Action', cat: 'Action' as const },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSearchError(null);
                      setIsSearching(true);
                      fetchMoviesByCategory(item.cat)
                        .then(setSearchResults)
                        .finally(() => setIsSearching(false));
                    }}
                    className="px-3 py-1.5 rounded-full bg-[#1a1f2c] hover:bg-slate-800 text-xs font-semibold text-slate-200 whitespace-nowrap"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* RECENT SEARCHES CHIPS (Saved in localStorage) */}
            {recentSearches.length > 0 && (
              <div
                data-testid="recent-searches-section"
                className="p-3.5 rounded-2xl bg-[#131722] border border-slate-800/80 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                    <Clock className="w-3.5 h-3.5 text-[#10d97b]" />
                    <span>Recent Searches</span>
                  </div>
                  <button
                    type="button"
                    data-testid="clear-recent-searches-btn"
                    onClick={handleClearRecentSearches}
                    className="text-[11px] font-semibold text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear All</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {recentSearches.map((term) => (
                    <div
                      key={term}
                      className="inline-flex items-center rounded-full bg-[#1c2230] hover:bg-[#232b3d] border border-slate-700/80 text-xs text-slate-100 transition-colors"
                    >
                      <button
                        type="button"
                        data-testid={`recent-search-chip-${term}`}
                        onClick={() => handleSearchSubmit(undefined, term)}
                        className="pl-3 pr-2 py-1 font-medium hover:text-[#10d97b] transition-colors"
                      >
                        {term}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${term} from recent searches`}
                        onClick={() => handleRemoveRecentSearch(term)}
                        className="pr-2.5 pl-1 py-1 text-slate-400 hover:text-rose-400 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Requirement 4: "Server Busy, Try Again" Error Alert when Proxy fails */}
            {searchError && (
              <div
                data-testid="search-error-banner"
                role="alert"
                className="p-4 rounded-2xl bg-rose-950/60 border border-rose-500/50 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
                  <div>
                    <div className="text-sm font-extrabold text-rose-200">{searchError}</div>
                    <div className="text-[11px] font-mono text-rose-300/80">
                      Tried corsproxy.io &amp; api.allorigins.win &rarr; h5.aoneroom.com/wefeed-h5api-bff/subject/search?keyword={searchQuery}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="retry-search-btn"
                  onClick={() => handleSearchSubmit()}
                  className="px-3.5 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Try Again</span>
                </button>
              </div>
            )}

            {isSearching ? (
              <div
                data-testid="search-loading-spinner"
                className="py-14 rounded-2xl bg-[#131722] border border-slate-800 flex flex-col items-center justify-center gap-3 text-center"
              >
                <Loader2 className="w-9 h-9 text-[#10d97b] animate-spin" />
                <div className="text-sm font-bold text-white">
                  Searching MovieBox API via Client-Side Proxy (corsproxy.io / allorigins.win)...
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  Target: https://h5.aoneroom.com/wefeed-h5api-bff/subject/search?keyword={searchQuery}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3.5">
                {searchResults.map((movie) => (
                  <div
                    key={`${movie.mediaType}_${movie.id}`}
                    className="group flex flex-col rounded-xl overflow-hidden bg-[#141822] border border-slate-800/70"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenMovie(movie)}
                      className="relative aspect-[2/3] w-full overflow-hidden bg-slate-900 focus:outline-none"
                    >
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-slate-100">
                        {movie.language}
                      </span>
                    </button>

                    <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
                      <div>
                        <button
                          type="button"
                          onClick={() => handleOpenMovie(movie)}
                          className="text-xs font-bold text-white truncate block w-full text-left group-hover:text-[#10d97b]"
                        >
                          {movie.title}
                        </button>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {movie.releaseYear} · ★ {movie.rating.toFixed(1)}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleStartDownload(movie, '720p', FALLBACK_TEST_MP4_720P, 1020.6)
                          }
                          aria-label={`Download ${movie.title} 720p`}
                          className="flex-1 py-1.5 rounded-lg bg-[#10d97b]/15 hover:bg-[#10d97b]/25 text-[#10d97b] font-bold text-[11px] flex items-center justify-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          <span>720p</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleExportToDevice(movie, '720p', FALLBACK_TEST_MP4_720P, 1020.6)
                          }
                          aria-label={`Save ${movie.title} to device`}
                          className="px-2 py-1.5 rounded-lg bg-[#f3e5ab] text-slate-950 font-bold text-[11px] flex items-center gap-0.5"
                        >
                          <FolderDown className="w-3 h-3" />
                          <span>Save</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            TAB 3: DOWNLOADS (OFFLINE PLAYBACK + SAVE TO DEVICE STORAGE)
           =================================================================== */}
        {activeTab === 'downloads' && (
          <DownloadsView
            appName={appConfig.app_name}
            downloads={downloads}
            recommendedMovies={
              bollywoodAndSouthSection.length > 0
                ? bollywoodAndSouthSection.slice(0, 6)
                : trendingMoviesSection.slice(0, 6)
            }
            isOfflineSimulated={isOfflineSimulated}
            onToggleOfflineSimulation={() => {
              setIsOfflineSimulated((prev) => {
                const next = !prev;
                showToast(
                  next
                    ? 'Offline Mode Activated: Playing downloaded files from internal Directory.Data!'
                    : 'Online Mode Restored'
                );
                return next;
              });
            }}
            onPlayOfflineItem={handlePlayOfflineItem}
            onPauseDownload={pauseDownload}
            onResumeDownload={resumeDownload}
            onDeleteDownload={deleteDownload}
            onExportItemToDevice={handleExportExistingItemToDevice}
            onSelectMovie={handleOpenMovie}
            onRefreshRecommendations={() => {
              fetchBollywoodMovies().then((list) => {
                setBollywoodAndSouthSection(list);
                showToast('Refreshed live TMDb recommendations!');
              });
            }}
            onOpenDeliverables={() =>
              showToast('Local P2P Wi-Fi File Transfer ready — select any downloaded movie to share.')
            }
          />
        )}

        {/* ===================================================================
            TAB 4: WATCHLIST VIEW
           =================================================================== */}
        {activeTab === 'watchlist' && (
          <div className="pb-24 px-4 sm:px-6 pt-4 max-w-7xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-white">My Watchlist ({watchlist.length})</h1>
              <span className="text-xs text-slate-400">
                Saved for quick streaming &amp; offline download
              </span>
            </div>

            {watchlist.length === 0 ? (
              <div className="py-12 rounded-2xl bg-[#131722] border border-slate-800 text-center space-y-2">
                <Bookmark className="w-8 h-8 text-slate-500 mx-auto" />
                <p className="text-sm font-semibold text-slate-300">Your Watchlist is empty</p>
                <p className="text-xs text-slate-500">
                  Open any movie or series and tap &ldquo;+ Watchlist&rdquo; to save it here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3.5">
                {watchlist.map((movie) => (
                  <div
                    key={movie.id}
                    className="group flex flex-col rounded-xl overflow-hidden bg-[#141822] border border-slate-800/70"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenMovie(movie)}
                      className="relative aspect-[2/3] w-full overflow-hidden bg-slate-900"
                    >
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-slate-100">
                        {movie.language}
                      </span>
                    </button>
                    <div className="p-2.5 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenMovie(movie)}
                        className="text-xs font-semibold text-slate-100 truncate text-left"
                      >
                        {movie.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleWatchlist(movie)}
                        aria-label={`Remove ${movie.title} from Watchlist`}
                        className="text-xs text-rose-400 hover:underline shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            TAB 5: "ME" PROFILE & ADMIN COMMAND CENTER VIEW
           =================================================================== */}
        {activeTab === 'me' && (
          <ProfileMeView
            appConfig={appConfig}
            loggedInUser={loggedInUser}
            userSettings={userSettings}
            watchHistory={watchHistory}
            watchlist={watchlist}
            isAdminUnlocked={isAdminUnlocked}
            onUserAuthChanged={(user) => {
              setLoggedInUser(user);
              if (user) {
                showToast(`Signed in as ${user.username} — Allotted ID: ${user.id}`);
                fetchAllAppUsers().then(setAppUsers);
              } else {
                showToast('Signed out of your account.');
              }
            }}
            onUpdateUserSettings={(nextSettings) => {
              const saved = saveUserAppSettings(nextSettings);
              setUserSettings(saved);
              showToast('App settings saved!');
            }}
            onChangeThemeColor={(theme: ThemeColorId) => {
              updateAppConfig({ primary_theme: theme }).then((res) => {
                setAppConfig(res.config);
                showToast(`App theme updated to ${theme}!`);
              });
            }}
            onClearHistoryAndCache={() => {
              setWatchHistory([]);
              setRecentSearches([]);
              try {
                localStorage.removeItem(HISTORY_STORAGE_KEY);
                localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
              } catch {
                // ignore
              }
              showToast('Cleared watch history & recent search cache!');
            }}
            onSelectHistoryMovie={(tmdbId) => {
              const found =
                allAdminCatalogMovies.find((m) => m.id === tmdbId) ||
                heroAndCategoryMovies[0];
              if (found) {
                handleOpenMovie(found);
              }
            }}
            onOpenWatchlistTab={() => setActiveTab('watchlist')}
            onOpenAdminModal={() => setAdminModalState({ open: true, tab: 'admin' })}
            onOpenDeliverablesModal={() =>
              setAdminModalState({ open: true, tab: 'deliverables' })
            }
          />
        )}
      </main>

      {/* =====================================================================
          STICKY BOTTOM NAVIGATION BAR
         ===================================================================== */}
      <nav
        aria-label="Primary Bottom Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 bg-[#11141c]/95 backdrop-blur-md border-t border-slate-800/80 h-14 px-2"
      >
        <div className="max-w-xl mx-auto h-full grid grid-cols-5 items-center">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
              activeTab === 'home' ? 'text-[#10d97b]' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5">Home</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
              activeTab === 'search' ? 'text-[#10d97b]' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Search className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5">Search</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('downloads')}
            className={`relative flex flex-col items-center justify-center min-h-[44px] transition-colors ${
              activeTab === 'downloads' ? 'text-[#10d97b]' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="relative">
              <Download className="w-5 h-5" />
              {activeDownloadsCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 px-1 rounded-full bg-[#10d97b] text-slate-950 font-mono text-[9px] font-extrabold">
                  {activeDownloadsCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-semibold mt-0.5">Downloads</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('watchlist')}
            className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
              activeTab === 'watchlist' ? 'text-[#10d97b]' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bookmark className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5">Watchlist</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('me')}
            className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
              activeTab === 'me' ? 'text-[#10d97b]' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5">Me</span>
          </button>
        </div>
      </nav>

      {/* =====================================================================
          HYBRID VIDEO PLAYER & MOVIE DETAILS OVERLAY MODAL
         ===================================================================== */}
      {playingMovie && (
        <VideoPlayerModal
          movie={playingMovie}
          movieLink={activeMovieLink}
          appConfig={appConfig}
          offlineDownload={playingOfflineItem}
          isInWatchlist={watchlist.some((w) => w.id === playingMovie.id)}
          isFetchingStream={isFetchingStream}
          streamFetchError={streamFetchError}
          movieBoxDirectStreamUrl={movieBoxDirectStreamUrl}
          onRetryStreamFetch={() => fetchMovieStreamForItem(playingMovie)}
          onClose={() => {
            setPlayingMovie(null);
            setPlayingOfflineItem(null);
          }}
          onToggleWatchlist={handleToggleWatchlist}
          onStartDownload={handleStartDownload}
          onExportToDevice={handleExportToDevice}
          onProgressUpdate={handleProgressUpdate}
          isAdminUnlocked={isAdminUnlocked}
          onSaveCustomMovieLink={async (input) => {
            const res = await upsertMovieLink(input);
            if (res.ok && res.record) {
              setActiveMovieLink(res.record);
              setMovieLinksMap((prev) => ({ ...prev, [res.record!.tmdb_id]: res.record! }));
              showToast(`Saved custom link for ${playingMovie.title}!`);
            }
            return res;
          }}
        />
      )}

      {/* =====================================================================
          GLOBAL USER ACCESS ENFORCEMENT OVERLAY (BANNED / SUSPENDED / MAINTENANCE)
         ===================================================================== */}
      {(() => {
        const currentDeviceUser =
          appUsers.find((u) => u.id === getCurrentDeviceUserId()) || null;
        const accessCheck = evaluateGlobalUserAccess(
          currentDeviceUser,
          appConfig,
          isAdminUnlocked
        );
        if (accessCheck.allowed || adminModalState.open) return null;
        return (
          <div
            data-testid="global-access-lock-overlay"
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4"
          >
            <div className="max-w-md w-full rounded-3xl bg-[#141822] border border-rose-500/40 p-6 text-center space-y-4 shadow-2xl">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <h2 className="text-lg font-extrabold text-white">
                {accessCheck.reason === 'maintenance'
                  ? 'Global Maintenance Mode Active'
                  : 'Account Access Restricted'}
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">{accessCheck.message}</p>
              <button
                type="button"
                onClick={() => setAdminModalState({ open: true, tab: 'admin' })}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-[#10d97b] inline-flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Admin Override Login</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* =====================================================================
          RESTRICTED GLOBAL ADMIN COMMAND CENTER MODAL
         ===================================================================== */}
      {adminModalState.open && (
        <AdminAndDeliverablesModal
          initialTab={adminModalState.tab}
          isAdminUnlocked={isAdminUnlocked}
          appConfig={appConfig}
          movies={allAdminCatalogMovies}
          onClose={() => setAdminModalState((s) => ({ ...s, open: false }))}
          onUnlockAdmin={() => {
            setIsAdminUnlocked(true);
            try {
              sessionStorage.setItem('cinebox_admin_unlocked', '1');
            } catch {
              // ignore
            }
            showToast('Admin Session Unlocked — Full Global Control Active!');
          }}
          onLockAdmin={() => {
            setIsAdminUnlocked(false);
            try {
              sessionStorage.removeItem('cinebox_admin_unlocked');
            } catch {
              // ignore
            }
            showToast('Admin Session Locked.');
          }}
          onConfigUpdated={(nextCfg) => setAppConfig(nextCfg)}
          onLinksUpdated={refreshSupabaseData}
          onUsersUpdated={(updatedUsers) => setAppUsers(updatedUsers)}
          onPreviewPopupAd={() => {
            showToast('Popup & Popunder Ads are strictly disabled — Static Banner-Only mode is active.');
          }}
        />
      )}
    </div>
  );
}
