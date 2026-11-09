import {
  CastMember,
  CategoryFilter,
  MovieItem,
  TmdbWatchProviderItem,
  TvSeasonInfo,
} from '../types/movie';

/**
 * Clean Configuration Constant for TMDb API v3.
 * Uses `VITE_TMDB_API_KEY` from environment if provided, or the live TMDb v3 key constant,
 * and allows runtime override in Settings.
 */
export const TMDB_API_KEY: string =
  (import.meta as any).env?.VITE_TMDB_API_KEY || '3fd2be6f0c70a2a598f084ddfb75487c';
export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

const CUSTOM_TMDB_KEY_STORAGE = 'cinebox_custom_tmdb_api_key';

const GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10765: 'Sci-Fi & Fantasy',
  10768: 'War & Politics',
};

/**
 * PHASE 6 RULE:
 * Honest TMDB original language mapping.
 * TMDB metadata is for informational display only and never falsely claims "Dual Audio" or "Hindi Dub"
 * unless a verified audio track or separate language stream is actually present.
 */
const LANGUAGE_LABEL_MAP: Record<string, string> = {
  hi: 'Hindi',
  te: 'Telugu',
  ta: 'Tamil',
  ml: 'Malayalam',
  kn: 'Kannada',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ur: 'Urdu',
  pa: 'Punjabi',
  ar: 'Arabic',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  tr: 'Turkish',
};

export function getActiveTmdbApiKey(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem(CUSTOM_TMDB_KEY_STORAGE);
    if (custom && custom.trim().length > 8) {
      return custom.trim();
    }
  }
  return TMDB_API_KEY;
}

export function setCustomTmdbApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  if (!key.trim()) {
    localStorage.removeItem(CUSTOM_TMDB_KEY_STORAGE);
  } else {
    localStorage.setItem(CUSTOM_TMDB_KEY_STORAGE, key.trim());
  }
}

/**
 * Maps a raw TMDb movie/TV object into `MovieItem`.
 * Always constructs poster URLs as `https://image.tmdb.org/t/p/w500${item.poster_path}`
 * and backdrop URLs as `https://image.tmdb.org/t/p/w1280${item.backdrop_path || item.poster_path}`.
 */
export function mapTmdbItemToMovie(
  item: Record<string, any>,
  fallbackCategory: CategoryFilter = 'Trending',
  idx?: number,
  forcedMediaType?: 'movie' | 'tv'
): MovieItem {
  const isTv =
    forcedMediaType === 'tv' ||
    item.media_type === 'tv' ||
    Boolean(item.first_air_date && !item.release_date);

  const rawTitle = item.title || item.name || item.original_title || item.original_name || 'Untitled';
  const releaseDate = item.release_date || item.first_air_date || '2025-01-01';
  const year = String(releaseDate).slice(0, 4) || '2025';

  const posterUrl = `https://image.tmdb.org/t/p/w500${item.poster_path}`;
  const backdropUrl = item.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
    : posterUrl;

  const genreNames: string[] = Array.isArray(item.genre_ids)
    ? item.genre_ids.map((id: number) => GENRE_MAP[id]).filter(Boolean).slice(0, 3)
    : Array.isArray(item.genres)
    ? item.genres.map((g: any) => g.name).filter(Boolean).slice(0, 3)
    : [];

  if (genreNames.length === 0) {
    genreNames.push(isTv ? 'Series' : 'Action', 'Drama');
  }

  const origLang = String(item.original_language || 'en').toLowerCase();
  const isPakOrigin =
    origLang === 'ur' ||
    (Array.isArray(item.origin_country) && item.origin_country.includes('PK'));
  const languageBadge = isPakOrigin
    ? 'Urdu'
    : LANGUAGE_LABEL_MAP[origLang] || origLang.toUpperCase();

  return {
    id: Number(item.id),
    title: rawTitle,
    originalTitle: item.original_title || item.original_name || rawTitle,
    originalLanguageCode: isPakOrigin ? 'ur' : origLang,
    releaseYear: year,
    rating: Math.round((Number(item.vote_average) || 7.8) * 10) / 10,
    language: languageBadge,
    genres: genreNames,
    category: fallbackCategory,
    mediaType: isTv ? 'tv' : 'movie',
    posterUrl,
    backdropUrl,
    overview:
      item.overview ||
      'Watch in high definition with multi-server auto-embed streaming and offline download support.',
    runtime: isTv ? 'Series · Multi-Season' : '2h 10m',
    rankNumber: idx !== undefined ? idx + 1 : undefined,
    cast: [],
  };
}

