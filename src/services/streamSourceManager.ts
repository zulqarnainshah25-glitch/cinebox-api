import {
  AlternateLanguageStream,
  AudioSourceType,
  EmbedServerOption,
  ManagedStreamSource,
  MovieLinkRecord,
  SourceAvailabilityStatus,
  StreamFormat,
} from '../types/movie';
import { sanitizeAlternateStreamsList, sanitizeSafeUrl } from '../utils/securityValidator';

export interface VerifiedAudioTrack {
  id: number;
  name: string;
  lang: string;
  languageName: string;
  audioRole: 'Original' | 'Dubbed' | 'Track';
  displayLabel: string; // e.g. "English — Original", "Hindi — Dubbed", "Urdu — Dubbed"
  isDefault: boolean;
  trackType: string; // e.g. 'MAIN', 'ALTERNATE'
  groupId?: string;
  source: 'hls' | 'html5';
  failed?: boolean;
}

export interface AudioCapabilityEvaluation {
  mode:
    | 'hls-multi-track'
    | 'native-multi-track'
    | 'single-track'
    | 'cross-origin-iframe'
    | 'unsupported';
  canSwitchEmbeddedAudio: boolean;
  hasAlternateLanguageStreams: boolean;
  verifiedEmbeddedTrackCount: number;
  alternateStreamCount: number;
  honestStatusMessage: string;
}

const ISO_LANGUAGE_MAP: Record<string, string> = {
  en: 'English',
  eng: 'English',
  'en-us': 'English',
  'en-gb': 'English',
  hi: 'Hindi',
  hin: 'Hindi',
  'hi-in': 'Hindi',
  ur: 'Urdu',
  urd: 'Urdu',
  'ur-pk': 'Urdu',
  ar: 'Arabic',
  ara: 'Arabic',
  ta: 'Tamil',
  tam: 'Tamil',
  te: 'Telugu',
  tel: 'Telugu',
  ml: 'Malayalam',
  mal: 'Malayalam',
  kn: 'Kannada',
  kan: 'Kannada',
  pa: 'Punjabi',
  pan: 'Punjabi',
  bn: 'Bengali',
  ben: 'Bengali',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fra: 'French',
  fre: 'French',
  de: 'German',
  deu: 'German',
  ger: 'German',
  ja: 'Japanese',
  jpn: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  zh: 'Chinese',
  zho: 'Chinese',
  chi: 'Chinese',
  ru: 'Russian',
  rus: 'Russian',
  pt: 'Portuguese',
  por: 'Portuguese',
  it: 'Italian',
  ita: 'Italian',
  tr: 'Turkish',
  tur: 'Turkish',
};

/**
 * Resolves a human-readable language name from an ISO language code or track name.
 */
export function resolveLanguageName(rawLang?: string | null, rawName?: string | null): {
  code: string;
  name: string;
} {
  const cleanLang = (rawLang || '').trim().toLowerCase();
  const baseLang = cleanLang.split(/[-_]/)[0];

  if (cleanLang && ISO_LANGUAGE_MAP[cleanLang]) {
    return { code: baseLang || cleanLang, name: ISO_LANGUAGE_MAP[cleanLang] };
  }
  if (baseLang && ISO_LANGUAGE_MAP[baseLang]) {
    return { code: baseLang, name: ISO_LANGUAGE_MAP[baseLang] };
  }

  // Check if the track name itself clearly states a known language (e.g. "Hindi", "English", "Urdu")
  const cleanName = (rawName || '').trim();
  const lowerName = cleanName.toLowerCase();
  for (const [code, langName] of Object.entries(ISO_LANGUAGE_MAP)) {
    if (code.length === 2 && new RegExp(`\\b${langName.toLowerCase()}\\b`, 'i').test(lowerName)) {
      return { code, name: langName };
    }
  }

  if (cleanLang && cleanLang !== 'und' && cleanLang !== 'unknown') {
    return { code: cleanLang, name: cleanLang.toUpperCase() };
  }

  return { code: 'und', name: cleanName || 'Unknown Language' };
}

/**
 * Determines whether a verified audio track is "Original", "Dubbed", or "Track"
 * based on actual HLS/HTML5 track attributes and optional original language code.
 */
export function determineAudioTrackRole(params: {
  trackLangCode: string;
  trackName?: string;
  isDefault?: boolean;
  index: number;
  originalLanguageCode?: string;
}): 'Original' | 'Dubbed' | 'Track' {
  const { trackLangCode, trackName = '', isDefault = false, index, originalLanguageCode } = params;
  const lowerName = trackName.toLowerCase();

  if (lowerName.includes('original') || lowerName.includes('orig')) {
    return 'Original';
  }
  if (lowerName.includes('dub') || lowerName.includes('dubbed')) {
    return 'Dubbed';
  }

  const normOrig = (originalLanguageCode || '').trim().toLowerCase().split(/[-_]/)[0];
  if (normOrig && trackLangCode && trackLangCode !== 'und') {
    if (trackLangCode === normOrig) {
      return 'Original';
    }
    return 'Dubbed';
  }

  if (isDefault || index === 0) {
    return 'Original';
  }

  if (trackLangCode && trackLangCode !== 'und') {
    return 'Dubbed';
  }

  return 'Track';
}

