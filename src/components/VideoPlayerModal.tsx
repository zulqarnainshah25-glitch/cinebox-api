import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ExternalLink,
  Film,
  Info,
  Loader2,
  Maximize2,
  RefreshCw,
  Save,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Tv,
  Volume2,
  X,
} from 'lucide-react';
import {
  AppConfigRecord,
  DownloadItem,
  DownloadQuality,
  MovieItem,
  MovieLinkRecord,
  SubtitleTrackOption,
} from '../types/movie';
import {
  AlternateLanguageStream,
  buildVidSrcAdBlockCssRules,
  formatPlayerTimecode,
  getCleanIframeAttributes,
  getFullscreenPlayerConfig,
  getVidSrcPlayerIframeAttributes,
  installVidSrcNetworkAdInterceptor,
  isVidSrcProviderUrl,
  lockScreenOrientationSafely,
  PLAYABLE_HD_STREAMS_POOL,
  resolvePlaybackPlan,
  VerifiedAudioTrack,
} from '../utils/streamResolver';
import {
  checkStreamSourceHealth,
  evaluatePlayerAudioCapability,
  SourceAvailabilityStatus,
  switchEmbeddedAudioTrackSafely,
} from '../services/streamSourceManager';
import {
  DramaOrHindiStreamOption,
  isPakistaniOrUrduContent,
  searchPakDramaOrHindiStreams,
} from '../services/hindiAndPakDramaService';
import {
  buildVidSrcEmbedUrl,
  fetchVidSrcContentInfo,
  getVidSrcSavedProgress,
  parseVidSrcPlayerEventMessage,
  saveVidSrcPlayerProgress,
  VidSrcContentInfoResult,
} from '../services/vidsrcService';
import { fetchLinkHealthRowsForTmdb } from '../services/supabaseClient';
import {
  getSavedSubtitlePreferences,
  sanitizeSubtitleTracksList,
  saveSubtitlePreferences,
  SubtitleBgOpacityOption,
  SubtitleFontSizeOption,
} from '../utils/subtitleParser';
import { useHlsPlayer } from '../hooks/useHlsPlayer';
import {
  getSavedUserPlaybackPreferences,
  saveUserPlaybackPreferences,
  usePlaybackProgress,
} from '../hooks/usePlaybackProgress';
import { SubtitleLayer } from './player/SubtitleLayer';
import { PlayerGestures } from './player/PlayerGestures';
import {
  findNextHealthyEmbedSource,
  formatUserFriendlySourceLabel,
  SourcePicker,
} from './player/SourcePicker';
import { PlayerControls } from './player/PlayerControls';

