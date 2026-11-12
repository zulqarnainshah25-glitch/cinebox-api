import React from 'react';
import {
  Activity,
  ExternalLink,
  Info,
  Link2,
  Server,
  ShieldCheck,
  Tv,
  Volume2,
  Youtube,
} from 'lucide-react';
import {
  AlternateLanguageStream,
  EmbedServerOption,
} from '../../utils/streamResolver';
import { SourceAvailabilityStatus } from '../../services/streamSourceManager';

/**
 * Phase 2 (6): Converts technical server names into simple user-facing labels:
 * "Source 1", "Source 2", "Source 3", etc.
 */
export function formatUserFriendlySourceLabel(indexZeroBased: number): string {
  const safeNum = Math.max(1, Math.floor(indexZeroBased) + 1);
  return `Source ${safeNum}`;
}

export interface SourceHealthBadgeInfo {
  status: 'ok' | 'slow' | 'unknown' | 'down';
  label: 'OK' | 'slow' | 'unknown' | 'down';
  dotColor: 'green' | 'yellow' | 'red';
  colorMeaning: 'likely working' | 'unknown' | 'failed';
  dotClass: string;
  badgeClass: string;
}

/**
 * Fix 4: Maps internal availability or `link_health` status to a colored status dot:
 * - Green (`bg-emerald-400`, `OK` / `likely working`) when HTTP probe succeeded (`'available'` / `'ok'`)
 * - Yellow (`bg-amber-400`, `unknown` / `slow`) when not yet checked (`undefined` / `'unknown'` / `'checking'`) or slow (`'timeout'` / `'slow'`)
 * - Red (`bg-rose-500`, `down` / `failed`) when HTTP probe failed or timed out (`'unavailable'` / `'down'`)
 */
export function resolveSourceHealthDotStatus(
  rawStatus?: SourceAvailabilityStatus | 'ok' | 'slow' | 'down' | 'unknown' | null
): SourceHealthBadgeInfo {
  if (rawStatus === 'unavailable' || rawStatus === 'down') {
    return {
      status: 'down',
      label: 'down',
      dotColor: 'red',
      colorMeaning: 'failed',
      dotClass: 'bg-rose-500',
      badgeClass: 'text-rose-300 bg-rose-950/80 border-rose-500/40',
    };
  }
  if (rawStatus === 'timeout' || rawStatus === 'slow') {
    return {
      status: 'slow',
      label: 'slow',
      dotColor: 'yellow',
      colorMeaning: 'unknown',
      dotClass: 'bg-amber-400',
      badgeClass: 'text-amber-200 bg-amber-950/80 border-amber-500/40',
    };
  }
  if (rawStatus === 'available' || rawStatus === 'ok') {
    return {
      status: 'ok',
      label: 'OK',
      dotColor: 'green',
      colorMeaning: 'likely working',
      dotClass: 'bg-emerald-400',
      badgeClass: 'text-emerald-200 bg-emerald-950/80 border-emerald-500/40',
    };
  }
  return {
    status: 'unknown',
    label: 'unknown',
    dotColor: 'yellow',
    colorMeaning: 'unknown',
    dotClass: 'bg-amber-400',
    badgeClass: 'text-amber-200 bg-amber-950/80 border-amber-500/40',
  };
}

/**
 * Selects the next healthy embed source when the current source fails or times out.
 */
export function findNextHealthyEmbedSource(
  embedServers: EmbedServerOption[],
  currentServerId: string,
  healthMap: Record<string, SourceAvailabilityStatus | 'ok' | 'slow' | 'down'> = {},
  failedIds: Set<string> = new Set()
): EmbedServerOption | null {
  if (!Array.isArray(embedServers) || embedServers.length === 0) return null;

  const currentIdx = embedServers.findIndex((s) => s.id === currentServerId);
  const orderedCandidates =
    currentIdx >= 0
      ? [
          ...embedServers.slice(currentIdx + 1),
          ...embedServers.slice(0, currentIdx),
        ]
      : embedServers;

  // Prefer sources that are not marked down and haven't failed in this session
  for (const srv of orderedCandidates) {
    if (srv.id === currentServerId || failedIds.has(srv.id)) continue;
    const dot = resolveSourceHealthDotStatus(healthMap[srv.id]);
    if (dot.status !== 'down') {
      return srv;
    }
  }

  // Fallback to any non-failed source
  for (const srv of orderedCandidates) {
    if (srv.id !== currentServerId && !failedIds.has(srv.id)) {
      return srv;
    }
  }

  return null;
}