/**
 * Formats a Netflix-style audio track label:
 * e.g., "English — Original", "Hindi — Dubbed", "Urdu — Dubbed", or "Audio Track 1 (Unknown)".
 */
export function formatVerifiedAudioLabel(params: {
  languageName: string;
  langCode: string;
  rawName?: string;
  role: 'Original' | 'Dubbed' | 'Track';
  index: number;
}): string {
  const { languageName, langCode, rawName = '', role, index } = params;
  const cleanRaw = rawName.trim();

  if (langCode === 'und' && (!cleanRaw || /^audio\s*track\s*\d+$/i.test(cleanRaw))) {
    return `Track ${index + 1} — ${role === 'Original' ? 'Default' : 'Audio'}`;
  }

  if (role === 'Original' || role === 'Dubbed') {
    return `${languageName} — ${role}`;
  }

  return cleanRaw ? `${languageName} (${cleanRaw})` : `${languageName} — Track ${index + 1}`;
}

/**
 * PHASE 2A & 2B:
 * Strictly extracts and normalizes ONLY genuinely detected audio tracks from HLS.js (`hls.audioTracks`)
 * or native HTML5 (`video.audioTracks`).
 *
 * CRITICAL RULE:
 * Never creates fake audio tracks based on TMDB metadata, movie titles, country, or language strings.
 * Deduplicates identical tracks and preserves track IDs for accurate HLS/HTML5 switching.
 */
