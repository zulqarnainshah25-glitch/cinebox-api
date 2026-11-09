import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ExternalLink,
  Flame,
  Maximize2,
  Play,
  RefreshCw,
  Search,
  Tv,
  X,
  Youtube,
} from 'lucide-react';
import {
  fetchPakistaniDramasFromYouTube,
  OFFICIAL_PAK_DRAMA_CHANNELS,
  PakDramaChannelKey,
  PakDramaSortOrder,
  YouTubeDramaVideoItem,
} from '../services/youtubeDramaService';
import { lockScreenOrientationSafely } from '../utils/streamResolver';

interface PakistaniDramasSectionProps {
  isFullTab?: boolean;
}

export const PakistaniDramasSection: React.FC<PakistaniDramasSectionProps> = ({
  isFullTab = false,
}) => {
  const [selectedChannel, setSelectedChannel] = useState<PakDramaChannelKey>('ALL');
  const [sortOrder, setSortOrder] = useState<PakDramaSortOrder>('date');
  const [searchInput, setSearchInput] = useState<string>('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState<string>('');

  const [dramaItems, setDramaItems] = useState<YouTubeDramaVideoItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isQuotaError, setIsQuotaError] = useState<boolean>(false);
  const [activeVideo, setActiveVideo] = useState<YouTubeDramaVideoItem | null>(null);
  const [isDramaFullscreen, setIsDramaFullscreen] = useState<boolean>(false);

  const loadDramas = async (forceRefresh: boolean = false) => {
    setIsLoading(true);
    setErrorMessage(null);
    setIsQuotaError(false);

    const res = await fetchPakistaniDramasFromYouTube({
      channelKey: selectedChannel,
      searchQuery: appliedSearchQuery,
      sortOrder,
      maxResults: 20,
      forceRefresh,
    });

    setIsLoading(false);
    if (!res.ok) {
      setDramaItems([]);
      setIsQuotaError(res.quotaExceeded);
      setErrorMessage(
        res.errorMessage || (res.quotaExceeded ? 'Please try again later' : 'Content Unavailable, Try Again')
      );
      return;
    }

    setDramaItems(res.items);
  };

  useEffect(() => {
    loadDramas(false);
  }, [selectedChannel, sortOrder, appliedSearchQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearchQuery(searchInput.trim());
  };

  return (
    <section
      data-testid="pakistani-dramas-youtube-section"
      className="px-3 sm:px-6 space-y-4"
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-extrabold uppercase tracking-wider text-[#10d97b]">
              🇵🇰 Official YouTube Data API v3
            </span>
            <h2 className="text-base sm:text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <Tv className="w-5 h-5 text-[#10d97b]" />
              <span>Pakistani Dramas (HUM TV · ARY Digital · Har Pal Geo · GEO TV)</span>
            </h2>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
            Watch full HD episodes directly from verified official Pakistani Drama YouTube channels.
          </p>
        </div>

        {/* Latest / Popular Sort Filter Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="pak-drama-sort-latest"
            onClick={() => setSortOrder('date')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              sortOrder === 'date'
                ? 'bg-[#10d97b] text-slate-950 shadow-sm'
                : 'bg-[#171b24] text-slate-300 border border-slate-800 hover:text-white'
            }`}
          >
            Latest
          </button>
          <button
            type="button"
            data-testid="pak-drama-sort-popular"
            onClick={() => setSortOrder('viewCount')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 ${
              sortOrder === 'viewCount'
                ? 'bg-[#10d97b] text-slate-950 shadow-sm'
                : 'bg-[#171b24] text-slate-300 border border-slate-800 hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Popular</span>
          </button>
          <button
            type="button"
            data-testid="pak-drama-refresh-btn"
            onClick={() => loadDramas(true)}
            aria-label="Refresh Pakistani Dramas"
            className="p-2 rounded-xl bg-[#171b24] border border-slate-800 text-slate-300 hover:text-[#10d97b]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#10d97b]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Channel Filter Pills + Drama Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <button
            type="button"
            data-testid="pak-channel-btn-ALL"
            onClick={() => setSelectedChannel('ALL')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              selectedChannel === 'ALL'
                ? 'bg-white text-slate-950 font-bold'
                : 'bg-[#171b24] text-slate-300 hover:bg-slate-800'
            }`}
          >
            All Channels
          </button>
          {OFFICIAL_PAK_DRAMA_CHANNELS.map((ch) => {
            const active = selectedChannel === ch.key;
            return (
              <button
                key={ch.key}
                type="button"
                data-testid={`pak-channel-btn-${ch.key}`}
                onClick={() => setSelectedChannel(ch.key)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-white text-slate-950 font-bold'
                    : 'bg-[#171b24] text-slate-300 hover:bg-slate-800'
                }`}
              >
                {ch.name}
              </button>
            );
          })}
        </div>

        <form
          onSubmit={handleSearchSubmit}
          className="flex items-center gap-2 w-full md:w-80 bg-[#171b24] border border-slate-700/80 rounded-xl px-3 py-1.5 focus-within:border-[#10d97b]"
        >
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="search"
            data-testid="pak-drama-youtube-search-input"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              if (!e.target.value.trim()) {
                setAppliedSearchQuery('');
              }
            }}
            placeholder="Search Pakistani drama (e.g. Tere Bin, Ishq Murshid)..."
            aria-label="Search Pakistani dramas"
            className="w-full bg-transparent text-xs text-white placeholder-slate-400 focus:outline-none"
          />
          <button
            type="submit"
            data-testid="pak-drama-youtube-search-btn"
            className="text-xs font-bold text-[#10d97b] hover:opacity-90 shrink-0"
          >
            Find
          </button>
        </form>
      </div>

      {/* Active Embedded YouTube Drama Player Modal / Panel */}
      {activeVideo && (
        <div
          data-testid="pak-drama-youtube-player-panel"
          className="rounded-2xl bg-[#000000] border border-[#10d97b]/50 overflow-hidden shadow-2xl space-y-3 p-3 sm:p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-rose-600/20 border border-rose-500/40 text-rose-300 text-[10px] font-bold flex items-center gap-1">
                  <Youtube className="w-3 h-3" />
                  <span>{activeVideo.channelTitle}</span>
                </span>
                {activeVideo.durationFormatted && (
                  <span className="text-[11px] font-mono text-slate-400">
                    {activeVideo.durationFormatted}
                  </span>
                )}
              </div>
              <h3 className="text-xs sm:text-sm font-bold text-white truncate mt-1">
                {activeVideo.title}
              </h3>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="pak-drama-fullscreen-btn"
                onClick={() => {
                  setIsDramaFullscreen(true);
                  lockScreenOrientationSafely('landscape').catch(() => {});
                }}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-xs flex items-center gap-1.5"
              >
                <Maximize2 className="w-3.5 h-3.5 text-[#10d97b]" />
                <span>Fullscreen</span>
              </button>
              <a
                href={activeVideo.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="pak-drama-open-new-tab-btn"
                className="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in New Tab</span>
              </a>
              <button
                type="button"
                data-testid="pak-drama-close-player-btn"
                onClick={() => {
                  setIsDramaFullscreen(false);
                  lockScreenOrientationSafely('portrait').catch(() => {});
                  setActiveVideo(null);
                }}
                aria-label="Close Drama Player"
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            className={
              isDramaFullscreen
                ? 'cinebox-player-fullscreen fixed inset-0 z-[9999] w-[100vw] h-[100vh] h-[100dvh] bg-[#000000] overflow-hidden border-0 m-0 p-0'
                : 'relative aspect-video w-full rounded-xl overflow-hidden bg-[#000000]'
            }
            style={{ backgroundColor: '#000000' }}
          >
            {isDramaFullscreen && (
              <button
                type="button"
                data-testid="pak-drama-exit-fullscreen-btn"
                onClick={() => {
                  setIsDramaFullscreen(false);
                  lockScreenOrientationSafely('portrait').catch(() => {});
                }}
                aria-label="Exit Fullscreen"
                className="fixed top-[max(0.75rem,env(safe-area-inset-top,12px))] left-[max(0.75rem,env(safe-area-inset-left,12px))] z-[10000] flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/80 hover:bg-black border border-white/25 text-white text-xs font-extrabold shadow-2xl backdrop-blur-md min-h-[40px]"
              >
                <ChevronLeft className="w-4 h-4 text-[#10d97b] stroke-[2.5]" />
                <span>Back / Exit Fullscreen</span>
                <X className="w-3.5 h-3.5 text-slate-300 ml-0.5" />
              </button>
            )}
            <iframe
              data-testid="pak-drama-youtube-iframe"
              src={activeVideo.embedUrl}
              title={activeVideo.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="w-full h-full border-0 bg-[#000000]"
              style={{ backgroundColor: '#000000' }}
            />
          </div>
        </div>
      )}

      {/* Quota Limit / API Failure Banner */}
      {errorMessage && (
        <div
          data-testid="pak-drama-error-banner"
          className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-rose-200 font-semibold">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {!isQuotaError && (
            <button
              type="button"
              data-testid="pak-drama-retry-btn"
              onClick={() => loadDramas(true)}
              className="px-3.5 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-xs"
            >
              Try Again
            </button>
          )}
        </div>
      )}

      {/* Drama Posters Grid View */}
      {dramaItems.length > 0 ? (
        <div
          data-testid="pak-drama-grid"
          className={`grid gap-3.5 ${
            isFullTab
              ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
              : 'grid-cols-2 sm:grid-cols-4'
          }`}
        >
          {(isFullTab ? dramaItems : dramaItems.slice(0, 8)).map((item) => {
            const isPlaying = activeVideo?.videoId === item.videoId;
            return (
              <div
                key={item.videoId}
                data-testid={`pak-drama-card-${item.videoId}`}
                onClick={() => setActiveVideo(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setActiveVideo(item);
                }}
                className={`group rounded-2xl overflow-hidden bg-[#141821] border transition-all cursor-pointer flex flex-col justify-between ${
                  isPlaying
                    ? 'border-[#10d97b] ring-1 ring-[#10d97b]/50'
                    : 'border-slate-800/80 hover:border-slate-600'
                }`}
              >
                <div className="relative aspect-[16/10] w-full bg-slate-950 overflow-hidden">
                  <img
                    src={item.posterUrl}
                    alt={item.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-sm border border-white/15 text-[10px] font-bold text-[#10d97b]">
                    {item.channelTitle}
                  </span>

                  {item.durationFormatted && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-mono text-white">
                      {item.durationFormatted}
                    </span>
                  )}

                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/35">
                    <div className="w-10 h-10 rounded-full bg-[#10d97b] text-slate-950 flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 fill-slate-950 ml-0.5" />
                    </div>
                  </div>
                </div>

                <div className="p-2.5 space-y-1">
                  <h3 className="text-xs font-bold text-slate-100 line-clamp-2 group-hover:text-[#10d97b] transition-colors">
                    {item.title}
                  </h3>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{item.viewCountFormatted || 'Official HD'}</span>
                    <span className="text-[#10d97b] font-semibold">Watch Ep</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !isLoading &&
        !errorMessage && (
          <div className="p-6 rounded-2xl bg-[#141821] border border-slate-800 text-center text-xs text-slate-400">
            No Pakistani Drama episodes matched your filter. Try clearing the search box.
          </div>
        )
      )}
    </section>
  );
};
