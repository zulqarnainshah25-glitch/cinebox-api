import React, { useEffect, useState } from 'react';
import {
  Cast,
  Check,
  ChevronLeft,
  FastForward,
  Gauge,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  Smartphone,
  Subtitles,
  Sun,
  Unlock,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DownloadQuality, SubtitleTrackOption } from '../../types/movie';
import {
  AlternateLanguageStream,
  formatPlayerTimecode,
  VerifiedAudioTrack,
} from '../../utils/streamResolver';
import { HlsQualityLevelOption, HlsSubtitleTrackOption } from '../../hooks/useHlsPlayer';
import {
  SubtitleBgOpacityOption,
  SubtitleFontSizeOption,
} from '../../utils/subtitleParser';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * Phase 2 (4): Clean Chromecast / Remote Playback extension point for Capacitor & Web.
 */
export async function requestCastOrRemotePlayback(
  videoEl: HTMLVideoElement | null
): Promise<{ ok: boolean; message: string }> {
  try {
    const winAny = typeof window !== 'undefined' ? (window as any) : null;
    if (winAny?.Capacitor?.Plugins?.Chromecast?.requestSession) {
      await winAny.Capacitor.Plugins.Chromecast.requestSession();
      return { ok: true, message: 'Connected to Chromecast session.' };
    }
    const remote = (videoEl as any)?.remote;
    if (remote && typeof remote.prompt === 'function') {
      await remote.prompt();
      return { ok: true, message: 'Remote playback device selected.' };
    }
    return {
      ok: false,
      message: 'Cast / Remote Playback is ready — no compatible Cast receiver detected on this network.',
    };
  } catch {
    return {
      ok: false,
      message: 'Cast receiver selection was cancelled or is unavailable on this device.',
    };
  }
}

