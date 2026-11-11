import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { VerifiedAudioTrack } from '../utils/streamResolver';
import {
  attachSafariNativeAudioTrackListeners,
  detectVerifiedAudioTracks,
} from '../services/streamSourceManager';

export interface HlsQualityLevelOption {
  index: number; // -1 = Auto
  label: string;
  height?: number;
  bitrateKbps?: number;
}

export interface HlsSubtitleTrackOption {
  id: number;
  label: string;
  lang: string;
}

export interface WeakNetworkHlsConfig {
  enableWorker: boolean;
  startLevel: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
  maxBufferSize: number;
  backBufferLength: number;
  manifestLoadingTimeOut: number;
  manifestLoadingMaxRetry: number;
  manifestLoadingRetryDelay: number;
  manifestLoadingMaxRetryTimeout: number;
  levelLoadingTimeOut: number;
  levelLoadingMaxRetry: number;
  levelLoadingRetryDelay: number;
  levelLoadingMaxRetryTimeout: number;
  fragLoadingTimeOut: number;
  fragLoadingMaxRetry: number;
  fragLoadingRetryDelay: number;
  fragLoadingMaxRetryTimeout: number;
  abrBandWidthFactor: number;
  abrBandWidthUpFactor: number;
}

/**
 * Phase 2 (2): Tuned `hls.js` configuration for weak mobile internet:
 * - Starts fast at ~480p and adapts upward via ABR
 * - Sensible buffer limits (`maxBufferLength: 24`, `maxMaxBufferLength: 60`)
 * - Retries with exponential backoff (`manifestLoadingMaxRetry: 4`, `fragLoadingMaxRetry: 6`)
 */
export function buildWeakNetworkHlsConfig(): WeakNetworkHlsConfig {
  return {
    enableWorker: true,
    startLevel: -1,
    maxBufferLength: 24,
    maxMaxBufferLength: 60,
    maxBufferSize: 30 * 1000 * 1000,
    backBufferLength: 30,
    manifestLoadingTimeOut: 12000,
    manifestLoadingMaxRetry: 4,
    manifestLoadingRetryDelay: 1000,
    manifestLoadingMaxRetryTimeout: 16000,
    levelLoadingTimeOut: 12000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 1000,
    levelLoadingMaxRetryTimeout: 16000,
    fragLoadingTimeOut: 20000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    fragLoadingMaxRetryTimeout: 24000,
    abrBandWidthFactor: 0.85,
    abrBandWidthUpFactor: 0.7,
  };
}

/**
 * Selects an initial quality level close to ~480p (`height <= 540`) so playback starts immediately
 * on weak 3G/4G connections, then hands control back to adaptive bitrate (`-1`).
 */
export function pickInitial480pLevel(
  levels: Array<{ height?: number; bitrate?: number }> | null | undefined
): number {
  if (!Array.isArray(levels) || levels.length === 0) return -1;

  let bestIndex = -1;
  let smallestDiff = Number.POSITIVE_INFINITY;

  levels.forEach((lvl, idx) => {
    const h = Number(lvl?.height) || 0;
    if (h > 0 && h <= 540) {
      const diff = Math.abs(480 - h);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        bestIndex = idx;
      }
    }
  });

  if (bestIndex !== -1) return bestIndex;

  // Fallback: pick lowest bitrate/height level
  let lowestIdx = 0;
  let lowestMetric = Number.POSITIVE_INFINITY;
  levels.forEach((lvl, idx) => {
    const metric = Number(lvl?.height) || Number(lvl?.bitrate) || idx + 1;
    if (metric < lowestMetric) {
      lowestMetric = metric;
      lowestIdx = idx;
    }
  });
  return lowestIdx;
}

export function computeExponentialBackoffMs(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 16000
): number {
  const safeAttempt = Math.max(0, Math.min(10, Math.floor(attempt)));
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, safeAttempt));
}

export type HlsRecoveryAction =
  | 'startLoad'
  | 'recoverMediaError'
  | 'swapAudioCodec'
  | 'failover';

export function evaluateHlsFatalErrorRecovery(
  errorType: string | undefined,
  recoveryAttemptCount: number
): {
  action: HlsRecoveryAction;
  statusText: string;
  backoffMs: number;
} {
  const attempt = Math.max(1, Math.floor(recoveryAttemptCount));
  const backoffMs = computeExponentialBackoffMs(attempt - 1, 800, 8000);

  if (errorType === 'networkError' || errorType === Hls.ErrorTypes?.NETWORK_ERROR) {
    if (attempt <= 3) {
      return {
        action: 'startLoad',
        statusText: `Reconnecting… (Attempt ${attempt}/3)`,
        backoffMs,
      };
    }
    return {
      action: 'failover',
      statusText: 'Stream network unreachable — switching to next healthy source…',
      backoffMs: 0,
    };
  }

  if (errorType === 'mediaError' || errorType === Hls.ErrorTypes?.MEDIA_ERROR) {
    if (attempt === 1) {
      return {
        action: 'recoverMediaError',
        statusText: 'Reconnecting… (Recovering media decoder)',
        backoffMs: 400,
      };
    }
    if (attempt === 2) {
      return {
        action: 'swapAudioCodec',
        statusText: 'Reconnecting… (Swapping audio codec)',
        backoffMs: 600,
      };
    }
    return {
      action: 'failover',
      statusText: 'Media error unrecoverable — switching to next healthy source…',
      backoffMs: 0,
    };
  }

  return {
    action: 'failover',
    statusText: 'Playback error — switching to next healthy source…',
    backoffMs: 0,
  };
}