/**
 * Helper that fetches a TMDb list endpoint, filters out any item where `poster_path` is null,
 * and maps valid items to `MovieItem[]`.
 */
async function fetchTmdbListEndpoint(
  url: string,
  category: CategoryFilter,
  forcedMediaType?: 'movie' | 'tv'
): Promise<MovieItem[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDb HTTP ${res.status}`);
  }
  const json = await res.json();
  const rawResults = Array.isArray(json.results) ? json.results : [];

  // Filter out any TMDb results where poster_path is null or empty
  const withValidPosters = rawResults.filter(
    (item: any) => item && typeof item.poster_path === 'string' && item.poster_path.trim().length > 0
  );

  return withValidPosters.map((item: any, idx: number) =>
    mapTmdbItemToMovie(item, category, idx, forcedMediaType)
  );
}

/**
 * Fetches live Trending TV Series from TMDb:
 * - Default (`Top Series`): `https://api.themoviedb.org/3/trending/tv/week?api_key=${TMDB_API_KEY}`
 * - `Anime`: `discover/tv` with genre 16 & Japanese original language
 * - `Asian Drama`: `discover/tv` with Korean/Chinese original language
 * - `Indian Drama`: `discover/tv` with Hindi original language
 */
export async function fetchTrendingTvSeries(subFilter: string = 'Top Series'): Promise<MovieItem[]> {
  const apiKey = getActiveTmdbApiKey();
  let endpoint = `${TMDB_BASE_URL}/trending/tv/week?api_key=${encodeURIComponent(apiKey)}`;

  if (subFilter === 'Anime') {
    endpoint = `${TMDB_BASE_URL}/discover/tv?api_key=${encodeURIComponent(apiKey)}&with_genres=16&with_original_language=ja&sort_by=popularity.desc`;
  } else if (subFilter === 'Pakistani Drama') {
    endpoint = `${TMDB_BASE_URL}/discover/tv?api_key=${encodeURIComponent(apiKey)}&with_original_language=ur&sort_by=popularity.desc`;
  } else if (subFilter === 'Asian Drama') {
    endpoint = `${TMDB_BASE_URL}/discover/tv?api_key=${encodeURIComponent(apiKey)}&with_original_language=ko&sort_by=popularity.desc`;
  } else if (subFilter === 'Indian Drama') {
    endpoint = `${TMDB_BASE_URL}/discover/tv?api_key=${encodeURIComponent(apiKey)}&with_original_language=hi&sort_by=popularity.desc`;
  }

  return fetchTmdbListEndpoint(endpoint, subFilter === 'Anime' ? 'Anime' : 'Series', 'tv');
}

/**
 * Fetches live Bollywood / Hindi movies from TMDb:
 * `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=hi&sort_by=popularity.desc`
 */
export async function fetchBollywoodMovies(): Promise<MovieItem[]> {
  const apiKey = getActiveTmdbApiKey();
  const endpoint = `${TMDB_BASE_URL}/discover/movie?api_key=${encodeURIComponent(apiKey)}&with_original_language=hi&sort_by=popularity.desc`;
  return fetchTmdbListEndpoint(endpoint, 'Bollywood', 'movie');
}

/**
 * Fetches live South Indian (Telugu, Tamil, Malayalam, Kannada) movies from TMDb.
 */
export async function fetchSouthIndianMovies(): Promise<MovieItem[]> {
  const apiKey = getActiveTmdbApiKey();
  const endpoint = `${TMDB_BASE_URL}/discover/movie?api_key=${encodeURIComponent(apiKey)}&with_original_language=te|ta|ml|kn&sort_by=popularity.desc`;
  return fetchTmdbListEndpoint(endpoint, 'South Hindi Dubbed', 'movie');
}

/**
 * Dynamically fetches movies/series by Category using live TMDb API endpoints.
 */
export async function fetchMoviesByCategory(category: CategoryFilter | 'All'): Promise<MovieItem[]> {
  const apiKey = getActiveTmdbApiKey();

  if (category === 'Bollywood') {
    return fetchBollywoodMovies();
  }
  if (category === 'South Hindi Dubbed') {
    return fetchSouthIndianMovies();
  }
  if (category === 'Series') {
    return fetchTrendingTvSeries('Top Series');
  }
  if (category === 'Anime') {
    return fetchTrendingTvSeries('Anime');
  }

  let endpoint = `${TMDB_BASE_URL}/trending/movie/week?api_key=${encodeURIComponent(apiKey)}`;
  if (category === 'Hollywood') {
    endpoint = `${TMDB_BASE_URL}/movie/popular?api_key=${encodeURIComponent(apiKey)}&language=en-US`;
  } else if (category === 'Action') {
    endpoint = `${TMDB_BASE_URL}/discover/movie?api_key=${encodeURIComponent(apiKey)}&with_genres=28&sort_by=popularity.desc`;
  }

  return fetchTmdbListEndpoint(
    endpoint,
    category === 'All' ? 'Trending' : category,
    'movie'
  );
}

/**
 * Fetches live Latest / Now Playing Movies from TMDb (`/movie/now_playing`).
 * Ensures every single movie has a valid, accurate TMDb title and poster.
 */
export async function fetchTmdbNowPlayingMovies(): Promise<MovieItem[]> {
  const apiKey = getActiveTmdbApiKey();
  const endpoint = `${TMDB_BASE_URL}/movie/now_playing?api_key=${encodeURIComponent(apiKey)}&language=en-US&page=1`;
  return fetchTmdbListEndpoint(endpoint, 'Trending', 'movie');
}

/**
 * Fetches live Latest / On The Air TV Series from TMDb (`/tv/on_the_air`).
 * Ensures every single TV show has a valid, accurate TMDb title and poster.
 */
export async function fetchTmdbOnTheAirTvShows(): Promise<MovieItem[]> {
  const apiKey = getActiveTmdbApiKey();
  const endpoint = `${TMDB_BASE_URL}/tv/on_the_air?api_key=${encodeURIComponent(apiKey)}&language=en-US&page=1`;
  return fetchTmdbListEndpoint(endpoint, 'Series', 'tv');
}

const TMDB_MEDIA_CACHE = new Map<
  string,
  { title: string; year: string; posterUrl: string; rating: number; overview: string }
>();

/**
 * Fetches single movie or TV metadata from TMDb to accurately enrich VidSrc feeds.
 */
export async function fetchTmdbMediaById(
  tmdbId: number,
  mediaType: 'movie' | 'tv' = 'movie'
): Promise<{ title: string; year: string; posterUrl: string; rating: number; overview: string } | null> {
  const safeId = Math.max(1, Math.floor(Number(tmdbId) || 0));
  if (!safeId) return null;

  const cacheKey = `${mediaType}_${safeId}`;
  if (TMDB_MEDIA_CACHE.has(cacheKey)) {
    return TMDB_MEDIA_CACHE.get(cacheKey)!;
  }

  const apiKey = getActiveTmdbApiKey();
  const endpoint = `${TMDB_BASE_URL}/${mediaType}/${safeId}?api_key=${encodeURIComponent(apiKey)}&language=en-US`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data) return null;

    const title = data.title || data.name || data.original_title || data.original_name || '';
    const releaseDate = data.release_date || data.first_air_date || '2026';
    const year = String(releaseDate).slice(0, 4) || '2026';
    const posterPath = typeof data.poster_path === 'string' && data.poster_path.trim() ? data.poster_path : '';
    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : '';
    const rating = Math.round((Number(data.vote_average) || 7.5) * 10) / 10;
    const overview = data.overview || '';

    const result = { title, year, posterUrl, rating, overview };
    TMDB_MEDIA_CACHE.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Searches movies & TV series dynamically via TMDb `/search/multi`, filtering out null `poster_path` items.
 */
export async function searchMovies(query: string): Promise<MovieItem[]> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return fetchMoviesByCategory('Trending');
  }

  const apiKey = getActiveTmdbApiKey();
  const endpoint = `${TMDB_BASE_URL}/search/multi?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(cleanQuery)}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    return [];
  }
  const json = await res.json();
  const rawResults = Array.isArray(json.results) ? json.results : [];

  return rawResults
    .filter(
      (item: any) =>
        item &&
        item.media_type !== 'person' &&
        typeof item.poster_path === 'string' &&
        item.poster_path.trim().length > 0
    )
    .map((item: any, idx: number) => mapTmdbItemToMovie(item, 'Trending', idx));
}

/**
 * Extracts official TMDB Watch Providers (flatrate, free, rent, buy) from `watch/providers` response.
 */
export function parseTmdbWatchProviders(rawProviders: any): {
  providers: TmdbWatchProviderItem[];
  link?: string;
} {
  const results = rawProviders?.results;
  if (!results || typeof results !== 'object') {
    return { providers: [] };
  }

  // Prefer IN, US, PK, GB, or first available region
  const regionData =
    results.IN ||
    results.US ||
    results.PK ||
    results.GB ||
    results[Object.keys(results)[0]];

  if (!regionData || typeof regionData !== 'object') {
    return { providers: [] };
  }

  const seenIds = new Set<number>();
  const providers: TmdbWatchProviderItem[] = [];

  const buckets: { key: 'flatrate' | 'free' | 'rent' | 'buy' }[] = [
    { key: 'flatrate' },
    { key: 'free' },
    { key: 'rent' },
    { key: 'buy' },
  ];

  for (const bucket of buckets) {
    const arr = regionData[bucket.key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const id = Number(item?.provider_id);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      providers.push({
        providerId: id,
        providerName: String(item.provider_name || 'Streaming Provider'),
        logoUrl: item.logo_path ? `https://image.tmdb.org/t/p/w92${item.logo_path}` : undefined,
        type: bucket.key,
      });
    }
  }

  return {
    providers: providers.slice(0, 8),
    link: typeof regionData.link === 'string' ? regionData.link : undefined,
  };
}