export function detectVerifiedAudioTracks(
  hlsAudioTracks?: Array<{
    id?: number;
    name?: string;
    lang?: string;
    default?: boolean;
    type?: string;
    groupId?: string;
  }> | null,
  html5AudioTracks?: ArrayLike<{
    id?: string;
    label?: string;
    language?: string;
    kind?: string;
    enabled?: boolean;
  }> | null,
  originalLanguageCode?: string | null
): VerifiedAudioTrack[] {
  const results: VerifiedAudioTrack[] = [];
  const seenKeys = new Set<string>();
  const langCountMap = new Map<string, number>();

  // 1. Real HLS.js manifest audioTracks
  if (Array.isArray(hlsAudioTracks) && hlsAudioTracks.length > 0) {
    for (let idx = 0; idx < hlsAudioTracks.length; idx++) {
      const raw = hlsAudioTracks[idx];
      if (!raw) continue;

      const trackId = typeof raw.id === 'number' ? raw.id : idx;
      const { code, name: languageName } = resolveLanguageName(raw.lang, raw.name);
      const isDefault = Boolean(raw.default) || (idx === 0 && !hlsAudioTracks.some((t) => t?.default));
      const trackType = (raw.type || (isDefault ? 'MAIN' : 'ALTERNATE')).toUpperCase();
      const groupId = raw.groupId ? String(raw.groupId) : undefined;

      // Deduplicate tracks that share the exact same language code, normalized name, and group
      // (only when language or name is actually specified)
      const normName = (raw.name || '').trim().toLowerCase();
      const dedupeKey =
        code === 'und' && !normName
          ? `und-id-${trackId}:${groupId || 'default'}`
          : `${code}:${normName}:${groupId || 'default'}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);

      const prevLangCount = langCountMap.get(code) || 0;
      langCountMap.set(code, prevLangCount + 1);

      const baseRole = determineAudioTrackRole({
        trackLangCode: code,
        trackName: raw.name,
        isDefault,
        index: idx,
        originalLanguageCode: originalLanguageCode || undefined,
      });

      const baseLabel = formatVerifiedAudioLabel({
        languageName,
        langCode: code,
        rawName: raw.name,
        role: baseRole,
        index: idx,
      });

      const cleanRawName = (raw.name || '').trim();
      const isGenericLangName =
        !cleanRawName ||
        cleanRawName.toLowerCase() === languageName.toLowerCase() ||
        cleanRawName.toLowerCase() === code.toLowerCase();

      const displayLabel =
        prevLangCount > 0 && code !== 'und' && !isGenericLangName
          ? `${languageName} — Alternate (${cleanRawName})`
          : prevLangCount > 0 && code !== 'und'
          ? `${baseLabel} #${prevLangCount + 1}`
          : baseLabel;

      results.push({
        id: trackId,
        name: cleanRawName || displayLabel,
        lang: code,
        languageName,
        audioRole: baseRole,
        displayLabel,
        isDefault,
        trackType,
        groupId,
        source: 'hls',
      });
    }
    return results;
  }

  // 2. Real Native HTML5 <video>.audioTracks
  if (
    html5AudioTracks &&
    typeof html5AudioTracks.length === 'number' &&
    html5AudioTracks.length > 0
  ) {
    for (let idx = 0; idx < html5AudioTracks.length; idx++) {
      const raw = html5AudioTracks[idx];
      if (!raw) continue;

      const { code, name: languageName } = resolveLanguageName(raw.language, raw.label);
      const isDefault = Boolean(raw.enabled) || idx === 0;
      const trackType = (raw.kind || (isDefault ? 'main' : 'alternative')).toUpperCase();

      const audioRole = determineAudioTrackRole({
        trackLangCode: code,
        trackName: raw.label,
        isDefault,
        index: idx,
        originalLanguageCode: originalLanguageCode || undefined,
      });

      const displayLabel = formatVerifiedAudioLabel({
        languageName,
        langCode: code,
        rawName: raw.label,
        role: audioRole,
        index: idx,
      });

      const dedupeKey = `html5:${code}:${(raw.label || '').trim().toLowerCase()}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);

      results.push({
        id: idx,
        name: (raw.label || '').trim() || displayLabel,
        lang: code,
        languageName,
        audioRole,
        displayLabel,
        isDefault,
        trackType,
        source: 'html5',
      });
    }
    return results;
  }

  // IMPORTANT: Do NOT synthesize fake tracks from TMDB/metadata strings. Return empty array.
  return [];
}

/**
 * PHASE 2B:
 * Safely switches an embedded audio track on an HLS.js instance or native HTML5 video element
 * without restarting playback, preserving `currentTime` and playback state, and automatically
 * falling back to `previousTrackId` if switching fails.
 */
export function switchEmbeddedAudioTrackSafely(params: {
  targetTrackId: number;
  previousTrackId: number;
  availableTracks: VerifiedAudioTrack[];
  hlsInstance?: {
    audioTracks?: Array<{ id?: number }>;
    audioTrack: number;
  } | null;
  videoElement?: {
    currentTime: number;
    paused: boolean;
    play?: () => Promise<void>;
    audioTracks?: {
      length: number;
      [index: number]: { enabled: boolean };
    };
  } | null;
}): {
  ok: boolean;
  activeTrackId: number;
  preservedTimeSeconds: number;
  wasPlaying: boolean;
  fellBack: boolean;
  error?: string;
} {
  const { targetTrackId, previousTrackId, availableTracks, hlsInstance, videoElement } = params;
  const preservedTimeSeconds = videoElement && Number.isFinite(videoElement.currentTime)
    ? videoElement.currentTime
    : 0;
  const wasPlaying = videoElement ? !videoElement.paused : true;

  const targetTrack = availableTracks.find((t) => t.id === targetTrackId);
  if (!targetTrack || targetTrack.failed) {
    const fallbackId = availableTracks.some((t) => t.id === previousTrackId && !t.failed)
      ? previousTrackId
      : availableTracks.find((t) => !t.failed)?.id ?? 0;
    return {
      ok: false,
      activeTrackId: fallbackId,
      preservedTimeSeconds,
      wasPlaying,
      fellBack: true,
      error: 'Requested audio track is unavailable or failed verification.',
    };
  }

  try {
    if (
      targetTrack.source === 'hls' &&
      hlsInstance &&
      Array.isArray(hlsInstance.audioTracks) &&
      hlsInstance.audioTracks.length > 0
    ) {
      const existsInHls = hlsInstance.audioTracks.some(
        (t, idx) => (typeof t.id === 'number' ? t.id : idx) === targetTrackId
      );
      if (!existsInHls) {
        throw new Error(`HLS track ID ${targetTrackId} not found in manifest`);
      }
      hlsInstance.audioTrack = targetTrackId;
    } else if (
      targetTrack.source === 'html5' &&
      videoElement?.audioTracks &&
      videoElement.audioTracks.length > 0
    ) {
      if (targetTrackId < 0 || targetTrackId >= videoElement.audioTracks.length) {
        throw new Error(`HTML5 audio track index ${targetTrackId} out of bounds`);
      }
      for (let i = 0; i < videoElement.audioTracks.length; i++) {
        videoElement.audioTracks[i].enabled = i === targetTrackId;
      }
    } else {
      throw new Error('No active multi-track media engine available for switching');
    }

    // Preserve playback position and state
    if (videoElement && preservedTimeSeconds > 0 && Math.abs(videoElement.currentTime - preservedTimeSeconds) > 0.5) {
      videoElement.currentTime = preservedTimeSeconds;
    }
    if (videoElement && wasPlaying && videoElement.paused && typeof videoElement.play === 'function') {
      videoElement.play().catch(() => {});
    }

    return {
      ok: true,
      activeTrackId: targetTrackId,
      preservedTimeSeconds,
      wasPlaying,
      fellBack: false,
    };
  } catch (err: any) {
    // Automatic fallback to previous working track
    const fallbackId = availableTracks.some((t) => t.id === previousTrackId && !t.failed)
      ? previousTrackId
      : availableTracks.find((t) => !t.failed)?.id ?? 0;

    try {
      if (hlsInstance && typeof hlsInstance.audioTrack === 'number') {
        hlsInstance.audioTrack = fallbackId;
      } else if (videoElement?.audioTracks) {
        for (let i = 0; i < videoElement.audioTracks.length; i++) {
          videoElement.audioTracks[i].enabled = i === fallbackId;
        }
      }
    } catch {
      // ignore secondary error
    }

    return {
      ok: false,
      activeTrackId: fallbackId,
      preservedTimeSeconds,
      wasPlaying,
      fellBack: true,
      error: err?.message || 'Failed to switch audio track; reverted to original track.',
    };
  }
}

/**
 * PHASE 2C (Scenario 2):
 * Builds verified separate alternate-language video streams from `MovieLinkRecord`.
 * Never invents URLs and never treats separate video streams as embedded audio tracks.
 */
export function resolveAlternateLanguageStreams(
  linkRecord?: MovieLinkRecord | null,
  originalLanguageCode?: string | null
): AlternateLanguageStream[] {
  if (!linkRecord) return [];

  const streams: AlternateLanguageStream[] = [];
  const seenUrls = new Set<string>();

  const inferFormat = (url: string): 'hls' | 'mp4' | 'dash' => {
    const lower = url.toLowerCase();
    if (lower.includes('.m3u8')) return 'hls';
    if (lower.includes('.mpd')) return 'dash';
    return 'mp4';
  };

  // 1. Primary direct_video_url
  const primaryUrl = sanitizeSafeUrl(linkRecord.direct_video_url);
  if (primaryUrl && !seenUrls.has(primaryUrl)) {
    seenUrls.add(primaryUrl);
    const { code, name } = resolveLanguageName(originalLanguageCode || 'en', linkRecord.language);
    const isDubbedLabel = /dub/i.test(linkRecord.language || '');
    streams.push({
      id: `alt-primary-${code}`,
      label: isDubbedLabel ? `${name} Dubbed` : `Original (${name})`,
      languageCode: code,
      languageName: name,
      audioType: isDubbedLabel ? 'dubbed' : 'original',
      url: primaryUrl,
      format: inferFormat(primaryUrl),
      verified: true,
    });
  }

  // 2. Explicit separate Hindi Dubbed stream if provided
  const hindiUrl = sanitizeSafeUrl(linkRecord.hindi_dubbed_video_url);
  if (hindiUrl && !seenUrls.has(hindiUrl)) {
    seenUrls.add(hindiUrl);
    streams.push({
      id: 'alt-hindi-dubbed',
      label: 'Hindi Dubbed',
      languageCode: 'hi',
      languageName: 'Hindi',
      audioType: 'dubbed',
      url: hindiUrl,
      format: inferFormat(hindiUrl),
      verified: true,
    });
  }

  // 3. Explicit separate Urdu Dubbed stream if provided
  const urduUrl = sanitizeSafeUrl(linkRecord.urdu_dubbed_video_url);
  if (urduUrl && !seenUrls.has(urduUrl)) {
    seenUrls.add(urduUrl);
    streams.push({
      id: 'alt-urdu-dubbed',
      label: 'Urdu Dubbed',
      languageCode: 'ur',
      languageName: 'Urdu',
      audioType: 'dubbed',
      url: urduUrl,
      format: inferFormat(urduUrl),
      verified: true,
    });
  }

  // 4. Additional structured alternate_streams array if present (strictly sanitized via Task 2 validator)
  if (Array.isArray(linkRecord.alternate_streams)) {
    const sanitizedAlternates = sanitizeAlternateStreamsList(linkRecord.alternate_streams);
    const seenIds = new Set<string>(streams.map((s) => s.id.toLowerCase()));

    for (const item of sanitizedAlternates) {
      if (!item || !item.url) continue;
      if (seenUrls.has(item.url) || seenIds.has(item.id.toLowerCase())) continue;
      seenUrls.add(item.url);
      seenIds.add(item.id.toLowerCase());

      streams.push({
        id: item.id,
        label: item.label,
        languageCode: item.languageCode,
        languageName: item.languageName,
        audioType: item.audioType,
        url: item.url,
        format: item.format || inferFormat(item.url),
        verified: Boolean(item.verified ?? true),
      });
    }
  }

  return streams;
}

/**
 * TASK 3:
 * Attaches native Safari / WebKit `video.audioTracks` event listeners (`change`, `addtrack`, `removetrack`),
 * prevents duplicate listener registration on the same AudioTrackList, and returns a cleanup function
 * that removes all registered listeners via `removeEventListener`.
 */
const activeSafariTrackListenersMap = new WeakMap<object, () => void>();

export function attachSafariNativeAudioTrackListeners(
  videoEl: { audioTracks?: any } | null | undefined,
  originalLanguageCode: string | null | undefined,
  onTracksUpdated: (tracks: VerifiedAudioTrack[], enabledTrackId: number) => void
): () => void {
  const nativeAudioTracks = videoEl?.audioTracks;
  if (!nativeAudioTracks || typeof nativeAudioTracks !== 'object') {
    return () => {};
  }

  // Prevent duplicate listeners if already attached to this AudioTrackList instance
  const existingCleanup = activeSafariTrackListenersMap.get(nativeAudioTracks);
  if (existingCleanup) {
    existingCleanup();
  }

  let isDisposed = false;

  const syncSafariNativeTracks = () => {
    if (isDisposed || !nativeAudioTracks) return;
    const detected = detectVerifiedAudioTracks(null, nativeAudioTracks, originalLanguageCode);
    let enabledIdx = 0;
    const len = Number(nativeAudioTracks.length) || 0;
    for (let i = 0; i < len; i++) {
      if (nativeAudioTracks[i]?.enabled) {
        enabledIdx = i;
        break;
      }
    }
    onTracksUpdated(detected, enabledIdx);
  };

  if (typeof nativeAudioTracks.addEventListener === 'function') {
    nativeAudioTracks.addEventListener('change', syncSafariNativeTracks);
    nativeAudioTracks.addEventListener('addtrack', syncSafariNativeTracks);
    nativeAudioTracks.addEventListener('removetrack', syncSafariNativeTracks);
  }

  // Sync initial tracks if already populated
  if ((Number(nativeAudioTracks.length) || 0) > 0) {
    syncSafariNativeTracks();
  }

  const cleanup = () => {
    if (isDisposed) return;
    isDisposed = true;
    if (typeof nativeAudioTracks.removeEventListener === 'function') {
      nativeAudioTracks.removeEventListener('change', syncSafariNativeTracks);
      nativeAudioTracks.removeEventListener('addtrack', syncSafariNativeTracks);
      nativeAudioTracks.removeEventListener('removetrack', syncSafariNativeTracks);
    }
    if (activeSafariTrackListenersMap.get(nativeAudioTracks) === cleanup) {
      activeSafariTrackListenersMap.delete(nativeAudioTracks);
    }
  };

  activeSafariTrackListenersMap.set(nativeAudioTracks, cleanup);
  return cleanup;
}

/**
 * PHASE 3:
 * Evaluates the exact audio selection capability for the current playback mode and active streams.
 * Prevents displaying a fake working-looking audio selector when playing a cross-origin iframe
 * or a single-track video.
 */
export function evaluatePlayerAudioCapability(params: {
  playerMode: 'direct' | 'blob' | 'trailer' | 'embed' | 'pak-drama';
  activeDirectUrl?: string | null;
  verifiedTracks: VerifiedAudioTrack[];
  alternateStreams: AlternateLanguageStream[];
}): AudioCapabilityEvaluation {
  const { playerMode, activeDirectUrl, verifiedTracks, alternateStreams } = params;
  const activeValidTracks = verifiedTracks.filter((t) => !t.failed);
  const hasMultipleEmbedded = activeValidTracks.length > 1;
  const hasAlternateLanguageStreams = alternateStreams.length > 1;

  if (playerMode === 'embed' || playerMode === 'pak-drama' || playerMode === 'trailer') {
    return {
      mode: 'cross-origin-iframe',
      canSwitchEmbeddedAudio: false,
      hasAlternateLanguageStreams,
      verifiedEmbeddedTrackCount: 0,
      alternateStreamCount: alternateStreams.length,
      honestStatusMessage:
        'Cross-origin iframe provider active: Internal audio tracks cannot be inspected or switched by CineBox due to browser cross-origin security. Use the provider’s internal player controls if available, or switch verified language sources below.',
    };
  }

  const isHls = Boolean(activeDirectUrl && activeDirectUrl.toLowerCase().includes('.m3u8'));

  if (hasMultipleEmbedded) {
    return {
      mode: isHls ? 'hls-multi-track' : 'native-multi-track',
      canSwitchEmbeddedAudio: true,
      hasAlternateLanguageStreams,
      verifiedEmbeddedTrackCount: activeValidTracks.length,
      alternateStreamCount: alternateStreams.length,
      honestStatusMessage: `Verified multi-audio stream (${activeValidTracks.length} embedded audio tracks detected in manifest).`,
    };
  }

  if (activeValidTracks.length === 1) {
    return {
      mode: 'single-track',
      canSwitchEmbeddedAudio: false,
      hasAlternateLanguageStreams,
      verifiedEmbeddedTrackCount: 1,
      alternateStreamCount: alternateStreams.length,
      honestStatusMessage: hasAlternateLanguageStreams
        ? `Single embedded audio track (${activeValidTracks[0].displayLabel}). Alternate language video streams are available.`
        : `Single audio track detected (${activeValidTracks[0].displayLabel}). No alternate embedded audio tracks exist in this stream.`,
    };
  }

  return {
    mode: 'single-track',
    canSwitchEmbeddedAudio: false,
    hasAlternateLanguageStreams,
    verifiedEmbeddedTrackCount: 0,
    alternateStreamCount: alternateStreams.length,
    honestStatusMessage: hasAlternateLanguageStreams
      ? 'Single-track video stream. Switch language via the verified Alternate Language Streams selector.'
      : 'Single-track video stream (Original Audio). No secondary audio tracks detected in stream manifest.',
  };
}

/**
 * PHASE 4:
 * Centralized Stream Source Manager.
 * Builds a deduplicated, validated list of all available stream sources for a movie/episode.
 */
export function buildCentralizedManagedSources(params: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  linkRecord?: MovieLinkRecord | null;
  embedServers: EmbedServerOption[];
  alternateStreams: AlternateLanguageStream[];
  youtubeKey?: string;
}): ManagedStreamSource[] {
  const {
    tmdbId,
    mediaType,
    season = 1,
    episode = 1,
    embedServers,
    alternateStreams,
    youtubeKey,
  } = params;

  const movieIdentifier =
    mediaType === 'tv' ? `${tmdbId}:S${season}:E${episode}` : String(tmdbId);

  const rawSources: ManagedStreamSource[] = [];

  // 1. Add verified direct / alternate language streams (HLS, DASH, MP4)
  for (const alt of alternateStreams) {
    const safeUrl = sanitizeSafeUrl(alt.url);
    if (!safeUrl) continue;

    rawSources.push({
      id: `direct-${alt.id}`,
      providerName: 'CineBox Direct CDN (Supabase)',
      movieIdentifier,
      label: `${alt.label} (${alt.format.toUpperCase()})`,
      streamUrl: safeUrl,
      format: alt.format,
      language: alt.languageName,
      languageCode: alt.languageCode,
      audioType: alt.audioType === 'dubbed' ? 'dubbed' : 'original',
      availabilityStatus: 'available',
      validationStatus: 'verified',
      isCrossOriginIframe: false,
      supportsInternalAudioSwitch: alt.format === 'hls',
      isCustom: true,
    });
  }

  // 2. Add Embed Servers (cross-origin iframes) with honest provider-controlled audioType
  for (const srv of embedServers) {
    const safeUrl = sanitizeSafeUrl(srv.url);
    if (!safeUrl) continue;

    const providerName =
      srv.providerName ||
      (srv.id.includes('2embed') || srv.id === 'auto-server-3'
        ? '2Embed'
        : srv.id.includes('vidsrc-icu')
        ? 'VidSrc.icu'
        : srv.id.includes('vidsrc') || srv.id === 'auto-server-1'
        ? 'VidSrc.sh'
        : srv.id.includes('multiembed')
        ? 'MultiEmbed'
        : srv.id.includes('autoembed')
        ? 'AutoEmbed'
        : 'Custom Embed');

    rawSources.push({
      id: srv.id,
      providerName,
      movieIdentifier,
      label: srv.label,
      streamUrl: safeUrl,
      format: 'iframe',
      language: srv.language || 'Provider Default',
      languageCode: 'und',
      audioType: 'provider-controlled',
      availabilityStatus: 'available',
      validationStatus: srv.isCustom ? 'verified' : 'unverified-external',
      isCrossOriginIframe: true,
      supportsInternalAudioSwitch: false,
      isCustom: srv.isCustom,
    });
  }

  // 3. Official YouTube Trailer if available
  if (youtubeKey && /^[a-zA-Z0-9_-]{6,20}$/.test(youtubeKey.trim())) {
    rawSources.push({
      id: 'official-youtube-trailer',
      providerName: 'YouTube Official',
      movieIdentifier,
      label: 'Official TMDb Trailer (YouTube HD)',
      streamUrl: `https://www.youtube.com/embed/${youtubeKey.trim()}`,
      format: 'youtube',
      language: 'Original',
      languageCode: 'en',
      audioType: 'original',
      availabilityStatus: 'available',
      validationStatus: 'verified',
      isCrossOriginIframe: true,
      supportsInternalAudioSwitch: false,
      isCustom: false,
    });
  }

  return deduplicateManagedSources(rawSources);
}