interface VideoPlayerModalProps {
  movie: MovieItem;
  movieLink: MovieLinkRecord | null;
  appConfig?: AppConfigRecord;
  offlineDownload?: DownloadItem | null;
  isInWatchlist: boolean;
  isAdminUnlocked?: boolean;
  onClose: () => void;
  onStartDownload?: (
    movie: MovieItem,
    quality: DownloadQuality,
    sourceUrl: string,
    fileSizeMB: number
  ) => void;
  onExportToDevice?: (
    movie: MovieItem,
    quality: DownloadQuality,
    sourceUrl: string,
    fileSizeMB: number
  ) => void | Promise<void>;
  onToggleWatchlist: (movie: MovieItem) => void;
  onProgressUpdate: (movie: MovieItem, currentSeconds: number, durationSeconds: number) => void;
  onSaveCustomMovieLink?: (
    linkInput: Partial<MovieLinkRecord>
  ) => Promise<{ ok: boolean; error?: string | null; record?: MovieLinkRecord | null }>;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  movie,
  movieLink,
  offlineDownload,
  isInWatchlist,
  isAdminUnlocked = false,
  onClose,
  onToggleWatchlist,
  onProgressUpdate,
  onSaveCustomMovieLink,
}) => {
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(1);

  const seasonsList =
    movie.seasons && movie.seasons.length > 0
      ? movie.seasons
      : [
          { seasonNumber: 1, name: 'Season 1', episodeCount: 12 },
          { seasonNumber: 2, name: 'Season 2', episodeCount: 10 },
          { seasonNumber: 3, name: 'Season 3', episodeCount: 10 },
        ];

  const currentSeasonInfo =
    seasonsList.find((s) => s.seasonNumber === selectedSeason) || seasonsList[0];
  const episodeCount = Math.min(36, Math.max(1, currentSeasonInfo?.episodeCount || 12));

  // Playback progress, Supabase watch_history sync, Skip Intro & 5s Next Episode countdown
  const {
    activeUserId,
    savedResumePosition,
    savedDuration,
    reportPlaybackProgress,
    nextEpisodeCountdown,
    startNextEpisodeCountdown,
    cancelNextEpisodeCountdown,
    playNextEpisodeImmediately,
    canShowSkipIntro,
  } = usePlaybackProgress({
    movie,
    season: selectedSeason,
    episode: selectedEpisode,
    totalEpisodesInSeason: episodeCount,
    introStart: movieLink?.intro_start,
    introEnd: movieLink?.intro_end,
    onProgressUpdate,
    onAdvanceEpisode: (nextEp) => {
      setSelectedEpisode(nextEp);
    },
  });

  const savedUserPlaybackPrefs = getSavedUserPlaybackPreferences(activeUserId);
  const savedSubPrefs = getSavedSubtitlePreferences(activeUserId);

  const plan = resolvePlaybackPlan(
    movie.id,
    movieLink,
    movie.mediaType,
    selectedSeason,
    selectedEpisode,
    movie.originalLanguageCode,
    movie.youtubeKey
  );

  const isPakDrama = isPakistaniOrUrduContent(movie);

  const [playerMode, setPlayerMode] = useState<'direct' | 'embed' | 'pak-drama' | 'trailer'>(
    offlineDownload ? 'direct' : isPakDrama ? 'pak-drama' : 'embed'
  );
  const [selectedEmbedId, setSelectedEmbedId] = useState<string>(
    movieLink?.stream_url ? 'custom-supabase' : 'auto-server-3'
  );
  const [selectedAltStreamUrl, setSelectedAltStreamUrl] = useState<string | null>(
    plan.directVideoUrl
  );
  const failedEmbedServerIdsRef = useRef<Set<string>>(new Set());

  // Pakistani Drama & Hindi Dubbed Stream Resolver State
  const [pakDramaStreams, setPakDramaStreams] = useState<DramaOrHindiStreamOption[]>([]);
  const [activePakStreamIdx, setActivePakStreamIdx] = useState<number>(0);
  const [isLoadingPakDrama, setIsLoadingPakDrama] = useState<boolean>(false);
  const [pakDramaQueryInput, setPakDramaQueryInput] = useState<string>('');
  const [pakDramaError, setPakDramaError] = useState<string | null>(null);

  // Source Health Verification Map
  const [sourceHealthMap, setSourceHealthMap] = useState<
    Record<string, SourceAvailabilityStatus | 'ok' | 'slow' | 'down'>
  >({});
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);

  // VidSrc.sh Content Info & Watch Progress
  const [vidsrcInfoState, setVidsrcInfoState] = useState<VidSrcContentInfoResult | null>(null);
  const [isLoadingVidsrcInfo, setIsLoadingVidsrcInfo] = useState<boolean>(false);
  const [vidsrcWatchProgress, setVidsrcWatchProgress] = useState<{
    currentTime: number;
    duration: number;
    watchedPercent: number;
    updatedAt: number;
  } | null>(() =>
    getVidSrcSavedProgress({
      tmdbId: movie.id,
      mediaType: movie.mediaType,
      season: 1,
      episode: 1,
    })
  );

  // Inline Admin Link Editor State
  const [showLinkEditor, setShowLinkEditor] = useState<boolean>(false);
  const [customDirectUrl, setCustomDirectUrl] = useState<string>(
    movieLink?.direct_video_url || ''
  );
  const [customHindiDubbedUrl, setCustomHindiDubbedUrl] = useState<string>(
    movieLink?.hindi_dubbed_video_url || ''
  );
  const [customUrduDubbedUrl, setCustomUrduDubbedUrl] = useState<string>(
    movieLink?.urdu_dubbed_video_url || ''
  );
  const [customEmbedUrl, setCustomEmbedUrl] = useState<string>(movieLink?.stream_url || '');
  const [customSubtitlesJson, setCustomSubtitlesJson] = useState<string>(
    movieLink?.subtitles && movieLink.subtitles.length > 0
      ? JSON.stringify(movieLink.subtitles)
      : ''
  );
  const [customIntroStart, setCustomIntroStart] = useState<string>(
    typeof movieLink?.intro_start === 'number' ? String(movieLink.intro_start) : ''
  );
  const [customIntroEnd, setCustomIntroEnd] = useState<string>(
    typeof movieLink?.intro_end === 'number' ? String(movieLink.intro_end) : ''
  );
  const [customLang, setCustomLang] = useState<string>(
    movieLink?.language || movie.language || 'English'
  );
  const [isSavingLink, setIsSavingLink] = useState<boolean>(false);
  const [linkSaveMessage, setLinkSaveMessage] = useState<string | null>(null);

  // Real VidSrc.sh AdBlocker State
  const [isVidSrcAdBlockerEnabled, setIsVidSrcAdBlockerEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cinebox_vidsrc_adblocker_v1');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [blockedAdsCount, setBlockedAdsCount] = useState<number>(0);
  const [adBlockToast, setAdBlockToast] = useState<string | null>(null);

  const handleToggleVidSrcAdBlocker = () => {
    setIsVidSrcAdBlockerEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cinebox_vidsrc_adblocker_v1', String(next));
      } catch {
        // ignore
      }
      setAdBlockToast(
        next
          ? '🛡️ VidSrc.sh AdBlocker Enabled — Popup Ads Blocked'
          : '⚠️ VidSrc.sh AdBlocker Disabled'
      );
      return next;
    });
  };

  useEffect(() => {
    if (!adBlockToast) return;
    const timer = setTimeout(() => setAdBlockToast(null), 3000);
    return () => clearTimeout(timer);
  }, [adBlockToast]);

  // Direct HTML5 & HLS Player State (No fake 596s default duration!)
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(90);
  const [brightness, setBrightness] = useState<number>(100);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [fitMode, setFitMode] = useState<'cover' | 'contain' | 'fill'>('contain');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(savedUserPlaybackPrefs.playbackSpeed);
  const savedNormalSpeedRef = useRef<number>(savedUserPlaybackPrefs.playbackSpeed);
  const [isPipActive, setIsPipActive] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [areControlsVisible, setAreControlsVisible] = useState<boolean>(true);
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subtitle State (Real .VTT / .SRT / HLS)
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(savedSubPrefs.enabled);
  const [selectedSubtitleLang, setSelectedSubtitleLang] = useState<string>(
    savedSubPrefs.preferredLang || savedUserPlaybackPrefs.preferredSubtitleLang || 'en'
  );
  const [subtitleDelayMs, setSubtitleDelayMs] = useState<number>(savedSubPrefs.delayMs);
  const [subtitleSize, setSubtitleSize] = useState<SubtitleFontSizeOption>(
    savedSubPrefs.fontSize
  );
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState<SubtitleBgOpacityOption>(
    savedSubPrefs.bgOpacity
  );
  const [customSubtitleText, setCustomSubtitleText] = useState<string | null>(null);

  const [activeDrawer, setActiveDrawer] = useState<
    'none' | 'language' | 'quality' | 'speed' | 'settings'
  >('none');
  const [activeQualityLabel, setActiveQualityLabel] = useState<DownloadQuality>(
    offlineDownload?.quality || '720p'
  );
  const [audioSwitchNotice, setAudioSwitchNotice] = useState<string | null>(null);

  const activeDirectSourceUrl =
    offlineDownload?.sourceUrl ||
    selectedAltStreamUrl ||
    plan.directVideoUrl ||
    plan.testFallbackMp4Url;

  // Automatic failover to next healthy source
  const handleTriggerAutoFailover = () => {
    failedEmbedServerIdsRef.current.add(selectedEmbedId);
    const nextHealthy = findNextHealthyEmbedSource(
      plan.embedServers,
      selectedEmbedId,
      sourceHealthMap,
      failedEmbedServerIdsRef.current
    );
    if (nextHealthy) {
      setSelectedEmbedId(nextHealthy.id);
      setPlayerMode('embed');
      const idx = plan.embedServers.findIndex((s) => s.id === nextHealthy.id);
      setAudioSwitchNotice(
        `Source unavailable — automatically switched to ${formatUserFriendlySourceLabel(idx >= 0 ? idx : 0)}`
      );
      setTimeout(() => setAudioSwitchNotice(null), 3200);
    }
  };

  // Weak mobile network HLS.js hook
  const {
    videoRef,
    hlsRef,
    pendingResumeTimeRef,
    pendingResumePlayRef,
    verifiedAudioTracks,
    setVerifiedAudioTracks,
    selectedAudioTrackId,
    setSelectedAudioTrackId,
    hlsQualityLevels,
    selectedHlsLevel,
    setSelectedHlsLevel,
    hlsSubtitleTracks,
    selectedHlsSubtitleId,
    selectHlsSubtitleTrack,
    isReconnecting,
    reconnectMessage,
  } = useHlsPlayer({
    playerMode,
    activeDirectSourceUrl,
    originalLanguageCode: movie.originalLanguageCode,
    preferredAudioLang: savedUserPlaybackPrefs.preferredAudioLang,
    preferredSubtitleLang: selectedSubtitleLang,
    playbackSpeed,
    isMuted,
    onFatalFailover: handleTriggerAutoFailover,
    onAudioSwitchNotice: setAudioSwitchNotice,
  });

  const scheduleControlsAutoHide = () => {
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
    controlsHideTimerRef.current = setTimeout(() => {
      setAreControlsVisible(false);
      controlsHideTimerRef.current = null;
    }, 3500);
  };

  const handleWakeOrToggleControls = (forceShow: boolean = false) => {
    if (forceShow) {
      setAreControlsVisible(true);
      scheduleControlsAutoHide();
      return;
    }
    setAreControlsVisible((prev) => {
      const next = !prev;
      if (next) {
        scheduleControlsAutoHide();
      } else if (controlsHideTimerRef.current) {
        clearTimeout(controlsHideTimerRef.current);
        controlsHideTimerRef.current = null;
      }
      return next;
    });
  };

  // Sync fullscreen & orientation
  useEffect(() => {
    const handleFullscreenChange = () => {
      const docAny = document as any;
      const activeFsEl = document.fullscreenElement || docAny.webkitFullscreenElement || null;
      if (activeFsEl) {
        setIsFullscreen(true);
        setAreControlsVisible(true);
        scheduleControlsAutoHide();
        lockScreenOrientationSafely('landscape').catch(() => {});

        const containerEl = playerContainerRef.current as any;
        if (
          containerEl &&
          activeFsEl !== containerEl &&
          containerEl.contains(activeFsEl) &&
          typeof containerEl.requestFullscreen === 'function'
        ) {
          containerEl.requestFullscreen().catch(() => {});
        }
      } else {
        setIsFullscreen(false);
        setAreControlsVisible(true);
        lockScreenOrientationSafely('portrait').catch(() => {});
      }
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setIsFullscreen(false);
        setAreControlsVisible(true);
        lockScreenOrientationSafely('portrait').catch(() => {});
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (controlsHideTimerRef.current) {
        clearTimeout(controlsHideTimerRef.current);
        controlsHideTimerRef.current = null;
      }
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      lockScreenOrientationSafely('portrait').catch(() => {});
      const docAny = document as any;
      if (document.fullscreenElement || docAny.webkitFullscreenElement) {
        try {
          if (typeof document.exitFullscreen === 'function') {
            document.exitFullscreen().catch(() => {});
          } else if (typeof docAny.webkitExitFullscreen === 'function') {
            docAny.webkitExitFullscreen();
          }
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Load link_health rows from Supabase on mount
  useEffect(() => {
    let active = true;
    fetchLinkHealthRowsForTmdb(movie.id)
      .then((rows) => {
        if (!active || rows.length === 0) return;
        setSourceHealthMap((prev) => {
          const next = { ...prev };
          for (const srv of plan.embedServers) {
            const match = rows.find((r) => r.source_url === srv.url);
            if (match && match.status !== 'unknown') {
              next[srv.id] = match.status;
            }
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [movie.id]);

  const audioCapability = evaluatePlayerAudioCapability({
    playerMode,
    activeDirectUrl: activeDirectSourceUrl,
    verifiedTracks: verifiedAudioTracks,
    alternateStreams: plan.alternateLanguageStreams,
  });

  const activeEmbeddedTrack =
    verifiedAudioTracks.find((t) => t.id === selectedAudioTrackId && !t.failed) ||
    verifiedAudioTracks.find((t) => !t.failed) ||
    null;

  const activeAlternateStream =
    plan.alternateLanguageStreams.find((s) => s.url === activeDirectSourceUrl) ||
    plan.alternateLanguageStreams[0] ||
    null;

  const loadPakDramaOrHindiStreams = async (
    overrideQuery?: string,
    episodeNum: number = selectedEpisode
  ) => {
    setIsLoadingPakDrama(true);
    setPakDramaError(null);
    const res = await searchPakDramaOrHindiStreams({
      title: movie.title,
      mediaType: movie.mediaType,
      episode: episodeNum,
      customQuery: overrideQuery,
      isPakDrama: isPakistaniOrUrduContent(movie),
    });
    setIsLoadingPakDrama(false);
    setPakDramaQueryInput(res.queryUsed);
    if (res.ok && res.streams.length > 0) {
      setPakDramaStreams(res.streams);
      setActivePakStreamIdx(0);
    } else {
      setPakDramaStreams([]);
      setPakDramaError(res.error || 'No full-length stream found.');
    }
  };

  useEffect(() => {
    const pakDetected = isPakistaniOrUrduContent(movie);
    const nextPlan = resolvePlaybackPlan(
      movie.id,
      movieLink,
      movie.mediaType,
      1,
      1,
      movie.originalLanguageCode,
      movie.youtubeKey
    );

    setPlayerMode(
      offlineDownload ? 'direct' : pakDetected ? 'pak-drama' : 'embed'
    );
    setSelectedEmbedId(movieLink?.stream_url ? 'custom-supabase' : 'auto-server-3');
    setSelectedAltStreamUrl(nextPlan.directVideoUrl);
    setSelectedSeason(1);
    setSelectedEpisode(1);
    setCustomDirectUrl(movieLink?.direct_video_url || '');
    setCustomHindiDubbedUrl(movieLink?.hindi_dubbed_video_url || '');
    setCustomUrduDubbedUrl(movieLink?.urdu_dubbed_video_url || '');
    setCustomEmbedUrl(movieLink?.stream_url || '');
    setCustomSubtitlesJson(
      movieLink?.subtitles && movieLink.subtitles.length > 0
        ? JSON.stringify(movieLink.subtitles)
        : ''
    );
    setCustomIntroStart(
      typeof movieLink?.intro_start === 'number' ? String(movieLink.intro_start) : ''
    );
    setCustomIntroEnd(
      typeof movieLink?.intro_end === 'number' ? String(movieLink.intro_end) : ''
    );
    setCustomLang(movieLink?.language || movie.language || 'English');
    setLinkSaveMessage(null);
    setActiveDrawer('none');
    failedEmbedServerIdsRef.current.clear();
    pendingResumeTimeRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    setVidsrcWatchProgress(
      getVidSrcSavedProgress({
        tmdbId: movie.id,
        mediaType: movie.mediaType,
        season: 1,
        episode: 1,
      })
    );
  }, [movie.id, offlineDownload, movieLink]);

  useEffect(() => {
    loadPakDramaOrHindiStreams(undefined, selectedEpisode);
  }, [movie.id, selectedEpisode]);

  const loadVidSrcContentInfo = async () => {
    setIsLoadingVidsrcInfo(true);
    const result = await fetchVidSrcContentInfo({
      tmdbId: movie.id,
      mediaType: movie.mediaType,
      season: selectedSeason,
      episode: selectedEpisode,
      fallbackTitle: movie.title,
      fallbackYear: movie.releaseYear,
      fallbackPoster: movie.posterUrl,
    });
    setVidsrcInfoState(result);
    setIsLoadingVidsrcInfo(false);

    if (!result.ok && !movieLink?.stream_url) {
      setSelectedEmbedId((prev) => (prev === 'auto-server-1' ? 'auto-server-3' : prev));
    }
  };

  useEffect(() => {
    let active = true;
    setVidsrcWatchProgress(
      getVidSrcSavedProgress({
        tmdbId: movie.id,
        mediaType: movie.mediaType,
        season: selectedSeason,
        episode: selectedEpisode,
      })
    );
    setIsLoadingVidsrcInfo(true);
    fetchVidSrcContentInfo({
      tmdbId: movie.id,
      mediaType: movie.mediaType,
      season: selectedSeason,
      episode: selectedEpisode,
      fallbackTitle: movie.title,
      fallbackYear: movie.releaseYear,
      fallbackPoster: movie.posterUrl,
    })
      .then((res) => {
        if (!active) return;
        setVidsrcInfoState(res);
        setIsLoadingVidsrcInfo(false);
        if (!res.ok && !movieLink?.stream_url) {
          setSelectedEmbedId((prev) => (prev === 'auto-server-1' ? 'auto-server-3' : prev));
        }
      })
      .catch(() => {
        if (!active) return;
        setIsLoadingVidsrcInfo(false);
      });
    return () => {
      active = false;
    };
  }, [movie.id, movie.mediaType, selectedSeason, selectedEpisode, movieLink?.stream_url]);

  // Listen for VidSrc.sh iframe PLAYER_EVENT messages and sync to Watch History + Supabase
  useEffect(() => {
    const handlePostMessage = (event: MessageEvent) => {
      const parsed = parseVidSrcPlayerEventMessage(event.data, event.origin);
      if (!parsed) return;

      const resolvedTmdbId = parsed.tmdbId && parsed.tmdbId > 0 ? parsed.tmdbId : movie.id;
      const resolvedMediaType = parsed.mediaType || movie.mediaType;
      const resolvedSeason =
        parsed.season || (movie.mediaType === 'tv' ? selectedSeason : 1);
      const resolvedEpisode =
        parsed.episode || (movie.mediaType === 'tv' ? selectedEpisode : 1);

      saveVidSrcPlayerProgress({
        tmdbId: resolvedTmdbId,
        mediaType: resolvedMediaType,
        season: resolvedSeason,
        episode: resolvedEpisode,
        currentTime: parsed.currentTime,
        duration: parsed.duration,
      });

      setVidsrcWatchProgress({
        currentTime: Math.round(parsed.currentTime),
        duration: Math.round(parsed.duration),
        watchedPercent:
          parsed.duration > 0
            ? Math.min(100, Math.max(1, Math.round((parsed.currentTime / parsed.duration) * 100)))
            : 0,
        updatedAt: Date.now(),
      });

      if (parsed.duration > 0) {
        reportPlaybackProgress(parsed.currentTime, parsed.duration);
      }
    };

    window.addEventListener('message', handlePostMessage);
    return () => {
      window.removeEventListener('message', handlePostMessage);
    };
  }, [movie, selectedSeason, selectedEpisode, reportPlaybackProgress]);

  const handleRunSourceHealthChecks = async () => {
    setIsCheckingHealth(true);
    const nextMap: Record<string, SourceAvailabilityStatus> = {};
    for (const src of plan.managedSources) {
      nextMap[src.id] = 'checking';
    }
    setSourceHealthMap({ ...nextMap });

    const results = await Promise.all(
      plan.managedSources.map((src) => checkStreamSourceHealth(src, 3500))
    );
    const finalMap: Record<string, SourceAvailabilityStatus> = {};
    for (const r of results) {
      finalMap[r.id] = r.availabilityStatus;
    }
    setSourceHealthMap(finalMap);
    setIsCheckingHealth(false);
  };

  const handleSelectVerifiedAudioTrack = (track: VerifiedAudioTrack) => {
    setAudioSwitchNotice(null);
    const switchResult = switchEmbeddedAudioTrackSafely({
      targetTrackId: track.id,
      previousTrackId: selectedAudioTrackId,
      availableTracks: verifiedAudioTracks,
      hlsInstance: hlsRef.current,
      videoElement: videoRef.current as any,
    });

    setSelectedAudioTrackId(switchResult.activeTrackId);
    saveUserPlaybackPreferences({ preferredAudioLang: track.lang }, activeUserId);

    if (!switchResult.ok) {
      setAudioSwitchNotice(
        switchResult.error || 'Audio track switch failed — reverted to previous track.'
      );
      setVerifiedAudioTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, failed: true } : t))
      );
    } else {
      setAudioSwitchNotice(`Switched audio to ${track.displayLabel}`);
      setTimeout(() => setAudioSwitchNotice(null), 2800);
    }
  };

  const handleSelectAlternateLanguageStream = (altStream: AlternateLanguageStream) => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.currentTime) && v.currentTime > 0) {
      pendingResumeTimeRef.current = v.currentTime;
      pendingResumePlayRef.current = !v.paused;
    }
    saveUserPlaybackPreferences({ preferredAudioLang: altStream.languageCode }, activeUserId);
    setSelectedAltStreamUrl(altStream.url);
    setPlayerMode('direct');
    setAudioSwitchNotice(`Switched stream source to ${altStream.label}`);
    setTimeout(() => setAudioSwitchNotice(null), 2800);
  };

  const handleSelectQualityOption = (levelIndex: number, directQuality?: DownloadQuality) => {
    if (hlsRef.current && hlsQualityLevels.length > 0) {
      hlsRef.current.currentLevel = levelIndex;
      setSelectedHlsLevel(levelIndex);
      setActiveDrawer('none');
      return;
    }

    if (directQuality) {
      const targetDl = plan.downloads.find((d) => d.quality === directQuality);
      if (targetDl && targetDl.url) {
        const v = videoRef.current;
        if (v && Number.isFinite(v.currentTime) && v.currentTime > 0) {
          pendingResumeTimeRef.current = v.currentTime;
          pendingResumePlayRef.current = !v.paused;
        }
        setActiveQualityLabel(directQuality);
        setSelectedAltStreamUrl(targetDl.url);
        setPlayerMode('direct');
      }
      setActiveDrawer('none');
    }
  };

  const handleTogglePlay = () => {
    if (isLocked) return;
    const videoEl = videoRef.current;
    if (videoEl) {
      if (videoEl.paused) {
        videoEl.play().catch(() => {});
        setIsPlaying(true);
      } else {
        videoEl.pause();
        setIsPlaying(false);
      }
    } else {
      setIsPlaying((prev) => !prev);
    }
  };

  const handleSeekOffset = (deltaSeconds: number) => {
    if (isLocked) return;
    const videoEl = videoRef.current;
    if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
      const nextTime = Math.max(0, Math.min(videoEl.duration, videoEl.currentTime + deltaSeconds));
      videoEl.currentTime = nextTime;
      setCurrentTime(nextTime);
    } else if (duration > 0) {
      setCurrentTime((prev) => Math.max(0, Math.min(duration, prev + deltaSeconds)));
    }
  };

  const handleSeekTo = (targetSeconds: number) => {
    if (isLocked) return;
    const clamped = Math.max(0, targetSeconds);
    setCurrentTime(clamped);
    if (videoRef.current && Number.isFinite(videoRef.current.duration)) {
      try {
        videoRef.current.currentTime = clamped;
      } catch {
        // ignore
      }
    }
  };

  const handleSelectSpeed = (spd: number) => {
    setPlaybackSpeed(spd);
    savedNormalSpeedRef.current = spd;
    saveUserPlaybackPreferences({ playbackSpeed: spd }, activeUserId);
    if (videoRef.current) {
      videoRef.current.playbackRate = spd;
    }
    setActiveDrawer('none');
  };

  const handleTemporarySpeedBoost = (active: boolean) => {
    const targetSpeed = active ? 2 : savedNormalSpeedRef.current || 1;
    setPlaybackSpeed(targetSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = targetSpeed;
    }
  };

  const handleCycleFitMode = () => {
    if (isLocked) return;
    setFitMode((prev) => (prev === 'cover' ? 'contain' : prev === 'contain' ? 'fill' : 'cover'));
  };

  const handleExitFullscreen = () => {
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
    setIsFullscreen(false);
    setAreControlsVisible(true);
    lockScreenOrientationSafely('portrait').catch(() => {});
    const docAny = document as any;
    try {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        document.exitFullscreen().catch(() => {});
      } else if (
        docAny.webkitFullscreenElement &&
        typeof docAny.webkitExitFullscreen === 'function'
      ) {
        docAny.webkitExitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const handleToggleFullscreen = () => {
    if (isLocked) return;
    if (isFullscreen) {
      handleExitFullscreen();
      return;
    }

    setIsFullscreen(true);
    setAreControlsVisible(true);
    scheduleControlsAutoHide();
    lockScreenOrientationSafely('landscape').catch(() => {});
    const el = playerContainerRef.current as any;
    if (!el) return;
    try {
      if (typeof el.requestFullscreen === 'function') {
        el.requestFullscreen().catch(() => {});
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        el.webkitRequestFullscreen();
      }
    } catch {
      // CSS fullscreen fallback active
    }
  };

  const handleTogglePictureInPicture = async () => {
    if (isLocked) return;
    const v = videoRef.current as any;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
      } else if (typeof v.requestPictureInPicture === 'function') {
        await v.requestPictureInPicture();
        setIsPipActive(true);
      }
    } catch {
      // PiP not supported
    }
  };

  const handleSaveInlineLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveCustomMovieLink) return;
    setIsSavingLink(true);
    setLinkSaveMessage(null);

    let parsedSubtitles: SubtitleTrackOption[] = movieLink?.subtitles || [];
    if (customSubtitlesJson.trim()) {
      try {
        parsedSubtitles = sanitizeSubtitleTracksList(JSON.parse(customSubtitlesJson));
      } catch {
        setIsSavingLink(false);
        setLinkSaveMessage('Invalid Subtitles JSON format. Expected [{"lang":"ur","label":"Urdu","url":"https://..."}]');
        return;
      }
    }

    const introStartVal = customIntroStart.trim() ? Number(customIntroStart.trim()) : null;
    const introEndVal = customIntroEnd.trim() ? Number(customIntroEnd.trim()) : null;

    const res = await onSaveCustomMovieLink({
      tmdb_id: movie.id,
      title: movie.title,
      language: customLang,
      direct_video_url: customDirectUrl.trim() || null,
      hindi_dubbed_video_url: customHindiDubbedUrl.trim() || null,
      urdu_dubbed_video_url: customUrduDubbedUrl.trim() || null,
      stream_url: customEmbedUrl.trim() || null,
      subtitles: parsedSubtitles,
      intro_start: Number.isFinite(introStartVal) ? introStartVal : null,
      intro_end: Number.isFinite(introEndVal) ? introEndVal : null,
    });
    setIsSavingLink(false);
    if (res.ok) {
      setLinkSaveMessage('Saved! Stream, subtitle tracks & intro markers are now active.');
      if (customDirectUrl.trim()) {
        setSelectedAltStreamUrl(customDirectUrl.trim());
        setPlayerMode('direct');
      } else if (customHindiDubbedUrl.trim()) {
        setSelectedAltStreamUrl(customHindiDubbedUrl.trim());
        setPlayerMode('direct');
      } else if (customEmbedUrl.trim()) {
        setSelectedEmbedId('custom-supabase');
        setPlayerMode('embed');
      }
    } else {
      setLinkSaveMessage(res.error || 'Failed to save link.');
    }
  };

  const activeEmbedServerIdx = Math.max(
    0,
    plan.embedServers.findIndex((s) => s.id === selectedEmbedId)
  );
  const activeEmbedServer = plan.embedServers[activeEmbedServerIdx] || plan.embedServers[0];
  const activeFriendlySourceName = formatUserFriendlySourceLabel(activeEmbedServerIdx);

  const cleanIframeAttrs = getCleanIframeAttributes(
    activeEmbedServer?.url,
    `${movie.title} - ${activeFriendlySourceName}`
  );

  const vidsrcIframeAttrs = getVidSrcPlayerIframeAttributes(
    activeEmbedServer?.url,
    `${movie.title} - ${activeFriendlySourceName}`,
    isVidSrcAdBlockerEnabled
  );

  const isCurrentServerVidSrc = isVidSrcProviderUrl(activeEmbedServer?.url);

  const vidsrcAdBlockCss = buildVidSrcAdBlockCssRules(
    isVidSrcAdBlockerEnabled,
    playerMode === 'embed' && isCurrentServerVidSrc
  );

  useEffect(() => {
    const cleanup = installVidSrcNetworkAdInterceptor({
      enabled: playerMode === 'embed' && isVidSrcAdBlockerEnabled,
      isVidSrcTarget: isCurrentServerVidSrc,
      onAdBlocked: (_blockedUrl, kind) => {
        setBlockedAdsCount((c) => c + 1);
        setAdBlockToast(`🛡️ VidSrc.sh Ad Blocked (${kind})`);
      },
    });
    return cleanup;
  }, [playerMode, isCurrentServerVidSrc, isVidSrcAdBlockerEnabled]);

  const displayPlayerTitle =
    movie.mediaType === 'tv'
      ? `${movie.title} — S${selectedSeason}:E${selectedEpisode}`
      : `${activeQualityLabel.toUpperCase()} ${movie.title}`;

  const fsConfig = getFullscreenPlayerConfig(isFullscreen, fitMode, areControlsVisible);
  const subtitleTracksList = sanitizeSubtitleTracksList(movieLink?.subtitles || []);
  const effectiveResumeSeconds =
    savedResumePosition > 0
      ? savedResumePosition
      : vidsrcWatchProgress?.currentTime || 0;
  const effectiveResumeDuration =
    savedDuration > 0 ? savedDuration : vidsrcWatchProgress?.duration || 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000000] text-slate-100 overflow-y-auto border-0 outline-none"
      style={{ backgroundColor: '#000000' }}
      role="dialog"
      aria-label={`Playing ${movie.title}`}
    >
      {/* Dynamic CSS Hiding Rules Layer for VidSrc.sh Adblocker */}
      {vidsrcAdBlockCss && (
        <style id="cinebox-vidsrc-adblocker-css" data-testid="vidsrc-adblocker-css-rules">
          {vidsrcAdBlockCss}
        </style>
      )}

      <div className="max-w-6xl mx-auto min-h-screen flex flex-col bg-[#000000] border-0 outline-none">
        {/* TOP PLAYER HEADER FOR EMBED / PAK-DRAMA / TRAILER MODES */}
        {!isFullscreen && playerMode === 'embed' && (
          <div
            data-testid="player-top-header-bar"
            className="sticky top-0 z-30 flex items-center justify-between gap-2 px-3 sm:px-5 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-2 bg-[#000000] border-0"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                data-testid="close-player-btn"
                onClick={onClose}
                aria-label="Back to catalog"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-white transition-colors shrink-0"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                <span className="text-xs sm:text-sm font-bold text-white truncate block">
                  {displayPlayerTitle}
                </span>
                <span className="text-[10px] sm:text-[11px] font-semibold text-[#10d97b] truncate block">
                  Playing on {activeFriendlySourceName} · Popup &amp; Ad Protection Active
                </span>
              </div>
            </div>

            <div className="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
              {plan.alternateLanguageStreams.length > 0 && (
                <button
                  type="button"
                  data-testid="switch-to-verified-direct-audio-btn"
                  onClick={() => {
                    setSelectedAltStreamUrl(plan.alternateLanguageStreams[0].url);
                    setPlayerMode('direct');
                  }}
                  className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-[#10d97b]/50 text-[#10d97b] text-[11px] sm:text-xs font-extrabold flex items-center gap-1.5 min-h-[36px] transition-colors"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Direct Stream ({plan.alternateLanguageStreams.length} Lang)</span>
                </button>
              )}

              <button
                type="button"
                role="switch"
                aria-checked={isVidSrcAdBlockerEnabled}
                aria-label="Adblocker toggle switch for VidSrc.sh"
                data-testid="vidsrc-adblocker-toggle-btn"
                onClick={handleToggleVidSrcAdBlocker}
                className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-extrabold shadow-md flex items-center gap-2 min-h-[36px] transition-all active:scale-95 border ${
                  isVidSrcAdBlockerEnabled
                    ? 'bg-emerald-950/95 hover:bg-emerald-900 border-[#10d97b] text-[#10d97b]'
                    : 'bg-slate-800/90 hover:bg-slate-700 border-slate-600 text-slate-300'
                }`}
              >
                {isVidSrcAdBlockerEnabled ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-[#10d97b] shrink-0" />
                ) : (
                  <ShieldOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                <span>Adblocker</span>
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                    isVidSrcAdBlockerEnabled ? 'bg-[#10d97b]' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-slate-950 transition-transform ${
                      isVidSrcAdBlockerEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </span>
                {blockedAdsCount > 0 && (
                  <span
                    data-testid="vidsrc-blocked-ads-badge"
                    className="px-1.5 py-0.5 rounded-full bg-[#10d97b] text-slate-950 text-[10px] font-black leading-none"
                  >
                    {blockedAdsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                data-testid="enter-fullscreen-btn"
                onClick={handleToggleFullscreen}
                aria-label="Enter Fullscreen"
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-[11px] sm:text-xs font-extrabold flex items-center gap-1.5 min-h-[36px] transition-transform active:scale-95"
              >
                <Maximize2 className="w-3.5 h-3.5 text-[#10d97b]" />
                <span>Fullscreen</span>
              </button>

              <a
                href={activeEmbedServer?.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-in-new-tab-btn"
                className="inline-flex px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#10d97b] via-[#22e58a] to-[#facc15] hover:opacity-95 text-slate-950 text-[11px] sm:text-xs font-extrabold shadow-lg shadow-[#10d97b]/25 items-center gap-1.5 min-h-[36px] transition-transform active:scale-95"
              >
                <ExternalLink className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Open in New Tab</span>
              </a>
            </div>
          </div>
        )}

        {!isFullscreen && playerMode === 'pak-drama' && (
          <div
            data-testid="player-top-header-bar"
            className="sticky top-0 z-30 flex items-center justify-between gap-2 px-3 sm:px-5 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-2 bg-[#000000] border-0"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                data-testid="close-player-btn"
                onClick={onClose}
                aria-label="Back to catalog"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-white transition-colors shrink-0"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                <span className="text-xs sm:text-sm font-bold text-white truncate block">
                  {pakDramaStreams[activePakStreamIdx]?.title || displayPlayerTitle}
                </span>
                <span className="text-[10px] sm:text-[11px] font-semibold text-[#10d97b] truncate block">
                  Pak Drama &amp; Hindi Stream ·{' '}
                  {pakDramaStreams[activePakStreamIdx]
                    ? `Duration: ${pakDramaStreams[activePakStreamIdx].durationFormatted}`
                    : 'Searching Full Episode / Hindi Stream...'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="enter-fullscreen-btn"
                onClick={handleToggleFullscreen}
                aria-label="Enter Fullscreen"
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-[11px] sm:text-xs font-extrabold flex items-center gap-1.5 min-h-[36px]"
              >
                <Maximize2 className="w-3.5 h-3.5 text-[#10d97b]" />
                <span>Fullscreen</span>
              </button>
            </div>
          </div>
        )}

        {!isFullscreen && playerMode === 'trailer' && movie.youtubeKey && (
          <div
            data-testid="player-top-header-bar"
            className="sticky top-0 z-30 flex items-center justify-between gap-2 px-3 sm:px-4 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-2 bg-[#000000] border-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                data-testid="close-player-btn"
                onClick={onClose}
                aria-label="Back to catalog"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-white transition-colors shrink-0"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-xs sm:text-sm font-bold text-white truncate">
                {movie.youtubeTitle || `${movie.title} — Official TMDb Video`}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedEmbedId('auto-server-3');
                setPlayerMode('embed');
              }}
              className="px-3 py-1.5 rounded-lg bg-[#10d97b] text-slate-950 text-xs font-bold transition-colors shrink-0"
            >
              Back to Source 1
            </button>
          </div>
        )}

        {/* ===================================================================
            HYBRID VIDEO PLAYER SURFACE
           =================================================================== */}
        <div
          ref={playerContainerRef}
          data-testid="video-player-surface-container"
          onClick={() => {
            if (isFullscreen) {
              handleWakeOrToggleControls(false);
            }
          }}
          className={fsConfig.containerClassName}
          style={{ filter: `brightness(${brightness}%)`, backgroundColor: '#000000' }}
        >
          {isFullscreen && !areControlsVisible && (
            <div
              data-testid="fullscreen-top-wake-strip"
              onClick={(e) => {
                e.stopPropagation();
                handleWakeOrToggleControls(true);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                handleWakeOrToggleControls(true);
              }}
              className="fixed top-0 left-0 right-0 h-14 z-[9999] bg-transparent cursor-pointer"
              aria-label="Tap to show fullscreen controls and exit button"
            />
          )}

          {fsConfig.showAlwaysVisibleExitButton && (
            <>
              <button
                type="button"
                data-testid="fullscreen-exit-back-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExitFullscreen();
                }}
                aria-label="Exit Fullscreen"
                className={fsConfig.exitButtonClassName}
              >
                <ChevronLeft className="w-4 h-4 text-[#10d97b] stroke-[2.5]" />
                <span>Back / Exit Fullscreen</span>
              </button>

              <button
                type="button"
                data-testid="fullscreen-exit-corner-x-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExitFullscreen();
                }}
                aria-label="Close Fullscreen"
                className={`fixed top-[max(0.75rem,env(safe-area-inset-top,12px))] right-[max(0.75rem,env(safe-area-inset-right,12px))] z-[10000] w-10 h-10 rounded-full bg-black/85 hover:bg-black border border-white/20 text-white flex items-center justify-center shadow-2xl backdrop-blur-md transition-all duration-200 active:scale-95 ${
                  areControlsVisible
                    ? 'opacity-100 pointer-events-auto translate-y-0'
                    : 'opacity-0 pointer-events-none -translate-y-2'
                }`}
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </>
          )}

          {playerMode === 'trailer' && movie.youtubeKey ? (
            <div className="relative w-full h-full bg-[#000000]">
              <iframe
                key={movie.youtubeKey}
                src={`https://www.youtube.com/embed/${movie.youtubeKey}?autoplay=1&rel=0&modestbranding=1`}
                title={`${movie.title} Official TMDb Video`}
                className="w-full h-full border-0 bg-[#000000]"
                style={{ backgroundColor: '#000000' }}
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : playerMode === 'pak-drama' ? (
            <div className="relative w-full h-full bg-[#000000] flex items-center justify-center">
              {isLoadingPakDrama ? (
                <div className="flex flex-col items-center gap-2 text-center p-4">
                  <Loader2 className="w-9 h-9 text-[#10d97b] animate-spin" />
                  <span className="text-xs font-bold text-white">
                    Loading Full Episode / Hindi Dubbed Stream for &ldquo;{movie.title}&rdquo;...
                  </span>
                </div>
              ) : pakDramaStreams[activePakStreamIdx] ? (
                <iframe
                  key={pakDramaStreams[activePakStreamIdx].embedUrl}
                  data-testid="pak-drama-iframe-player"
                  src={pakDramaStreams[activePakStreamIdx].embedUrl}
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  title={pakDramaStreams[activePakStreamIdx].title}
                  className="w-full h-full border-0 bg-[#000000]"
                  style={{ backgroundColor: '#000000' }}
                />
              ) : (
                <div className="text-center p-6 space-y-2 max-w-md">
                  <div className="text-sm font-bold text-amber-300">
                    {pakDramaError || 'No stream found for this query.'}
                  </div>
                  <p className="text-xs text-slate-400">
                    Use the search bar below the player to search any Episode number, or switch to Source 1.
                  </p>
                </div>
              )}
            </div>
          ) : playerMode === 'embed' ? (
            <div
              data-vidsrc-adblock={
                vidsrcIframeAttrs.isVidSrcAdBlockerActive ? 'active' : 'inactive'
              }
              className="relative w-full h-full bg-[#000000]"
            >
              {adBlockToast && (
                <div
                  data-testid="vidsrc-adblock-toast"
                  className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-black/90 border border-[#10d97b] text-xs font-extrabold text-[#10d97b] shadow-xl pointer-events-none"
                >
                  {adBlockToast}
                </div>
              )}

              {vidsrcIframeAttrs.isVidSrcAdBlockerActive && (
                <div
                  data-testid="vidsrc-click-shield-layer"
                  className="absolute inset-0 z-30 pointer-events-none select-none"
                  aria-hidden="true"
                >
                  <div
                    data-testid="vidsrc-shield-zone-top"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setBlockedAdsCount((c) => c + 1);
                      setAdBlockToast('🛡️ VidSrc.sh Popup Ad Click Blocked (clickjack-shield)');
                    }}
                    className="absolute top-0 left-0 right-[240px] h-[26%] pointer-events-auto cursor-default"
                  />
                  <div
                    data-testid="vidsrc-shield-zone-left"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setBlockedAdsCount((c) => c + 1);
                      setAdBlockToast('🛡️ VidSrc.sh Popup Ad Click Blocked (clickjack-shield)');
                    }}
                    className="absolute top-[26%] bottom-[60px] left-0 w-[22%] pointer-events-auto cursor-default"
                  />
                  <div
                    data-testid="vidsrc-shield-zone-right"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setBlockedAdsCount((c) => c + 1);
                      setAdBlockToast('🛡️ VidSrc.sh Popup Ad Click Blocked (clickjack-shield)');
                    }}
                    className="absolute top-[52px] bottom-[60px] right-0 w-[22%] pointer-events-auto cursor-default"
                  />
                  <div
                    data-testid="vidsrc-shield-zone-lower"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setBlockedAdsCount((c) => c + 1);
                      setAdBlockToast('🛡️ VidSrc.sh Popup Ad Click Blocked (clickjack-shield)');
                    }}
                    className="absolute top-[72%] bottom-[60px] left-[22%] right-[22%] pointer-events-auto cursor-default"
                  />
                </div>
              )}

              <iframe
                key={`${cleanIframeAttrs.src}::adblock-${vidsrcIframeAttrs.isVidSrcAdBlockerActive ? 'on' : 'off'}`}
                data-testid="embed-iframe-player"
                data-vidsrc-iframe={vidsrcIframeAttrs.isVidSrcTarget ? 'true' : 'false'}
                data-adblock-policy={vidsrcIframeAttrs.sandbox || 'none'}
                src={cleanIframeAttrs.src}
                allowFullScreen={cleanIframeAttrs.allowFullScreen}
                onError={handleTriggerAutoFailover}
                title={cleanIframeAttrs.title}
                className="w-full h-full border-0 bg-[#000000]"
                style={{ backgroundColor: '#000000' }}
              />
            </div>
          ) : (
            /* DIRECT NATIVE HTML5 + HLS PLAYER MODULAR STACK */
            <>
              <video
                ref={videoRef}
                data-testid="native-html5-video"
                playsInline
                poster={movie.backdropUrl}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  setCurrentTime(v.currentTime);
                  if (Number.isFinite(v.duration) && v.duration > 0) {
                    setDuration(v.duration);
                    reportPlaybackProgress(v.currentTime, v.duration);
                  }
                }}
                onEnded={() => {
                  setIsPlaying(false);
                  if (movie.mediaType === 'tv' && selectedEpisode < episodeCount) {
                    startNextEpisodeCountdown();
                  }
                }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (Number.isFinite(v.duration) && v.duration > 0) {
                    setDuration(v.duration);
                  }
                  if (
                    pendingResumeTimeRef.current !== null &&
                    Number.isFinite(pendingResumeTimeRef.current) &&
                    pendingResumeTimeRef.current > 0
                  ) {
                    try {
                      v.currentTime = pendingResumeTimeRef.current;
                    } catch {
                      // ignore
                    }
                    const shouldPlay = pendingResumePlayRef.current;
                    pendingResumeTimeRef.current = null;
                    if (shouldPlay) {
                      v.play()
                        .then(() => setIsPlaying(true))
                        .catch(() => {});
                    } else {
                      v.pause();
                      setIsPlaying(false);
                    }
                  }
                }}
                className={`relative z-10 w-full h-full bg-black ${
                  fitMode === 'cover'
                    ? 'object-cover'
                    : fitMode === 'contain'
                    ? 'object-contain'
                    : 'object-fill'
                }`}
              />

              {/* Gesture Layer (Double-tap seek, Vertical swipe brightness/volume, Long-press 2x, Pinch fitMode, Keyboard shortcuts) */}
              <PlayerGestures
                enabled={playerMode === 'direct'}
                isLocked={isLocked}
                brightness={brightness}
                volume={volume}
                playbackSpeed={playbackSpeed}
                onSeekOffset={handleSeekOffset}
                onChangeBrightness={setBrightness}
                onChangeVolume={(nextVol) => {
                  setVolume(nextVol);
                  setIsMuted(nextVol === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = nextVol / 100;
                    videoRef.current.muted = nextVol === 0;
                  }
                }}
                onTemporarySpeedBoost={handleTemporarySpeedBoost}
                onCycleFitMode={handleCycleFitMode}
                onTogglePlay={handleTogglePlay}
                onToggleFullscreen={handleToggleFullscreen}
                onToggleMute={() =>
                  setIsMuted((m) => {
                    const next = !m;
                    if (videoRef.current) videoRef.current.muted = next;
                    return next;
                  })
                }
                onToggleSubtitles={() => {
                  const next = !subtitlesEnabled;
                  setSubtitlesEnabled(next);
                  saveSubtitlePreferences({ enabled: next }, activeUserId);
                }}
                onWakeControls={() => handleWakeOrToggleControls(true)}
              />

              {/* Real .VTT / .SRT Subtitle Layer with RTL Urdu Nastaliq support */}
              <SubtitleLayer
                subtitlesEnabled={subtitlesEnabled}
                subtitleTracks={subtitleTracksList}
                selectedSubtitleLang={selectedSubtitleLang}
                currentTime={currentTime}
                subtitleDelayMs={subtitleDelayMs}
                subtitleSize={subtitleSize}
                subtitleBgOpacity={subtitleBgOpacity}
                customSubtitleText={customSubtitleText}
              />

              {/* Modular Player Controls & Drawers */}
              <PlayerControls
                movieTitle={movie.title}
                moviePosterUrl={movie.posterUrl}
                displayPlayerTitle={displayPlayerTitle}
                statusSubline={
                  offlineDownload
                    ? `Offline Playback (${offlineDownload.fileSizeMB}MB)`
                    : activeAlternateStream
                    ? `Active Stream: ${activeAlternateStream.label} (${activeAlternateStream.format.toUpperCase()})`
                    : activeEmbeddedTrack
                    ? `Verified Audio: ${activeEmbeddedTrack.displayLabel}`
                    : 'CineBox Direct HTML5 / HLS Stream Active'
                }
                areControlsVisible={areControlsVisible}
                isLocked={isLocked}
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                isMuted={isMuted}
                volume={volume}
                brightness={brightness}
                playbackSpeed={playbackSpeed}
                fitMode={fitMode}
                isFullscreen={isFullscreen}
                isPipActive={isPipActive}
                bottomControlsSafePaddingClass={fsConfig.bottomControlsSafePaddingClass}
                activeDrawer={activeDrawer}
                isReconnecting={isReconnecting}
                reconnectMessage={reconnectMessage}
                showSkipIntro={canShowSkipIntro(currentTime)}
                introEndSeconds={movieLink?.intro_end}
                nextEpisodeCountdown={nextEpisodeCountdown}
                nextEpisodeNumber={selectedEpisode + 1}
                audioSwitchNotice={audioSwitchNotice}
                verifiedAudioTracks={verifiedAudioTracks}
                selectedAudioTrackId={selectedAudioTrackId}
                alternateLanguageStreams={plan.alternateLanguageStreams}
                activeDirectSourceUrl={activeDirectSourceUrl}
                hlsQualityLevels={hlsQualityLevels}
                selectedHlsLevel={selectedHlsLevel}
                activeQualityLabel={activeQualityLabel}
                hlsSubtitleTracks={hlsSubtitleTracks}
                selectedHlsSubtitleId={selectedHlsSubtitleId}
                subtitleTracks={subtitleTracksList}
                subtitlesEnabled={subtitlesEnabled}
                selectedSubtitleLang={selectedSubtitleLang}
                subtitleDelayMs={subtitleDelayMs}
                subtitleSize={subtitleSize}
                subtitleBgOpacity={subtitleBgOpacity}
                videoRef={videoRef}
                onClose={onClose}
                onToggleLock={() => {
                  setIsLocked((prev) => !prev);
                  setActiveDrawer('none');
                }}
                onTogglePlay={handleTogglePlay}
                onSeekOffset={handleSeekOffset}
                onSeekTo={handleSeekTo}
                onToggleMute={() =>
                  setIsMuted((m) => {
                    const next = !m;
                    if (videoRef.current) videoRef.current.muted = next;
                    return next;
                  })
                }
                onChangeVolume={(v) => {
                  setVolume(v);
                  setIsMuted(v === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = v / 100;
                    videoRef.current.muted = v === 0;
                  }
                }}
                onChangeBrightness={setBrightness}
                onTogglePip={handleTogglePictureInPicture}
                onSetActiveDrawer={setActiveDrawer}
                onSelectVerifiedAudioTrack={handleSelectVerifiedAudioTrack}
                onSelectAlternateLanguageStream={handleSelectAlternateLanguageStream}
                onSelectQualityOption={handleSelectQualityOption}
                onSelectSpeed={handleSelectSpeed}
                onCycleFitMode={handleCycleFitMode}
                onToggleFullscreen={handleToggleFullscreen}
                onToggleSubtitlesEnabled={(enabled) => {
                  setSubtitlesEnabled(enabled);
                  saveSubtitlePreferences({ enabled }, activeUserId);
                }}
                onSelectSubtitleLang={(lang) => {
                  setSelectedSubtitleLang(lang);
                  saveSubtitlePreferences({ preferredLang: lang, enabled: true }, activeUserId);
                  saveUserPlaybackPreferences({ preferredSubtitleLang: lang }, activeUserId);
                }}
                onSelectHlsSubtitleTrack={selectHlsSubtitleTrack}
                onChangeSubtitleDelay={(delayMs) => {
                  setSubtitleDelayMs(delayMs);
                  saveSubtitlePreferences({ delayMs }, activeUserId);
                }}
                onChangeSubtitleSize={(fontSize) => {
                  setSubtitleSize(fontSize);
                  saveSubtitlePreferences({ fontSize }, activeUserId);
                }}
                onChangeSubtitleBgOpacity={(bgOpacity) => {
                  setSubtitleBgOpacity(bgOpacity);
                  saveSubtitlePreferences({ bgOpacity }, activeUserId);
                }}
                onLoadCustomSubtitleText={setCustomSubtitleText}
                onPlayNextEpisodeNow={playNextEpisodeImmediately}
                onCancelNextEpisode={cancelNextEpisodeCountdown}
              />
            </>
          )}
        </div>

        {/* ===================================================================
            BELOW-PLAYER CONTROLS: VIDSRC METADATA, SOURCE PICKER, EPISODES
           =================================================================== */}
        <div className="flex-1 px-3 sm:px-6 py-4 sm:py-5 pb-16 space-y-4 sm:space-y-5">
          {/* VidSrc.sh Content Info & Watch Progress Resume Bar */}
          <div
            data-testid="vidsrc-integration-panel"
            className="p-3 sm:p-3.5 rounded-2xl bg-[#111622] border border-slate-800/90 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-[#10d97b]/15 border border-[#10d97b]/40 text-[10px] font-extrabold text-[#10d97b] uppercase tracking-wider">
                  Stream Status
                </span>
                <span className="text-xs font-bold text-slate-200">
                  Active: {playerMode === 'embed' ? activeFriendlySourceName : 'Direct Stream'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="switch-vidsrc-sh-btn"
                  onClick={() => {
                    setSelectedEmbedId('auto-server-1');
                    setPlayerMode('embed');
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors ${
                    playerMode === 'embed' && selectedEmbedId === 'auto-server-1'
                      ? 'bg-[#10d97b] text-slate-950'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                >
                  Source 2 (EN Subtitles)
                </button>

                <button
                  type="button"
                  data-testid="switch-2embed-fallback-btn"
                  onClick={() => {
                    setSelectedEmbedId('auto-server-3');
                    setPlayerMode('embed');
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors ${
                    playerMode === 'embed' && selectedEmbedId === 'auto-server-3'
                      ? 'bg-[#10d97b] text-slate-950'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                >
                  Source 1 (Primary)
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={isVidSrcAdBlockerEnabled}
                  data-testid="vidsrc-panel-adblocker-switch"
                  onClick={handleToggleVidSrcAdBlocker}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold flex items-center gap-1.5 border transition-colors ${
                    isVidSrcAdBlockerEnabled
                      ? 'bg-emerald-950/90 border-[#10d97b] text-[#10d97b]'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Adblocker: {isVidSrcAdBlockerEnabled ? 'ON' : 'OFF'}</span>
                </button>

                <a
                  href={buildVidSrcEmbedUrl({
                    tmdbId: movie.id,
                    mediaType: movie.mediaType,
                    season: selectedSeason,
                    episode: selectedEpisode,
                    dsLang: 'en',
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="prominent-open-new-tab-btn"
                  className="px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-[#10d97b]/50 text-[#10d97b] text-[11px] font-bold flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open in New Tab</span>
                </a>
              </div>
            </div>

            {isLoadingVidsrcInfo && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                <Loader2 className="w-3.5 h-3.5 text-[#10d97b] animate-spin" />
                <span>Checking stream availability...</span>
              </div>
            )}

            {!isLoadingVidsrcInfo && vidsrcInfoState?.ok && vidsrcInfoState.info && (
              <div
                data-testid="vidsrc-content-info-bar"
                className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#161c2b] border border-emerald-500/30"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={vidsrcInfoState.info.poster || movie.posterUrl}
                    alt={vidsrcInfoState.info.title || movie.title}
                    referrerPolicy="no-referrer"
                    className="w-10 h-14 rounded-lg object-cover bg-slate-900 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-extrabold text-white truncate">
                      {vidsrcInfoState.info.title || movie.title}
                    </div>
                    <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-2 mt-0.5">
                      <span>Year: {vidsrcInfoState.info.year || movie.releaseYear}</span>
                      <span>·</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#10d97b]/20 text-[#10d97b] font-extrabold text-[10px]">
                        Quality: {vidsrcInfoState.info.quality || 'HD'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!isLoadingVidsrcInfo && vidsrcInfoState?.notAvailable && (
              <div
                data-testid="vidsrc-not-available-banner"
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-950/50 border border-amber-500/40"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <div className="text-xs font-bold text-amber-200">
                    Source 2 unavailable (404) — Automatic Failover to Source 1 Active
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadVidSrcContentInfo}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-[11px] font-bold flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Recheck</span>
                </button>
              </div>
            )}

            {effectiveResumeSeconds > 0 && (
              <div
                data-testid="vidsrc-watch-progress-bar"
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-950/40 border border-[#10d97b]/30 text-xs"
              >
                <div className="flex items-center gap-2 text-emerald-200 font-semibold">
                  <Check className="w-3.5 h-3.5 text-[#10d97b]" />
                  <span>
                    Saved Watch Progress: {formatPlayerTimecode(effectiveResumeSeconds)}
                    {effectiveResumeDuration > 0
                      ? ` / ${formatPlayerTimecode(effectiveResumeDuration)}`
                      : ''}
                  </span>
                </div>
                {playerMode === 'direct' && (
                  <button
                    type="button"
                    data-testid="resume-playback-btn"
                    onClick={() => handleSeekTo(effectiveResumeSeconds)}
                    className="px-2.5 py-1 rounded-lg bg-[#10d97b] text-slate-950 font-extrabold text-[11px]"
                  >
                    Resume Here
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Modular SourcePicker ("Source 1", "Source 2", "Source 3" + Health Dots + Auto-Failover) */}
          <div className="bg-[#131722] border border-slate-800/90 rounded-2xl p-3 sm:p-3.5 space-y-3">
            <SourcePicker
              movieId={movie.id}
              mediaType={movie.mediaType}
              selectedSeason={selectedSeason}
              selectedEpisode={selectedEpisode}
              isPakDrama={isPakDrama}
              playerMode={playerMode}
              selectedEmbedId={selectedEmbedId}
              embedServers={plan.embedServers}
              alternateLanguageStreams={plan.alternateLanguageStreams}
              activeDirectSourceUrl={activeDirectSourceUrl}
              sourceHealthMap={sourceHealthMap}
              isCheckingHealth={isCheckingHealth}
              isAdminUnlocked={isAdminUnlocked}
              showLinkEditor={showLinkEditor}
              youtubeKey={movie.youtubeKey}
              activeEmbedUrl={activeEmbedServer?.url}
              onRunHealthChecks={handleRunSourceHealthChecks}
              onToggleLinkEditor={() => setShowLinkEditor((prev) => !prev)}
              onSelectAlternateStream={handleSelectAlternateLanguageStream}
              onSelectPakDramaServer={() => {
                setPlayerMode('pak-drama');
                if (pakDramaStreams.length === 0 && !isLoadingPakDrama) {
                  loadPakDramaOrHindiStreams(undefined, selectedEpisode);
                }
              }}
              onSelectEmbedServer={(serverId) => {
                setSelectedEmbedId(serverId);
                setPlayerMode('embed');
              }}
              onSelectTrailer={() => setPlayerMode('trailer')}
              onTriggerAutoFailover={handleTriggerAutoFailover}
            />

            {/* Honest Audio Capability Banner */}
            <div
              data-testid="honest-audio-capability-banner"
              className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 flex items-start gap-2"
            >
              <Info className="w-4 h-4 text-[#10d97b] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-semibold text-slate-200">
                  Audio System Status ({audioCapability.mode.toUpperCase()}):
                </div>
                <p className="text-slate-400 leading-relaxed">
                  {audioCapability.honestStatusMessage}
                </p>
              </div>
            </div>

            {/* Pak Drama & Hindi Dubbed Stream Finder Panel */}
            {playerMode === 'pak-drama' && (
              <div
                data-testid="pak-drama-stream-selector-panel"
                className="p-3 rounded-xl bg-[#0b101b] border border-[#10d97b]/40 space-y-2.5"
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    loadPakDramaOrHindiStreams(pakDramaQueryInput, selectedEpisode);
                  }}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <input
                    type="text"
                    data-testid="pak-drama-custom-query-input"
                    value={pakDramaQueryInput}
                    onChange={(e) => setPakDramaQueryInput(e.target.value)}
                    placeholder="Search e.g. Dar e Nijaat Episode 1, Kabhi Main Kabhi Tum Ep 1..."
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:border-[#10d97b] focus:outline-none"
                  />
                  <button
                    type="submit"
                    data-testid="pak-drama-search-submit-btn"
                    className="px-4 py-2 rounded-lg bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-bold text-xs shrink-0"
                  >
                    Find Episode / Stream
                  </button>
                </form>

                {pakDramaStreams.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-300">
                      Available Full-Length Streams ({pakDramaStreams.length} found):
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                      {pakDramaStreams.slice(0, 8).map((st, idx) => (
                        <button
                          key={st.id}
                          type="button"
                          data-testid={`pak-drama-stream-option-${idx}`}
                          onClick={() => setActivePakStreamIdx(idx)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-left truncate max-w-xs border transition-colors ${
                            activePakStreamIdx === idx
                              ? 'bg-[#10d97b] text-slate-950 border-[#10d97b] font-bold'
                              : 'bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-600'
                          }`}
                        >
                          #{idx + 1}: {st.title.slice(0, 42)} ({st.durationFormatted})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Inline Admin Stream, Subtitle & Skip-Intro Editor */}
            {showLinkEditor && (
              <form
                onSubmit={handleSaveInlineLink}
                className="mt-3 p-4 rounded-xl bg-[#0b0e16] border border-[#10d97b]/40 space-y-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#10d97b]" />
                      <span>
                        Attach Direct HLS/MP4, Real Subtitles (.VTT/.SRT) &amp; Skip-Intro Markers
                      </span>
                    </h4>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-300 block">
                    1-Click Test Presets:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {PLAYABLE_HD_STREAMS_POOL.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setCustomDirectUrl(preset.mp4_720p);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-[#10d97b] font-semibold"
                      >
                        + {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <label className="block text-slate-300 font-semibold mb-1">
                      Primary Direct Video URL (<code>.mp4</code> or Multi-Audio <code>.m3u8</code>):
                    </label>
                    <input
                      type="url"
                      value={customDirectUrl}
                      onChange={(e) => setCustomDirectUrl(e.target.value)}
                      placeholder="https://your-cdn.com/movies/master.m3u8"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Separate Hindi Dubbed Stream URL:
                    </label>
                    <input
                      type="url"
                      value={customHindiDubbedUrl}
                      onChange={(e) => setCustomHindiDubbedUrl(e.target.value)}
                      placeholder="https://your-cdn.com/movies/movie-hindi.m3u8"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Separate Urdu Dubbed Stream URL:
                    </label>
                    <input
                      type="url"
                      value={customUrduDubbedUrl}
                      onChange={(e) => setCustomUrduDubbedUrl(e.target.value)}
                      placeholder="https://your-cdn.com/movies/movie-urdu.mp4"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Intro Start (seconds, for Skip Intro):
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={customIntroStart}
                      onChange={(e) => setCustomIntroStart(e.target.value)}
                      placeholder="e.g. 15"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Intro End (seconds, for Skip Intro):
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={customIntroEnd}
                      onChange={(e) => setCustomIntroEnd(e.target.value)}
                      placeholder="e.g. 85"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-slate-300 font-semibold mb-1">
                      Subtitles JSON (<code>[{`{"lang":"ur","label":"Urdu","url":"https://.../sub.srt"}`}]</code>):
                    </label>
                    <input
                      type="text"
                      value={customSubtitlesJson}
                      onChange={(e) => setCustomSubtitlesJson(e.target.value)}
                      placeholder='[{"lang":"en","label":"English","url":"https://example.com/en.vtt"},{"lang":"ur","label":"Urdu","url":"https://example.com/ur.srt"}]'
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  {linkSaveMessage && (
                    <span className="text-xs font-semibold text-[#10d97b]">{linkSaveMessage}</span>
                  )}
                  <button
                    type="submit"
                    disabled={isSavingLink}
                    className="ml-auto px-4 py-2 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSavingLink ? 'Saving...' : 'Save Link to Supabase & Play Now'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* TV Series Season & Episode Selector */}
            {movie.mediaType === 'tv' && (
              <div
                data-testid="tv-season-episode-bar"
                className="pt-2 border-t border-slate-800/80 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Tv className="w-4 h-4 text-[#10d97b]" />
                    <span>Select Season &amp; Episode</span>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    {seasonsList.map((s) => (
                      <button
                        key={s.seasonNumber}
                        type="button"
                        onClick={() => {
                          setSelectedSeason(s.seasonNumber);
                          setSelectedEpisode(1);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                          selectedSeason === s.seasonNumber
                            ? 'bg-white text-slate-950 font-bold'
                            : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        Season {s.seasonNumber}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {Array.from({ length: episodeCount }, (_, i) => i + 1).map((epNum) => (
                    <button
                      key={epNum}
                      type="button"
                      onClick={() => setSelectedEpisode(epNum)}
                      className={`min-w-[44px] py-1.5 px-2.5 rounded-lg text-xs font-mono font-semibold shrink-0 transition-colors ${
                        selectedEpisode === epNum
                          ? 'bg-[#10d97b] text-slate-950 font-bold'
                          : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      Ep {epNum}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Movie/Series Metadata, TMDB Watch Providers & VidSrc.sh AdBlocker Shield */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                    {movie.title}
                  </h1>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-400">
                    <span className="text-[#10d97b] font-semibold">★ {movie.rating.toFixed(1)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{movie.releaseYear}</span>
                    <span aria-hidden="true">·</span>
                    <span>{movie.runtime}</span>
                    <span aria-hidden="true">·</span>
                    <span title="TMDB Original Language (Informational)">
                      Orig. Language: {movie.language}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{movie.genres.join(' / ')}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onToggleWatchlist(movie)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 min-h-[44px] shrink-0 border transition-colors ${
                    isInWatchlist
                      ? 'bg-[#10d97b]/15 border-[#10d97b] text-[#10d97b]'
                      : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
                  }`}
                >
                  {isInWatchlist ? (
                    <>
                      <BookmarkCheck className="w-4 h-4" />
                      <span>In Watchlist</span>
                    </>
                  ) : (
                    <>
                      <Bookmark className="w-4 h-4" />
                      <span>+ Watchlist</span>
                    </>
                  )}
                </button>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">{movie.overview}</p>

              {movie.watchProviders && movie.watchProviders.length > 0 && (
                <div
                  data-testid="tmdb-watch-providers-section"
                  className="p-3.5 rounded-2xl bg-[#111520] border border-slate-800/90 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-200">
                      Official Streaming Availability (TMDB Watch Providers · Informational)
                    </span>
                    {movie.watchProvidersLink && (
                      <a
                        href={movie.watchProvidersLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[#10d97b] hover:underline flex items-center gap-1"
                      >
                        <span>View on TMDB</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {movie.watchProviders.map((wp) => (
                      <div
                        key={wp.providerId}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2 text-xs text-slate-200"
                      >
                        {wp.logoUrl && (
                          <img
                            src={wp.logoUrl}
                            alt={wp.providerName}
                            referrerPolicy="no-referrer"
                            className="w-5 h-5 rounded object-cover"
                          />
                        )}
                        <span className="font-medium">{wp.providerName}</span>
                        <span className="text-[10px] font-mono uppercase text-slate-400">
                          ({wp.type})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {movie.cast && movie.cast.length > 0 && (
                <div className="pt-2">
                  <h3 className="text-xs font-semibold text-slate-400 mb-2.5">Featured Cast</h3>
                  <div className="flex flex-wrap gap-3">
                    {movie.cast.map((actor) => (
                      <div
                        key={actor.id}
                        className="px-3 py-2 rounded-xl bg-[#131722] border border-slate-800/80 text-xs flex items-center gap-2.5"
                      >
                        {actor.profileUrl && (
                          <img
                            src={actor.profileUrl}
                            alt={actor.name}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-full object-cover bg-slate-800"
                          />
                        )}
                        <div>
                          <div className="font-semibold text-slate-100">{actor.name}</div>
                          <div className="text-slate-400 text-[11px]">{actor.character}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: VidSrc.sh AdBlocker Shield */}
            <div className="bg-[#131722] border border-slate-800/90 rounded-2xl p-4 space-y-3.5 h-fit">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#10d97b]" />
                  <span>VidSrc.sh AdBlocker Shield</span>
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                    isVidSrcAdBlockerEnabled
                      ? 'bg-[#10d97b]/20 text-[#10d97b] border border-[#10d97b]/40'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isVidSrcAdBlockerEnabled ? 'ACTIVE (VIDSRC.SH)' : 'DISABLED'}
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Blocks click-jacking popup windows, <code className="text-slate-200">window.open</code>{' '}
                ad redirects, and ad-network scripts strictly on{' '}
                <code className="text-[#10d97b]">vidsrc.sh</code> while keeping Source 1 and
                video playback untouched.
              </p>

              <button
                type="button"
                role="switch"
                aria-checked={isVidSrcAdBlockerEnabled}
                data-testid="vidsrc-sidebar-adblocker-btn"
                onClick={handleToggleVidSrcAdBlocker}
                className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-between gap-2 transition-colors min-h-[42px] border ${
                  isVidSrcAdBlockerEnabled
                    ? 'bg-emerald-950/90 hover:bg-emerald-900/80 border-[#10d97b] text-[#10d97b]'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  {isVidSrcAdBlockerEnabled ? (
                    <ShieldCheck className="w-4 h-4 text-[#10d97b]" />
                  ) : (
                    <ShieldOff className="w-4 h-4 text-amber-400" />
                  )}
                  <span>
                    Adblocker ({isVidSrcAdBlockerEnabled ? 'Enabled' : 'Disabled'})
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-mono">
                    {blockedAdsCount} Blocked
                  </span>
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full transition-colors ${
                      isVidSrcAdBlockerEnabled ? 'bg-[#10d97b]' : 'bg-slate-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-slate-950 transition-transform ${
                        isVidSrcAdBlockerEnabled ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </span>
              </button>

              {isAdminUnlocked && (
                <button
                  type="button"
                  onClick={() => setShowLinkEditor((prev) => !prev)}
                  className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-[#10d97b]/50 text-[#10d97b] font-bold text-xs flex items-center justify-center gap-2 transition-colors min-h-[42px]"
                >
                  <Film className="w-4 h-4" />
                  <span>+ Attach Custom Stream / Subtitles (Admin)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