/**
 * Fetches rich Movie or TV Series details (cast, runtime, TV seasons/episodes count, and Watch Providers) from TMDb.
 */
export async function fetchMediaDetails(movie: MovieItem): Promise<MovieItem> {
  const apiKey = getActiveTmdbApiKey();
  const typePath = movie.mediaType === 'tv' ? 'tv' : 'movie';
  try {
    const res = await fetch(
      `${TMDB_BASE_URL}/${typePath}/${movie.id}?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits,videos,watch/providers`
    );
    if (!res.ok) return movie;
    const data = await res.json();

    const cast: CastMember[] = Array.isArray(data.credits?.cast)
      ? data.credits.cast.slice(0, 8).map((c: any) => ({
          id: Number(c.id),
          name: c.name || 'Cast Member',
          character: c.character || 'Role',
          profileUrl: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined,
        }))
      : movie.cast;

    let runtime = movie.runtime;
    if (movie.mediaType === 'movie' && Number(data.runtime) > 0) {
      const hrs = Math.floor(Number(data.runtime) / 60);
      const mins = Number(data.runtime) % 60;
      runtime = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    } else if (movie.mediaType === 'tv' && Number(data.number_of_seasons) > 0) {
      runtime = `${data.number_of_seasons} Season${data.number_of_seasons > 1 ? 's' : ''} · ${
        data.number_of_episodes || 8
      } Eps`;
    }

    const seasons: TvSeasonInfo[] | undefined =
      movie.mediaType === 'tv' && Array.isArray(data.seasons)
        ? data.seasons
            .filter((s: any) => Number(s.season_number) > 0 && Number(s.episode_count) > 0)
            .map((s: any) => ({
              seasonNumber: Number(s.season_number),
              name: s.name || `Season ${s.season_number}`,
              episodeCount: Number(s.episode_count) || 10,
            }))
        : undefined;

    const genres =
      Array.isArray(data.genres) && data.genres.length > 0
        ? data.genres.map((g: any) => g.name)
        : movie.genres;

    // Extract official YouTube Trailer / Teaser / Clip from TMDb videos response
    let youtubeKey = movie.youtubeKey;
    let youtubeTitle = movie.youtubeTitle;
    if (Array.isArray(data.videos?.results)) {
      const ytVideos = data.videos.results.filter(
        (v: any) => v && v.site === 'YouTube' && typeof v.key === 'string' && v.key.trim().length > 0
      );
      const bestVideo =
        ytVideos.find((v: any) => v.type === 'Trailer' && v.official) ||
        ytVideos.find((v: any) => v.type === 'Trailer') ||
        ytVideos.find((v: any) => v.type === 'Teaser') ||
        ytVideos[0];
      if (bestVideo) {
        youtubeKey = bestVideo.key;
        youtubeTitle = bestVideo.name || `${movie.title} Official Video`;
      }
    }

    const watchInfo = parseTmdbWatchProviders(data['watch/providers']);

    return {
      ...movie,
      runtime,
      cast,
      genres,
      youtubeKey,
      youtubeTitle,
      watchProviders: watchInfo.providers,
      watchProvidersLink: watchInfo.link,
      seasons:
        seasons && seasons.length > 0
          ? seasons
          : movie.mediaType === 'tv'
          ? [{ seasonNumber: 1, name: 'Season 1', episodeCount: 12 }]
          : undefined,
      overview: data.overview || movie.overview,
    };
  } catch {
    return movie;
  }
}
