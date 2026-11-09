import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Download,
  FileVideo,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings2,
  ShieldCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BlobFetchProgress,
  DEFAULT_CUSTOM_HEADERS,
  fetchVideoAsBlobUrl,
} from '../utils/blobStreamFetcher';
import { formatPlayerTimecode } from '../utils/streamResolver';
import { sanitizeFileName } from '../utils/securityValidator';

interface CustomHeaderBlobPlayerProps {
  initialVideoUrl?: string;
  movieTitle?: string;
  initialUserAgent?: string;
  initialReferer?: string;
  autoFetchOnMount?: boolean;
  onDownloadBlobToApp?: (url: string, sizeMB: number) => void;
  onSwitchToServer3?: () => void;
  onClose?: () => void;
}

export const CustomHeaderBlobPlayer: React.FC<CustomHeaderBlobPlayerProps> = ({
  initialVideoUrl = '',
  movieTitle = 'Custom Header Blob Video',
  initialUserAgent = DEFAULT_CUSTOM_HEADERS.userAgent,
  initialReferer = DEFAULT_CUSTOM_HEADERS.referer,
  autoFetchOnMount = true,
  onDownloadBlobToApp,
  onSwitchToServer3,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Input state for MP4 URL + Custom Headers (`User-Agent` & `Referer`)
  const [mp4Url, setMp4Url] = useState<string>(initialVideoUrl);
  const [userAgent, setUserAgent] = useState<string>(initialUserAgent);
  const [referer, setReferer] = useState<string>(initialReferer);
  const [showHeaderConfig, setShowHeaderConfig] = useState<boolean>(false);

  // Blob fetch lifecycle state
  const [status, setStatus] = useState<'idle' | 'fetching' | 'ready' | 'error'>(
    initialVideoUrl ? 'idle' : 'error'
  );
  const [progress, setProgress] = useState<BlobFetchProgress>({
    loadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    speedMBps: 0,
  });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobSizeMB, setBlobSizeMB] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialVideoUrl ? null : 'Movie Link Unavailable (Try Server 3)'
  );

  // HTML5 Video Playback Controls State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Revoke previous object URL to avoid memory leaks
  const cleanupBlobUrl = (urlToRevoke: string | null) => {
    if (urlToRevoke && urlToRevoke.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(urlToRevoke);
      } catch {
        // ignore
      }
    }
  };

  const startBlobDownloadAndPlay = async (targetUrl: string = mp4Url) => {
    const trimmed = (targetUrl || '').trim();
    if (!trimmed) {
      setStatus('error');
      setErrorMessage('Movie Link Unavailable (Try Server 3)');
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus('fetching');
    setErrorMessage(null);
    setProgress({ loadedBytes: 0, totalBytes: 0, percent: 0, speedMBps: 0 });

    try {
      const result = await fetchVideoAsBlobUrl({
        url: trimmed,
        headersConfig: {
          userAgent,
          referer,
        },
        signal: controller.signal,
        onProgress: (prog) => {
          setProgress(prog);
        },
      });

      setBlobUrl((prev) => {
        cleanupBlobUrl(prev);
        return result.blobUrl;
      });
      setBlobSizeMB(Math.round((result.sizeBytes / (1024 * 1024)) * 100) / 100);
      setStatus('ready');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setStatus('error');
      setErrorMessage('Movie Link Unavailable (Try Server 3)');
    }
  };

  useEffect(() => {
    setMp4Url(initialVideoUrl || '');
    if (autoFetchOnMount && initialVideoUrl) {
      startBlobDownloadAndPlay(initialVideoUrl);
    } else if (!initialVideoUrl) {
      setStatus('error');
      setErrorMessage('Movie Link Unavailable (Try Server 3)');
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [initialVideoUrl]);

  useEffect(() => {
    return () => {
      cleanupBlobUrl(blobUrl);
    };
  }, [blobUrl]);

  // Auto-play once blobUrl is assigned and video metadata loads
  const handleVideoLoadedData = () => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration) && v.duration > 0) {
      setDuration(v.duration);
    }
    v.play()
      .then(() => {
        setIsPlaying(true);
      })
      .catch(() => {
        // Fallback to muted autoplay if browser policy requires user gesture for audio
        v.muted = true;
        setIsMuted(true);
        v.play()
          .then(() => setIsPlaying(true))
          .catch(() => {});
      });
  };

  // Play / Pause button handler
  const handleTogglePlayPause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  // 10s Rewind / Forward handler
  const handleSeekOffset = (deltaSec: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const next = Math.max(0, Math.min(v.duration, v.currentTime + deltaSec));
    v.currentTime = next;
    setCurrentTime(next);
  };

  // Fullscreen button handler
  const handleToggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document.exitFullscreen?.()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };

  // Download button handler (saves the fetched Blob directly as an .mp4 file)
  const handleDownloadBlobFile = () => {
    if (!blobUrl) {
      startBlobDownloadAndPlay(mp4Url);
      return;
    }

    const safeFile = `${sanitizeFileName(movieTitle || 'movie')}.mp4`;
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = safeFile;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    if (onDownloadBlobToApp) {
      onDownloadBlobToApp(mp4Url, blobSizeMB || 15);
    }
  };

  const progressRatio = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      data-testid="custom-header-blob-player"
      className="w-full h-full flex flex-col bg-[#080b11] text-slate-100 select-none overflow-hidden"
    >
      {/* Top Status & Custom Header Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0d121d] border-b border-slate-800/90 z-20">
        <div className="flex items-center gap-2 min-w-0">
          {onClose && (
            <button
              type="button"
              data-testid="close-player-btn"
              onClick={onClose}
              aria-label="Back to catalog"
              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-white transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <ShieldCheck className="w-4 h-4 text-[#10d97b] shrink-0" />
          <span className="text-xs font-bold text-white truncate">
            Blob Stream Player ({movieTitle})
          </span>
          {status === 'ready' && blobUrl && (
            <span
              data-testid="blob-url-badge"
              className="px-2 py-0.5 rounded bg-emerald-950/90 border border-[#10d97b]/40 text-[10px] font-mono text-[#10d97b]"
            >
              blob: ready ({blobSizeMB} MB)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="toggle-blob-headers-btn"
            onClick={() => setShowHeaderConfig((prev) => !prev)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-200 flex items-center gap-1"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#10d97b]" />
            <span>{showHeaderConfig ? 'Hide Headers' : 'User-Agent & Referer'}</span>
          </button>

          <button
            type="button"
            data-testid="blob-download-btn"
            onClick={handleDownloadBlobFile}
            className="px-2.5 py-1 rounded-lg bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-bold text-[11px] flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download MP4</span>
          </button>
        </div>
      </div>

      {/* Collapsible Custom Headers (`User-Agent` & `Referer`) Configurator */}
      {showHeaderConfig && (
        <div className="p-3 bg-[#101624] border-b border-slate-800 space-y-2.5 text-xs z-30 overflow-y-auto max-h-56">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-bold text-[#10d97b]">
              Custom Fetch Headers (User-Agent &amp; Referer) + Direct MP4 URL
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">Direct MP4 Video URL</label>
              <input
                type="url"
                value={mp4Url}
                onChange={(e) => setMp4Url(e.target.value)}
                placeholder="Paste direct .mp4 URL here..."
                className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-[11px] font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">
                Custom User-Agent Header
              </label>
              <input
                type="text"
                value={userAgent}
                onChange={(e) => setUserAgent(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-[11px] font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">Custom Referer Header</label>
              <div className="flex gap-1.5">
                <input
                  type="url"
                  value={referer}
                  onChange={(e) => setReferer(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-[11px] font-mono text-white"
                />
                <button
                  type="button"
                  onClick={() => startBlobDownloadAndPlay(mp4Url)}
                  className="px-3 py-1.5 rounded bg-[#10d97b] text-slate-950 font-bold text-[11px] whitespace-nowrap"
                >
                  Fetch Blob
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Video & Blob Progress Surface */}
      <div className="relative flex-1 w-full bg-black flex items-center justify-center overflow-hidden">
        {status === 'fetching' && (
          <div className="z-20 flex flex-col items-center justify-center p-6 text-center max-w-md space-y-3">
            <Loader2 className="w-10 h-10 text-[#10d97b] animate-spin" />
            <div className="text-sm font-bold text-white">
              Fetching MP4 into Blob with Custom Headers... ({progress.percent}%)
            </div>
            <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#10d97b] transition-all duration-150"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {(progress.loadedBytes / (1024 * 1024)).toFixed(2)} MB downloaded · {progress.speedMBps}{' '}
              MB/s
            </div>
          </div>
        )}

        {status === 'error' && (
          <div
            data-testid="blob-unavailable-message"
            className="z-20 flex flex-col items-center justify-center p-6 text-center max-w-md space-y-3"
          >
            <AlertCircle className="w-10 h-10 text-amber-400" />
            <div className="text-base font-extrabold text-white">
              {errorMessage || 'Movie Link Unavailable (Try Server 3)'}
            </div>
            <p className="text-xs text-slate-400">
              Direct .MP4 stream proxy se fetch nahi ho saka. Movie dekhne ke liye Server 3 (2Embed) use karein ya custom .mp4 URL paste karein.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {onSwitchToServer3 && (
                <button
                  type="button"
                  data-testid="blob-switch-to-server3-btn"
                  onClick={onSwitchToServer3}
                  className="px-4 py-2 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Play on Server 3 (2Embed)</span>
                </button>
              )}
              {mp4Url.trim() && (
                <button
                  type="button"
                  onClick={() => startBlobDownloadAndPlay(mp4Url)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Blob Fetch</span>
                </button>
              )}
            </div>
          </div>
        )}

        {blobUrl && (
          <video
            ref={videoRef}
            data-testid="blob-video-element"
            src={blobUrl}
            playsInline
            onLoadedData={handleVideoLoadedData}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              setCurrentTime(v.currentTime);
              if (Number.isFinite(v.duration) && v.duration > 0) {
                setDuration(v.duration);
              }
            }}
            className="w-full h-full object-contain bg-black"
          />
        )}

        {/* Bottom Player Control Bar (Play/Pause, Seek, Fullscreen, Download) */}
        {status === 'ready' && blobUrl && (
          <div className="absolute bottom-0 inset-x-0 z-30 px-4 py-2.5 bg-gradient-to-t from-black/90 via-black/65 to-transparent space-y-2">
            {/* Timeline Scrubber */}
            <div className="flex items-center gap-2.5 text-[11px] font-mono text-slate-200">
              <span>{formatPlayerTimecode(currentTime)}</span>
              <div className="relative flex-1 h-1.5 bg-white/25 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#10d97b]"
                  style={{ width: `${progressRatio}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setCurrentTime(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                  aria-label="Seek Blob Video"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
              <span>{formatPlayerTimecode(duration)}</span>
            </div>

            {/* Buttons: Play/Pause, 10s Rewind/Forward, Mute, Download, Fullscreen */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-testid="blob-play-pause-btn"
                  onClick={handleTogglePlayPause}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="px-3 py-1.5 rounded-lg bg-[#10d97b] text-slate-950 font-bold text-xs flex items-center gap-1"
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
                  onClick={() => handleSeekOffset(-10)}
                  aria-label="Rewind 10s"
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => handleSeekOffset(10)}
                  aria-label="Forward 10s"
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                >
                  <RotateCw className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !isMuted;
                    setIsMuted(next);
                    if (videoRef.current) videoRef.current.muted = next;
                  }}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadBlobFile}
                  className="px-3 py-1.5 rounded-lg bg-emerald-950/90 hover:bg-emerald-900 border border-[#10d97b]/50 text-[#10d97b] font-bold text-xs flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download ({blobSizeMB}MB)</span>
                </button>

                <button
                  type="button"
                  data-testid="blob-fullscreen-btn"
                  onClick={handleToggleFullscreen}
                  aria-label="Toggle Fullscreen"
                  className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white font-semibold text-xs flex items-center gap-1"
                >
                  {isFullscreen ? (
                    <>
                      <Minimize2 className="w-3.5 h-3.5" />
                      <span>Exit</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Fullscreen</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