export interface SourcePickerProps {
  movieId: number;
  mediaType: 'movie' | 'tv';
  selectedSeason: number;
  selectedEpisode: number;
  isPakDrama: boolean;
  playerMode: 'direct' | 'embed' | 'pak-drama' | 'trailer';
  selectedEmbedId: string;
  embedServers: EmbedServerOption[];
  alternateLanguageStreams: AlternateLanguageStream[];
  activeDirectSourceUrl: string;
  sourceHealthMap: Record<string, SourceAvailabilityStatus | 'ok' | 'slow' | 'down'>;
  isCheckingHealth: boolean;
  isAdminUnlocked: boolean;
  showLinkEditor: boolean;
  youtubeKey?: string;
  activeEmbedUrl?: string;
  onRunHealthChecks: () => void;
  onToggleLinkEditor: () => void;
  onSelectAlternateStream: (alt: AlternateLanguageStream) => void;
  onSelectPakDramaServer: () => void;
  onSelectEmbedServer: (serverId: string) => void;
  onSelectTrailer: () => void;
  onTriggerAutoFailover: () => void;
}

export const SourcePicker: React.FC<SourcePickerProps> = ({
  movieId,
  mediaType,
  selectedSeason,
  selectedEpisode,
  isPakDrama,
  playerMode,
  selectedEmbedId,
  embedServers,
  alternateLanguageStreams,
  activeDirectSourceUrl,
  sourceHealthMap,
  isCheckingHealth,
  isAdminUnlocked,
  showLinkEditor,
  youtubeKey,
  activeEmbedUrl,
  onRunHealthChecks,
  onToggleLinkEditor,
  onSelectAlternateStream,
  onSelectPakDramaServer,
  onSelectEmbedServer,
  onSelectTrailer,
  onTriggerAutoFailover,
}) => {
  return (
    <div className="space-y-3">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <Server className="w-4 h-4 text-[#10d97b] shrink-0" />
          <span>
            {mediaType === 'tv'
              ? `Stream Sources (S${selectedSeason}:E${selectedEpisode})`
              : 'Stream Sources & Audio Tracks'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="check-source-health-btn"
            disabled={isCheckingHealth}
            onClick={onRunHealthChecks}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1 transition-colors"
          >
            <Activity className="w-3.5 h-3.5 text-[#10d97b]" />
            <span>{isCheckingHealth ? 'Checking Sources...' : 'Check Source Health'}</span>
          </button>

          <button
            type="button"
            data-testid="auto-failover-source-btn"
            onClick={onTriggerAutoFailover}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-semibold transition-colors"
            title="Switch to next healthy source automatically"
          >
            Try Next Healthy Source
          </button>

          <span className="text-[11px] font-mono text-slate-400">
            TMDb ID: {movieId} · {mediaType.toUpperCase()}
          </span>

          {isAdminUnlocked && (
            <button
              type="button"
              data-testid="toggle-inline-link-editor-btn"
              onClick={onToggleLinkEditor}
              className="px-2.5 py-1 rounded-lg bg-emerald-950/90 hover:bg-emerald-900 border border-[#10d97b]/50 text-[#10d97b] text-[11px] font-bold flex items-center gap-1 transition-colors"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>
                {showLinkEditor ? 'Close Link Setup' : '+ Attach Stream / Subtitles'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Verified Direct Language Video Streams Bar */}
      {alternateLanguageStreams.length > 0 && (
        <div
          data-testid="verified-language-sources-bar"
          className="p-2.5 rounded-xl bg-emerald-950/40 border border-[#10d97b]/30 flex flex-wrap items-center justify-between gap-2"
        >
          <div className="text-xs font-bold text-[#10d97b] flex items-center gap-1.5">
            <Volume2 className="w-4 h-4" />
            <span>Direct Multi-Language Streams:</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {alternateLanguageStreams.map((alt) => {
              const isActive =
                playerMode === 'direct' && activeDirectSourceUrl === alt.url;
              return (
                <button
                  key={alt.id}
                  type="button"
                  data-testid={`verified-lang-source-btn-${alt.id}`}
                  onClick={() => onSelectAlternateStream(alt)}
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

      {/* User-Friendly Source Buttons ("Source 1", "Source 2", "Source 3" + Health Status Dot) */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
        {embedServers.map((srv, idx) => {
          const isSelected = playerMode === 'embed' && selectedEmbedId === srv.id;
          const friendlyLabel = formatUserFriendlySourceLabel(idx);
          const healthDot = resolveSourceHealthDotStatus(sourceHealthMap[srv.id]);

          return (
            <button
              key={srv.id}
              type="button"
              data-testid={`embed-server-btn-${srv.id}`}
              data-source-friendly-label={friendlyLabel}
              onClick={() => onSelectEmbedServer(srv.id)}
              className={`px-3 sm:px-3.5 py-2 rounded-xl text-xs font-bold transition-colors min-h-[40px] flex items-center justify-between sm:justify-start gap-2 min-w-0 border ${
                isSelected
                  ? 'bg-[#10d97b] text-slate-950 border-[#10d97b] shadow-sm'
                  : 'bg-slate-800/90 text-slate-100 border-slate-700/80 hover:bg-slate-700'
              }`}
            >
              <span className="truncate">{friendlyLabel}</span>
              <span
                data-testid={`source-health-dot-${srv.id}`}
                className="inline-flex items-center gap-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-black/25"
                title={`Source Health: ${healthDot.label}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${healthDot.dotClass}`} />
                <span>{healthDot.label}</span>
              </span>
            </button>
          );
        })}

        {/* Dedicated Pakistani Drama & Hindi Episode Finder */}
        <button
          type="button"
          data-testid="pak-drama-hindi-server-btn"
          onClick={onSelectPakDramaServer}
          className={`px-2.5 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-bold transition-colors min-h-[40px] flex items-center gap-1.5 border min-w-0 ${
            playerMode === 'pak-drama'
              ? 'bg-[#10d97b] text-slate-950 border-[#10d97b] shadow-md'
              : 'bg-emerald-950/80 border-[#10d97b]/50 text-[#10d97b] hover:bg-emerald-900/70'
          }`}
        >
          <Tv className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {isPakDrama || mediaType === 'tv'
              ? `Pak Drama / Urdu (Ep ${selectedEpisode})`
              : 'Hindi / Drama Finder'}
          </span>
        </button>

        {/* Official TMDb Video / Trailer */}
        {youtubeKey && (
          <button
            type="button"
            data-testid="play-official-trailer-btn"
            onClick={onSelectTrailer}
            className={`px-2.5 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-semibold transition-colors min-h-[40px] flex items-center gap-1.5 min-w-0 ${
              playerMode === 'trailer'
                ? 'bg-[#10d97b] text-slate-950 font-bold shadow-sm'
                : 'bg-rose-950/70 border border-rose-500/40 text-rose-200 hover:bg-rose-900/60'
            }`}
          >
            <Youtube className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate">Official Trailer</span>
          </button>
        )}

        {/* Last-Resort Open in New Tab Button */}
        <a
          href={activeEmbedUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="prominent-open-new-tab-btn"
          className="px-2.5 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-extrabold transition-transform active:scale-95 min-h-[40px] flex items-center gap-1.5 min-w-0 bg-gradient-to-r from-[#10d97b] via-[#22e58a] to-[#facc15] text-slate-950 shadow-md shadow-[#10d97b]/25 hover:opacity-95"
        >
          <ExternalLink className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
          <span className="truncate">Open in New Tab</span>
        </a>
      </div>

      {/* Phase 2 (7): Clear Notice on Third-Party Iframe Sources */}
      {playerMode === 'embed' && (
        <div
          data-testid="third-party-iframe-ad-notice"
          className="px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#10d97b] shrink-0" />
            <span>
              Popup-blocking &amp; sandbox protection active. Note: Third-party sources may still show provider ads — keep Adblocker ON or switch to another Source if needed.
            </span>
          </div>
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 hidden sm:block" />
        </div>
      )}
    </div>
  );
};