/**
 * Removes duplicate sources sharing the same normalized URL.
 */
export function deduplicateManagedSources(sources: ManagedStreamSource[]): ManagedStreamSource[] {
  if (!Array.isArray(sources)) return [];
  const seenUrls = new Set<string>();
  const result: ManagedStreamSource[] = [];

  for (const src of sources) {
    if (!src || !src.streamUrl) continue;
    const safe = sanitizeSafeUrl(src.streamUrl);
    if (!safe) continue;
    const normKey = safe.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(normKey)) continue;
    seenUrls.add(normKey);
    result.push({ ...src, streamUrl: safe });
  }

  return result;
}

/**
 * PHASE 4 (Stage 2 Deep Verification):
 * Checks the health of a stream source with:
 * - Cross-origin iframe protection (never classifies an iframe as broken because it blocks HEAD/CORS)
 * - HTTP HEAD -> ranged GET fallback (`Range: bytes=0-2047`) for servers that reject HEAD (405/403/400)
 * - HLS `.m3u8` manifest validation (verifies `#EXTM3U` header and rejects HTML soft-404 pages)
 * - MP4 / WebM / DASH format validation (rejects `text/html` error responses)
 * - Redirect tracking (`redirected`, `finalUrl`) and strict `AbortController` timeout cleanup
 */