export interface PlayerControlsProps {
  movieTitle: string;
  moviePosterUrl?: string;
  displayPlayerTitle: string;
  statusSubline: string;
  areControlsVisible: boolean;
  isLocked: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isMuted: boolean;
  volume: number;
  brightness: number;
  playbackSpeed: number;
  fitMode: 'cover' | 'contain' | 'fill';
  isFullscreen: boolean;
  isPipActive: boolean;
  bottomControlsSafePaddingClass: string;
  activeDrawer: 'none' | 'language' | 'quality' | 'speed' | 'settings';
  isReconnecting: boolean;
  reconnectMessage: string | null;
  showSkipIntro: boolean;
  introEndSeconds?: number | null;
  nextEpisodeCountdown: number | null;
  nextEpisodeNumber?: number;
  audioSwitchNotice: string | null;
  verifiedAudioTracks: VerifiedAudioTrack[];
  selectedAudioTrackId: number;
  alternateLanguageStreams: AlternateLanguageStream[];
  activeDirectSourceUrl: string;
  hlsQualityLevels: HlsQualityLevelOption[];
  selectedHlsLevel: number;
  activeQualityLabel: DownloadQuality;
  hlsSubtitleTracks: HlsSubtitleTrackOption[];
  selectedHlsSubtitleId: number;
  subtitleTracks: SubtitleTrackOption[];
  subtitlesEnabled: boolean;
  selectedSubtitleLang: string;
  subtitleDelayMs: number;
  subtitleSize: SubtitleFontSizeOption;
  subtitleBgOpacity: SubtitleBgOpacityOption;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  onToggleLock: () => void;
  onTogglePlay: () => void;
  onSeekOffset: (deltaSeconds: number) => void;
  onSeekTo: (targetSeconds: number) => void;
  onToggleMute: () => void;
  onChangeVolume: (vol: number) => void;
  onChangeBrightness: (b: number) => void;
  onTogglePip: () => void;
  onSetActiveDrawer: (drawer: 'none' | 'language' | 'quality' | 'speed' | 'settings') => void;
  onSelectVerifiedAudioTrack: (track: VerifiedAudioTrack) => void;
  onSelectAlternateLanguageStream: (alt: AlternateLanguageStream) => void;
  onSelectQualityOption: (levelIdx: number, directQuality?: DownloadQuality) => void;
  onSelectSpeed: (speed: number) => void;
  onCycleFitMode: () => void;
  onToggleFullscreen: () => void;
  onToggleSubtitlesEnabled: (enabled: boolean) => void;
  onSelectSubtitleLang: (lang: string) => void;
  onSelectHlsSubtitleTrack: (trackId: number) => void;
  onChangeSubtitleDelay: (delayMs: number) => void;
  onChangeSubtitleSize: (size: SubtitleFontSizeOption) => void;
  onChangeSubtitleBgOpacity: (opacity: SubtitleBgOpacityOption) => void;
  onLoadCustomSubtitleText: (rawSrtOrVtt: string) => void;
  onPlayNextEpisodeNow: () => void;
  onCancelNextEpisode: () => void;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  movieTitle,
  moviePosterUrl,
  displayPlayerTitle,
  statusSubline,
  areControlsVisible,
  isLocked,
  isPlaying,
  currentTime,
  duration,
  isMuted,
  volume,
  brightness,
  playbackSpeed,
  fitMode,
  isFullscreen,
  isPipActive,
  bottomControlsSafePaddingClass,
  activeDrawer,
  isReconnecting,
  reconnectMessage,
  showSkipIntro,
  introEndSeconds,
  nextEpisodeCountdown,
  nextEpisodeNumber,
  audioSwitchNotice,
  verifiedAudioTracks,
  selectedAudioTrackId,
  alternateLanguageStreams,
  activeDirectSourceUrl,
  hlsQualityLevels,
  selectedHlsLevel,
  activeQualityLabel,
  hlsSubtitleTracks,
  selectedHlsSubtitleId,
  subtitleTracks,
  subtitlesEnabled,
  selectedSubtitleLang,
  subtitleDelayMs,
  subtitleSize,
  subtitleBgOpacity,
  videoRef,
  onClose,
  onToggleLock,
  onTogglePlay,
  onSeekOffset,
  onSeekTo,
  onToggleMute,
  onChangeVolume,
  onChangeBrightness,
  onTogglePip,
  onSetActiveDrawer,
  onSelectVerifiedAudioTrack,
  onSelectAlternateLanguageStream,
  onSelectQualityOption,
  onSelectSpeed,
  onCycleFitMode,
  onToggleFullscreen,
  onToggleSubtitlesEnabled,
  onSelectSubtitleLang,
  onSelectHlsSubtitleTrack,
  onChangeSubtitleDelay,
  onChangeSubtitleSize,
  onChangeSubtitleBgOpacity,
  onLoadCustomSubtitleText,
  onPlayNextEpisodeNow,
  onCancelNextEpisode,
}) => {
  const [castNotice, setCastNotice] = useState<string | null>(null);
  const [customSubUrlInput, setCustomSubUrlInput] = useState<string>('');

  // Phase 2 (4): Android Background Audio & Lock-Screen MediaSession API integration
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      const ms = navigator.mediaSession;
      if (typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({
          title: displayPlayerTitle || movieTitle,
          artist: 'CineBox HD Stream',
          artwork: moviePosterUrl
            ? [{ src: moviePosterUrl, sizes: '512x512', type: 'image/jpeg' }]
            : [],
        });
      }
      ms.setActionHandler('play', () => onTogglePlay());
      ms.setActionHandler('pause', () => onTogglePlay());
      ms.setActionHandler('seekbackward', () => onSeekOffset(-10));
      ms.setActionHandler('seekforward', () => onSeekOffset(10));
    } catch {
      // ignore unsupported MediaSession handlers
    }
  }, [displayPlayerTitle, movieTitle, moviePosterUrl, onTogglePlay, onSeekOffset]);

  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const handleCastClick = async () => {
    const res = await requestCastOrRemotePlayback(videoRef.current);
    setCastNotice(res.message);
    setTimeout(() => setCastNotice(null), 3200);
  };

  return (
    <>
      {/* Subtle Top & Bottom Cinema Scrims */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 bg-gradient-to-b from-black/75 via-transparent to-black/85 transition-opacity duration-300 ease-out ${
          areControlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Phase 2 (2): Clean "Reconnecting…" State Banner on Weak Mobile Networks */}
      {isReconnecting && (
        <div
          data-testid="player-reconnecting-banner"
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-black/90 border border-amber-400/60 text-xs font-extrabold text-amber-300 shadow-2xl flex items-center gap-2"
        >
          <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
          <span>{reconnectMessage || 'Reconnecting…'}</span>
        </div>
      )}

      {/* Audio / Cast Toast Notice */}
      {(audioSwitchNotice || castNotice) && (
        <div
          data-testid="audio-switch-notice"
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-black/85 border border-[#10d97b]/50 text-xs font-semibold text-[#10d97b] shadow-lg"
        >
          {audioSwitchNotice || castNotice}
        </div>
      )}

      {/* Phase 2 (4): "Skip Intro" Button driven by optional intro_start / intro_end */}
      {showSkipIntro && typeof introEndSeconds === 'number' && (
        <button
          type="button"
          data-testid="skip-intro-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSeekTo(introEndSeconds);
          }}
          className="absolute bottom-24 right-4 sm:right-6 z-40 px-4 py-2 rounded-xl bg-black/85 hover:bg-[#10d97b] hover:text-slate-950 border border-[#10d97b] text-white text-xs sm:text-sm font-extrabold shadow-2xl flex items-center gap-2 transition-all active:scale-95"
        >
          <FastForward className="w-4 h-4" />
          <span>Skip Intro</span>
        </button>
      )}

      {/* Phase 2 (4): 5-Second Auto-Play Next Episode Countdown Overlay for TV Series */}
      {nextEpisodeCountdown !== null && (
        <div
          data-testid="next-episode-countdown-overlay"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-24 right-4 sm:right-6 z-40 p-4 rounded-2xl bg-slate-950/95 border border-[#10d97b] shadow-2xl max-w-xs space-y-2.5"
        >
          <div className="text-xs font-extrabold text-white flex items-center gap-2">
            <SkipForward className="w-4 h-4 text-[#10d97b]" />
            <span>
              Up Next: Episode {nextEpisodeNumber} in {nextEpisodeCountdown}s…
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="play-next-episode-now-btn"
              onClick={onPlayNextEpisodeNow}
              className="flex-1 px-3 py-1.5 rounded-lg bg-[#10d97b] text-slate-950 text-xs font-extrabold"
            >
              Play Now
            </button>
            <button
              type="button"
              data-testid="cancel-next-episode-btn"
              onClick={onCancelNextEpisode}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* TOP PLAYER BAR */}
      <div
        className={`absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top,12px))] pb-3 transition-all duration-300 ease-out ${
          areControlsVisible
            ? 'opacity-100 pointer-events-auto translate-y-0'
            : 'opacity-0 pointer-events-none -translate-y-3'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            data-testid="close-player-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (isFullscreen) {
                onToggleFullscreen();
              } else {
                onClose();
              }
            }}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Back to catalog'}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="truncate">
            <h2 className="text-sm sm:text-base font-semibold text-white tracking-wide truncate">
              {displayPlayerTitle}
            </h2>
            <span className="text-[11px] text-[#10d97b] font-medium block truncate">
              {statusSubline}
            </span>
          </div>
        </div>

        {!isLocked && (
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              className="flex flex-col items-center justify-center min-w-[40px] min-h-[40px] text-slate-200 hover:text-white transition-colors"
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              <span className="text-[10px] mt-0.5">{isMuted ? 'Muted' : `${volume}%`}</span>
            </button>

            <button
              type="button"
              data-testid="player-cast-btn"
              onClick={handleCastClick}
              aria-label="Cast to TV"
              className="flex flex-col items-center justify-center min-w-[40px] min-h-[40px] text-slate-200 hover:text-white transition-colors"
            >
              <Cast className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">Cast</span>
            </button>

            <button
              type="button"
              onClick={onTogglePip}
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
                onSetActiveDrawer(activeDrawer === 'settings' ? 'none' : 'settings')
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

      {/* CENTER PLAYER CONTROLS: Lock + -10s + Play/Pause + +10s */}
      <div
        className={`absolute inset-x-0 top-[44%] -translate-y-1/2 z-30 flex items-center justify-between px-3 sm:px-8 pointer-events-none transition-opacity duration-200 ${
          areControlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          type="button"
          onClick={onToggleLock}
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
              onClick={() => onSeekOffset(-10)}
              aria-label="Rewind 10 seconds"
              className="relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/40 hover:bg-black/65 text-white transition-transform active:scale-95"
            >
              <RotateCcw className="w-6 h-6 sm:w-8 sm:h-8 stroke-[1.75]" />
              <span className="absolute text-[9px] sm:text-[10px] font-bold">10</span>
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
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
              onClick={() => onSeekOffset(10)}
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

      {/* BOTTOM PLAYER BAR */}
      {!isLocked && (
        <div
          data-testid="player-bottom-controls-bar"
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-200 ${bottomControlsSafePaddingClass} ${
            areControlsVisible
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Row 1: Seek Bar & Real Timecodes (no fake 596s duration) */}
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
                max={duration > 0 ? duration : 100}
                value={duration > 0 ? currentTime : 0}
                onChange={(e) => onSeekTo(Number(e.target.value))}
                aria-label="Seek video timeline"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none"
              />
              <div
                className="pointer-events-none absolute w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-white ring-2 ring-[#10d97b] shadow-md -translate-x-1/2"
                style={{ left: `${progressPercent}%` }}
              />
            </div>
            <span
              data-testid="player-duration-timecode"
              className="text-[11px] sm:text-xs font-mono tabular-nums text-slate-200 shrink-0"
            >
              {duration > 0 ? formatPlayerTimecode(duration) : '00:00'}
            </span>
          </div>

          {/* Row 2: Controls Buttons */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={onTogglePlay}
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
                onClick={() => onSeekOffset(-10)}
                aria-label="Seek backward 10 seconds"
                className="min-h-[38px] px-2 rounded-lg bg-white/5 hover:bg-white/15 text-slate-200 hover:text-white text-[11px] font-bold flex items-center gap-1 transition-colors shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>10s</span>
              </button>

              <button
                type="button"
                onClick={() => onSeekOffset(10)}
                aria-label="Seek forward 10 seconds"
                className="min-h-[38px] px-2 rounded-lg bg-white/5 hover:bg-white/15 text-slate-200 hover:text-white text-[11px] font-bold flex items-center gap-1 transition-colors shrink-0"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>10s</span>
              </button>
            </div>

            <div className="flex items-center gap-2 sm:gap-3.5 text-[11px] sm:text-xs font-medium text-white shrink-0">
              <button
                type="button"
                data-testid="audio-language-drawer-btn"
                onClick={() =>
                  onSetActiveDrawer(activeDrawer === 'language' ? 'none' : 'language')
                }
                aria-label="Subtitles and Audio"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg min-h-[38px] transition-colors ${
                  activeDrawer === 'language'
                    ? 'bg-[#10d97b]/20 border border-[#10d97b] text-[#10d97b] font-bold'
                    : 'bg-white/10 hover:bg-white/20 text-white hover:text-[#10d97b]'
                }`}
              >
                <Subtitles className="w-4 h-4 shrink-0" />
                <span>CC / Audio</span>
              </button>

              <button
                type="button"
                data-testid="bottom-settings-gear-btn"
                onClick={() =>
                  onSetActiveDrawer(activeDrawer === 'settings' ? 'none' : 'settings')
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

              <button
                type="button"
                data-testid="video-quality-drawer-btn"
                onClick={() =>
                  onSetActiveDrawer(activeDrawer === 'quality' ? 'none' : 'quality')
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

              <button
                type="button"
                data-testid="playback-speed-drawer-btn"
                onClick={() =>
                  onSetActiveDrawer(activeDrawer === 'speed' ? 'none' : 'speed')
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

              <button
                type="button"
                data-testid="fit-mode-toggle-btn"
                onClick={onCycleFitMode}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 min-h-[38px] hover:text-[#10d97b] transition-colors"
              >
                <Smartphone className="w-4 h-4 shrink-0" />
                <span className="capitalize">{fitMode}</span>
              </button>

              <button
                type="button"
                data-testid="bottom-fullscreen-toggle-btn"
                onClick={onToggleFullscreen}
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

      {/* DRAWER 1: REAL SUBTITLES (.VTT / .SRT / HLS) & AUDIO TRACKS */}
      {activeDrawer === 'language' && (
        <div
          data-testid="audio-subtitle-drawer"
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 right-0 z-40 w-[320px] sm:w-[390px] bg-[#0b0f19]/95 backdrop-blur-md border-l border-white/15 p-4 flex flex-col justify-between text-xs overflow-y-auto"
          role="region"
          aria-label="Audio and Subtitles Selector"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-sm font-bold text-white">Audio &amp; Real Subtitles</span>
              <button
                type="button"
                onClick={() => onSetActiveDrawer('none')}
                className="text-slate-400 hover:text-white font-semibold"
              >
                Close
              </button>
            </div>

            {/* Verified Audio Tracks */}
            {verifiedAudioTracks.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-300">
                  Audio Tracks ({verifiedAudioTracks.length}):
                </div>
                {verifiedAudioTracks.map((track) => {
                  const isSelected = selectedAudioTrackId === track.id && !track.failed;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      disabled={track.failed}
                      onClick={() => onSelectVerifiedAudioTrack(track)}
                      className={`w-full px-3 py-2 rounded-lg flex items-center justify-between text-left transition-colors ${
                        track.failed
                          ? 'bg-rose-950/30 text-rose-400 opacity-60 cursor-not-allowed'
                          : isSelected
                          ? 'bg-[#10d97b] text-slate-950 font-bold'
                          : 'bg-white/5 text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      <span>{track.displayLabel}</span>
                      {isSelected && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Separate Language Video Streams */}
            {alternateLanguageStreams.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-300">
                  Language Streams ({alternateLanguageStreams.length}):
                </div>
                {alternateLanguageStreams.map((alt) => {
                  const isCurrent = activeDirectSourceUrl === alt.url;
                  return (
                    <button
                      key={alt.id}
                      type="button"
                      onClick={() => onSelectAlternateLanguageStream(alt)}
                      className={`w-full px-3 py-2 rounded-lg flex items-center justify-between text-left ${
                        isCurrent
                          ? 'bg-[#10d97b] text-slate-950 font-bold'
                          : 'bg-white/5 text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      <span>{alt.label}</span>
                      {isCurrent && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* HLS Native Subtitle Tracks */}
            {hlsSubtitleTracks.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-white/10">
                <div className="text-[11px] font-bold text-slate-300">
                  HLS Manifest Subtitles:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectHlsSubtitleTrack(-1)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                      selectedHlsSubtitleId === -1
                        ? 'bg-[#10d97b] text-slate-950 font-bold'
                        : 'bg-white/5 text-slate-300'
                    }`}
                  >
                    Off
                  </button>
                  {hlsSubtitleTracks.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => onSelectHlsSubtitleTrack(st.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                        selectedHlsSubtitleId === st.id
                          ? 'bg-[#10d97b] text-slate-950 font-bold'
                          : 'bg-white/5 text-slate-300'
                      }`}
                    >
                      {st.label} ({st.lang})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Real .VTT / .SRT Subtitle Controls */}
            <div className="pt-2 border-t border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">Subtitles (.VTT / .SRT)</span>
                <button
                  type="button"
                  data-testid="toggle-subtitles-btn"
                  onClick={() => onToggleSubtitlesEnabled(!subtitlesEnabled)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
                    subtitlesEnabled
                      ? 'bg-[#10d97b] text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {subtitlesEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              {subtitleTracks.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {subtitleTracks.map((sub) => {
                    const active =
                      subtitlesEnabled &&
                      (selectedSubtitleLang.toLowerCase() === sub.lang.toLowerCase() ||
                        selectedSubtitleLang.toLowerCase() === sub.label.toLowerCase());
                    return (
                      <button
                        key={`${sub.lang}-${sub.url}`}
                        type="button"
                        onClick={() => {
                          onSelectSubtitleLang(sub.lang);
                          onToggleSubtitlesEnabled(true);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                          active
                            ? 'bg-[#10d97b] text-slate-950 font-bold'
                            : 'bg-white/5 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        {sub.label} ({sub.lang.toUpperCase()})
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  No subtitle tracks attached to this movie yet. Paste `.srt` or `.vtt` text below or attach subtitle URLs in Link Setup.
                </p>
              )}

              {/* Delay (+/- ms) */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Delay: {subtitleDelayMs} ms</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="subtitle-delay-minus-btn"
                    onClick={() => onChangeSubtitleDelay(subtitleDelayMs - 250)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white"
                  >
                    -250ms
                  </button>
                  <button
                    type="button"
                    data-testid="subtitle-delay-reset-btn"
                    onClick={() => onChangeSubtitleDelay(0)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    0ms
                  </button>
                  <button
                    type="button"
                    data-testid="subtitle-delay-plus-btn"
                    onClick={() => onChangeSubtitleDelay(subtitleDelayMs + 250)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white"
                  >
                    +250ms
                  </button>
                </div>
              </div>

              {/* Font Size */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Size:</span>
                <div className="flex items-center gap-1">
                  {(['sm', 'normal', 'large', 'xl'] as SubtitleFontSizeOption[]).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => onChangeSubtitleSize(sz)}
                      className={`px-2 py-1 rounded uppercase text-[10px] font-bold ${
                        subtitleSize === sz
                          ? 'bg-[#10d97b] text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              {/* Background Opacity */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Background:</span>
                <div className="flex items-center gap-1">
                  {([0, 50, 75, 100] as SubtitleBgOpacityOption[]).map((op) => (
                    <button
                      key={op}
                      type="button"
                      data-testid={`subtitle-bg-opacity-${op}`}
                      onClick={() => onChangeSubtitleBgOpacity(op)}
                      className={`px-2 py-1 rounded text-[10px] font-bold ${
                        subtitleBgOpacity === op
                          ? 'bg-[#10d97b] text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {op}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Inline .SRT / .VTT Paste Loader */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] text-slate-400 block">
                  Paste raw `.srt` or `.vtt` subtitle text (Urdu RTL / Hindi / English supported):
                </span>
                <textarea
                  rows={2}
                  value={customSubUrlInput}
                  onChange={(e) => setCustomSubUrlInput(e.target.value)}
                  placeholder="1&#10;00:00:01,000 --> 00:00:05,000&#10;السلام علیکم"
                  className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-[#10d97b]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (customSubUrlInput.trim()) {
                      onLoadCustomSubtitleText(customSubUrlInput);
                      onToggleSubtitlesEnabled(true);
                    }
                  }}
                  className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[#10d97b] font-bold text-[11px]"
                >
                  Apply .SRT / .VTT Subtitles
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER 2: VIDEO QUALITY */}
      {activeDrawer === 'quality' && (
        <div
          data-testid="video-quality-drawer"
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 right-0 z-40 w-56 bg-[#0b0f19]/95 backdrop-blur-md border-l border-white/15 p-4 flex flex-col justify-between text-xs"
          role="region"
          aria-label="Video Quality Selector"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="font-bold text-white">Video Quality</span>
              <button
                type="button"
                onClick={() => onSetActiveDrawer('none')}
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
                      onClick={() => onSelectQualityOption(lvl.index)}
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
                      onClick={() => onSelectQualityOption(-1, q)}
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
            Starts at ~480p on weak mobile connections and adapts automatically.
          </p>
        </div>
      )}

      {/* DRAWER 3: PLAYBACK SPEED */}
      {activeDrawer === 'speed' && (
        <div
          onClick={(e) => e.stopPropagation()}
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
                onClick={() => onSelectSpeed(spd)}
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

      {/* DRAWER 4: BRIGHTNESS & VOLUME */}
      {activeDrawer === 'settings' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 right-0 z-40 w-64 bg-[#0b0f19]/95 backdrop-blur-md border-l border-white/15 p-5 flex flex-col justify-between text-xs text-slate-200"
          role="region"
          aria-label="Brightness and Volume Controls"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Display &amp; Audio</span>
              <button
                type="button"
                onClick={() => onSetActiveDrawer('none')}
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
                onChange={(e) => onChangeBrightness(Number(e.target.value))}
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
                onChange={(e) => onChangeVolume(Number(e.target.value))}
                className="w-full accent-[#10d97b]"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            Shortcuts: Space (Play), Arrows (Seek/Vol), F (Fullscreen), M (Mute), C (Subtitles).
          </p>
        </div>
      )}
    </>
  );
};
