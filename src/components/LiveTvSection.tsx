import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertTriangle,
  CalendarClock,
  Globe,
  History,
  Languages,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Subtitles,
  Trash2,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  IptvCategorySummary,
  IptvChannel,
  IptvPlaylistSourceId,
  LiveEpgProgramme,
  LiveSourceRecord,
  UserLiveFavoriteRecord,
  UserLiveHistoryRecord,
} from '../types/movie';
import {
  buildLiveTvProxyUrl,
  cacheChannelEpgProgrammes,
  classifyLiveStreamError,
  computeCurrentAndNextEpg,
  extractIptvCategories,
  fetchIptvOrgApiCatalog,
  fetchIptvPlaylist,
  filterIptvChannels,
  formatEpgLocalTime,
  getCachedChannelEpgProgrammes,
  IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE,
  IPTV_PAKISTAN_GEO_NOTICE,
  matchEpgProgrammesForChannel,
} from '../services/iptvService';
import {
  clearLiveHistory,
  isNativeAndroidLivePlatform,
  launchNativeMedia3LivePlayer,
  loadLiveFavorites,
  loadLiveHistory,
  recordLiveWatchHistory,
  toggleLiveFavorite,
} from '../services/liveTvUserService';
import { getSupabaseCredentials } from '../services/supabaseClient';
import {
  buildWeakNetworkHlsConfig,
  evaluateHlsFatalErrorRecovery,
} from '../hooks/useHlsPlayer';
import { AppLanguageCode } from '../utils/i18n';

interface LiveTvSectionProps {
  isActive: boolean;
  currentLang?: AppLanguageCode;
  isAdminUnlocked?: boolean;
  onOpenAdminLiveTv?: () => void;
}

const CHANNELS_PER_PAGE = 60;
const LIVE_STREAM_CONNECT_TIMEOUT_MS = 8000;

type CountryFilterCode = 'ALL' | 'PK' | 'IN';

const PUBLIC_LIVE_SOURCES: { id: IptvPlaylistSourceId; label: string; testId: string }[] = [
  { id: 'iptv-org-api', label: 'All TV (iptv-org API)', testId: 'iptv-source-api-btn' },
  { id: 'india', label: 'Indian TV', testId: 'iptv-source-india-btn' },
  { id: 'pakistan', label: 'Pakistan TV', testId: 'iptv-source-pakistan-btn' },
  { id: 'sports', label: 'Sports', testId: 'iptv-source-sports-btn' },
  { id: 'freetv', label: 'Free-TV', testId: 'iptv-source-freetv-btn' },
];

const EXTRA_M3U_SOURCES: { id: IptvPlaylistSourceId; label: string }[] = [
  { id: 'news', label: 'News M3U' },
  { id: 'movies', label: 'Movies M3U' },
  { id: 'entertainment', label: 'Entertainment M3U' },
  { id: 'all', label: 'All M3U Index' },
];