export interface UseHlsPlayerOptions {
  playerMode: 'direct' | 'embed' | 'pak-drama' | 'trailer';
  activeDirectSourceUrl: string;
  originalLanguageCode?: string;
  preferredAudioLang?: string;
  preferredSubtitleLang?: string;
  playbackSpeed: number;
  isMuted: boolean;
  onFatalFailover?: () => void;
  onAudioSwitchNotice?: (msg: string | null) => void;
}

export function useHlsPlayer({
  playerMode,
  activeDirectSourceUrl,
  originalLanguageCode,
  preferredAudioLang,
  preferredSubtitleLang,
  playbackSpeed,
  isMuted,
  onFatalFailover,
  onAudioSwitchNotice,
}: UseHlsPlayerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pendingResumeTimeRef = useRef<number | null>(null);
  const pendingResumePlayRef = useRef<boolean>(true);
  const recoveryAttemptsRef = useRef<number>(0);

  const [verifiedAudioTracks, setVerifiedAudioTracks] = useState<VerifiedAudioTrack[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<number>(0);
  const [hlsQualityLevels, setHlsQualityLevels] = useState<HlsQualityLevelOption[]>([]);
  const [selectedHlsLevel, setSelectedHlsLevel] = useState<number>(-1);
  const [hlsSubtitleTracks, setHlsSubtitleTracks] = useState<HlsSubtitleTrackOption[]>([]);
  const [selectedHlsSubtitleId, setSelectedHlsSubtitleId] = useState<number>(-1);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null);

  useEffect(() => {
    if (playerMode !== 'direct') {
      setIsReconnecting(false);
      setReconnectMessage(null);
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl || !activeDirectSourceUrl) return;

    let hls: Hls | null = null;
    let isCancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupSafariNativeTracks: (() => void) | null = null;

    recoveryAttemptsRef.current = 0;
    setIsReconnecting(false);
    setReconnectMessage(null);
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

    const handleWaiting = () => {
      if (isCancelled) return;
      setIsReconnecting(true);
      setReconnectMessage('Reconnecting…');
    };

    const handlePlayingOrCanPlay = () => {
      if (isCancelled) return;
      recoveryAttemptsRef.current = 0;
      setIsReconnecting(false);
      setReconnectMessage(null);
    };

    videoEl.addEventListener('waiting', handleWaiting);
    videoEl.addEventListener('playing', handlePlayingOrCanPlay);
    videoEl.addEventListener('canplay', handlePlayingOrCanPlay);

    if (activeDirectSourceUrl.toLowerCase().includes('.m3u8')) {
      if (Hls.isSupported()) {
        const weakNetConfig = buildWeakNetworkHlsConfig();
        hls = new Hls(weakNetConfig);
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
            originalLanguageCode
          );
          setVerifiedAudioTracks(detected);

          if (preferredAudioLang && detected.length > 1) {
            const prefMatch = detected.find(
              (d) =>
                !d.failed &&
                (d.lang.toLowerCase() === preferredAudioLang.toLowerCase() ||
                  d.languageName.toLowerCase() === preferredAudioLang.toLowerCase())
            );
            if (prefMatch && hls.audioTrack !== prefMatch.id) {
              try {
                hls.audioTrack = prefMatch.id;
                setSelectedAudioTrackId(prefMatch.id);
              } catch {
                // ignore
              }
            }
          } else if (typeof hls.audioTrack === 'number' && hls.audioTrack >= 0) {
            setSelectedAudioTrackId(hls.audioTrack);
          } else if (detected.length > 0) {
            const def = detected.find((d) => d.isDefault) || detected[0];
            setSelectedAudioTrackId(def.id);
          }

          // 2. Real HLS Quality Levels + Initial ~480p Fast Start
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

            const initial480Idx = pickInitial480pLevel(hls.levels);
            if (initial480Idx >= 0 && hls.currentLevel === -1) {
              try {
                hls.startLevel = initial480Idx;
              } catch {
                // ignore
              }
            }
          }

          // 3. Real HLS Subtitle Tracks
          if (Array.isArray(hls.subtitleTracks) && hls.subtitleTracks.length > 0) {
            const mappedSubs = hls.subtitleTracks.map((st, idx) => ({
              id: typeof st.id === 'number' ? st.id : idx,
              label: st.name || st.lang || `Subtitle ${idx + 1}`,
              lang: st.lang || 'und',
            }));
            setHlsSubtitleTracks(mappedSubs);

            if (preferredSubtitleLang) {
              const matchedSub = mappedSubs.find(
                (s) =>
                  s.lang.toLowerCase() === preferredSubtitleLang.toLowerCase() ||
                  s.label.toLowerCase().includes(preferredSubtitleLang.toLowerCase())
              );
              if (matchedSub) {
                try {
                  hls.subtitleTrack = matchedSub.id;
                  setSelectedHlsSubtitleId(matchedSub.id);
                } catch {
                  // ignore
                }
              }
            }
          }
        };

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (isCancelled) return;
          setIsReconnecting(false);
          setReconnectMessage(null);
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
        hls.on(Hls.Events.FRAG_LOADED, () => {
          if (isCancelled) return;
          recoveryAttemptsRef.current = 0;
          setIsReconnecting(false);
          setReconnectMessage(null);
        });

        // Automatic recovery on fatal errors with exponential backoff
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
                onAudioSwitchNotice?.(
                  `Alternate audio track failed to load — automatically reverted to ${fallbackTrack.displayLabel}.`
                );
              }
              return updated;
            });
            return;
          }

          if (data?.fatal) {
            recoveryAttemptsRef.current += 1;
            const decision = evaluateHlsFatalErrorRecovery(
              data.type,
              recoveryAttemptsRef.current
            );

            setIsReconnecting(true);
            setReconnectMessage(decision.statusText);

            if (decision.action === 'startLoad') {
              if (reconnectTimer) clearTimeout(reconnectTimer);
              reconnectTimer = setTimeout(() => {
                if (!isCancelled && hls) {
                  hls.startLoad();
                }
              }, decision.backoffMs);
            } else if (decision.action === 'recoverMediaError') {
              try {
                hls.recoverMediaError();
              } catch {
                // ignore
              }
            } else if (decision.action === 'swapAudioCodec') {
              try {
                hls.swapAudioCodec();
                hls.recoverMediaError();
              } catch {
                // ignore
              }
            } else {
              setIsReconnecting(false);
              setReconnectMessage(null);
              onFatalFailover?.();
            }
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = activeDirectSourceUrl;
        cleanupSafariNativeTracks = attachSafariNativeAudioTrackListeners(
          videoEl as any,
          originalLanguageCode,
          (detected, enabledIdx) => {
            if (isCancelled) return;
            setVerifiedAudioTracks(detected);
            setSelectedAudioTrackId(enabledIdx);
          }
        );
      }
    } else {
      videoEl.src = activeDirectSourceUrl;
      cleanupSafariNativeTracks = attachSafariNativeAudioTrackListeners(
        videoEl as any,
        originalLanguageCode,
        (detected, enabledIdx) => {
          if (isCancelled) return;
          setVerifiedAudioTracks(detected);
          setSelectedAudioTrackId(enabledIdx);
        }
      );
    }

    const handleNativeLoadedMetadata = () => {
      if (isCancelled) return;
      setIsReconnecting(false);
      setReconnectMessage(null);
      restoreSavedPositionIfAny();
      if (!hls && (videoEl as any).audioTracks) {
        if (cleanupSafariNativeTracks) {
          cleanupSafariNativeTracks();
        }
        cleanupSafariNativeTracks = attachSafariNativeAudioTrackListeners(
          videoEl as any,
          originalLanguageCode,
          (detected, enabledIdx) => {
            if (isCancelled) return;
            setVerifiedAudioTracks(detected);
            setSelectedAudioTrackId(enabledIdx);
          }
        );
      }
    };

    const handleNativeError = () => {
      if (isCancelled || hls) return;
      onFatalFailover?.();
    };

    videoEl.addEventListener('loadedmetadata', handleNativeLoadedMetadata);
    videoEl.addEventListener('error', handleNativeError);

    videoEl.playbackRate = playbackSpeed;
    videoEl.muted = isMuted;
    const shouldAutoPlay =
      pendingResumeTimeRef.current !== null ? pendingResumePlayRef.current : true;
    if (shouldAutoPlay) {
      videoEl
        .play()
        .catch(() => {
          if (isCancelled) return;
          videoEl.muted = true;
          videoEl.play().catch(() => {});
        });
    } else {
      videoEl.pause();
    }

    return () => {
      isCancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      videoEl.removeEventListener('waiting', handleWaiting);
      videoEl.removeEventListener('playing', handlePlayingOrCanPlay);
      videoEl.removeEventListener('canplay', handlePlayingOrCanPlay);
      videoEl.removeEventListener('loadedmetadata', handleNativeLoadedMetadata);
      videoEl.removeEventListener('error', handleNativeError);
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
  }, [activeDirectSourceUrl, playerMode, originalLanguageCode]);

  const selectHlsSubtitleTrack = (trackId: number) => {
    setSelectedHlsSubtitleId(trackId);
    if (hlsRef.current) {
      try {
        hlsRef.current.subtitleTrack = trackId;
      } catch {
        // ignore
      }
    }
  };

  return {
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
  };
}
