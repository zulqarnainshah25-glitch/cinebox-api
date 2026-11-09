import React, { useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FolderDown,
  MoreVertical,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { DownloadItem, MovieItem } from '../types/movie';

interface DownloadsViewProps {
  appName: string;
  downloads: DownloadItem[];
  recommendedMovies: MovieItem[];
  isOfflineSimulated: boolean;
  onToggleOfflineSimulation: () => void;
  onPlayOfflineItem: (item: DownloadItem) => void;
  onPauseDownload: (itemId: string) => void;
  onResumeDownload: (itemId: string) => void;
  onDeleteDownload: (itemId: string) => void;
  onExportItemToDevice: (item: DownloadItem) => void;
  onSelectMovie: (movie: MovieItem) => void;
  onRefreshRecommendations: () => void;
  onOpenDeliverables: () => void;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  appName,
  downloads,
  recommendedMovies,
  isOfflineSimulated,
  onToggleOfflineSimulation,
  onPlayOfflineItem,
  onPauseDownload,
  onResumeDownload,
  onDeleteDownload,
  onExportItemToDevice,
  onSelectMovie,
  onRefreshRecommendations,
  onOpenDeliverables,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'local' | 'received'>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filteredDownloads = downloads.filter((d) => {
    if (activeSubTab === 'all') return true;
    if (activeSubTab === 'local') return Boolean(d.exportedDevicePath) || d.categoryTag === 'local';
    return d.categoryTag === 'received';
  });

  const usedGB = downloads.reduce((sum, item) => sum + item.downloadedMB / 1024, 0);
  const availableGB = Math.max(1.2, Math.round((23.6 - usedGB) * 10) / 10);

  return (
    <div className="pb-24 px-4 sm:px-6 pt-3 max-w-7xl mx-auto space-y-6">
      {/* Top Header: `Downloads` + `Transfer` button (Exact match to Screenshot 6) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Downloads</h1>
          <button
            type="button"
            onClick={onToggleOfflineSimulation}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 border transition-colors ${
              isOfflineSimulated
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <WifiOff className="w-3.5 h-3.5" />
            <span>{isOfflineSimulated ? 'Offline Mode Active' : 'Test Offline Mode'}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenDeliverables}
          className="px-4 py-1.5 rounded-full bg-[#113228] hover:bg-[#164235] border border-[#10d97b]/30 text-[#10d97b] text-xs sm:text-sm font-semibold flex items-center gap-1.5 min-h-[38px] transition-colors"
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>Transfer</span>
        </button>
      </div>

      {/* Sub-header: `Downloaded` + `22.6GB available` */}
      <div className="space-y-3 border-t border-slate-800/80 pt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Downloaded</h2>
          <span className="text-xs sm:text-sm font-mono tabular-nums text-slate-400">
            {availableGB}GB available
          </span>
        </div>

        {/* Filter Pills: `MovieBox 1` | `Local files` | `Received` */}
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveSubTab('all')}
            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors min-h-[36px] ${
              activeSubTab === 'all'
                ? 'bg-white text-slate-950 font-bold'
                : 'bg-[#1a1d26] text-slate-300 hover:bg-slate-800'
            }`}
          >
            {appName} {downloads.length}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('local')}
            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors min-h-[36px] ${
              activeSubTab === 'local'
                ? 'bg-white text-slate-950 font-bold'
                : 'bg-[#1a1d26] text-slate-300 hover:bg-slate-800'
            }`}
          >
            Local files ({downloads.filter((d) => d.exportedDevicePath).length})
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('received')}
            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors min-h-[36px] ${
              activeSubTab === 'received'
                ? 'bg-white text-slate-950 font-bold'
                : 'bg-[#1a1d26] text-slate-300 hover:bg-slate-800'
            }`}
          >
            Received
          </button>
        </div>

        {/* Downloaded Movies List (Exact match to `720P Immortal [Hindi]` row in Screenshot 6) */}
        {filteredDownloads.length === 0 ? (
          <div className="py-8 px-4 rounded-2xl bg-[#131722] border border-slate-800/80 text-center space-y-2">
            <Download className="w-8 h-8 text-slate-500 mx-auto" />
            <p className="text-sm font-semibold text-slate-300">No files in this folder yet</p>
            <p className="text-xs text-slate-500">
              Tap any movie below or in the Home tab to download in 480p/720p/1080p or export to your phone.
            </p>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            {filteredDownloads.map((item) => {
              const isDownloading = item.status === 'downloading';
              const isPaused = item.status === 'paused';
              const isFailed = item.status === 'failed';

              return (
                <div
                  key={item.id}
                  className="relative flex items-center gap-3.5 p-2.5 rounded-2xl bg-[#12151e] hover:bg-[#171b26] border border-slate-800/70 transition-colors"
                >
                  {/* Left 16:9 Thumbnail with Play button & Bottom Progress Bar */}
                  <button
                    type="button"
                    onClick={() => onPlayOfflineItem(item)}
                    aria-label={`Play ${item.title} offline`}
                    className="relative w-32 sm:w-40 aspect-video rounded-xl overflow-hidden bg-slate-900 shrink-0 group focus:outline-none"
                  >
                    <img
                      src={item.backdropUrl || item.posterUrl}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                      <div className="w-9 h-9 rounded-full bg-white/90 text-slate-950 flex items-center justify-center shadow-md">
                        <Play className="w-5 h-5 fill-slate-950 ml-0.5" />
                      </div>
                    </div>
                    {/* Bottom Progress Bar on Thumbnail */}
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-slate-700/80">
                      <div
                        className="h-full bg-[#10d97b] transition-all duration-300"
                        style={{
                          width: `${
                            isDownloading || isPaused
                              ? item.progress
                              : Math.max(15, item.watchedPercent)
                          }%`,
                        }}
                      />
                    </div>
                  </button>

                  {/* Middle Metadata Stack */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onPlayOfflineItem(item)}
                        className="text-sm sm:text-base font-bold text-white hover:text-[#10d97b] truncate text-left"
                      >
                        {item.title}
                      </button>

                      {/* Three Dots Action Menu */}
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenMenuId(openMenuId === item.id ? null : item.id)
                          }
                          aria-label={`Options for ${item.title}`}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-white rounded-lg"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {openMenuId === item.id && (
                          <div className="absolute right-0 top-9 z-30 w-48 rounded-xl bg-[#1c212e] border border-slate-700 shadow-xl py-1.5 text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                onPlayOfflineItem(item);
                              }}
                              className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2"
                            >
                              <Play className="w-3.5 h-3.5 text-[#10d97b]" />
                              <span>Play Offline In-App</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                onExportItemToDevice(item);
                              }}
                              className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2"
                            >
                              <FolderDown className="w-3.5 h-3.5 text-amber-300" />
                              <span>Export to /Download/</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                onDeleteDownload(item.id);
                              }}
                              className="w-full px-3.5 py-2 text-left text-rose-400 hover:bg-slate-800 flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Offline File</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Size & Live Progress Indicator */}
                    <div className="text-xs font-mono tabular-nums text-slate-400">
                      {isDownloading ? (
                        <span className="text-[#10d97b] font-semibold">
                          Downloading {item.progress.toFixed(0)}% · {item.downloadedMB}MB /{' '}
                          {item.fileSizeMB}MB · {item.speedMBps} MB/s
                        </span>
                      ) : isPaused ? (
                        <span className="text-amber-400">
                          Paused at {item.progress.toFixed(0)}% ({item.downloadedMB}MB /{' '}
                          {item.fileSizeMB}MB)
                        </span>
                      ) : isFailed ? (
                        <span className="text-rose-400 font-semibold">
                          {item.errorMessage || 'Download failed — check stream URL or retry.'}
                        </span>
                      ) : (
                        <span>{item.fileSizeMB}MB</span>
                      )}
                    </div>

                    {/* Bottom Status + Cream/Gold `[Save]` Button (Exact match to Screenshot 6) */}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="text-xs text-slate-400 truncate">
                        {item.exportedDevicePath ? (
                          <span className="text-[#10d97b] flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">Saved: {item.exportedDevicePath}</span>
                          </span>
                        ) : (
                          <span>{item.watchedPercent || 15}% watched</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isDownloading && (
                          <button
                            type="button"
                            onClick={() => onPauseDownload(item.id)}
                            aria-label={`Pause download ${item.title}`}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 flex items-center gap-1 min-h-[32px]"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause</span>
                          </button>
                        )}

                        {(isPaused || isFailed) && (
                          <button
                            type="button"
                            onClick={() => onResumeDownload(item.id)}
                            aria-label={`${isFailed ? 'Retry' : 'Resume'} download ${item.title}`}
                            className="px-2.5 py-1 rounded-lg bg-[#10d97b] text-slate-950 text-xs font-bold flex items-center gap-1 min-h-[32px]"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>{isFailed ? 'Retry' : 'Resume'}</span>
                          </button>
                        )}

                        {/* Gold/Cream `[Save]` button ("Save to Device / Export to Phone") */}
                        <button
                          type="button"
                          onClick={() => onExportItemToDevice(item)}
                          aria-label={`Save ${item.title} to device public storage`}
                          className="px-3 py-1 rounded-lg bg-[#f3e5ab] hover:bg-[#ebd88b] text-slate-950 font-bold text-xs flex items-center gap-1 shadow-sm transition-colors min-h-[32px]"
                        >
                          <FolderDown className="w-3.5 h-3.5" />
                          <span>Save</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===================================================================
          "FOR YOU" RECOMMENDED MOVIES GRID (Exact match to Screenshot 6)
         =================================================================== */}
      <div className="space-y-3.5 pt-2">
        <h2 className="text-lg font-bold text-white">For You</h2>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {recommendedMovies.slice(0, 6).map((movie) => (
            <button
              key={movie.id}
              type="button"
              onClick={() => onSelectMovie(movie)}
              className="group text-left flex flex-col rounded-xl overflow-hidden bg-[#141822] border border-slate-800/60 hover:border-slate-700 transition-all focus:outline-none"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-900">
                <img
                  src={movie.posterUrl}
                  alt={movie.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {/* Top-Right Language Tag (`Hindi`) matching Screenshot 6 */}
                <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-slate-100">
                  {movie.language}
                </span>
              </div>
              <div className="p-2">
                <div className="text-xs font-medium text-slate-200 truncate group-hover:text-[#10d97b]">
                  {movie.title}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Bottom `[Refresh new content]` Button (Exact match to Screenshot 6) */}
        <button
          type="button"
          onClick={onRefreshRecommendations}
          className="w-full py-3.5 rounded-xl bg-[#191d27] hover:bg-[#222734] text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 transition-colors min-h-[48px]"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh new content</span>
        </button>
      </div>
    </div>
  );
};
