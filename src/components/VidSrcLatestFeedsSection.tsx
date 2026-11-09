import React, { useEffect, useState } from 'react';
import { AlertTriangle, Film, Play, RefreshCw, Tv } from 'lucide-react';
import { MovieItem } from '../types/movie';
import {
  fetchVidSrcLatestFeed,
  VidSrcLatestFeedItem,
} from '../services/vidsrcService';

interface VidSrcLatestFeedsSectionProps {
  fallbackMovies: MovieItem[];
  fallbackSeries: MovieItem[];
  onSelectMovie: (movie: MovieItem) => void;
}

export const VidSrcLatestFeedsSection: React.FC<VidSrcLatestFeedsSectionProps> = ({
  fallbackMovies,
  fallbackSeries,
  onSelectMovie,
}) => {
  const [latestMovies, setLatestMovies] = useState<VidSrcLatestFeedItem[]>([]);
  const [latestTvShows, setLatestTvShows] = useState<VidSrcLatestFeedItem[]>([]);
  const [moviesError, setMoviesError] = useState<string | null>(null);
  const [tvError, setTvError] = useState<string | null>(null);
  const [isLoadingMovies, setIsLoadingMovies] = useState<boolean>(false);
  const [isLoadingTv, setIsLoadingTv] = useState<boolean>(false);

  const loadLatestMoviesFeed = async () => {
    setIsLoadingMovies(true);
    setMoviesError(null);
    const res = await fetchVidSrcLatestFeed('movie', 1);
    setIsLoadingMovies(false);

    if (res.ok && res.items.length > 0) {
      setLatestMovies(res.items.slice(0, 12));
    } else if (fallbackMovies.length > 0) {
      // Map live TMDb catalog into VidSrc.sh feed items so the grid is always populated and playable via vidsrc.sh
      setLatestMovies(
        fallbackMovies.slice(0, 12).map((m) => ({
          tmdbId: m.id,
          title: m.title,
          year: m.releaseYear,
          quality: 'HD 1080P',
          embedUrlTmdb: `https://vidsrc.sh/embed/movie/${m.id}?ds_lang=en`,
          posterUrl: m.posterUrl,
          mediaType: 'movie',
        }))
      );
    } else {
      setMoviesError(res.errorMessage || 'Content Unavailable, Try Again');
    }
  };

  const loadLatestTvFeed = async () => {
    setIsLoadingTv(true);
    setTvError(null);
    const res = await fetchVidSrcLatestFeed('tv', 1);
    setIsLoadingTv(false);

    if (res.ok && res.items.length > 0) {
      setLatestTvShows(res.items.slice(0, 12));
    } else if (fallbackSeries.length > 0) {
      setLatestTvShows(
        fallbackSeries.slice(0, 12).map((s) => ({
          tmdbId: s.id,
          title: s.title,
          year: s.releaseYear,
          quality: 'HD S1:E1',
          embedUrlTmdb: `https://vidsrc.sh/embed/tv/${s.id}/1/1?ds_lang=en`,
          posterUrl: s.posterUrl,
          mediaType: 'tv',
        }))
      );
    } else {
      setTvError(res.errorMessage || 'Content Unavailable, Try Again');
    }
  };

  useEffect(() => {
    loadLatestMoviesFeed();
  }, [fallbackMovies.length]);

  useEffect(() => {
    loadLatestTvFeed();
  }, [fallbackSeries.length]);

  const handleOpenFeedItem = (item: VidSrcLatestFeedItem) => {
    const existing = [...fallbackMovies, ...fallbackSeries].find((m) => m.id === item.tmdbId);
    if (existing) {
      onSelectMovie(existing);
      return;
    }

    const mapped: MovieItem = {
      id: item.tmdbId,
      title: item.title,
      releaseYear: item.year || '2026',
      rating: 7.8,
      language: 'English',
      originalLanguageCode: 'en',
      genres: [item.mediaType === 'tv' ? 'TV Series' : 'Movie'],
      category: item.mediaType === 'tv' ? 'Series' : 'Hollywood',
      mediaType: item.mediaType,
      posterUrl: item.posterUrl,
      backdropUrl: item.posterUrl,
      overview: `Streaming via VidSrc.sh (${item.quality}) — ${item.embedUrlTmdb}`,
      runtime: item.mediaType === 'tv' ? '45m' : '2h 05m',
      cast: [],
    };
    onSelectMovie(mapped);
  };

  return (
    <div className="space-y-6 px-3 sm:px-6">
      {/* 1. Latest Movies (VidSrc.sh Feed) */}
      <section data-testid="vidsrc-latest-movies-section" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-[#10d97b]" />
            <h2 className="text-base sm:text-xl font-extrabold text-white tracking-tight">
              Latest Movies
            </h2>
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-[#10d97b]">
              vidsrc.sh
            </span>
            <span className="text-[11px] font-medium text-emerald-400/90 hidden sm:inline">
              · TMDb Verified Posters &amp; Data
            </span>
          </div>
          <button
            type="button"
            onClick={loadLatestMoviesFeed}
            aria-label="Refresh Latest Movies"
            className="text-xs text-slate-400 hover:text-[#10d97b] flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMovies ? 'animate-spin text-[#10d97b]' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {moviesError && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 flex items-center justify-between text-xs text-rose-200">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>{moviesError}</span>
            </span>
            <button
              type="button"
              onClick={loadLatestMoviesFeed}
              className="px-3 py-1 rounded-lg bg-rose-500 text-slate-950 font-bold"
            >
              Try Again
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 sm:gap-3.5">
          {latestMovies.slice(0, 6).map((item) => (
            <div
              key={`latest-movie-${item.tmdbId}`}
              data-testid={`vidsrc-latest-movie-card-${item.tmdbId}`}
              onClick={() => handleOpenFeedItem(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleOpenFeedItem(item);
              }}
              className="group cursor-pointer"
            >
              <div className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-slate-900 border border-slate-800/80">
                <img
                  src={item.posterUrl}
                  alt={item.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-[#10d97b] text-slate-950 text-[9px] font-extrabold uppercase shadow">
                  {item.quality}
                </span>
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="w-9 h-9 rounded-full bg-[#10d97b] text-slate-950 flex items-center justify-center">
                    <Play className="w-4 h-4 fill-slate-950 ml-0.5" />
                  </div>
                </div>
              </div>
              <div className="mt-1.5 text-xs font-medium text-slate-200 truncate group-hover:text-[#10d97b]">
                {item.title}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">{item.year}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Latest TV Shows (VidSrc.sh Feed) */}
      <section data-testid="vidsrc-latest-tvshows-section" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tv className="w-4 h-4 text-[#10d97b]" />
            <h2 className="text-base sm:text-xl font-extrabold text-white tracking-tight">
              Latest TV Shows
            </h2>
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-[#10d97b]">
              vidsrc.sh
            </span>
            <span className="text-[11px] font-medium text-emerald-400/90 hidden sm:inline">
              · TMDb Verified Posters &amp; Data
            </span>
          </div>
          <button
            type="button"
            onClick={loadLatestTvFeed}
            aria-label="Refresh Latest TV Shows"
            className="text-xs text-slate-400 hover:text-[#10d97b] flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTv ? 'animate-spin text-[#10d97b]' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {tvError && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 flex items-center justify-between text-xs text-rose-200">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>{tvError}</span>
            </span>
            <button
              type="button"
              onClick={loadLatestTvFeed}
              className="px-3 py-1 rounded-lg bg-rose-500 text-slate-950 font-bold"
            >
              Try Again
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 sm:gap-3.5">
          {latestTvShows.slice(0, 6).map((item) => (
            <div
              key={`latest-tv-${item.tmdbId}`}
              data-testid={`vidsrc-latest-tv-card-${item.tmdbId}`}
              onClick={() => handleOpenFeedItem(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleOpenFeedItem(item);
              }}
              className="group cursor-pointer"
            >
              <div className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-slate-900 border border-slate-800/80">
                <img
                  src={item.posterUrl}
                  alt={item.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-[#10d97b] text-slate-950 text-[9px] font-extrabold uppercase shadow">
                  {item.quality}
                </span>
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="w-9 h-9 rounded-full bg-[#10d97b] text-slate-950 flex items-center justify-center">
                    <Play className="w-4 h-4 fill-slate-950 ml-0.5" />
                  </div>
                </div>
              </div>
              <div className="mt-1.5 text-xs font-medium text-slate-200 truncate group-hover:text-[#10d97b]">
                {item.title}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">{item.year}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
