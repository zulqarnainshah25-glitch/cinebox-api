export type ContentCategory =
  | 'trending'
  | 'hollywood'
  | 'bollywood'
  | 'series'
  | 'korean'
  | 'pak-dramas'
  | 'anime'
  | 'Trending'
  | 'All'
  | 'Bollywood'
  | 'Hollywood'
  | 'South Hindi Dubbed'
  | 'Action'
  | 'Series'
  | 'Anime'
  | 'Web Series'
  | 'Pakistani Dramas'
  | 'Korean Drama';

export type CategoryFilter = ContentCategory;

export type BottomNavTab = 'home' | 'search' | 'downloads' | 'watchlist' | 'me';

export type ThemeColorId = 'neon-green' | 'netflix-red' | 'royal-blue';

export type AdNetworkProvider = 'none' | 'admob' | 'custom_banner' | 'monetag';

export type DownloadQuality = '480p' | '720p' | '1080p';

export type StreamFormat = 'hls' | 'mp4' | 'dash' | 'iframe' | 'embed' | 'youtube' | 'unknown';

export type AudioSourceType = 'original' | 'dubbed' | 'multi' | 'provider-controlled';

export type SourceAvailabilityStatus =
  | 'available'
  | 'unavailable'
  | 'checking'
  | 'timeout'
  | 'unknown';

export interface WatchProgressRecord {
  tmdbId: number;
  title: string;
  posterUrl: string;
  backdropUrl: string;
  mediaType: 'movie' | 'tv';
  currentTimeSeconds: number;
  durationSeconds: number;
  watchedPercent: number;
  updatedAt: string;
  season?: number;
  episode?: number;
}

export interface WatchHistoryItem {
  tmdbId: number;
  title: string;
  language?: string;
  posterUrl: string;
  backdropUrl: string;
  watchedPercent: number;
  progressPercent?: number;
  currentTimeSeconds: number;
  durationSeconds: number;
  updatedAt: number;
  lastWatchedAt?: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  avatarColor: string;
  isGuest: boolean;
  joinedAt: string;
  role?: 'user' | 'vip' | 'moderator' | 'admin';
  status?: 'active' | 'suspended' | 'banned';
  platform?: 'Android' | 'Web' | 'Android APK' | 'Web Browser' | 'iOS / Other';
  trial_start_date?: string | null;
  trial_end_date?: string | null;
  referral_code?: string;
  referred_by?: string | null;
  successful_referrals?: number;
  access_expiry_date?: string | null;
}

export interface UserAppSettings {
  defaultServer: 'auto-server-3' | 'auto-server-1';
  defaultDownloadQuality: DownloadQuality;
  autoPlayVideo: boolean;
  wifiOnlyDownloads: boolean;
  preferredQuality?: DownloadQuality;
  preferredLanguage?: 'Hindi' | 'English' | 'Urdu / Pak Drama' | 'Dual Audio';
  appLanguage?: 'en' | 'ur';
  autoPlayTrailers?: boolean;
  notificationsEnabled?: boolean;
}

export interface AlternateLanguageStreamOption {
  id: string;
  label: string;
  languageCode: string;
  languageName: string;
  audioType: 'original' | 'dubbed' | 'multi';
  url: string;
  format: 'hls' | 'mp4' | 'dash' | 'embed';
  verified?: boolean;
}

export type AlternateLanguageStream = AlternateLanguageStreamOption;

export interface SubtitleTrackOption {
  lang: string;
  label: string;
  url: string;
  default?: boolean;
}

export interface MovieLinkRecord {
  tmdb_id: number;
  title?: string;
  language: string;
  direct_video_url: string | null;
  hindi_dubbed_video_url?: string | null;
  urdu_dubbed_video_url?: string | null;
  alternate_streams?: AlternateLanguageStreamOption[] | null;
  subtitles?: SubtitleTrackOption[] | null;
  intro_start?: number | null;
  intro_end?: number | null;
  stream_url: string | null;
  download_480p: string | null;
  download_720p: string | null;
  download_1080p?: string | null;
  file_size_480p?: string | null;
  file_size_720p?: string | null;
  file_size_1080p?: string | null;
  is_trending?: boolean;
  updated_at?: string;
}

export type AppUserRole = 'user' | 'vip' | 'moderator' | 'admin';
export type UserRole = AppUserRole;

export type AppUserStatus = 'active' | 'suspended' | 'banned';
export type UserAccountStatus = AppUserStatus;

export type AppUserPlatform =
  | 'Android'
  | 'Web'
  | 'Android APK'
  | 'Web Browser'
  | 'iOS / Other';

export interface AppUserRecord {
  id: string;
  username: string;
  email: string;
  role: AppUserRole;
  status: AppUserStatus;
  platform: AppUserPlatform;
  downloads_count?: number;
  last_active?: string;
  notes?: string;
  vip_until?: string | null;
  updated_at?: string;
  trial_start_date?: string | null;
  trial_end_date?: string | null;
  referral_code?: string;
  referred_by?: string | null;
  successful_referrals?: number;
  access_expiry_date?: string | null;
}

/**
 * Global App Configuration (`public.app_config`).
 * Phase 1 Security: `admin_pin_hash` and `admin_email` have been permanently removed.
 */
export interface AppConfigRecord {
  id: number;
  app_name: string;
  primary_theme: ThemeColorId;
  is_ads_enabled: boolean;
  ad_network_provider?: AdNetworkProvider;
  monetag_zone_id?: string;
  admob_app_id?: string;
  admob_banner_id?: string;
  admob_interstitial_id?: string;
  admob_app_open_id?: string;
  open_ads_same_tab?: boolean;
  show_app_open_ad_once?: boolean;
  banner_ad_html: string;
  popup_ad_link: string;
  popup_ad_image: string;
  direct_ad_link: string;
  featured_movie_ids?: string;
  maintenance_mode?: boolean;
  allow_guest_downloads?: boolean;
  announcement_banner?: string;
  official_website?: string;
  decentralized_manifest_url?: string;
  decentralized_sync_url?: string;
  apk_download_url?: string;
  apk_latest_version?: string;
  apk_release_notes?: string;
  updated_at?: string;
}