export async function checkStreamSourceHealth(
  source: ManagedStreamSource,
  timeoutMs: number = 4500,
  customFetch?: typeof fetch
): Promise<{
  id: string;
  availabilityStatus: SourceAvailabilityStatus;
  validationStatus: 'verified' | 'unverified-external' | 'failed-validation';
  latencyMs: number;
  redirected?: boolean;
  finalUrl?: string;
  contentType?: string;
  hlsManifestValid?: boolean;
  corsBlocked?: boolean;
  error?: string;
}> {
  const startMs = Date.now();
  const fetchFn = customFetch || fetch;
  const safeUrl = sanitizeSafeUrl(source.streamUrl);
  if (!safeUrl) {
    return {
      id: source.id,
      availabilityStatus: 'unavailable',
      validationStatus: 'failed-validation',
      latencyMs: 0,
      error: 'Invalid or unsafe stream URL.',
    };
  }

  // Cross-origin iframe providers cannot be HEAD-checked via CORS from the browser;
  // never classify an iframe as broken simply because its page blocks HEAD requests.
  if (source.isCrossOriginIframe || source.format === 'iframe' || source.format === 'youtube') {
    const isHttps = safeUrl.startsWith('https://');
    return {
      id: source.id,
      availabilityStatus: isHttps ? 'available' : 'unavailable',
      validationStatus: isHttps
        ? source.isCustom
          ? 'verified'
          : 'unverified-external'
        : 'failed-validation',
      latencyMs: Date.now() - startMs,
      finalUrl: safeUrl,
      error: isHttps ? undefined : 'Iframe source must use HTTPS.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const isHlsUrl = source.format === 'hls' || safeUrl.toLowerCase().includes('.m3u8');
  const RANGED_GET_FALLBACK_STATUSES = [400, 403, 404, 405, 501];

  try {
    // STEP 1: Always attempt HTTP HEAD request first
    let headRes: Response | null = null;
    try {
      headRes = await fetchFn(safeUrl, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (headErr: any) {
      if (headErr?.name === 'AbortError') {
        throw headErr;
      }
      // Non-timeout network error on HEAD -> fall back to ranged GET
      headRes = null;
    }

    // If HEAD succeeded (200/206) and returned text/html, immediately reject soft-404 HTML page
    if (headRes && (headRes.ok || headRes.status === 206)) {
      const headContentType = (headRes.headers?.get?.('content-type') || '').toLowerCase();
      if (headContentType.includes('text/html')) {
        clearTimeout(timer);
        return {
          id: source.id,
          availabilityStatus: 'unavailable',
          validationStatus: 'failed-validation',
          latencyMs: Date.now() - startMs,
          redirected: Boolean(headRes.redirected),
          finalUrl: headRes.url || safeUrl,
          contentType: headContentType,
          hlsManifestValid: isHlsUrl ? false : undefined,
          error: 'Endpoint returned HTML soft-404 instead of a media stream.',
        };
      }

      // For non-HLS direct media (MP4/WebM/MKV/DASH), a valid non-HTML HEAD 200/206 is sufficient
      if (!isHlsUrl) {
        clearTimeout(timer);
        return {
          id: source.id,
          availabilityStatus: 'available',
          validationStatus: 'verified',
          latencyMs: Date.now() - startMs,
          redirected: Boolean(headRes.redirected),
          finalUrl: headRes.url || safeUrl,
          contentType: headContentType,
        };
      }
    }

    // If HEAD returned a fatal status not in RANGED_GET_FALLBACK_STATUSES (e.g., 500, 502, 503), fail immediately
    if (
      headRes &&
      !headRes.ok &&
      headRes.status !== 206 &&
      !RANGED_GET_FALLBACK_STATUSES.includes(headRes.status)
    ) {
      clearTimeout(timer);
      const headContentType = (headRes.headers?.get?.('content-type') || '').toLowerCase();
      return {
        id: source.id,
        availabilityStatus: 'unavailable',
        validationStatus: 'failed-validation',
        latencyMs: Date.now() - startMs,
        redirected: Boolean(headRes.redirected),
        finalUrl: headRes.url || safeUrl,
        contentType: headContentType,
        hlsManifestValid: isHlsUrl ? false : undefined,
        error: `HTTP ${headRes.status}`,
      };
    }

    // STEP 2: Ranged GET fallback (when HEAD returned 400/403/404/405/501, threw a non-timeout error,
    // or when the stream is .m3u8 so we must verify the body begins with #EXTM3U)
    if (isHlsUrl) {
      const hlsRes = await fetchFn(safeUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-4095' },
        redirect: 'follow',
        signal: controller.signal,
      });
      const contentType = (hlsRes.headers?.get?.('content-type') || '').toLowerCase();
      const finalUrl = hlsRes.url || headRes?.url || safeUrl;
      const redirected = Boolean(hlsRes.redirected || headRes?.redirected);

      if (!hlsRes.ok && hlsRes.status !== 206) {
        try {
          await hlsRes.body?.cancel?.();
        } catch {
          // ignore body cancel error
        }
        clearTimeout(timer);
        return {
          id: source.id,
          availabilityStatus: 'unavailable',
          validationStatus: 'failed-validation',
          latencyMs: Date.now() - startMs,
          redirected,
          finalUrl,
          contentType,
          hlsManifestValid: false,
          error: `HTTP ${hlsRes.status}`,
        };
      }

      const bodyText = await hlsRes.text();
      try {
        await hlsRes.body?.cancel?.();
      } catch {
        // ignore body cancel error
      }
      clearTimeout(timer);

      const trimmedBody = bodyText.trimStart();
      const isHtmlPayload =
        contentType.includes('text/html') ||
        /^<!doctype\s+html/i.test(trimmedBody) ||
        /^<html/i.test(trimmedBody);

      if (isHtmlPayload) {
        return {
          id: source.id,
          availabilityStatus: 'unavailable',
          validationStatus: 'failed-validation',
          latencyMs: Date.now() - startMs,
          redirected,
          finalUrl,
          contentType,
          hlsManifestValid: false,
          error: 'Endpoint returned HTML soft-404 instead of an HLS manifest.',
        };
      }

      const hasExtM3u = trimmedBody.startsWith('#EXTM3U');
      if (!hasExtM3u) {
        return {
          id: source.id,
          availabilityStatus: 'unavailable',
          validationStatus: 'failed-validation',
          latencyMs: Date.now() - startMs,
          redirected,
          finalUrl,
          contentType,
          hlsManifestValid: false,
          error: 'Invalid HLS manifest (missing #EXTM3U header).',
        };
      }

      return {
        id: source.id,
        availabilityStatus: 'available',
        validationStatus: 'verified',
        latencyMs: Date.now() - startMs,
        redirected,
        finalUrl,
        contentType,
        hlsManifestValid: true,
      };
    }

    // Ranged GET fallback for direct MP4 / WebM / MKV / DASH (when HEAD failed or returned 400/403/404/405/501)
    const res = await fetchFn(safeUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-1023' },
      redirect: 'follow',
      signal: controller.signal,
    });
    // Immediately cancel body download after headers are received
    try {
      await res.body?.cancel?.();
    } catch {
      // ignore cancel error
    }

    clearTimeout(timer);
    const latencyMs = Date.now() - startMs;
    const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();

    if (res.ok || res.status === 206) {
      // Reject soft-404 HTML pages returned for a direct video file URL
      if (contentType.includes('text/html')) {
        return {
          id: source.id,
          availabilityStatus: 'unavailable',
          validationStatus: 'failed-validation',
          latencyMs,
          redirected: res.redirected,
          finalUrl: res.url || safeUrl,
          contentType,
          error: 'Endpoint returned HTML instead of a media stream.',
        };
      }

      return {
        id: source.id,
        availabilityStatus: 'available',
        validationStatus: 'verified',
        latencyMs,
        redirected: res.redirected,
        finalUrl: res.url || safeUrl,
        contentType,
      };
    }

    return {
      id: source.id,
      availabilityStatus: 'unavailable',
      validationStatus: 'failed-validation',
      latencyMs,
      redirected: res.redirected,
      finalUrl: res.url || safeUrl,
      contentType,
      error: `HTTP ${res.status}`,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    return {
      id: source.id,
      availabilityStatus: isTimeout ? 'timeout' : 'unavailable',
      validationStatus: 'failed-validation',
      latencyMs: Date.now() - startMs,
      corsBlocked: !isTimeout,
      error: isTimeout ? `Timed out after ${timeoutMs}ms` : 'Stream unreachable or CORS blocked',
    };
  }
}

/**
 * Selects the next available fallback source when the current source fails or times out.
 */
export function selectNextFallbackSource(
  sources: ManagedStreamSource[],
  failedSourceId: string
): ManagedStreamSource | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const candidates = sources.filter(
    (s) =>
      s.id !== failedSourceId &&
      s.availabilityStatus !== 'unavailable' &&
      s.availabilityStatus !== 'timeout'
  );
  return candidates[0] || null;
}
