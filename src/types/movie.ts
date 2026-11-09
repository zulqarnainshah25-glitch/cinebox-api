export type ThemeColorId = 'neon-green' | 'netflix-red' | 'royal-blue';

export type CategoryFilter =
  | 'Trending'
  | 'Pakistani Dramas'
  | 'Hollywood'
  | 'Bollywood'
  | 'South Hindi Dubbed'
  | 'Action'
  | 'Series'
  | 'Anime';

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profileUrl?: string;
}

export interface TvSeasonInfo {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface TmdbWatchProviderItem {
  providerId: number;
  providerName: string;
  logoUrl?: string;
  type: 'flatrate' | 'rent' | 'buy' | 'free';
}

export interface MovieItem {
  id: number; // TMDb ID
  title: string;
  originalTitle?: string;
  originalLanguageCode?: string;
  releaseYear: string;
  rating: number;
  language: string;
  genres: string[];
  category: CategoryFilter;
  mediaType: 'movie' | 'tv';
  posterUrl: string;
  backdropUrl: string;
  overview: string;
  runtime: string;
  rankNumber?: number;
  cast: CastMember[];
  seasons?: TvSeasonInfo[];
  youtubeKey?: string;
  youtubeTitle?: string;
  isHotShort?: boolean;
  watchProviders?: TmdbWatchProviderItem[];
  watchProvidersLink?: string;
}

/**
 * Represents a separate authorized video stream for a specific language
 * (Phase 2C Scenario 2: Multiple authorized video streams of the same movie, each with a different language).
 */
export interface AlternateLanguageStream {
  id: string;
  label: string; // e.g. "Original (English)", "Hindi Dubbed", "Urdu Dubbed"
  languageCode: string; // ISO code e.g. 'en', 'hi', 'ur'
  languageName: string; // e.g. 'English', 'Hindi', 'Urdu'
  audioType: 'original' | 'dubbed' | 'multi';
  url: string;
  format: 'hls' | 'mp4' | 'dash';
  verified: boolean;
}

export interface MovieLinkRecord {
  tmdb_id: number;
  title?: string;
  language: string;
  direct_video_url: string | null; // Primary .mp4 or .m3u8 direct link
  hindi_dubbed_video_url?: string | null; // Optional separate verified Hindi Dubbed .mp4/.m3u8 stream
  urdu_dubbed_video_url?: string | null; // Optional separate verified Urdu Dubbed .mp4/.m3u8 stream
  alternate_streams?: AlternateLanguageStream[];
  stream_url: string | null; // custom iframe embed link
  download_480p: string | null;
  download_720p: string | null;
  download_1080p?: string | null;
  file_size_480p?: string;
  file_size_720p?: string;
  file_size_1080p?: string;
  updated_at?: string;
}

export type UserRole = 'user' | 'vip' | 'moderator' | 'admin';
export type UserAccountStatus = 'active' | 'suspended' | 'banned';

export type AppPlatformType = 'Android' | 'Web' | 'Android APK' | 'Web Browser';

export interface AppUserRecord {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserAccountStatus;
  platform: AppPlatformType;
  device_id?: string;
  vip_until?: string;
  downloads_count?: number;
  notes?: string;
  trial_start_date?: string;
  trial_end_date?: string;
  referral_code?: string;
  referred_by?: string | null;
  successful_referrals?: number;
  access_expiry_date?: string | null;
  updated_at?: string;
}

export type AdNetworkProvider = 'none' | 'admob' | 'monetag' | 'custom';

export interface UserAppSettings {
  defaultServer: 'auto-server-3' | 'auto-server-1';
  defaultDownloadQuality: DownloadQuality;
  autoPlayVideo: boolean;
  wifiOnlyDownloads: boolean;
  preferredAudioLanguage: 'Hindi Dubbed' | 'Dual Audio' | 'Original English';
}

export interface AppConfigRecord {
  id?: number;
  app_name: string;
  primary_theme: ThemeColorId;
  is_ads_enabled: boolean;
  popup_ad_image: string;
  popup_ad_link: string;
  direct_ad_link: string;
  banner_ad_html: string;
  admin_pin_hash?: string;
  admin_email?: string;
  official_website?: string;
  decentralized_manifest_url?: string;
  backup_node_urls?: string[];
  maintenance_mode?: boolean;
  allow_guest_downloads?: boolean;
  ad_network_provider?: AdNetworkProvider;
  monetag_zone_id?: string;
  admob_app_id?: string;
  admob_banner_id?: string;
  admob_app_open_id?: string;
  open_ads_same_tab?: boolean;
  show_app_open_ad_once?: boolean;
}

export interface DecentralizedManifestPayload {
  version: string;
  exported_at: string;
  signature: string;
  app_config: AppConfigRecord;
  movie_links: MovieLinkRecord[];
  app_users: AppUserRecord[];
}

export type DownloadStatus = 'downloading' | 'paused' | 'completed' | 'failed';
export type DownloadQuality = '480p' | '720p' | '1080p';

export interface DownloadItem {
  id: string; // `${tmdb_id}_${quality}`
  tmdbId: number;
  title: string;
  language: string;
  quality: DownloadQuality;
  posterUrl: string;
  backdropUrl: string;
  sourceUrl: string;
  localUri: string;
  exportedDevicePath?: string;
  fileSizeMB: number;
  downloadedMB: number;
  progress: number;
  speedMBps: number;
  status: DownloadStatus;
  errorMessage?: string;
  watchedPercent: number;
  durationSeconds: number;
  createdAt: number;
  categoryTag: 'all' | 'local' | 'received';
}

export interface WatchHistoryItem {
  tmdbId: number;
  title: string;
  language: string;
  mediaType?: 'movie' | 'tv';
  backdropUrl: string;
  posterUrl: string;
  watchedPercent: number;
  currentTimeSeconds: number;
  durationSeconds: number;
  updatedAt: number;
}

export interface EmbedServerOption {
  id: string;
  label: string;
  url: string;
  isCustom: boolean;
  providerName?: string;
  language?: string;
  audioType?: 'original' | 'dubbed' | 'multi' | 'provider-controlled';
}

export type StreamFormat = 'hls' | 'dash' | 'mp4' | 'iframe' | 'youtube';
export type AudioSourceType = 'original' | 'dubbed' | 'multi-track' | 'provider-controlled';
export type SourceAvailabilityStatus = 'available' | 'checking' | 'unavailable' | 'timeout';
export type SourceValidationStatus = 'verified' | 'unverified-external' | 'invalid';

export interface ManagedStreamSource {
  id: string;
  providerName: string;
  movieIdentifier: string | number;
  label: string;
  streamUrl: string;
  format: StreamFormat;
  language: string;
  languageCode: string;
  audioType: AudioSourceType;
  availabilityStatus: SourceAvailabilityStatus;
  validationStatus: SourceValidationStatus;
  isCrossOriginIframe: boolean;
  supportsInternalAudioSwitch: boolean;
  isCustom?: boolean;
}

export interface ResolvedPlaybackPlan {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season: number;
  episode: number;
  preferredMode: 'direct-hls' | 'direct-mp4' | 'embed';
  directVideoUrl: string | null;
  testFallbackMp4Url: string;
  language: string;
  embedServers: EmbedServerOption[];
  alternateLanguageStreams: AlternateLanguageStream[];
  managedSources: ManagedStreamSource[];
  downloads: {
    quality: DownloadQuality;
    url: string;
    sizeLabel: string;
    sizeMB: number;
  }[];
}