export interface WatchHistoryRow {
  id?: number;
  user_id: string;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  season: number;
  episode: number;
  title: string;
  poster_url: string;
  backdrop_url: string;
  current_time_seconds: number;
  duration_seconds: number;
  watched_percent: number;
  updated_at: string;
}

export interface WatchlistRow {
  id?: number;
  user_id: string;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  poster_url: string;
  backdrop_url: string;
  release_year: string;
  rating: number;
  language: string;
  genres: string[];
  created_at: string;
}

export interface AuditLogRow {
  id?: number;
  admin_id?: string | null;
  admin_email: string;
  action: string;
  target_table: string;
  target_row_id: string;
  before_data?: Record<string, unknown> | null;
  after_data?: Record<string, unknown> | null;
  created_at?: string;
}

export interface FeaturedCollectionRow {
  id?: number;
  slug: string;
  title_en: string;
  title_ur: string;
  description_en?: string;
  description_ur?: string;
  tmdb_ids: number[];
  display_order: number;
  is_active: boolean;
  updated_at?: string;
}

export interface LinkHealthRow {
  id?: number;
  tmdb_id: number;
  source_key: string;
  tested_url: string;
  status: 'healthy' | 'broken' | 'timeout' | 'unverified-iframe' | 'unknown';
  http_code?: number | null;
  latency_ms?: number | null;
  error_message?: string;
  last_checked_at: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profileUrl: string | null;
}

export interface WatchProviderBadge {
  providerId: number;
  providerName: string;
  logoUrl: string;
  type?: 'flatrate' | 'rent' | 'buy' | 'free';
}

export interface TvSeasonInfo {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface MovieItem {
  id: number;
  title: string;
  originalTitle?: string;
  originalLanguageCode?: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  releaseYear: string;
  rating: number;
  voteCount?: number;
  mediaType: 'movie' | 'tv';
  category: ContentCategory;
  genres: string[];
  language: string;
  languageBadge?: string;
  qualityBadge?: '4K HDR' | '1080p BluRay' | '720p HD' | 'WEBRip HD' | string;
  duration?: string;
  runtime: string;
  cast: CastMember[];
  seasons?: TvSeasonInfo[];
  watchProviders?: WatchProviderBadge[];
  watchProvidersLink?: string | null;
  linkRecord?: MovieLinkRecord | null;
  youtubeKey?: string;
  youtubeTitle?: string;
  youtubeVideoId?: string;
  youtubeChannelTitle?: string;
  youtubeEmbedUrl?: string;
  vidsrcAvailable?: boolean;
}

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OfflineDownloadTask {
  id: string;
  tmdbId: number;
  title: string;
  posterUrl: string;
  quality: DownloadQuality;
  language: string;
  sourceUrl: string;
  localFileName: string;
  localUri: string | null;
  publicExportPath: string | null;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  speedKbps: number;
  etaSeconds: number;
  status: DownloadStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DownloadItem {
  id: string;
  tmdbId: number;
  movieId?: number;
  title: string;
  posterUrl: string;
  backdropUrl: string;
  quality: DownloadQuality;
  language: string;
  sizeLabel?: string;
  fileSizeMB: number;
  sizeMB?: number;
  downloadedMB: number;
  progress: number;
  speedMBps: number;
  status: 'downloading' | 'paused' | 'completed' | 'failed';
  sourceUrl: string;
  localUri: string;
  publicDevicePath?: string;
  exportedDevicePath?: string | null;
  watchedPercent: number;
  durationSeconds: number;
  errorMessage?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  categoryTag: 'local' | 'saved' | 'received' | 'all';
}

export interface EmbedServerOption {
  id: string;
  label: string;
  url: string;
  isCustom?: boolean;
  language?: string;
  providerName?: string;
  languageHint?: string;
  audioType?: AudioSourceType;
}

export type StreamServerOption = EmbedServerOption;

export interface ManagedStreamSource {
  id: string;
  providerName: string;
  movieIdentifier: string;
  label: string;
  streamUrl: string;
  format: StreamFormat;
  language: string;
  languageCode: string;
  audioType: AudioSourceType;
  availabilityStatus: SourceAvailabilityStatus;
  validationStatus: 'verified' | 'unverified-external' | 'failed-validation' | 'pending';
  isCrossOriginIframe: boolean;
  supportsInternalAudioSwitch: boolean;
  isCustom?: boolean;
  httpStatus?: number;
  contentType?: string;
  hlsManifestValid?: boolean;
  redirected?: boolean;
  finalUrl?: string;
  lastCheckedAt?: number;
  errorReason?: string;
}

export interface PlaybackDownloadOption {
  quality: DownloadQuality;
  url: string;
  sizeLabel: string;
  sizeMB: number;
}

export interface ResolvedPlaybackPlan {
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  language?: string;
  preferredMode: 'direct-hls' | 'direct-mp4' | 'embed';
  directVideoUrl: string | null;
  testFallbackMp4Url: string;
  embedServers: EmbedServerOption[];
  alternateLanguageStreams: AlternateLanguageStreamOption[];
  managedSources: ManagedStreamSource[];
  downloads: PlaybackDownloadOption[];
  download480pUrl?: string | null;
  download720pUrl?: string | null;
  download1080pUrl?: string | null;
  size480p?: string;
  size720p?: string;
  size1080p?: string;
}
