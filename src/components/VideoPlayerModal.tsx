import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Activity,
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  Download,
  ExternalLink,
  Film,
  FolderDown,
  Gauge,
  HelpCircle,
  Info,
  Layers,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Sparkles,
  Subtitles,
  Sun,
  Tv,
  Unlock,
  Volume2,
  VolumeX,
  X,
  Youtube,
} from 'lucide-react';
import {
  AlternateLanguageStream,
  AppConfigRecord,
  DownloadItem,
  DownloadQuality,
  ManagedStreamSource,
  MovieItem,
  MovieLinkRecord,
  SourceAvailabilityStatus,
} from '../types/movie';
import {
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
} from '../utils/streamResolver';
import {
  attachSafariNativeAudioTrackListeners,
  checkStreamSourceHealth,
  detectVerifiedAudioTracks,
  evaluatePlayerAudioCapability,
  selectNextFallbackSource,
  switchEmbeddedAudioTrackSafely,
  VerifiedAudioTrack,
} from '../services/streamSourceManager';
import {
  EXTRACTION_UNAVAILABLE_MESSAGE,
  extractStreamFromEmbedServers,
  StreamExtractionResult,
} from '../services/embedStreamExtractor';
import {
  buildDramaOrHindiSearchQuery,
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

interface VideoPlayerModalProps {
  movie: MovieItem;
  movieLink: MovieLinkRecord | null;
  appConfig: AppConfigRecord;
  offlineDownload?: DownloadItem | null;
  isInWatchlist: boolean;
  onClose: () => void;
  onToggleWatchlist: (movie: MovieItem) => void;
  onStartDownload: (movie: MovieItem, quality: DownloadQuality, url: string, sizeMB: number) => void;
  onExportToDevice: (movie: MovieItem, quality: DownloadQuality, url: string, sizeMB: number) => void;
  onProgressUpdate: (movie: MovieItem, currentSec: number, durationSec: number) => void;
  onSaveCustomMovieLink?: (
    input: Partial<MovieLinkRecord>
  ) => Promise<{ ok: boolean; error?: string; record?: MovieLinkRecord }>;
  isAdminUnlocked?: boolean;
}

const SUBTITLE_LANGS = ['English', 'Hindi', 'Urdu', 'Spanish', 'Arabic'];
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const SUBTITLE_CUES: { start: number; end: number; en: string; hi: string; ur: string }[] = [
  { start: 0, end: 15, en: '[cinematic audio]', hi: '[सिनेमैटिक ऑडियो]', ur: '[سنیما آڈیو]' },
  {
    start: 15,
    end: 45,
    en: 'Playing via CineBox Native HTML5 & HLS Audio Engine 2.0',
    hi: 'सिनेबॉक्स नेटिव HTML5 और HLS ऑडियो इंजन 2.0 पर चल रहा है',
    ur: 'سنے باکس نیٹو HTML5 اور HLS آڈیو انجن 2.0 پر چل رہا ہے',
  },
  { start: 45, end: 99999, en: '[ambient soundtrack]', hi: '[संगीत]', ur: '[موسیقی]' },
];

export interface HlsQualityLevelOption {
  index: number; // -1 for Auto ABR
  label: string;
  height?: number;
  bitrateKbps?: number;
}

export interface HlsSubtitleTrackOption {
  id: number;
  label: string;
  lang: string;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  movie,
  movieLink,
  appConfig,
  offlineDownload,
  isInWatchlist,
  onClose,
  onToggleWatchlist,
  onStartDownload,
  onProgressUpdate,
  onSaveCustomMovieLink,
  isAdminUnlocked = false,
}) => {
  // TV Series Season & Episode Selector State
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(1);

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

  const [playerMode, setPlayerMode] = useState<
    'direct' | 'trailer' | 'embed' | 'pak-drama'
  >(
    offlineDownload
      ? 'direct'
      : isPakDrama
      ? 'pak-drama'
      : 'embed'
  );
  const [selectedEmbedId, setSelectedEmbedId] = useState<string>(
    movieLink?.stream_url ? 'custom-supabase' : 'auto-server-3'
  );

  // VidSrc.sh Content Info Metadata & Watch Progress State
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

  // Separate Alternate Language Stream Selection State (Phase 2C Scenario 2)
  const [selectedAltStreamUrl, setSelectedAltStreamUrl] = useState<string | null>(
    plan.directVideoUrl
  );

  // Centralized Source Health State (Phase 4)
  const [sourceHealthMap, setSourceHealthMap] = useState<Record<string, SourceAvailabilityStatus>>({});
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);

  // Pakistani Drama & Hindi Dubbed Live Stream Finder State
  const [pakDramaStreams, setPakDramaStreams] = useState<DramaOrHindiStreamOption[]>([]);
  const [activePakStreamIdx, setActivePakStreamIdx] = useState<number>(0);
  const [isLoadingPakDrama, setIsLoadingPakDrama] = useState<boolean>(false);
  const [pakDramaError, setPakDramaError] = useState<string | null>(null);
  const [pakDramaQueryInput, setPakDramaQueryInput] = useState<string>(() =>
    buildDramaOrHindiSearchQuery({
      title: movie.title,
      mediaType: movie.mediaType,
      episode: 1,
      isPakDrama,
    })
  );

  // Inline Quick-Link Editor State (Admin)
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
  const [customDl480, setCustomDl480] = useState<string>(movieLink?.download_480p || '');
  const [customDl720, setCustomDl720] = useState<string>(movieLink?.download_720p || '');
  const [customDl1080, setCustomDl1080] = useState<string>(movieLink?.download_1080p || '');
  const [customLang, setCustomLang] = useState<string>(
    movieLink?.language || movie.language || 'English'
  );
  const [linkSaveMessage, setLinkSaveMessage] = useState<string | null>(null);
  const [isSavingLink, setIsSavingLink] = useState<boolean>(false);

  // VidSrc.sh Real AdBlocker State (Strict Iframe Sandbox + Window Popup/Redirect Shield)
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
        // ignore storage quota errors
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

  // Custom HTML5 & HLS.js Video Player State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingResumeTimeRef = useRef<number | null>(null);
  const pendingResumePlayRef = useRef<boolean>(true);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(596);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(90);
  const [brightness, setBrightness] = useState<number>(100);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [fitMode, setFitMode] = useState<'cover' | 'contain' | 'fill'>('contain');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isPipActive, setIsPipActive] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [areControlsVisible, setAreControlsVisible] = useState<boolean>(true);
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Sync native browser/WebView fullscreen state & automatic Landscape/Portrait orientation
  useEffect(() => {
    const handleFullscreenChange = () => {
      const docAny = document as any;
      const activeFsEl = document.fullscreenElement || docAny.webkitFullscreenElement || null;
      if (activeFsEl) {
        setIsFullscreen(true);
        setAreControlsVisible(true);
        scheduleControlsAutoHide();
        lockScreenOrientationSafely('landscape').catch(() => {});

        // If an internal <iframe> triggered fullscreen, promote playerContainerRef so our
        // React Exit Fullscreen button remains visible on top of the iframe!
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
      // Restore Portrait orientation & exit fullscreen when VideoPlayerModal closes
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

  // PHASE 2A: Verified Embedded Audio Tracks (ONLY real HLS.js or HTML5 tracks — never fake metadata tracks)
  const [verifiedAudioTracks, setVerifiedAudioTracks] = useState<VerifiedAudioTrack[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<number>(0);
  const [audioSwitchNotice, setAudioSwitchNotice] = useState<string | null>(null);

  // HLS Quality Levels & Subtitle Tracks
  const [hlsQualityLevels, setHlsQualityLevels] = useState<HlsQualityLevelOption[]>([]);
  const [selectedHlsLevel, setSelectedHlsLevel] = useState<number>(-1); // -1 = Auto ABR
  const [hlsSubtitleTracks, setHlsSubtitleTracks] = useState<HlsSubtitleTrackOption[]>([]);
  const [selectedHlsSubtitleId, setSelectedHlsSubtitleId] = useState<number>(-1);

  // Drawers (`audio-language`, `quality`, `speed`, `settings`)
  const [activeDrawer, setActiveDrawer] = useState<
    'none' | 'language' | 'quality' | 'speed' | 'settings'
  >('none');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(false);
  const [bilingualEnabled, setBilingualEnabled] = useState<boolean>(false);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('English');
  const [subtitleDelayMs, setSubtitleDelayMs] = useState<number>(0);
  const [subtitleSize, setSubtitleSize] = useState<'normal' | 'large'>('normal');
  const [activeQualityLabel, setActiveQualityLabel] = useState<DownloadQuality>(
    offlineDownload?.quality || '720p'
  );

  // Determine the active direct video URL (Offline item -> Selected Alternate Language Stream -> Plan direct -> Fallback test stream)
  const activeDirectSourceUrl =
    offlineDownload?.sourceUrl ||
    selectedAltStreamUrl ||
    plan.directVideoUrl ||
    plan.testFallbackMp4Url;

  // Evaluate honest audio capability for current playerMode and detected tracks
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

  // Reset state cleanly when switching movies
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
      offlineDownload
        ? 'direct'
        : pakDetected
        ? 'pak-drama'
        : 'embed'
    );
    setSelectedEmbedId(movieLink?.stream_url ? 'custom-supabase' : 'auto-server-3');
    setSelectedAltStreamUrl(nextPlan.directVideoUrl);
    setSelectedSeason(1);
    setSelectedEpisode(1);
    setCustomDirectUrl(movieLink?.direct_video_url || '');
    setCustomHindiDubbedUrl(movieLink?.hindi_dubbed_video_url || '');
    setCustomUrduDubbedUrl(movieLink?.urdu_dubbed_video_url || '');
    setCustomEmbedUrl(movieLink?.stream_url || '');
    setCustomDl480(movieLink?.download_480p || '');
    setCustomDl720(movieLink?.download_720p || '');
    setCustomDl1080(movieLink?.download_1080p || '');
    setCustomLang(movieLink?.language || movie.language || 'English');
    setLinkSaveMessage(null);
    setVerifiedAudioTracks([]);
    setSelectedAudioTrackId(0);
    setHlsQualityLevels([]);
    setSelectedHlsLevel(-1);
    setHlsSubtitleTracks([]);
    setSelectedHlsSubtitleId(-1);
    setAudioSwitchNotice(null);
    setActiveDrawer('none');
    pendingResumeTimeRef.current = null;
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

  // Part 1 (1 & 5): Fetch VidSrc.sh Content Info (Movie/TV Metadata) & Fallback to 2Embed on 404/Error
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

    // Automatic Fallback to 2Embed (auto-server-3) if VidSrc.sh returns 404 or fails and user hasn't set custom stream
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

  // Part 1 (4): Listen for VidSrc.sh iframe postMessage (PLAYER_EVENT) to save Watch History progress
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
        onProgressUpdate(movie, parsed.currentTime, parsed.duration);
      }
    };

    window.addEventListener('message', handlePostMessage);
    return () => {
      window.removeEventListener('message', handlePostMessage);
    };
  }, [movie, selectedSeason, selectedEpisode, onProgressUpdate]);

  // Phase 4: Run source health checks on demand
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

  // Phase 2B: Switch embedded HLS / HTML5 audio track safely without restarting playback
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

    if (!switchResult.ok) {
      setAudioSwitchNotice(
        switchResult.error || 'Audio track switch failed — reverted to previous track.'
      );
      // Mark failed track so user isn't stuck
      setVerifiedAudioTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, failed: true } : t))
      );
    } else {
      setAudioSwitchNotice(`Switched audio to ${track.displayLabel}`);
      setTimeout(() => {
        setAudioSwitchNotice((prev) =>
          prev === `Switched audio to ${track.displayLabel}` ? null : prev
        );
      }, 2800);
    }
  };

  // Phase 2C: Switch between Separate Verified Alternate-Language Video Streams while preserving playback position
  const handleSelectAlternateLanguageStream = (altStream: AlternateLanguageStream) => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.currentTime) && v.currentTime > 0) {
      pendingResumeTimeRef.current = v.currentTime;
      pendingResumePlayRef.current = !v.paused;
    }
    setSelectedAltStreamUrl(altStream.url);
    setPlayerMode('direct');
    setAudioSwitchNotice(`Switched stream source to ${altStream.label}`);
    setTimeout(() => {
      setAudioSwitchNotice((prev) =>
        prev === `Switched stream source to ${altStream.label}` ? null : prev
      );
    }, 2800);
  };

  // Switch HLS Quality Level or Direct MP4 Resolution while preserving playback position
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

  // Initialize HLS.js (with real manifest audioTracks, quality levels, subtitle tracks & error fallback) or MP4
  useEffect(() => {
    if (playerMode !== 'direct') return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    let hls: Hls | null = null;
    let isCancelled = false;
    let cleanupSafariNativeTracks: (() => void) | null = null;

    setVerifiedAudioTracks([]);
    setHlsQualityLevels([]);
    setHlsSubtitleTracks([]);

    const restoreSavedPositionIfAny = () => {
      if (
        pendingResumeTimeRef.current !== null &&
        Number.isFinite(pendingResumeTimeRef.current) &&
        pendingResumeTimeRef.current > 0
      ) {
        try {
          videoEl.currentTime = pendingResumeTimeRef.current;
        } catch {
          // ignore
        }
        const shouldPlay = pendingResumePlayRef.current;
        pendingResumeTimeRef.current = null;
        if (shouldPlay) {
          videoEl.play().catch(() => {});
        }
      }
    };

    if (activeDirectSourceUrl.toLowerCase().includes('.m3u8')) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
        });
        hlsRef.current = hls;
        hls.loadSource(activeDirectSourceUrl);
        hls.attachMedia(videoEl);

        const syncHlsTracksAndLevels = () => {
          if (!hls || isCancelled) return;

          // 1. Real HLS Audio Tracks
          const rawAudio = hls.audioTracks || [];
          const detected = detectVerifiedAudioTracks(
            rawAudio.map((t, idx) => ({
              id: typeof t.id === 'number' ? t.id : idx,
              name: t.name,
              lang: t.lang,
              default: t.default,
              type: (t as any).type,
              groupId: t.groupId,
            })),
            null,
            movie.originalLanguageCode
          );
          setVerifiedAudioTracks(detected);
          if (typeof hls.audioTrack === 'number' && hls.audioTrack >= 0) {
            setSelectedAudioTrackId(hls.audioTrack);
          } else if (detected.length > 0) {
            const def = detected.find((d) => d.isDefault) || detected[0];
            setSelectedAudioTrackId(def.id);
          }

          // 2. Real HLS Quality Levels
          if (Array.isArray(hls.levels) && hls.levels.length > 0) {
            const levels: HlsQualityLevelOption[] = [
              { index: -1, label: 'Auto (Adaptive)' },
              ...hls.levels.map((lvl, idx) => ({
                index: idx,
                label: lvl.height
                  ? `${lvl.height}p (${Math.round((lvl.bitrate || 1500000) / 1000)} kbps)`
                  : `Level ${idx + 1}`,
                height: lvl.height,
                bitrateKbps: Math.round((lvl.bitrate || 0) / 1000),
              })),
            ];
            setHlsQualityLevels(levels);
          }

          // 3. Real HLS Subtitle Tracks
          if (Array.isArray(hls.subtitleTracks) && hls.subtitleTracks.length > 0) {
            setHlsSubtitleTracks(
              hls.subtitleTracks.map((st, idx) => ({
                id: typeof st.id === 'number' ? st.id : idx,
                label: st.name || st.lang || `Subtitle ${idx + 1}`,
                lang: st.lang || 'und',
              }))
            );
          }
        };

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          syncHlsTracksAndLevels();
          restoreSavedPositionIfAny();
        });
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncHlsTracksAndLevels);
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, syncHlsTracksAndLevels);
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
          if (isCancelled) return;
          if (typeof data?.id === 'number') {
            setSelectedAudioTrackId(data.id);
          }
        });

        // Automatic fallback if an alternate audio track fails or stream encounters fatal error
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!hls || isCancelled) return;
          if (
            data?.details === Hls.ErrorDetails.AUDIO_TRACK_LOAD_ERROR ||
            data?.details === Hls.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT
          ) {
            const failedId = hls.audioTrack;
            setVerifiedAudioTracks((prev) => {
              const updated = prev.map((t) =>
                t.id === failedId ? { ...t, failed: true } : t
              );
              const fallbackTrack = updated.find((t) => !t.failed);
              if (fallbackTrack && hls) {
                hls.audioTrack = fallbackTrack.id;
                setSelectedAudioTrackId(fallbackTrack.id);
                setAudioSwitchNotice(
                  `Alternate audio track failed to load — automatically reverted to ${fallbackTrack.displayLabel}.`
                );
              }
              return updated;
            });
            return;
          }

          if (data?.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              // Automatic fallback to next healthy source in Stream Source Manager
              const fallbackSrc = selectNextFallbackSource(
                plan.managedSources,
                `direct-alt-primary-${movie.originalLanguageCode || 'en'}`
              );
              if (fallbackSrc && fallbackSrc.isCrossOriginIframe) {
                setSelectedEmbedId(fallbackSrc.id);
                setPlayerMode('embed');
              }
            }
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari / iOS Native HLS Fallback with real native audioTracks synchronization & cleanup
        videoEl.src = activeDirectSourceUrl;
        const bindSafariTracks = () => {
          if (isCancelled) return;
          if (cleanupSafariNativeTracks) {
            cleanupSafariNativeTracks();
          }
          cleanupSafariNativeTracks = attachSafariNativeAudioTrackListeners(
            videoEl as any,
            movie.originalLanguageCode,
            (detected, enabledIdx) => {
              if (isCancelled) return;
              setVerifiedAudioTracks(detected);
              setSelectedAudioTrackId(enabledIdx);
            }
          );
        };
        bindSafariTracks();
      }
    } else {
      videoEl.src = activeDirectSourceUrl;
      cleanupSafariNativeTracks = attachSafariNativeAudioTrackListeners(
        videoEl as any,
        movie.originalLanguageCode,
        (detected, enabledIdx) => {
          if (isCancelled) return;
          setVerifiedAudioTracks(detected);
          setSelectedAudioTrackId(enabledIdx);
        }
      );
    }

    const handleNativeLoadedMetadata = () => {
      if (isCancelled) return;
      restoreSavedPositionIfAny();
      // Re-attach/sync Safari native audioTracks once metadata is loaded if not using HLS.js
      if (!hls && (videoEl as any).audioTracks) {
        if (cleanupSafariNativeTracks) {
          cleanupSafariNativeTracks();
        }
        cleanupSafariNativeTracks = attachSafariNativeAudioTrackListeners(
          videoEl as any,
          movie.originalLanguageCode,
          (detected, enabledIdx) => {
            if (isCancelled) return;
            setVerifiedAudioTracks(detected);
            setSelectedAudioTrackId(enabledIdx);
          }
        );
      }
    };
    videoEl.addEventListener('loadedmetadata', handleNativeLoadedMetadata);

    videoEl.playbackRate = playbackSpeed;
    videoEl.muted = isMuted;
    const shouldAutoPlay =
      pendingResumeTimeRef.current !== null ? pendingResumePlayRef.current : true;
    if (shouldAutoPlay) {
      videoEl
        .play()
        .then(() => {
          if (!isCancelled) setIsPlaying(true);
        })
        .catch(() => {
          if (isCancelled) return;
          videoEl.muted = true;
          setIsMuted(true);
          videoEl.play().catch(() => {});
        });
    } else {
      videoEl.pause();
      setIsPlaying(false);
    }

    return () => {
      isCancelled = true;
      videoEl.removeEventListener('loadedmetadata', handleNativeLoadedMetadata);
      if (cleanupSafariNativeTracks) {
        cleanupSafariNativeTracks();
        cleanupSafariNativeTracks = null;
      }
      if (hls) {
        hls.destroy();
      }
      hlsRef.current = null;
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch {
        // ignore cleanup errors
      }
    };
  }, [activeDirectSourceUrl, playerMode, movie.originalLanguageCode]);

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
    } else {
      setCurrentTime((prev) => Math.max(0, Math.min(duration, prev + deltaSeconds)));
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLocked) return;
    const nextVal = Number(e.target.value);
    setCurrentTime(nextVal);
    if (videoRef.current && Number.isFinite(videoRef.current.duration)) {
      try {
        videoRef.current.currentTime = nextVal;
      } catch {
        // ignore
      }
    }
  };

  const handleSelectSpeed = (spd: number) => {
    setPlaybackSpeed(spd);
    if (videoRef.current) {
      videoRef.current.playbackRate = spd;
    }
    setActiveDrawer('none');
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
      } else if (docAny.webkitFullscreenElement && typeof docAny.webkitExitFullscreen === 'function') {
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
      // CSS fullscreen lock (`cinebox-player-fullscreen`) remains active even if native API is unsupported
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
      // Picture-in-Picture not supported or blocked
    }
  };

  const handleSaveInlineLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveCustomMovieLink) return;
    setIsSavingLink(true);
    setLinkSaveMessage(null);
    const res = await onSaveCustomMovieLink({
      tmdb_id: movie.id,
      title: movie.title,
      language: customLang,
      direct_video_url: customDirectUrl.trim() || null,
      hindi_dubbed_video_url: customHindiDubbedUrl.trim() || null,
      urdu_dubbed_video_url: customUrduDubbedUrl.trim() || null,
      stream_url: customEmbedUrl.trim() || null,
      download_480p: customDl480.trim() || customDirectUrl.trim() || null,
      download_720p: customDl720.trim() || customDirectUrl.trim() || null,
      download_1080p: customDl1080.trim() || customDl720.trim() || customDirectUrl.trim() || null,
      file_size_480p: '480.0MB',
      file_size_720p: '1050.0MB',
      file_size_1080p: '2150.0MB',
    });
    setIsSavingLink(false);
    if (res.ok) {
      setLinkSaveMessage(
        'Saved! Custom stream, alternate language streams & download links are now active.'
      );
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

  const activeCue =
    SUBTITLE_CUES.find((c) => currentTime % 120 >= c.start && currentTime % 120 < c.end) ||
    SUBTITLE_CUES[0];

  const activeEmbedServer =
    plan.embedServers.find((s) => s.id === selectedEmbedId) || plan.embedServers[0];

  const cleanIframeAttrs = getCleanIframeAttributes(
    activeEmbedServer?.url,
    `${movie.title} - ${activeEmbedServer?.label || 'Stream Player'}`
  );

  const vidsrcIframeAttrs = getVidSrcPlayerIframeAttributes(
    activeEmbedServer?.url,
    `${movie.title} - ${activeEmbedServer?.label || 'Stream Player'}`,
    isVidSrcAdBlockerEnabled
  );

  const isCurrentServerVidSrc = isVidSrcProviderUrl(activeEmbedServer?.url);

  const vidsrcAdBlockCss = buildVidSrcAdBlockCssRules(
    isVidSrcAdBlockerEnabled,
    playerMode === 'embed' && isCurrentServerVidSrc
  );

  // Real VidSrc.sh Ad-Filtering Logic Layer (Network Request Interception + Popup/DOM/Focus Shield)
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

  const progressPercent = Math.min(100, Math.max(0, (currentTime / Math.max(1, duration)) * 100));

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

  const displayPlayerTitle =
    movie.mediaType === 'tv'
      ? `${movie.title} — S${selectedSeason}:E${selectedEpisode}`
      : `${activeQualityLabel.toUpperCase()} ${movie.title}`;

  const fsConfig = getFullscreenPlayerConfig(isFullscreen, fitMode, areControlsVisible);

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000000] text-slate-100 overflow-y-auto border-0 outline-none"
      style={{ backgroundColor: '#000000' }}
      role="dialog"
      aria-label={`Playing ${movie.title}`}
    >
      {/* Dynamic CSS Hiding Rules Layer (Injected only when VidSrc.sh is active & Adblocker Toggle Switch is ON) */}
      {vidsrcAdBlockCss && (
        <style id="cinebox-vidsrc-adblocker-css" data-testid="vidsrc-adblocker-css-rules">
          {vidsrcAdBlockCss}
        </style>
      )}
      <div className="max-w-6xl mx-auto min-h-screen flex flex-col bg-[#000000] border-0 outline-none">
        {/* ===================================================================
            MOBILE-FIRST TOP PLAYER BAR (OUTSIDE ASPECT-VIDEO CONTAINER)
            PHASE 3 RULE: Never display a fake embedded audio selector on cross-origin iframes.
           =================================================================== */}
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
                  Playing on {activeEmbedServer?.label || 'Server 3 (2Embed.cc)'} · Cross-Origin Provider Audio
                </span>
              </div>
            </div>

            <div className="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* If verified Separate Alternate Language Video Streams exist for this movie, allow switching to them */}
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
                  <span>
                    Direct Stream ({plan.alternateLanguageStreams.length} Lang)
                  </span>
                </button>
              )}

              {/* Interactive 'Adblocker' Toggle Switch targeting vidsrc.sh */}
              <button
                type="button"
                role="switch"
                aria-checked={isVidSrcAdBlockerEnabled}
                aria-label="Adblocker toggle switch for VidSrc.sh"
                data-testid="vidsrc-adblocker-toggle-btn"
                onClick={handleToggleVidSrcAdBlocker}
                title="Toggle Adblocker (Network Request Interceptor & CSS Hiding Layer for vidsrc.sh)"
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
                {/* Visual Toggle Switch Track & Thumb */}
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
                  🇵🇰 Pak Drama &amp; Hindi Server ·{' '}
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

              {pakDramaStreams[activePakStreamIdx] && (
                <a
                  href={pakDramaStreams[activePakStreamIdx].watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="open-in-new-tab-btn"
                  className="hidden md:inline-flex px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#10d97b] via-[#22e58a] to-[#facc15] hover:opacity-95 text-slate-950 text-xs font-extrabold shadow-lg items-center gap-1.5 min-h-[36px] shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Open in New Tab</span>
                </a>
              )}
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
              Back to Server 3
            </button>
          </div>
        )}

        {/* ===================================================================
            HYBRID VIDEO PLAYER SURFACE (100% Pure #000000 Borderless Fullscreen)
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
          {/* TOP-EDGE WAKE ZONE WHEN CONTROLS ARE HIDDEN IN FULLSCREEN (SO IFRAME VIEWERS CAN WAKE EXIT BUTTON) */}
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

          {/* CONTROLS-SYNCED TOP-LEFT & TOP-RIGHT EXIT FULLSCREEN / BACK BUTTONS */}
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
                    Use the search bar below the player to search any Episode number or Hindi Dubbed title, or switch to Server 3.
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

              {/* VidSrc.sh Smart Click-Shield Perimeter Layer:
                  Intercepts clickjacking/popunder clicks (aclib.runPop & DGA mousedown listeners)
                  across the video canvas dead-zones while keeping Center Play/Seek controls,
                  Bottom Scrubber/Fullscreen bar, and Top-Right Episode selector 100% clickable. */}
              {vidsrcIframeAttrs.isVidSrcAdBlockerActive && (
                <div
                  data-testid="vidsrc-click-shield-layer"
                  className="absolute inset-0 z-30 pointer-events-none select-none"
                  aria-hidden="true"
                >
                  {/* Top Canvas Ad-Shield Zone (leaves top-right 240px open for TV Season/Episode selector) */}
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
                  {/* Left Wing Ad-Shield Zone */}
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
                  {/* Right Wing Ad-Shield Zone */}
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
                  {/* Lower-Middle Canvas Ad-Shield Zone (above 60px bottom control bar, below center Play button) */}
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
                title={cleanIframeAttrs.title}
                className="w-full h-full border-0 bg-[#000000]"
                style={{ backgroundColor: '#000000' }}
              />
            </div>
          ) : (
            /* =================================================================
               MODE 1: DIRECT NATIVE HTML5 + HLS AUDIO SYSTEM 2.0 PLAYER
               ================================================================= */
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
                    onProgressUpdate(movie, v.currentTime, v.duration);
                  }
                }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (Number.isFinite(v.duration) && v.duration > 0) {
                    setDuration(v.duration);
                  }

                  // Restore playback position & playback state if user switched Alternate Language Stream or Quality
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

                  // Inspect native HTML5 <video>.audioTracks if not already populated by HLS.js
                  const nativeTracks = (
                    v as unknown as {
                      audioTracks?: ArrayLike<{
                        id?: string;
                        label?: string;
                        language?: string;
                        kind?: string;
                        enabled?: boolean;
                      }>;
                    }
                  ).audioTracks;
                  if (
                    nativeTracks &&
                    nativeTracks.length > 0 &&
                    (!hlsRef.current || !hlsRef.current.audioTracks?.length)
                  ) {
                    const detected = detectVerifiedAudioTracks(
                      null,
                      nativeTracks,
                      movie.originalLanguageCode
                    );
                    setVerifiedAudioTracks(detected);
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

              {/* Subtle Top & Bottom Cinema Scrims */}
              <div
                className={`pointer-events-none absolute inset-0 z-20 bg-gradient-to-b from-black/75 via-transparent to-black/85 transition-opacity duration-200 ${
                  areControlsVisible ? 'opacity-100' : 'opacity-0'
                }`}
              />

              {/* Audio Switch / Fallback Toast Notification inside Player */}
              {audioSwitchNotice && (
                <div
                  data-testid="audio-switch-notice"
                  className="absolute top-14 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-black/85 border border-[#10d97b]/50 text-xs font-semibold text-[#10d97b] shadow-lg"
                >
                  {audioSwitchNotice}
                </div>
              )}

              {/* TOP PLAYER BAR */}
              <div
                className={`absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top,12px))] pb-3 transition-opacity duration-200 ${
                  areControlsVisible
                    ? 'opacity-100 pointer-events-auto'
                    : 'opacity-0 pointer-events-none'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    data-testid="close-player-btn"
                    onClick={onClose}
                    aria-label="Back to catalog"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <div className="truncate">
                    <h2 className="text-sm sm:text-base font-semibold text-white tracking-wide truncate">
                      {displayPlayerTitle}
                    </h2>
                    <span className="text-[11px] text-[#10d97b] font-medium block truncate">
                      {offlineDownload
                        ? `Offline Internal Storage Playback (${offlineDownload.fileSizeMB}MB)`
                        : activeAlternateStream
                        ? `Active Stream: ${activeAlternateStream.label} (${activeAlternateStream.format.toUpperCase()})`
                        : activeEmbeddedTrack
                        ? `Verified Audio: ${activeEmbeddedTrack.displayLabel}`
                        : 'CineBox Direct HTML5 / HLS Stream Active'}
                    </span>
                  </div>
                </div>

                {!isLocked && (
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setIsMuted((m) => {
                          const next = !m;
                          if (videoRef.current) videoRef.current.muted = next;
                          return next;
                        })
                      }
                      aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                      className="flex flex-col items-center justify-center min-w-[40px] min-h-[40px] text-slate-200 hover:text-white transition-colors"
                    >
                      {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                      <span className="text-[10px] mt-0.5">{isMuted ? 'Muted' : `${volume}%`}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTogglePictureInPicture}
                      aria-label="Picture in Picture"
                      className={`flex flex-col items-center justify-center min-w-[40px] min-h-[40px] transition-colors ${
                        isPipActive ? 'text-[#10d97b]' : 'text-slate-200 hover:text-white'
                      }`}
                    >
                      <PictureInPicture2 className="w-5 h-5" />
                      <span className="text-[10px] mt-0.5">PiP</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setActiveDrawer(activeDrawer === 'settings' ? 'none' : 'settings')
                      }
                      aria-label="Player Setting"
                      className="flex flex-col items-center justify-center min-w-[40px] min-h-[40px] text-slate-200 hover:text-white transition-colors"
                    >
                      <Settings className="w-5 h-5" />
                      <span className="text-[10px] mt-0.5">Setting</span>
                    </button>
                  </div>
                )}
              </div>

              {/* CENTER PLAYER CONTROLS: `Tap to Lock` + `10s Rewind` + `Play/Pause` + `10s Forward` */}
              <div
                className={`absolute inset-x-0 top-[44%] -translate-y-1/2 z-30 flex items-center justify-between px-3 sm:px-8 pointer-events-none transition-opacity duration-200 ${
                  areControlsVisible ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsLocked((prev) => !prev);
                    setActiveDrawer('none');
                  }}
                  aria-label={isLocked ? 'Unlock Screen Controls' : 'Tap to Lock'}
                  className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl bg-black/50 hover:bg-black/75 backdrop-blur-sm text-white text-[11px] sm:text-sm font-medium transition-colors min-h-[38px] sm:min-h-[44px]"
                >
                  {isLocked ? (
                    <>
                      <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-[#10d97b]" />
                      <span>Locked</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4 sm:w-5 sm:h-5 text-white/90" />
                      <span>Tap to Lock</span>
                    </>
                  )}
                </button>

                {!isLocked && (
                  <div className="pointer-events-auto flex items-center gap-4 sm:gap-12">
                    <button
                      type="button"
                      onClick={() => handleSeekOffset(-10)}
                      aria-label="Rewind 10 seconds"
                      className="relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/40 hover:bg-black/65 text-white transition-transform active:scale-95"
                    >
                      <RotateCcw className="w-6 h-6 sm:w-8 sm:h-8 stroke-[1.75]" />
                      <span className="absolute text-[9px] sm:text-[10px] font-bold">10</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      aria-label={isPlaying ? 'Pause video' : 'Play video'}
                      className="flex items-center justify-center w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-black/50 hover:bg-black/75 text-white transition-transform active:scale-95"
                    >
                      {isPlaying ? (
                        <Pause className="w-7 h-7 sm:w-9 sm:h-9 fill-white" />
                      ) : (
                        <Play className="w-7 h-7 sm:w-9 sm:h-9 fill-white ml-0.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSeekOffset(10)}
                      aria-label="Forward 10 seconds"
                      className="relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/40 hover:bg-black/65 text-white transition-transform active:scale-95"
                    >
                      <RotateCw className="w-6 h-6 sm:w-8 sm:h-8 stroke-[1.75]" />
                      <span className="absolute text-[9px] sm:text-[10px] font-bold">10</span>
                    </button>
                  </div>
                )}

                <div className="w-16 sm:w-24" />
              </div>

              {/* LIVE SUBTITLE CAPTION OVERLAY */}
              {subtitlesEnabled && (
                <div className="pointer-events-none absolute bottom-14 sm:bottom-16 inset-x-0 z-30 flex flex-col items-center justify-center px-4 text-center">
                  <span
                    className={`px-2.5 py-0.5 rounded bg-black/65 text-white font-medium tracking-wide drop-shadow ${
                      subtitleSize === 'large' ? 'text-sm sm:text-xl' : 'text-[11px] sm:text-base'
                    }`}
                  >
                    {selectedSubtitle === 'Hindi'
                      ? activeCue.hi
                      : selectedSubtitle === 'Urdu'
                      ? activeCue.ur
                      : activeCue.en}
                  </span>
                  {bilingualEnabled && (
                    <span className="mt-0.5 px-2 py-0.5 rounded bg-black/65 text-[#10d97b] text-[10px] sm:text-sm font-medium">
                      {activeCue.hi}
                    </span>
                  )}
                </div>
              )}

              {/* BOTTOM PLAYER BAR (Mobile-Aligned Controls: Play/Pause, Seek Bar, Subtitles CC, Settings Gear, Quality, Speed, Fit/Cover, Fullscreen) */}
              {!isLocked && (
                <div
                  data-testid="player-bottom-controls-bar"
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-200 ${
                    fsConfig.bottomControlsSafePaddingClass
                  } ${
                    areControlsVisible
                      ? 'opacity-100 pointer-events-auto'
                      : 'opacity-0 pointer-events-none'
                  }`}
                >
                  {/* Row 1: Mobile-Friendly Seek Bar & Timecodes */}
                  <div className="flex items-center gap-2.5 sm:gap-3 mb-2">
                    <span className="text-[11px] sm:text-xs font-mono tabular-nums text-slate-200 shrink-0">
                      {formatPlayerTimecode(currentTime)}
                    </span>
                    <div className="relative flex-1 flex items-center py-1">
                      <div className="w-full h-1.5 sm:h-2 bg-white/30 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#10d97b]"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={duration}
                        value={currentTime}
                        onChange={handleScrub}
                        aria-label="Seek video timeline"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none"
                      />
                      <div
                        className="pointer-events-none absolute w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-white ring-2 ring-[#10d97b] shadow-md -translate-x-1/2"
                        style={{ left: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="text-[11px] sm:text-xs font-mono tabular-nums text-slate-200 shrink-0">
                      {formatPlayerTimecode(duration)}
                    </span>
                  </div>

                  {/* Row 2: Bottom Controls Bar (Left: Play/Pause & Seek | Right: CC Subtitles, Gear Settings, Quality, Fit, Fullscreen) */}
                  <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleTogglePlay}
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white hover:text-[#10d97b] transition-colors shrink-0"
                      >
                        {isPlaying ? (
                          <Pause className="w-5 h-5 fill-current" />
                        ) : (
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSeekOffset(-10)}
                        aria-label="Seek backward 10 seconds"
                        className="min-h-[38px] px-2 rounded-lg bg-white/5 hover:bg-white/15 text-slate-200 hover:text-white text-[11px] font-bold flex items-center gap-1 transition-colors shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>10s</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSeekOffset(10)}
                        aria-label="Seek forward 10 seconds"
                        className="min-h-[38px] px-2 rounded-lg bg-white/5 hover:bg-white/15 text-slate-200 hover:text-white text-[11px] font-bold flex items-center gap-1 transition-colors shrink-0"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>10s</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3.5 text-[11px] sm:text-xs font-medium text-white shrink-0">
                      {/* 1. Subtitles (CC) & Audio Language Button */}
                      <button
                        type="button"
                        data-testid="audio-language-drawer-btn"
                        onClick={() =>
                          setActiveDrawer(activeDrawer === 'language' ? 'none' : 'language')
                        }
                        aria-label="Subtitles and Audio"
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg min-h-[38px] transition-colors ${
                          activeDrawer === 'language'
                            ? 'bg-[#10d97b]/20 border border-[#10d97b] text-[#10d97b] font-bold'
                            : 'bg-white/10 hover:bg-white/20 text-white hover:text-[#10d97b]'
                        }`}
                      >
                        <Subtitles className="w-4 h-4 shrink-0" />
                        <span>
                          CC / Audio
                          {audioCapability.canSwitchEmbeddedAudio && activeEmbeddedTrack
                            ? ` (${activeEmbeddedTrack.languageName})`
                            : activeAlternateStream
                            ? ` (${activeAlternateStream.languageName})`
                            : ''}
                        </span>
                      </button>

                      {/* 2. Settings (Gear) Button aligned in bottom bar */}
                      <button
                        type="button"
                        data-testid="bottom-settings-gear-btn"
                        onClick={() =>
                          setActiveDrawer(activeDrawer === 'settings' ? 'none' : 'settings')
                        }
                        aria-label="Player Settings"
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg min-h-[38px] transition-colors ${
                          activeDrawer === 'settings'
                            ? 'bg-[#10d97b]/20 border border-[#10d97b] text-[#10d97b] font-bold'
                            : 'bg-white/10 hover:bg-white/20 text-white hover:text-[#10d97b]'
                        }`}
                      >
                        <Settings className="w-4 h-4 shrink-0" />
                        <span>Settings</span>
                      </button>

                      {/* 3. Video Quality Selector Button */}
                      <button
                        type="button"
                        data-testid="video-quality-drawer-btn"
                        onClick={() =>
                          setActiveDrawer(activeDrawer === 'quality' ? 'none' : 'quality')
                        }
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg min-h-[38px] transition-colors ${
                          activeDrawer === 'quality'
                            ? 'bg-[#10d97b]/20 border border-[#10d97b] text-[#10d97b] font-bold'
                            : 'bg-white/10 hover:bg-white/20 text-white hover:text-[#10d97b]'
                        }`}
                      >
                        <Layers className="w-4 h-4 shrink-0" />
                        <span>
                          {hlsQualityLevels.length > 0
                            ? selectedHlsLevel === -1
                              ? 'Auto'
                              : hlsQualityLevels.find((l) => l.index === selectedHlsLevel)?.label.split(' ')[0] || 'HD'
                            : activeQualityLabel}
                        </span>
                      </button>

                      {/* 4. Playback Speed Selector Button */}
                      <button
                        type="button"
                        data-testid="playback-speed-drawer-btn"
                        onClick={() =>
                          setActiveDrawer(activeDrawer === 'speed' ? 'none' : 'speed')
                        }
                        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg min-h-[38px] transition-colors ${
                          activeDrawer === 'speed'
                            ? 'bg-[#10d97b]/20 border border-[#10d97b] text-[#10d97b] font-bold'
                            : 'bg-white/10 hover:bg-white/20 text-white hover:text-[#10d97b]'
                        }`}
                      >
                        <Gauge className="w-4 h-4 shrink-0" />
                        <span>{playbackSpeed}x</span>
                      </button>

                      {/* 5. Fit / Cover Mode (Available on both mobile & desktop to eliminate letterboxing if desired) */}
                      <button
                        type="button"
                        data-testid="fit-mode-toggle-btn"
                        onClick={handleCycleFitMode}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 min-h-[38px] hover:text-[#10d97b] transition-colors"
                      >
                        <Smartphone className="w-4 h-4 shrink-0" />
                        <span className="capitalize">{fitMode}</span>
                      </button>

                      {/* 6. Fullscreen / Exit Fullscreen */}
                      <button
                        type="button"
                        data-testid="bottom-fullscreen-toggle-btn"
                        onClick={handleToggleFullscreen}
                        aria-label="Toggle Fullscreen"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#10d97b] text-slate-950 font-bold min-h-[38px] hover:bg-[#0fc36d] transition-colors"
                      >
                        {isFullscreen ? (
                          <>
                            <Minimize2 className="w-4 h-4 shrink-0" />
                            <span>Exit</span>
                          </>
                        ) : (
                          <>
                            <Maximize2 className="w-4 h-4 shrink-0" />
                            <span>Fullscreen</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ===============================================================
                  DRAWER 1: NETFLIX-STYLE AUDIO & LANGUAGE + SUBTITLES DRAWER
                  Shows ONLY genuinely detected HLS/HTML5 audio tracks + Verified Alternate Streams
                 =============================================================== */}
              {activeDrawer === 'language' && (
                <div
                  data-testid="audio-language-drawer"
                  className="absolute inset-x-0 bottom-0 sm:inset-y-0 sm:left-auto sm:right-0 z-40 max-h-[82%] sm:max-h-none sm:w-[430px] bg-[#0b0f19]/95 backdrop-blur-md border-t sm:border-t-0 sm:border-l border-white/15 flex flex-col justify-between text-white rounded-t-2xl sm:rounded-none"
                  role="region"
                  aria-label="Audio & Language and Subtitles"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                    <span className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                      <Volume2 className="w-4 h-4 text-[#10d97b]" />
                      <span>Audio &amp; Language</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveDrawer('none')}
                      className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-white/5"
                    >
                      Close
                    </button>
                  </div>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/10 overflow-y-auto p-3.5 gap-3 sm:gap-0">
                    {/* Left Column: Embedded Audio Tracks + Alternate Language Streams */}
                    <div className="sm:pr-3 space-y-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                          Embedded Stream Audio
                        </h4>

                        {verifiedAudioTracks.length > 1 ? (
                          <div className="space-y-1.5" data-testid="audio-track-list-menu">
                            {verifiedAudioTracks.map((track) => {
                              const isSelected = track.id === selectedAudioTrackId;
                              return (
                                <button
                                  key={track.id}
                                  type="button"
                                  disabled={track.failed}
                                  data-testid={`audio-track-option-${track.id}`}
                                  onClick={() => handleSelectVerifiedAudioTrack(track)}
                                  className={`w-full flex items-center justify-between text-left text-xs px-2.5 py-2 rounded-lg transition-colors ${
                                    track.failed
                                      ? 'opacity-40 cursor-not-allowed text-rose-400'
                                      : isSelected
                                      ? 'bg-[#10d97b]/20 border border-[#10d97b] text-[#10d97b] font-bold'
                                      : 'bg-white/5 text-slate-200 hover:bg-white/10'
                                  }`}
                                >
                                  <span>
                                    {track.displayLabel}
                                    {track.failed ? ' (Unavailable)' : ''}
                                  </span>
                                  {isSelected && !track.failed && (
                                    <Check className="w-4 h-4 text-[#10d97b] shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            data-testid="single-audio-track-honest-notice"
                            className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-[11px] text-slate-300 space-y-1"
                          >
                            <div className="font-semibold text-white flex items-center justify-between">
                              <span>
                                {verifiedAudioTracks[0]?.displayLabel ||
                                  `${movie.language || 'Original'} — Single Track`}
                              </span>
                              <Check className="w-3.5 h-3.5 text-[#10d97b]" />
                            </div>
                            <p className="text-[10px] text-slate-400 leading-relaxed">
                              {audioCapability.honestStatusMessage}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Scenario 2: Separate Verified Language Video Streams */}
                      {plan.alternateLanguageStreams.length > 0 && (
                        <div className="pt-2 border-t border-white/10">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                            Verified Language Sources ({plan.alternateLanguageStreams.length})
                          </h4>
                          <div className="space-y-1.5" data-testid="alternate-language-streams-list">
                            {plan.alternateLanguageStreams.map((alt) => {
                              const isSelected = activeDirectSourceUrl === alt.url;
                              return (
                                <button
                                  key={alt.id}
                                  type="button"
                                  data-testid={`alt-stream-option-${alt.id}`}
                                  onClick={() => handleSelectAlternateLanguageStream(alt)}
                                  className={`w-full flex items-center justify-between text-left text-xs px-2.5 py-2 rounded-lg transition-colors ${
                                    isSelected
                                      ? 'bg-[#10d97b]/20 border border-[#10d97b] text-[#10d97b] font-bold'
                                      : 'bg-white/5 text-slate-200 hover:bg-white/10'
                                  }`}
                                >
                                  <span>{alt.label}</span>
                                  {isSelected && <Check className="w-4 h-4 text-[#10d97b] shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Subtitles */}
                    <div className="pt-3 sm:pt-0 sm:pl-3 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                            Subtitles
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={subtitlesEnabled}
                            aria-label="Toggle Subtitles"
                            onClick={() => setSubtitlesEnabled((s) => !s)}
                            className={`w-9 h-5 rounded-full transition-colors relative ${
                              subtitlesEnabled ? 'bg-[#10d97b]' : 'bg-slate-600'
                            }`}
                          >
                            <span
                              className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform translate-y-0.5 ${
                                subtitlesEnabled ? 'translate-x-4' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </div>

                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs text-slate-300">Bilingual Captions</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={bilingualEnabled}
                            aria-label="Toggle Bilingual Subtitles"
                            onClick={() => setBilingualEnabled((b) => !b)}
                            className={`w-9 h-5 rounded-full transition-colors relative ${
                              bilingualEnabled ? 'bg-[#10d97b]' : 'bg-slate-600'
                            }`}
                          >
                            <span
                              className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform translate-y-0.5 ${
                                bilingualEnabled ? 'translate-x-4' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </div>

                        {/* HLS Native Subtitle Tracks if present */}
                        {hlsSubtitleTracks.length > 0 && (
                          <div className="space-y-1 mb-2 pb-2 border-b border-white/10">
                            {hlsSubtitleTracks.map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() => {
                                  setSelectedHlsSubtitleId(st.id);
                                  setSubtitlesEnabled(true);
                                  if (hlsRef.current) hlsRef.current.subtitleTrack = st.id;
                                }}
                                className={`w-full flex items-center justify-between text-left text-xs px-2 py-1.5 rounded ${
                                  selectedHlsSubtitleId === st.id
                                    ? 'text-[#10d97b] font-bold'
                                    : 'text-slate-300 hover:text-white'
                                }`}
                              >
                                <span>{st.label} (HLS)</span>
                                {selectedHlsSubtitleId === st.id && (
                                  <Check className="w-3.5 h-3.5 text-[#10d97b]" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          {SUBTITLE_LANGS.map((lang) => {
                            const isSelected = subtitlesEnabled && selectedSubtitle === lang;
                            return (
                              <button
                                key={lang}
                                type="button"
                                onClick={() => {
                                  setSelectedSubtitle(lang);
                                  setSubtitlesEnabled(true);
                                }}
                                className={`w-full flex items-center justify-between text-left text-xs px-2 py-1.5 rounded ${
                                  isSelected
                                    ? 'bg-[#10d97b]/15 text-[#10d97b] font-bold'
                                    : 'text-slate-300 hover:text-white'
                                }`}
                              >
                                <span>{lang}</span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-[#10d97b]" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 bg-black/60 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setSubtitleSize((prev) => (prev === 'normal' ? 'large' : 'normal'))
                      }
                      className="flex items-center justify-center gap-1.5 text-slate-200 hover:text-[#10d97b]"
                    >
                      <span className="font-mono border border-slate-400 rounded px-1 text-[10px]">
                        CC
                      </span>
                      <span>Size ({subtitleSize})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubtitleDelayMs((d) => (d >= 1000 ? -500 : d + 500))}
                      className="flex items-center justify-center gap-1.5 text-slate-200 hover:text-[#10d97b]"
                    >
                      <span>Sync ({subtitleDelayMs}ms)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* DRAWER 2: VIDEO QUALITY SELECTOR (HLS Levels + Direct 480p/720p/1080p) */}
              {activeDrawer === 'quality' && (
                <div
                  data-testid="video-quality-drawer"
                  className="absolute inset-y-0 right-0 z-40 w-56 bg-[#0b0f19]/95 backdrop-blur-md border-l border-white/15 p-4 flex flex-col justify-between text-xs"
                  role="region"
                  aria-label="Video Quality Selector"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <span className="font-bold text-white">Video Quality</span>
                      <button
                        type="button"
                        onClick={() => setActiveDrawer('none')}
                        className="text-slate-400 hover:text-white"
                      >
                        Close
                      </button>
                    </div>

                    {hlsQualityLevels.length > 0 ? (
                      <div className="space-y-1.5">
                        {hlsQualityLevels.map((lvl) => {
                          const isSelected = selectedHlsLevel === lvl.index;
                          return (
                            <button
                              key={lvl.index}
                              type="button"
                              onClick={() => handleSelectQualityOption(lvl.index)}
                              className={`w-full px-3 py-2 rounded-lg flex items-center justify-between text-left ${
                                isSelected
                                  ? 'bg-[#10d97b] text-slate-950 font-bold'
                                  : 'bg-white/5 text-slate-200 hover:bg-white/10'
                              }`}
                            >
                              <span>{lvl.label}</span>
                              {isSelected && <Check className="w-4 h-4 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {(['480p', '720p', '1080p'] as DownloadQuality[]).map((q) => {
                          const isSelected = activeQualityLabel === q;
                          return (
                            <button
                              key={q}
                              type="button"
                              data-testid={`quality-option-${q}`}
                              onClick={() => handleSelectQualityOption(-1, q)}
                              className={`w-full px-3 py-2 rounded-lg flex items-center justify-between text-left ${
                                isSelected
                                  ? 'bg-[#10d97b] text-slate-950 font-bold'
                                  : 'bg-white/5 text-slate-200 hover:bg-white/10'
                              }`}
                            >
                              <span>{q} Full HD</span>
                              {isSelected && <Check className="w-4 h-4 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-400">
                    Playback position is preserved when changing video resolution.
                  </p>
                </div>
              )}

              {/* DRAWER 3: PLAYBACK SPEED DRAWER */}
              {activeDrawer === 'speed' && (
                <div
                  className="absolute inset-y-0 right-0 z-40 w-36 bg-[#0b0f19]/95 backdrop-blur-md border-l border-white/15 flex flex-col items-center justify-center gap-4 text-sm"
                  role="region"
                  aria-label="Playback Speed Selector"
                >
                  {SPEED_OPTIONS.map((spd) => {
                    const isSelected = playbackSpeed === spd;
                    return (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => handleSelectSpeed(spd)}
                        className={`w-full py-1.5 text-center font-semibold transition-colors ${
                          isSelected ? 'text-[#10d97b] text-base' : 'text-white/90 hover:text-white'
                        }`}
                      >
                        {spd}x
                      </button>
                    );
                  })}
                </div>
              )}

              {/* DRAWER 4: BRIGHTNESS & VOLUME SLIDER DRAWER */}
              {activeDrawer === 'settings' && (
                <div
                  className="absolute inset-y-0 right-0 z-40 w-64 bg-[#0b0f19]/95 backdrop-blur-md border-l border-white/15 p-5 flex flex-col justify-between text-xs text-slate-200"
                  role="region"
                  aria-label="Brightness and Volume Controls"
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">Display &amp; Audio</span>
                      <button
                        type="button"
                        onClick={() => setActiveDrawer('none')}
                        className="text-slate-400 hover:text-white"
                      >
                        Close
                      </button>
                    </div>

                    <div>
                      <label className="flex items-center justify-between mb-1.5">
                        <span className="flex items-center gap-1.5">
                          <Sun className="w-4 h-4 text-amber-400" /> Brightness
                        </span>
                        <span className="font-mono">{brightness}%</span>
                      </label>
                      <input
                        type="range"
                        min={50}
                        max={130}
                        value={brightness}
                        onChange={(e) => setBrightness(Number(e.target.value))}
                        className="w-full accent-[#10d97b]"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between mb-1.5">
                        <span className="flex items-center gap-1.5">
                          <Volume2 className="w-4 h-4 text-[#10d97b]" /> Volume
                        </span>
                        <span className="font-mono">{volume}%</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={volume}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setVolume(v);
                          setIsMuted(v === 0);
                          if (videoRef.current) {
                            videoRef.current.volume = v / 100;
                            videoRef.current.muted = v === 0;
                          }
                        }}
                        className="w-full accent-[#10d97b]"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    HLS.js Audio System 2.0 &amp; MP4 hardware acceleration active.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* ===================================================================
            CENTRALIZED STREAM SOURCE MANAGER + SERVER SWITCHER + TV EPISODES
           =================================================================== */}
        <div className="flex-1 px-3 sm:px-6 py-4 sm:py-5 pb-16 space-y-4 sm:space-y-5">
          {/* =================================================================
              PART 1: VIDSRC.SH CONTENT INFO METADATA BAR, 404 & ERROR BANNERS,
              AND PLAYER_EVENT WATCH HISTORY RESUME INDICATOR
             ================================================================= */}
          <div
            data-testid="vidsrc-integration-panel"
            className="p-3 sm:p-3.5 rounded-2xl bg-[#111622] border border-slate-800/90 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-[#10d97b]/15 border border-[#10d97b]/40 text-[10px] font-extrabold text-[#10d97b] uppercase tracking-wider">
                  VidSrc.sh API v2
                </span>
                <span className="text-xs font-bold text-slate-200">
                  {movie.mediaType === 'tv'
                    ? `Endpoint: /info/tv/${movie.id}/${selectedSeason}/${selectedEpisode}.json`
                    : `Endpoint: /info/movie/${movie.id}.json`}
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
                  Play VidSrc.sh (ds_lang=en)
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
                  2Embed Fallback
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
                  data-testid="vidsrc-open-new-tab-btn"
                  className="px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-[#10d97b]/50 text-[#10d97b] text-[11px] font-bold flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open VidSrc.sh in New Tab</span>
                </a>
              </div>
            </div>

            {isLoadingVidsrcInfo && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                <Loader2 className="w-3.5 h-3.5 text-[#10d97b] animate-spin" />
                <span>Checking VidSrc.sh Content Info API...</span>
              </div>
            )}

            {/* Condition 1: status_code === 200 -> Show title, year, poster, quality */}
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
                      <span>·</span>
                      <span className="text-emerald-300 font-semibold">
                        Default Subtitles: English (ds_lang=en)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Condition 2: status_code === 404 -> Show "Movie Not Available" + 2Embed Fallback active */}
            {!isLoadingVidsrcInfo && vidsrcInfoState?.notAvailable && (
              <div
                data-testid="vidsrc-not-available-banner"
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-950/50 border border-amber-500/40"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <div className="text-xs font-bold text-amber-200">
                    Movie Not Available on VidSrc.sh (404) — Auto-Fallback to 2Embed Active
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

            {/* Condition 3: Network/CORS/500 Error -> Show "Content Unavailable, Try Again" + 2Embed Fallback */}
            {!isLoadingVidsrcInfo &&
              vidsrcInfoState &&
              !vidsrcInfoState.ok &&
              !vidsrcInfoState.notAvailable && (
                <div
                  data-testid="vidsrc-error-banner"
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80"
                >
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="text-xs font-semibold text-slate-200">
                      {vidsrcInfoState.errorMessage || 'Content Unavailable, Try Again'}{' '}
                      <span className="text-slate-400 font-normal">
                        (Using TMDb Metadata &amp; 2Embed / VidSrc.sh Embed Player)
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="vidsrc-retry-info-btn"
                    onClick={loadVidSrcContentInfo}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Try Again</span>
                  </button>
                </div>
              )}

            {/* Part 1 (4): Watch History Progress from PLAYER_EVENT */}
            {vidsrcWatchProgress && vidsrcWatchProgress.currentTime > 0 && (
              <div
                data-testid="vidsrc-watch-progress-bar"
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-950/40 border border-[#10d97b]/30 text-xs"
              >
                <div className="flex items-center gap-2 text-emerald-200 font-semibold">
                  <Check className="w-3.5 h-3.5 text-[#10d97b]" />
                  <span>
                    Saved Watch Progress: {formatPlayerTimecode(vidsrcWatchProgress.currentTime)} /{' '}
                    {formatPlayerTimecode(vidsrcWatchProgress.duration)} (
                    {vidsrcWatchProgress.watchedPercent}%)
                  </span>
                </div>
                {playerMode === 'direct' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = vidsrcWatchProgress.currentTime;
                        setCurrentTime(vidsrcWatchProgress.currentTime);
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#10d97b] text-slate-950 font-extrabold text-[11px]"
                  >
                    Resume Here
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 1. Centralized Stream Source Manager & Server Switcher */}
          <div className="bg-[#131722] border border-slate-800/90 rounded-2xl p-3 sm:p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Server className="w-4 h-4 text-[#10d97b] shrink-0" />
                <span>
                  {movie.mediaType === 'tv'
                    ? `Centralized Stream Source Manager (S${selectedSeason}:E${selectedEpisode})`
                    : 'Centralized Stream Source Manager & Multi-Audio Controls'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="check-source-health-btn"
                  disabled={isCheckingHealth}
                  onClick={handleRunSourceHealthChecks}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                >
                  <Activity className="w-3.5 h-3.5 text-[#10d97b]" />
                  <span>{isCheckingHealth ? 'Checking Sources...' : 'Check Source Health'}</span>
                </button>

                <span className="text-[11px] font-mono text-slate-400">
                  TMDb ID: {movie.id} · {movie.mediaType.toUpperCase()}
                </span>

                {isAdminUnlocked && (
                  <button
                    type="button"
                    data-testid="toggle-inline-link-editor-btn"
                    onClick={() => setShowLinkEditor((prev) => !prev)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-950/90 hover:bg-emerald-900 border border-[#10d97b]/50 text-[#10d97b] text-[11px] font-bold flex items-center gap-1 transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>
                      {showLinkEditor
                        ? 'Close Link Setup'
                        : '+ Attach Stream / Language Links'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Separate Verified Language Video Streams Bar (Phase 2C Scenario 2) */}
            {plan.alternateLanguageStreams.length > 0 && (
              <div
                data-testid="verified-language-sources-bar"
                className="p-2.5 rounded-xl bg-emerald-950/40 border border-[#10d97b]/30 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="text-xs font-bold text-[#10d97b] flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4" />
                  <span>Verified Language Video Streams:</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {plan.alternateLanguageStreams.map((alt) => {
                    const isActive =
                      playerMode === 'direct' && activeDirectSourceUrl === alt.url;
                    return (
                      <button
                        key={alt.id}
                        type="button"
                        data-testid={`verified-lang-source-btn-${alt.id}`}
                        onClick={() => handleSelectAlternateLanguageStream(alt)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-[#10d97b] text-slate-950 shadow-sm'
                            : 'bg-slate-900 text-slate-200 border border-slate-700 hover:border-[#10d97b]/60'
                        }`}
                      >
                        <span>{alt.label}</span>
                        <span className="text-[10px] font-mono opacity-75">
                          ({alt.format.toUpperCase()})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
              {/* 🇵🇰 Dedicated Pakistani Drama & Hindi Dubbed Full Episode/Movie Server */}
              <button
                type="button"
                data-testid="pak-drama-hindi-server-btn"
                onClick={() => {
                  setPlayerMode('pak-drama');
                  if (pakDramaStreams.length === 0 && !isLoadingPakDrama) {
                    loadPakDramaOrHindiStreams(undefined, selectedEpisode);
                  }
                }}
                className={`px-2.5 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-bold transition-colors min-h-[40px] flex items-center gap-1.5 border min-w-0 ${
                  playerMode === 'pak-drama'
                    ? 'bg-[#10d97b] text-slate-950 border-[#10d97b] shadow-md'
                    : 'bg-emerald-950/80 border-[#10d97b]/50 text-[#10d97b] hover:bg-emerald-900/70'
                }`}
              >
                <Tv className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {isPakDrama || movie.mediaType === 'tv'
                    ? `🇵🇰 Pak Drama / Urdu (Ep ${selectedEpisode})`
                    : '🇮🇳 Hindi / Drama Stream Finder'}
                </span>
              </button>

              {/* Embed Server Buttons with Source Health Status Badges */}
              {plan.embedServers.map((srv) => {
                const isSelected = playerMode === 'embed' && selectedEmbedId === srv.id;
                const health = sourceHealthMap[srv.id];
                return (
                  <button
                    key={srv.id}
                    type="button"
                    data-testid={`embed-server-btn-${srv.id}`}
                    onClick={() => {
                      setSelectedEmbedId(srv.id);
                      setPlayerMode('embed');
                    }}
                    className={`px-2.5 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-semibold transition-colors min-h-[40px] flex items-center gap-1.5 min-w-0 ${
                      isSelected
                        ? 'bg-[#10d97b] text-slate-950 font-bold shadow-sm'
                        : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{srv.label}</span>
                    {health === 'available' && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Available" />
                    )}
                  </button>
                );
              })}

              {/* Prominent Open in New Tab Button if Iframe Fails to Load */}
              <a
                href={activeEmbedServer?.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="prominent-open-new-tab-btn"
                className="px-2.5 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-extrabold transition-transform active:scale-95 min-h-[40px] flex items-center gap-1.5 min-w-0 bg-gradient-to-r from-[#10d97b] via-[#22e58a] to-[#facc15] text-slate-950 shadow-md shadow-[#10d97b]/25 hover:opacity-95"
              >
                <ExternalLink className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                <span className="truncate">Open in New Tab</span>
              </a>

              {/* Official TMDb Video / Trailer */}
              {movie.youtubeKey && (
                <button
                  type="button"
                  data-testid="play-official-trailer-btn"
                  onClick={() => setPlayerMode('trailer')}
                  className={`px-2.5 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-semibold transition-colors min-h-[40px] flex items-center gap-1.5 min-w-0 ${
                    playerMode === 'trailer'
                      ? 'bg-[#10d97b] text-slate-950 font-bold shadow-sm'
                      : 'bg-rose-950/70 border border-rose-500/40 text-rose-200 hover:bg-rose-900/60'
                  }`}
                >
                  <Youtube className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="truncate">Official TMDb Video (HD)</span>
                </button>
              )}
            </div>

            {/* Honest Audio Capability Banner (Phase 3) */}
            <div
              data-testid="honest-audio-capability-banner"
              className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 flex items-start gap-2"
            >
              <Info className="w-4 h-4 text-[#10d97b] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-semibold text-slate-200">
                  Audio System 2.0 Status ({audioCapability.mode.toUpperCase()}):
                </div>
                <p className="text-slate-400 leading-relaxed">
                  {audioCapability.honestStatusMessage}
                </p>
              </div>
            </div>

            {/* 🇵🇰 PAKISTANI DRAMA & HINDI DUBBED STREAM SELECTOR PANEL */}
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
                    placeholder="Search e.g. Dar e Nijaat Episode 1, Kabhi Main Kabhi Tum Ep 1, or Movie Hindi Dubbed..."
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:border-[#10d97b] focus:outline-none"
                  />
                  <button
                    type="submit"
                    data-testid="pak-drama-search-submit-btn"
                    className="px-4 py-2 rounded-lg bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-bold text-xs shrink-0"
                  >
                    Find Episode / Hindi Stream
                  </button>
                </form>

                {pakDramaStreams.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-300">
                      Available Full-Length Streams ({pakDramaStreams.length} found — click to switch):
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

            {/* ===============================================================
                INLINE REAL MOVIE LINK & MULTI-LANGUAGE STREAM EDITOR (ADMIN)
               =============================================================== */}
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
                        Attach Direct HLS/MP4 &amp; Separate Language Streams for &ldquo;{movie.title}&rdquo; (TMDb ID: {movie.id})
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Attach a multi-audio <code className="text-[#10d97b]">.m3u8</code> manifest or separate authorized Original / Hindi Dubbed / Urdu Dubbed video streams:
                    </p>
                  </div>
                </div>

                {/* 1-Click Sample Real Stream Presets */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-300 block">
                    1-Click Test Presets (Click to auto-fill a real working HD .MP4 link):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {PLAYABLE_HD_STREAMS_POOL.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setCustomDirectUrl(preset.mp4_720p);
                          setCustomDl480(preset.mp4_480p);
                          setCustomDl720(preset.mp4_720p);
                          setCustomDl1080(preset.mp4_720p);
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
                      placeholder="https://your-cdn.com/movies/master.m3u8 or movie-720p.mp4"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Separate Hindi Dubbed Stream URL (Optional <code>.mp4</code> / <code>.m3u8</code>):
                    </label>
                    <input
                      type="url"
                      value={customHindiDubbedUrl}
                      onChange={(e) => setCustomHindiDubbedUrl(e.target.value)}
                      placeholder="https://your-cdn.com/movies/movie-hindi-dubbed.mp4"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Separate Urdu Dubbed Stream URL (Optional <code>.mp4</code> / <code>.m3u8</code>):
                    </label>
                    <input
                      type="url"
                      value={customUrduDubbedUrl}
                      onChange={(e) => setCustomUrduDubbedUrl(e.target.value)}
                      placeholder="https://your-cdn.com/movies/movie-urdu-dubbed.mp4"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      480p Download <code>.mp4</code> URL:
                    </label>
                    <input
                      type="url"
                      value={customDl480}
                      onChange={(e) => setCustomDl480(e.target.value)}
                      placeholder="https://your-cdn.com/movies/movie-480p.mp4"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      720p Download <code>.mp4</code> URL:
                    </label>
                    <input
                      type="url"
                      value={customDl720}
                      onChange={(e) => setCustomDl720(e.target.value)}
                      placeholder="https://your-cdn.com/movies/movie-720p.mp4"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      1080p Download <code>.mp4</code> URL:
                    </label>
                    <input
                      type="url"
                      value={customDl1080}
                      onChange={(e) => setCustomDl1080(e.target.value)}
                      placeholder="https://your-cdn.com/movies/movie-1080p.mp4"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-[#10d97b] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Custom Iframe Embed URL (Optional):
                    </label>
                    <input
                      type="url"
                      value={customEmbedUrl}
                      onChange={(e) => setCustomEmbedUrl(e.target.value)}
                      placeholder="https://streamwish.to/e/... or https://filemoon.sx/e/..."
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
                      onClick={() => {
                        setSelectedEpisode(epNum);
                      }}
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

          {/* 3. Movie/Series Metadata, TMDB Watch Providers & VidSrc.sh AdBlocker Shield */}
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

              {/* PHASE 6: Official TMDB Watch Providers (Displayed separately from playable sources) */}
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

              {/* Cast Section */}
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

            {/* Right Column: VidSrc.sh AdBlocker Shield & Official Streaming Info */}
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
                <code className="text-[#10d97b]">vidsrc.sh</code> while keeping Server 3 (2Embed) and
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
                  <span>+ Attach Custom Stream / Language Links (Admin)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