function getChannelInitials(name: string): string {
  const words = (name || 'TV')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'TV';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

// Helper formatting reserved cleanly for channel metadata

const ChannelLogoAvatar: React.FC<{
  logoUrl: string | null;
  name: string;
  sizeClass?: string;
}> = ({ logoUrl, name, sizeClass = 'w-11 h-11' }) => {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logoUrl]);

  if (!logoUrl || imgFailed) {
    return (
      <div
        className={`${sizeClass} rounded-xl bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700/70 flex items-center justify-center shrink-0 text-xs font-black text-[#10d97b] tracking-tight`}
        aria-hidden="true"
      >
        {getChannelInitials(name)}
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0 overflow-hidden p-1`}
    >
      <img
        src={logoUrl}
        alt={`${name} logo`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-full h-full object-contain"
      />
    </div>
  );
};

export const LiveTvSection: React.FC<LiveTvSectionProps> = ({
  isActive,
  currentLang = 'en',
  isAdminUnlocked = false,
  onOpenAdminLiveTv,
}) => {
  // Default directly to iptv-org API so Live TV works immediately for every user
  const [playlistSource, setPlaylistSource] = useState<IptvPlaylistSourceId>('iptv-org-api');
  const [channels, setChannels] = useState<IptvChannel[]>([]);
  const [categories, setCategories] = useState<IptvCategorySummary[]>([]);
  const [epgProgrammes] = useState<LiveEpgProgramme[]>([]);

  // Filters
  const [countryFilter, setCountryFilter] = useState<CountryFilterCode>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState<number>(CHANNELS_PER_PAGE);

  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState<boolean>(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  // Favorites & History
  const [favorites, setFavorites] = useState<UserLiveFavoriteRecord[]>([]);
  const [history, setHistory] = useState<UserLiveHistoryRecord[]>([]);

  // Active Live Player State
  const [activeChannel, setActiveChannel] = useState<IptvChannel | null>(null);
  const [activeSourceOverride, setActiveSourceOverride] = useState<LiveSourceRecord | null>(null);
  const [showEpgPanel, setShowEpgPanel] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [nativeLaunchStatus, setNativeLaunchStatus] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState<number>(0);

  // Audio & Subtitle Tracks exposed by HLS.js
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<{ id: number; name: string }[]>([]);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number>(-1);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerCardRef = useRef<HTMLDivElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);

  const isNativeAndroid = useMemo(() => isNativeAndroidLivePlatform(), []);

  // Load persisted favorites and history once on mount/activation
  useEffect(() => {
    if (!isActive) return;
    let mounted = true;
    Promise.all([loadLiveFavorites(), loadLiveHistory()])
      .then(([favs, hist]) => {
        if (!mounted) return;
        setFavorites(favs);
        setHistory(hist);
      })
      .catch(() => {
        // graceful fallback handled inside service
      });
    return () => {
      mounted = false;
    };
  }, [isActive]);

  const loadPlaylist = useCallback(
    async (source: IptvPlaylistSourceId, forceRefresh = false, signal?: AbortSignal) => {
      setIsLoadingPlaylist(true);
      setPlaylistError(null);

      try {
        if (source === 'iptv-org-api' || source === 'approved') {
          const apiResult = await fetchIptvOrgApiCatalog({
            forceRefresh,
            signal,
          });
          if (signal?.aborted) return;
          setChannels(apiResult.channels);
          setCategories(apiResult.categories);
          setVisibleLimit(CHANNELS_PER_PAGE);
          return;
        }

        const result = await fetchIptvPlaylist(source, {
          forceRefresh,
          signal,
        });
        if (signal?.aborted) return;
        setChannels(result.channels);
        setCategories(result.categories);
        setVisibleLimit(CHANNELS_PER_PAGE);
      } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        // If PK M3U fails, fall back automatically to iptv-org API PK channels
        if (source === 'pakistan') {
          try {
            const pkApiFallback = await fetchIptvOrgApiCatalog({
              countryFilter: 'PK',
              signal,
            });
            if (!signal?.aborted && pkApiFallback.channels.length > 0) {
              setChannels(pkApiFallback.channels);
              setCategories(pkApiFallback.categories);
              setVisibleLimit(CHANNELS_PER_PAGE);
              return;
            }
          } catch {
            // fall through to display error
          }
        }
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to fetch Live TV channels right now.';
        setPlaylistError(msg);
      } finally {
        if (!signal?.aborted) {
          setIsLoadingPlaylist(false);
        }
      }
    },
    []
  );

  // Fetch catalogue when Live TV tab activates or source changes
  useEffect(() => {
    if (!isActive) return;
    const controller = new AbortController();
    loadPlaylist(playlistSource, false, controller.signal);
    return () => controller.abort();
  }, [isActive, playlistSource, loadPlaylist]);

  useEffect(() => {
    setVisibleLimit(CHANNELS_PER_PAGE);
  }, [countryFilter, selectedCategory, selectedLanguage, favoritesOnly, searchQuery]);

  const destroyHlsInstance = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        // ignore cleanup errors
      }
      hlsRef.current = null;
    }
    const videoEl = videoRef.current;
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch {
        // ignore
      }
    }
    setAudioTracks([]);
    setCurrentAudioTrack(-1);
    setSubtitleTracks([]);
    setCurrentSubtitleTrack(-1);
    setIsPlaying(false);
    setIsBuffering(false);
  }, []);

  // Resolve active stream target (either selected alternate source or channel primary source)
  const resolvedActiveChannel = useMemo((): IptvChannel | null => {
    if (!activeChannel) return null;
    if (!activeSourceOverride) return activeChannel;
    return {
      ...activeChannel,
      streamUrl: activeSourceOverride.sourceUrl,
      sourceId: activeSourceOverride.id,
      format: activeSourceOverride.format,
      allowBrowserProxy: activeSourceOverride.allowBrowserProxy,
      rightsStatus: activeSourceOverride.rightsStatus,
      playbackStatus: activeSourceOverride.playbackStatus,
      lastCheckedAt: activeSourceOverride.lastCheckedAt,
      isHttpInsecure: activeSourceOverride.sourceUrl.toLowerCase().startsWith('http://'),
    };
  }, [activeChannel, activeSourceOverride]);

  // Compute EPG schedule for active channel (cached + matching, never fabricated)
  const activeChannelEpg = useMemo(() => {
    if (!activeChannel) {
      return { current: null, next: null, upcoming: [] as LiveEpgProgramme[] };
    }
    const cached = getCachedChannelEpgProgrammes(activeChannel.id);
    const pool = cached || matchEpgProgrammesForChannel(epgProgrammes, activeChannel);
    if (!cached && pool.length > 0) {
      cacheChannelEpgProgrammes(activeChannel.id, pool);
    }
    return computeCurrentAndNextEpg(pool);
  }, [activeChannel, epgProgrammes]);

  // Mount browser HLS.js OR launch Native Android Media3 ExoPlayer when channel changes
  useEffect(() => {
    if (!isActive || !resolvedActiveChannel) {
      destroyHlsInstance();
      return;
    }

    // STAGE 10: Android builds launch native Kotlin + Media3 ExoPlayer directly — NEVER WebView/iframe fallback
    if (isNativeAndroid) {
      destroyHlsInstance();
      setStreamError(null);
      setIsBuffering(true);
      let cancelled = false;

      launchNativeMedia3LivePlayer(resolvedActiveChannel, activeChannelEpg.current)
        .then((res) => {
          if (cancelled) return;
          setIsBuffering(false);
          if (!res.launched) {
            setNativeLaunchStatus(null);
            setStreamError(
              res.error || 'Native Media3 playback failed to launch for this live channel.'
            );
          } else {
            setIsPlaying(true);
            setNativeLaunchStatus(
              `Playing ${resolvedActiveChannel.name} in Native Android Media3 ExoPlayer.`
            );
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setIsBuffering(false);
          setStreamError(
            err instanceof Error
              ? err.message
              : 'Native Android Media3 player unavailable.'
          );
        });

      return () => {
        cancelled = true;
      };
    }

    // Browser playback path (HLS.js or Safari native HLS)
    const videoEl = videoRef.current;
    if (!videoEl) return;

    destroyHlsInstance();
    setStreamError(null);
    setNativeLaunchStatus(null);
    setIsBuffering(true);

    if (resolvedActiveChannel.format === 'dash') {
      setIsBuffering(false);
      setStreamError(
        'DASH (.mpd) live streams are natively supported in the CineBox Android APK (Media3 ExoPlayer). Select an HLS (.m3u8) source for browser playback.'
      );
      return;
    }

    const rawStreamUrl = resolvedActiveChannel.streamUrl;
    const canUseProxy = resolvedActiveChannel.allowBrowserProxy === true;
    const proxiedStreamUrl = canUseProxy
      ? buildLiveTvProxyUrl(rawStreamUrl, undefined, {
          sourceId: resolvedActiveChannel.sourceId || null,
        })
      : null;

    const isPageHttps =
      typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const { anonKey: supabaseAnonKey } = getSupabaseCredentials();
    let streamStarted = false;
    let triedDirectFallback = false;
    let activeWatchdog: ReturnType<typeof setTimeout> | null = null;

    const clearWatchdog = () => {
      if (activeWatchdog) {
        clearTimeout(activeWatchdog);
        activeWatchdog = null;
      }
    };

    const failWithMessage = (customMsg?: string | null) => {
      clearWatchdog();
      setIsBuffering(false);
      setIsPlaying(false);
      setStreamError(customMsg || IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE);
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }
    };

    const mountHlsStream = (targetUrl: string, usingProxy: boolean) => {
      destroyHlsInstance();
      setStreamError(null);
      setIsBuffering(true);
      clearWatchdog();

      let fatalRecoveryCount = 0;
      const MAX_FATAL_RECOVERIES = 1;

      activeWatchdog = setTimeout(() => {
        if (!streamStarted) {
          failWithMessage(IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE);
        }
      }, LIVE_STREAM_CONNECT_TIMEOUT_MS);

      if (Hls.isSupported()) {
        const hls = new Hls({
          ...buildWeakNetworkHlsConfig(),
          manifestLoadingTimeOut: 6000,
          manifestLoadingMaxRetry: 0,
          levelLoadingTimeOut: 6000,
          levelLoadingMaxRetry: 1,
          fragLoadingTimeOut: 8000,
          fragLoadingMaxRetry: 1,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 8,
          xhrSetup: (xhr, reqUrl) => {
            if (supabaseAnonKey && reqUrl.includes('.supabase.co/functions/v1/')) {
              xhr.setRequestHeader('apikey', supabaseAnonKey);
              xhr.setRequestHeader('Authorization', `Bearer ${supabaseAnonKey}`);
            }
          },
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls.loadSource(targetUrl);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          streamStarted = true;
          clearWatchdog();
          setIsBuffering(false);
          if (Array.isArray(hls.audioTracks)) {
            setAudioTracks(
              hls.audioTracks.map((t, idx) => ({
                id: idx,
                name: t.name || t.lang || `Audio ${idx + 1}`,
              }))
            );
            setCurrentAudioTrack(hls.audioTrack);
          }
          if (Array.isArray(hls.subtitleTracks)) {
            setSubtitleTracks(
              hls.subtitleTracks.map((t, idx) => ({
                id: idx,
                name: t.name || t.lang || `Subtitle ${idx + 1}`,
              }))
            );
            setCurrentSubtitleTrack(hls.subtitleTrack);
          }
          videoEl.muted = isMuted;
          videoEl
            .play()
            .then(() => {
              setIsPlaying(true);
            })
            .catch(() => {
              setIsPlaying(false);
            });
        });

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
          if (Array.isArray(hls.audioTracks)) {
            setAudioTracks(
              hls.audioTracks.map((t, idx) => ({
                id: idx,
                name: t.name || t.lang || `Audio ${idx + 1}`,
              }))
            );
            setCurrentAudioTrack(hls.audioTrack);
          }
        });

        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          if (Array.isArray(hls.subtitleTracks)) {
            setSubtitleTracks(
              hls.subtitleTracks.map((t, idx) => ({
                id: idx,
                name: t.name || t.lang || `Subtitle ${idx + 1}`,
              }))
            );
            setCurrentSubtitleTrack(hls.subtitleTrack);
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          const httpStatus =
            typeof data?.response?.code === 'number' ? data.response.code : undefined;

          const classification = classifyLiveStreamError({
            errorType: data?.type,
            errorDetails: data?.details,
            httpStatus,
            streamUrl: rawStreamUrl,
            isPageHttps,
            isFatal: Boolean(data?.fatal),
            usingProxy,
          });

          if (
            usingProxy &&
            classification.shouldFallbackToDirect &&
            !triedDirectFallback &&
            rawStreamUrl.toLowerCase().startsWith('https://')
          ) {
            triedDirectFallback = true;
            mountHlsStream(rawStreamUrl, false);
            return;
          }

          if (classification.shouldAbortImmediately) {
            failWithMessage(
              classification.userMessage || IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE
            );
            return;
          }

          if (!data.fatal) return;
          fatalRecoveryCount += 1;

          if (fatalRecoveryCount <= MAX_FATAL_RECOVERIES) {
            const recovery = evaluateHlsFatalErrorRecovery(
              data.type,
              fatalRecoveryCount
            );
            if (recovery.action === 'startLoad') {
              hls.startLoad();
              return;
            }
            if (
              recovery.action === 'recoverMediaError' ||
              recovery.action === 'swapAudioCodec'
            ) {
              hls.recoverMediaError();
              return;
            }
          }

          failWithMessage(
            classification.userMessage || IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE
          );
        });

        hls.attachMedia(videoEl);
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = targetUrl;
        videoEl.muted = isMuted;
        videoEl
          .play()
          .then(() => {
            streamStarted = true;
            clearWatchdog();
            setIsBuffering(false);
            setIsPlaying(true);
          })
          .catch(() => {
            setIsBuffering(false);
            setIsPlaying(false);
          });
      } else {
        clearWatchdog();
        setIsBuffering(false);
        setStreamError('HLS live playback is not supported in this browser.');
      }
    };

    mountHlsStream(proxiedStreamUrl || rawStreamUrl, Boolean(proxiedStreamUrl));

    return () => {
      clearWatchdog();
      destroyHlsInstance();
    };
  }, [
    isActive,
    resolvedActiveChannel,
    retryCounter,
    isNativeAndroid,
    destroyHlsInstance,
  ]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const favoriteIdSet = useMemo(
    () => new Set(favorites.map((f) => f.channelId)),
    [favorites]
  );

  const availableLanguages = useMemo(() => {
    const set = new Set<string>();
    for (const ch of channels) {
      const lang = (ch.language || '').trim();
      if (lang && lang !== 'und') set.add(lang);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [channels]);

  const filteredChannels = useMemo(
    () =>
      filterIptvChannels(channels, {
        query: searchQuery,
        category: selectedCategory,
        country: countryFilter,
        language: selectedLanguage,
        favoriteIds: favoriteIdSet,
        favoritesOnly,
      }),
    [
      channels,
      searchQuery,
      selectedCategory,
      countryFilter,
      selectedLanguage,
      favoriteIdSet,
      favoritesOnly,
    ]
  );

  const categoryChips = useMemo(() => {
    const fixedDefaults = ['Sports', 'News', 'Movies', 'Entertainment'];
    const result: { name: string; count: number | null }[] = [
      { name: 'All', count: channels.length },
    ];
    const seen = new Set<string>(['all']);

    for (const def of fixedDefaults) {
      const found = categories.find((c) => c.name.toLowerCase() === def.toLowerCase());
      seen.add(def.toLowerCase());
      result.push({ name: def, count: found ? found.count : 0 });
    }

    for (const cat of categories) {
      const lower = cat.name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      result.push({ name: cat.name, count: cat.count });
      if (result.length >= 14) break;
    }

    return result;
  }, [categories, channels.length]);

  const visibleChannels = useMemo(
    () => filteredChannels.slice(0, visibleLimit),
    [filteredChannels, visibleLimit]
  );
  const hasMoreChannels = visibleChannels.length < filteredChannels.length;

  const handleSelectChannel = useCallback((channel: IptvChannel) => {
    setActiveChannel(channel);
    setActiveSourceOverride(null);
    setStreamError(null);
    setNativeLaunchStatus(null);
    setRetryCounter((c) => c + 1);
    recordLiveWatchHistory(channel, history)
      .then((next) => setHistory(next))
      .catch(() => {});
    setTimeout(() => {
      playerCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }, [history]);

  const handleToggleFavorite = useCallback(
    async (
      e: React.MouseEvent,
      channel: Pick<IptvChannel, 'id' | 'name' | 'logoUrl' | 'country' | 'groupTitle'>
    ) => {
      e.stopPropagation();
      const res = await toggleLiveFavorite(channel, favorites);
      setFavorites(res.favorites);
    },
    [favorites]
  );

  const handleClearHistory = useCallback(async () => {
    const cleared = await clearLiveHistory();
    setHistory(cleared);
  }, []);

  const handleTogglePlayPause = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (videoEl.paused) {
      videoEl
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      videoEl.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const container = videoContainerRef.current;
    if (!container) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (container.requestFullscreen) {
        await container.requestFullscreen();
      }
    } catch {
      // Fullscreen denied or unsupported
    }
  }, []);

  const handlePlayNextChannel = useCallback(() => {
    if (filteredChannels.length === 0) return;
    if (!activeChannel) {
      handleSelectChannel(filteredChannels[0]);
      return;
    }
    const idx = filteredChannels.findIndex((c) => c.id === activeChannel.id);
    const nextChannel = filteredChannels[(idx + 1) % filteredChannels.length];
    if (nextChannel) handleSelectChannel(nextChannel);
  }, [filteredChannels, activeChannel, handleSelectChannel]);

  const handleSelectAudioTrack = useCallback((trackId: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.audioTrack = trackId;
    setCurrentAudioTrack(trackId);
  }, []);

  const handleSelectSubtitleTrack = useCallback((trackId: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.subtitleTrack = trackId;
    hlsRef.current.subtitleDisplay = trackId >= 0;
    setCurrentSubtitleTrack(trackId);
  }, []);

  return (
    <section
      data-testid="live-tv-section"
      aria-label="Live TV IPTV Player and Channels"
      className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 pb-24 space-y-5"
    >
      {/* Header & Source Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#10d97b]/15 border border-[#10d97b]/40 flex items-center justify-center shrink-0">
            <Tv className="w-5 h-5 text-[#10d97b]" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <span>{currentLang === 'ur' ? 'لائیو ٹی وی اور اسپورٹس' : 'Live TV & Sports'}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-[10px] font-black text-rose-300 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                LIVE
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              {channels.length > 0
                ? `${filteredChannels.length.toLocaleString()} of ${channels.length.toLocaleString()} live channels`
                : 'Live TV channels via iptv-org API & M3U playlists'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {PUBLIC_LIVE_SOURCES.map((src) => {
            const active = playlistSource === src.id;
            return (
              <button
                key={src.id}
                type="button"
                data-testid={src.testId}
                onClick={() => {
                  setPlaylistSource(src.id);
                  setSelectedCategory('All');
                  if (src.id === 'india' || src.id === 'pakistan') {
                    setCountryFilter('ALL');
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold border transition-colors ${
                  active
                    ? 'bg-[#10d97b] text-slate-950 border-[#10d97b]'
                    : 'bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-700'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                {src.label}
              </button>
            );
          })}

          <button
            type="button"
            data-testid="iptv-refresh-btn"
            aria-label="Refresh Live Channels"
            disabled={isLoadingPlaylist}
            onClick={() => loadPlaylist(playlistSource, true)}
            className="shrink-0 p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-[#10d97b]/50 text-slate-200 disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoadingPlaylist ? 'animate-spin text-[#10d97b]' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Extra Category M3U Feeds */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {EXTRA_M3U_SOURCES.map((src) => (
          <button
            key={src.id}
            type="button"
            data-testid={`iptv-source-${src.id}-btn`}
            onClick={() => {
              setPlaylistSource(src.id);
              setSelectedCategory('All');
              setCountryFilter('ALL');
            }}
            className={`whitespace-nowrap shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              playlistSource === src.id
                ? 'bg-[#10d97b]/20 text-[#10d97b] border border-[#10d97b]/40'
                : 'bg-slate-900/70 text-slate-300 border border-slate-800 hover:text-white'
            }`}
          >
            {src.label}
          </button>
        ))}
        {isAdminUnlocked && onOpenAdminLiveTv && (
          <button
            type="button"
            data-testid="iptv-open-admin-manager-btn"
            onClick={onOpenAdminLiveTv}
            className="whitespace-nowrap shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-900/70 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-950/50 inline-flex items-center gap-1"
          >
            <ShieldCheck className="w-3 h-3" />
            Admin Manager
          </button>
        )}
      </div>

      {/* Pakistan Regional Notice when PK filter or channel is selected */}
      {(countryFilter === 'PK' || playlistSource === 'pakistan' || activeChannel?.country === 'PK') && (
        <div
          data-testid="iptv-pakistan-geo-notice"
          role="status"
          className="rounded-xl bg-amber-500/10 border border-amber-500/35 px-4 py-2.5 flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-amber-200"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{IPTV_PAKISTAN_GEO_NOTICE}</span>
        </div>
      )}

      {/* Active Live Player Card */}
      {resolvedActiveChannel && (
        <div
          ref={playerCardRef}
          data-testid="iptv-hls-player-card"
          className="rounded-2xl bg-[#0e121b] border border-slate-800 overflow-hidden shadow-2xl"
        >
          {/* Video Stage */}
          <div
            ref={videoContainerRef}
            className="relative aspect-video w-full max-h-[340px] sm:max-h-[400px] bg-black flex items-center justify-center"
          >
            {isNativeAndroid ? (
              <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
                <Tv className="w-12 h-12 text-[#10d97b]" />
                <p className="text-sm font-bold text-white">
                  {nativeLaunchStatus || `Launching ${resolvedActiveChannel.name} in Native Media3 Player`}
                </p>
                <button
                  type="button"
                  onClick={() => setRetryCounter((c) => c + 1)}
                  className="px-4 py-2 rounded-xl bg-[#10d97b] text-slate-950 text-xs font-extrabold"
                >
                  Open Native Media3 Player
                </button>
              </div>
            ) : (
              <video
                ref={videoRef}
                playsInline
                autoPlay
                onPlay={() => {
                  setIsPlaying(true);
                  setIsBuffering(false);
                }}
                onPause={() => {
                  setIsPlaying(false);
                  setIsBuffering(false);
                }}
                onWaiting={() => setIsBuffering(true)}
                onPlaying={() => {
                  setIsBuffering(false);
                  setIsPlaying(true);
                }}
                onError={() => {
                  setIsBuffering(false);
                  setIsPlaying(false);
                  setStreamError(IPTV_CHANNEL_OFFLINE_ERROR_MESSAGE);
                }}
                className="w-full h-full object-contain bg-black"
              />
            )}

            {/* Top Overlay Strip */}
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between gap-2 pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto flex-wrap">
                <span
                  data-testid="iptv-live-badge"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600/90 backdrop-blur-sm text-white text-[11px] font-black uppercase tracking-wider shadow"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  LIVE
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-sm border border-white/10 text-xs font-bold text-white truncate max-w-[180px] sm:max-w-xs">
                  {resolvedActiveChannel.name}
                </span>
                {resolvedActiveChannel.format && resolvedActiveChannel.format !== 'unknown' && (
                  <span className="px-2 py-0.5 rounded bg-black/75 border border-white/10 text-[10px] font-bold text-slate-300 uppercase">
                    {resolvedActiveChannel.format}
                  </span>
                )}
              </div>

              <button
                type="button"
                data-testid="iptv-close-player-btn"
                aria-label="Close Live Player"
                onClick={() => {
                  destroyHlsInstance();
                  setActiveChannel(null);
                  setActiveSourceOverride(null);
                  setStreamError(null);
                }}
                className="pointer-events-auto p-2 rounded-lg bg-black/70 hover:bg-black text-slate-200 border border-white/15 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Buffering Spinner */}
            {isBuffering && !streamError && (
              <div className="absolute inset-0 z-15 flex flex-col items-center justify-center bg-black/45 pointer-events-none gap-2">
                <Loader2 className="w-9 h-9 text-[#10d97b] animate-spin" />
                <span className="text-xs font-semibold text-slate-200">
                  Connecting to live stream...
                </span>
              </div>
            )}

            {/* Honest Stream Error Overlay */}
            {streamError && (
              <div
                data-testid="iptv-stream-error"
                className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950 p-5 text-center gap-3"
              >
                <AlertTriangle className="w-9 h-9 text-amber-400" />
                <p className="text-xs sm:text-sm text-slate-200 max-w-md leading-relaxed">
                  {streamError}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setRetryCounter((c) => c + 1)}
                    className="px-4 py-2 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 text-xs font-extrabold transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Stream
                  </button>
                  {filteredChannels.length > 1 && (
                    <button
                      type="button"
                      data-testid="iptv-next-channel-btn"
                      onClick={handlePlayNextChannel}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors"
                    >
                      Try Next Channel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      destroyHlsInstance();
                      setActiveChannel(null);
                      setStreamError(null);
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Player Metadata, 4-Signal Status Indicators, Alternate Sources & Controls */}
          <div className="px-3.5 py-3 bg-[#121722] border-t border-slate-800/90 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <ChannelLogoAvatar
                  logoUrl={resolvedActiveChannel.logoUrl}
                  name={resolvedActiveChannel.name}
                  sizeClass="w-10 h-10"
                />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-extrabold text-white truncate">
                    {resolvedActiveChannel.name}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold">
                    <span className="px-2 py-0.5 rounded border bg-[#10d97b]/15 text-[#10d97b] border-[#10d97b]/40">
                      {resolvedActiveChannel.groupTitle}
                    </span>
                    {resolvedActiveChannel.country && (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                        {resolvedActiveChannel.country}
                      </span>
                    )}
                    {resolvedActiveChannel.provider && (
                      <span className="px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/80">
                        {resolvedActiveChannel.provider}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Player Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                {!isNativeAndroid && (
                  <>
                    <button
                      type="button"
                      data-testid="iptv-play-pause-btn"
                      aria-label={isPlaying ? 'Pause Live Stream' : 'Play Live Stream'}
                      onClick={handleTogglePlayPause}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 text-xs font-extrabold transition-colors min-h-[38px]"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-4 h-4 fill-current" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-current" />
                          <span>Play</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      data-testid="iptv-mute-btn"
                      aria-label={isMuted ? 'Unmute Live Stream' : 'Mute Live Stream'}
                      onClick={() => setIsMuted((m) => !m)}
                      className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 transition-colors min-h-[38px]"
                    >
                      {isMuted ? (
                        <VolumeX className="w-4 h-4 text-amber-400" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-slate-200" />
                      )}
                    </button>

                    <button
                      type="button"
                      data-testid="iptv-fullscreen-btn"
                      aria-label={isFullscreen ? 'Exit Live Fullscreen' : 'Enter Live Fullscreen'}
                      onClick={handleToggleFullscreen}
                      className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 transition-colors min-h-[38px]"
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  data-testid="iptv-player-favorite-btn"
                  aria-label="Toggle Favorite Channel"
                  onClick={(e) => handleToggleFavorite(e, resolvedActiveChannel)}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 transition-colors min-h-[38px]"
                >
                  <Star
                    className={`w-4 h-4 ${
                      favoriteIdSet.has(resolvedActiveChannel.id)
                        ? 'text-amber-400 fill-amber-400'
                        : 'text-slate-300'
                    }`}
                  />
                </button>

                <button
                  type="button"
                  data-testid="iptv-toggle-epg-btn"
                  onClick={() => setShowEpgPanel((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 min-h-[38px]"
                >
                  <CalendarClock className="w-4 h-4 text-[#10d97b]" />
                  <span>Guide</span>
                </button>
              </div>
            </div>

            {/* Track Selectors (Audio & Subtitles) & Alternate Sources */}
            {(audioTracks.length > 1 ||
              subtitleTracks.length > 0 ||
              (activeChannel?.alternateSources && activeChannel.alternateSources.length > 1)) && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/70">
                {activeChannel?.alternateSources && activeChannel.alternateSources.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-400">Sources:</span>
                    {activeChannel.alternateSources.map((src, idx) => {
                      const selected =
                        (activeSourceOverride?.id || activeChannel.sourceId) === src.id;
                      return (
                        <button
                          key={src.id}
                          type="button"
                          onClick={() => {
                            setActiveSourceOverride(src);
                            setRetryCounter((c) => c + 1);
                          }}
                          className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                            selected
                              ? 'bg-[#10d97b] text-slate-950 border-[#10d97b]'
                              : 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white'
                          }`}
                        >
                          S{idx + 1} ({src.format.toUpperCase()})
                        </button>
                      );
                    })}
                  </div>
                )}

                {audioTracks.length > 1 && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                    <Languages className="w-3.5 h-3.5 text-[#10d97b]" />
                    <select
                      aria-label="Audio Track"
                      value={currentAudioTrack}
                      onChange={(e) => handleSelectAudioTrack(Number(e.target.value))}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                    >
                      {audioTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {subtitleTracks.length > 0 && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                    <Subtitles className="w-3.5 h-3.5 text-[#10d97b]" />
                    <select
                      aria-label="Subtitle Track"
                      value={currentSubtitleTrack}
                      onChange={(e) => handleSelectSubtitleTrack(Number(e.target.value))}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                    >
                      <option value={-1}>Subtitles Off</option>
                      {subtitleTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            {/* EPG Now & Next Bar (Never fabricates schedules) */}
            <div
              data-testid="iptv-epg-summary"
              className="rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2 text-xs space-y-1.5"
            >
              {activeChannelEpg.current || activeChannelEpg.next ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] font-black uppercase text-[#10d97b] mr-2">
                      Now
                    </span>
                    {activeChannelEpg.current ? (
                      <span className="text-slate-100 font-semibold">
                        {formatEpgLocalTime(activeChannelEpg.current.startAtUtc)} –{' '}
                        {formatEpgLocalTime(activeChannelEpg.current.endAtUtc)} ·{' '}
                        {activeChannelEpg.current.title}
                      </span>
                    ) : (
                      <span className="text-slate-400">No live programme metadata</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400 mr-2">
                      Next
                    </span>
                    {activeChannelEpg.next ? (
                      <span className="text-slate-300">
                        {formatEpgLocalTime(activeChannelEpg.next.startAtUtc)} ·{' '}
                        {activeChannelEpg.next.title}
                      </span>
                    ) : (
                      <span className="text-slate-500">No upcoming listing</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 text-[11px]">
                  No programme guide available for this channel right now.
                </p>
              )}

              {showEpgPanel && activeChannelEpg.upcoming.length > 0 && (
                <div
                  data-testid="iptv-epg-schedule-panel"
                  className="pt-2 border-t border-slate-800/70 space-y-1 max-h-40 overflow-y-auto"
                >
                  {activeChannelEpg.upcoming.slice(0, 8).map((prog) => (
                    <div
                      key={prog.id}
                      className="flex items-center justify-between gap-2 text-[11px] text-slate-300"
                    >
                      <span className="font-semibold truncate">{prog.title}</span>
                      <span className="text-slate-500 shrink-0">
                        {formatEpgLocalTime(prog.startAtUtc)} – {formatEpgLocalTime(prog.endAtUtc)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recently Watched History Strip */}
      {history.length > 0 && (
        <div
          data-testid="iptv-history-strip"
          className="rounded-xl bg-slate-900/70 border border-slate-800 p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-white">
              <History className="w-3.5 h-3.5 text-[#10d97b]" />
              Recently Watched
            </span>
            <button
              type="button"
              data-testid="iptv-clear-history-btn"
              onClick={handleClearHistory}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear History
            </button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {history.slice(0, 8).map((item) => {
              const matched = channels.find((c) => c.id === item.channelId);
              return (
                <button
                  key={`${item.channelId}::${item.lastWatchedAt}`}
                  type="button"
                  disabled={!matched}
                  onClick={() => matched && handleSelectChannel(matched)}
                  className="shrink-0 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-[#10d97b]/50 text-xs text-slate-200 disabled:opacity-60"
                >
                  <span className="font-semibold truncate max-w-[130px]">{item.channelName}</span>
                  <span className="text-[10px] text-slate-500 uppercase">{item.country}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Country, Language, Favorites & Category Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Country Filter */}
          <div
            role="group"
            aria-label="Country Filter"
            className="flex items-center gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1"
          >
            {(
              [
                { code: 'ALL', label: 'All Countries' },
                { code: 'PK', label: 'Pakistan' },
                { code: 'IN', label: 'India' },
              ] as const
            ).map((item) => (
              <button
                key={item.code}
                type="button"
                data-testid={`iptv-country-${item.code.toLowerCase()}-btn`}
                onClick={() => setCountryFilter(item.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 ${
                  countryFilter === item.code
                    ? 'bg-[#10d97b] text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Globe className="w-3 h-3" />
                {item.label}
              </button>
            ))}
          </div>

          {/* Favorites Toggle */}
          <button
            type="button"
            data-testid="iptv-favorites-filter-btn"
            onClick={() => setFavoritesOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
              favoritesOnly
                ? 'bg-amber-400 text-slate-950 border-amber-400'
                : 'bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-current' : ''}`} />
            Favorites ({favorites.length})
          </button>

          {/* Language Selector */}
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-200">
            <Languages className="w-3.5 h-3.5 text-[#10d97b]" />
            <select
              data-testid="iptv-language-select"
              aria-label="Filter by language"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="bg-transparent text-xs text-white focus:outline-none"
            >
              <option value="all" className="bg-slate-900">
                All Languages
              </option>
              {availableLanguages.map((lang) => (
                <option key={lang} value={lang} className="bg-slate-900">
                  {lang.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <label htmlFor="iptv-channel-search" className="sr-only">
            Search Live TV channels by name or category
          </label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="iptv-channel-search"
            data-testid="iptv-search-input"
            type="text"
            inputMode="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search live channels (e.g. PTV Sports, ARY News, Ten Sports)..."
            className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-900/95 border border-slate-800 focus:border-[#10d97b] focus:outline-none text-sm text-white placeholder:text-slate-500"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear channel search"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Filter Buttons */}
        <div
          role="tablist"
          aria-label="Live TV Channel Categories"
          className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1"
        >
          {categoryChips.map((chip) => {
            const isSelected =
              selectedCategory.toLowerCase() === chip.name.toLowerCase();
            return (
              <button
                key={chip.name}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-testid={`iptv-category-chip-${chip.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                onClick={() => setSelectedCategory(chip.name)}
                className={`whitespace-nowrap shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  isSelected
                    ? 'bg-[#10d97b] text-slate-950 border-[#10d97b]'
                    : 'bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-600 hover:text-white'
                }`}
              >
                {chip.name}
                {chip.count !== null ? ` (${chip.count.toLocaleString()})` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* Playlist Loading / Error / Empty / Grid States */}
      {isLoadingPlaylist && channels.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 text-[#10d97b] animate-spin" />
          <p className="text-sm font-semibold">Loading Live TV catalogue...</p>
        </div>
      ) : playlistError && channels.length === 0 ? (
        <div
          data-testid="iptv-playlist-error"
          className="rounded-2xl bg-slate-900/80 border border-rose-500/35 p-6 text-center space-y-3"
        >
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
          <p className="text-sm font-semibold text-white">{playlistError}</p>
          <button
            type="button"
            onClick={() => loadPlaylist(playlistSource, true)}
            className="px-4 py-2 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 text-xs font-extrabold transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : filteredChannels.length === 0 ? (
        <div
          data-testid="iptv-empty-state"
          className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8 text-center space-y-3"
        >
          <Tv className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-sm font-bold text-white">No matching channels found</p>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            Try clearing your search or adjusting Country, Category, or Language filters.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {visibleChannels.map((channel) => {
              const isChannelSelected = activeChannel?.id === channel.id;
              const isFav = favoriteIdSet.has(channel.id);

              return (
                <div
                  key={`${channel.id}::${channel.streamUrl}`}
                  data-testid={`iptv-channel-card-${channel.id}`}
                  className={`group p-3 rounded-xl border transition-all flex items-center gap-2 min-h-[76px] ${
                    isChannelSelected
                      ? 'bg-[#10d97b]/15 border-[#10d97b] shadow-lg shadow-[#10d97b]/10'
                      : 'bg-[#111622] border-slate-800/90 hover:border-[#10d97b]/60 hover:bg-[#151b29]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectChannel(channel)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left focus:outline-none"
                  >
                    <ChannelLogoAvatar logoUrl={channel.logoUrl} name={channel.name} />

                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-[#10d97b] transition-colors">
                        {channel.name}
                      </p>

                      <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                        <span className="font-medium text-slate-400 truncate max-w-[110px]">
                          {channel.groupTitle}
                        </span>
                        {channel.country && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold uppercase">
                            {channel.country}
                          </span>
                        )}
                        {channel.format && channel.format !== 'unknown' && (
                          <span className="px-1.5 py-0.5 rounded bg-[#10d97b]/10 text-[#10d97b] border border-[#10d97b]/25 font-bold uppercase">
                            {channel.format}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    aria-label={isFav ? `Remove ${channel.name} from favorites` : `Favorite ${channel.name}`}
                    onClick={(e) => handleToggleFavorite(e, channel)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 shrink-0 self-start"
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        isFav ? 'text-amber-400 fill-amber-400' : ''
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          {hasMoreChannels && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                data-testid="iptv-load-more-btn"
                onClick={() => setVisibleLimit((prev) => prev + CHANNELS_PER_PAGE)}
                className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-extrabold text-white transition-colors"
              >
                Show More Channels ({(filteredChannels.length - visibleChannels.length).toLocaleString()} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
