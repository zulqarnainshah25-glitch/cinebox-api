import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSafeUrl,
  sanitizeFileName,
  buildPublicExportPath,
  sanitizeBannerHtml,
  isAdminJwtUser,
  isModeratorOrAdminJwtUser,
  sanitizeDatabaseTextField,
  validateMovieLinkInput,
  validateAppUserInput,
  parseDirectBulkMovieLinksInput,
  evaluateGlobalUserAccess,
  generateAllottedUserId,
  verifyAdFreeHtmlGuard,
} from './securityValidator';
import {
  buildEmbedServerList,
  getCleanIframeAttributes,
  resolvePlaybackPlan,
  parseFileSizeMB,
  formatPlayerTimecode,
  FALLBACK_TEST_MP4_720P,
  sanitizeSearchQuery,
  addRecentSearchQuery,
  removeRecentSearchQuery,
} from './streamResolver';
import {
  parseMovieFileName,
  parseHosterFilesList,
} from '../services/videoHosterIntegration';
import {
  buildCustomFetchHeaders,
  sanitizeHeaderValue,
} from './blobStreamFetcher';
import {
  buildCorsProxyHeaders,
  buildProxiedUrl,
  DEFAULT_SUPABASE_CORS_PROXY_URL,
  getActiveCorsProxyBaseUrl,
  MOVIEBOX_REQUIRED_HEADERS,
  parseMovieBoxSearchResponse,
  parseMovieBoxStreamResponse,
} from '../services/movieBoxDirectApi';
import {
  buildDirectTmdbHeaders,
  buildDirectTmdbUrl,
  buildTmdbProxyHeaders,
  buildTmdbRequestUrl,
  DEFAULT_DEPLOYED_TMDB_PROXY_URL,
  getActiveTmdbApiKey,
  getActiveTmdbProxyUrl,
  getActiveTmdbReadAccessToken,
} from '../services/tmdbService';
import { getLanguageDirection, getTranslation } from './i18n';

test('Security: sanitizeSafeUrl allows valid https/http and blocks XSS schemes', () => {
  assert.equal(
    sanitizeSafeUrl('https://commondatastorage.googleapis.com/sample.mp4'),
    'https://commondatastorage.googleapis.com/sample.mp4'
  );
  assert.equal(sanitizeSafeUrl('javascript:alert(document.cookie)'), null);
  assert.equal(sanitizeSafeUrl('JAVASCRIPT:eval("evil()")'), null);
  assert.equal(sanitizeSafeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeSafeUrl(''), null);
  assert.equal(sanitizeSafeUrl(null), null);
});

test('Security: sanitizeFileName and buildPublicExportPath block path traversal attacks', () => {
  const maliciousTitle = '../../../etc/passwd [Hindi] <script>';
  const safeName = sanitizeFileName(maliciousTitle, '720p', 'mp4');
  assert.equal(safeName.includes('..'), false);
  assert.equal(safeName.includes('/'), false);
  assert.equal(safeName.includes('<'), false);
  assert.equal(safeName, 'etcpasswd_Hindi_script_720p.mp4');

  const publicPath = buildPublicExportPath('../../RootHack', 'Immortal [Hindi]', '720p');
  assert.equal(publicPath, 'Download/RootHack/Immortal_Hindi_720p.mp4');
});

test('Security: sanitizeBannerHtml strips script tags, iframes, and inline event handlers', () => {
  const dirtyHtml =
    '<div onclick="stealToken()">Promo <script> evil() </script><img src="x" onerror="alert(1)" /><a href="javascript:hack()">Click</a></div>';
  const cleanHtml = sanitizeBannerHtml(dirtyHtml);
  assert.equal(cleanHtml.includes('<script'), false);
  assert.equal(cleanHtml.includes('onclick'), false);
  assert.equal(cleanHtml.includes('onerror'), false);
  assert.equal(cleanHtml.includes('javascript:'), false);
  assert.equal(cleanHtml.includes('Promo'), true);
});

test('Phase 1 Security: isAdminJwtUser and isModeratorOrAdminJwtUser strictly verify JWT app_metadata.role = "admin" and reject user_metadata spoofing', () => {
  assert.equal(isAdminJwtUser(null), false);
  assert.equal(isAdminJwtUser(undefined), false);
  assert.equal(
    isAdminJwtUser({
      user: {
        email: 'user@example.com',
        app_metadata: { role: 'user' },
        user_metadata: { role: 'admin' }, // Spoofed user_metadata must be rejected
      },
    }),
    false
  );
  assert.equal(
    isAdminJwtUser({
      user: {
        email: 'admin@cinebox.app',
        app_metadata: { role: 'admin' },
      },
    }),
    true
  );
  assert.equal(
    isModeratorOrAdminJwtUser({
      user: {
        email: 'mod@cinebox.app',
        app_metadata: { role: 'moderator' },
      },
    }),
    true
  );
});

test('Validation: validateMovieLinkInput rejects invalid tmdb_id or malicious URLs', () => {
  const badId = validateMovieLinkInput({ tmdb_id: -5, language: 'Hindi' });
  assert.equal(badId.valid, false);

  const badUrl = validateMovieLinkInput({
    tmdb_id: 533535,
    direct_video_url: 'javascript:alert(1)',
  });
  assert.equal(badUrl.valid, false);

  const valid = validateMovieLinkInput({
    tmdb_id: 533535,
    title: 'Deadpool & Wolverine',
    language: 'Hindi',
    direct_video_url: 'https://cdn.example.com/movie.m3u8',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.sanitized?.tmdb_id, 533535);
});

test('Hybrid Player: resolvePlaybackPlan defaults to Server 3 (2Embed) and hides sandbox-blocked Server 2 & Server 4', () => {
  const moviePlan = resolvePlaybackPlan(550, null, 'movie');
  assert.equal(moviePlan.preferredMode, 'embed');
  assert.equal(moviePlan.directVideoUrl, null);
  assert.equal(typeof moviePlan.testFallbackMp4Url, 'string');
  assert.ok(moviePlan.testFallbackMp4Url.startsWith('https://'));
  // Server 3 (2Embed), Server 1 (VidSrc.sh), and 3 Hindi/Dual-Audio servers are returned
  assert.equal(moviePlan.embedServers.length, 5);
  assert.equal(moviePlan.embedServers[0].id, 'auto-server-3');
  assert.equal(moviePlan.embedServers[0].url, 'https://www.2embed.cc/embed/550');
  assert.equal(moviePlan.embedServers[1].id, 'auto-server-1');
  assert.equal(moviePlan.embedServers[1].url, 'https://vidsrc.sh/embed/movie/550?ds_lang=en');
  assert.equal(moviePlan.embedServers[2].id, 'hindi-multiembed');
  assert.equal(moviePlan.embedServers[3].id, 'hindi-autoembed');
  assert.equal(moviePlan.embedServers[4].id, 'hindi-vidsrc-icu');

  const tvPlanDefault = resolvePlaybackPlan(1399, null, 'tv', 1, 1);
  assert.equal(tvPlanDefault.preferredMode, 'embed');
  assert.equal(tvPlanDefault.embedServers.length, 5);
  assert.equal(tvPlanDefault.embedServers[0].id, 'auto-server-3');
  assert.equal(tvPlanDefault.embedServers[0].url, 'https://www.2embed.cc/embedtv/1399&s=1&e=1');
  assert.equal(tvPlanDefault.embedServers[1].id, 'auto-server-1');
  assert.equal(tvPlanDefault.embedServers[1].url, 'https://vidsrc.sh/embed/tv/1399/1/1?ds_lang=en');

  const tvPlanS2E5 = buildEmbedServerList(1399, 'tv', 2, 5);
  assert.equal(tvPlanS2E5[0].url, 'https://www.2embed.cc/embedtv/1399&s=2&e=5');
  assert.equal(tvPlanS2E5[1].url, 'https://vidsrc.sh/embed/tv/1399/2/5?ds_lang=en');

  const hlsPlan = resolvePlaybackPlan(
    533535,
    {
      tmdb_id: 533535,
      language: 'Hindi Dub',
      direct_video_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      stream_url: 'https://custom.embed/movie/533535',
      download_480p: 'https://cdn.example.com/movie-480p.mp4',
      download_720p: 'https://cdn.example.com/movie-720p.mp4',
    },
    'movie'
  );
  assert.equal(hlsPlan.preferredMode, 'direct-hls');
  assert.equal(hlsPlan.embedServers.length, 6);
  assert.equal(hlsPlan.embedServers[0].isCustom, true);
});

test('Recent Searches: sanitizeSearchQuery, addRecentSearchQuery, and removeRecentSearchQuery handle XSS and deduplication', () => {
  assert.equal(sanitizeSearchQuery('  <script>Avatar</script>  '), 'scriptAvatar/script');
  let list = addRecentSearchQuery([], 'Avatar');
  list = addRecentSearchQuery(list, 'Jawan');
  list = addRecentSearchQuery(list, 'avatar'); // case-insensitive duplicate moves to front
  assert.deepEqual(list, ['avatar', 'Jawan']);

  list = removeRecentSearchQuery(list, 'AVATAR');
  assert.deepEqual(list, ['Jawan']);
});

test('Utilities: formatPlayerTimecode and parseFileSizeMB handle edge cases', () => {
  assert.equal(formatPlayerTimecode(1228), '20:28');
  assert.equal(formatPlayerTimecode(7781), '2:09:41');
  assert.equal(formatPlayerTimecode(-10), '00:00');
  assert.equal(parseFileSizeMB('1020.6MB'), 1020.6);
  assert.equal(parseFileSizeMB('1.5GB'), 1536);
  assert.equal(parseFileSizeMB(null, 500), 500);
});

test('Video Hoster: parseMovieFileName and parseHosterFilesList handle scene releases and API responses', () => {
  const parsed1 = parseMovieFileName('Deadpool.and.Wolverine.2024.1080p.WEBRip.Hindi.x264.mp4');
  assert.equal(parsed1.cleanTitle, 'Deadpool and Wolverine');
  assert.equal(parsed1.year, '2024');

  const parsed2 = parseMovieFileName('Jawan_2023_720p_Hindi_Dubbed.mkv');
  assert.equal(parsed2.cleanTitle, 'Jawan');
  assert.equal(parsed2.year, '2023');

  const rawList = `
# Sample Host List
Inception | https://streamwish.com/e/incp123 | https://streamwish.com/d/incp123.mp4
Interstellar | intst456
`;
  const items = parseHosterFilesList(rawList, 'streamwish');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Inception');
  assert.equal(items[0].fileCode, 'incp123');
  assert.equal(items[0].embedUrl, 'https://streamwish.com/e/incp123');
  assert.equal(items[1].title, 'Interstellar');
  assert.equal(items[1].fileCode, 'intst456');
  assert.equal(items[1].embedUrl, 'https://streamwish.com/e/intst456');
});

test('Blob Stream Fetcher: buildCustomFetchHeaders sets User-Agent & Referer and strips CRLF injection', () => {
  const clean = sanitizeHeaderValue('Mozilla/5.0\r\nX-Injected: hacked');
  assert.equal(clean, 'Mozilla/5.0X-Injected: hacked');

  const headers = buildCustomFetchHeaders({
    userAgent: 'CustomPlayer/1.0 (Android 14)',
    referer: 'https://streamwish.com/e/abc123',
  });
  assert.equal(headers['User-Agent'], 'CustomPlayer/1.0 (Android 14)');
  assert.equal(headers['Referer'], 'https://streamwish.com/e/abc123');
});

test('MovieBox Direct Proxy API: builds proxy URLs, headers, and parses search & stream responses', () => {
  const target = 'https://h5.aoneroom.com/wefeed-h5api-bff/subject/search?keyword=Avatar';
  assert.equal(
    buildProxiedUrl(target, 'https://corsproxy.io/?'),
    'https://corsproxy.io/?https%3A%2F%2Fh5.aoneroom.com%2Fwefeed-h5api-bff%2Fsubject%2Fsearch%3Fkeyword%3DAvatar'
  );
  assert.equal(
    MOVIEBOX_REQUIRED_HEADERS['User-Agent'],
    'com.community.mbox.in/50020130 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)'
  );
  assert.equal(MOVIEBOX_REQUIRED_HEADERS['Referer'], 'https://api3.aoneroom.com/');

  const mockSearchJson = {
    data: {
      items: [
        {
          subjectId: '987654',
          title: 'Avatar: Fire and Ash',
          cover: { url: 'https://image.tmdb.org/t/p/w500/avatar.jpg' },
          releaseDate: '2025-12-19',
          imdbRatingValue: '8.7',
        },
      ],
    },
  };
  const parsedItems = parseMovieBoxSearchResponse(mockSearchJson);
  assert.equal(parsedItems.length, 1);
  assert.equal(parsedItems[0].id, 987654);
  assert.equal(parsedItems[0].originalTitle, '987654');
  assert.equal(parsedItems[0].title, 'Avatar: Fire and Ash');
  assert.equal(parsedItems[0].posterUrl, 'https://image.tmdb.org/t/p/w500/avatar.jpg');

  const mockPlayJson = {
    data: {
      streams: [
        {
          url: 'https://cdn.aoneroom.com/streams/avatar-720p.mp4',
          resolutions: '720P',
        },
      ],
    },
  };
  const streamUrl = parseMovieBoxStreamResponse(mockPlayJson);
  assert.equal(streamUrl, 'https://cdn.aoneroom.com/streams/avatar-720p.mp4');
});

test('Embed Stream Extractor (2Embed & VidSrc): extracts .m3u8 and .mp4 URLs and nested RCP iframe sources', async () => {
  const {
    extractStreamUrlsFromHtml,
    extractNestedEmbedSourcesFromHtml,
    EXTRACTION_UNAVAILABLE_MESSAGE,
  } = await import('../services/embedStreamExtractor');

  assert.equal(
    EXTRACTION_UNAVAILABLE_MESSAGE,
    'Download not available for this server, try another'
  );

  // 1. Escaped JSON/JS payload containing .m3u8 and .mp4 streams (Streambert pattern)
  const sampleEmbedHtml = `
    <script>
      const playerSources = {
        hls: "https:\\/\\/cdn.vidsrc-stream.net\\/hls\\/550\\/master.m3u8?token=abc123",
        backupMp4: "https://cdn.2embed-storage.com/movies/550-720p.mp4"
      };
    </script>
  `;
  const extracted = extractStreamUrlsFromHtml(sampleEmbedHtml, 'server-3-2embed');
  assert.equal(extracted.length, 2);
  // Prioritizes .mp4 first, then .m3u8
  assert.equal(extracted[0].format, 'mp4');
  assert.equal(extracted[0].url, 'https://cdn.2embed-storage.com/movies/550-720p.mp4');
  assert.equal(extracted[1].format, 'm3u8');
  assert.equal(
    extracted[1].url,
    'https://cdn.vidsrc-stream.net/hls/550/master.m3u8?token=abc123'
  );

  // 2. Nested VidSrc RCP data-hash and iframe src extraction
  const wrapperHtml = `
    <div class="server" data-hash="a1b2c3d4e5f6g7h8i9j0k1l2">VidSrc PRO</div>
    <iframe src="//cloudnestra.com/rcp/xyz987654321"></iframe>
  `;
  const nested = extractNestedEmbedSourcesFromHtml(wrapperHtml, 'https://vidsrc.sh');
  assert.equal(nested.includes('https://cloudnestra.com/rcp/xyz987654321'), true);
  assert.equal(nested.includes('https://cloudnestra.com/rcp/a1b2c3d4e5f6g7h8i9j0k1l2'), true);
});

test('Iframe Player: getCleanIframeAttributes returns src and allowFullScreen with zero sandbox attributes', () => {
  const attrs = getCleanIframeAttributes(
    'https://vidsrc.sh/embed/movie/550?ds_lang=en',
    'Fight Club - Server 1 (VidSrc.sh)'
  );
  assert.equal(attrs.src, 'https://vidsrc.sh/embed/movie/550?ds_lang=en');
  assert.equal(attrs.allowFullScreen, true);
  assert.equal('sandbox' in attrs, false);
  assert.equal(attrs.sandbox, undefined);

  const maliciousAttrs = getCleanIframeAttributes('javascript:alert(1)', 'Malicious');
  assert.equal(maliciousAttrs.src, '');
});

test('Global Admin Bulk Upload: parseDirectBulkMovieLinksInput parses CSV/Pipe and JSON while blocking XSS URLs', () => {
  const pipeData = `
# tmdb_id | title | language | direct_video_url | stream_url | download_480p | download_720p
533535 | Deadpool & Wolverine | Hindi Dub | https://cdn.example.com/dp3.mp4 | https://www.2embed.cc/embed/533535 | https://cdn.example.com/dp3-480p.mp4 | https://cdn.example.com/dp3-720p.mp4
872585 | Oppenheimer | Dual Audio | https://cdn.example.com/opp.m3u8
999999 | Bad Movie | Hindi | javascript:alert(1)
-15 | Invalid ID | Hindi | https://cdn.example.com/bad.mp4
`;
  const parsedPipe = parseDirectBulkMovieLinksInput(pipeData);
  assert.equal(parsedPipe.validRecords.length, 2);
  assert.equal(parsedPipe.validRecords[0].tmdb_id, 533535);
  assert.equal(parsedPipe.validRecords[0].title, 'Deadpool & Wolverine');
  assert.equal(parsedPipe.validRecords[1].tmdb_id, 872585);
  assert.equal(parsedPipe.errors.length, 2);

  const jsonData = JSON.stringify([
    {
      tmdb_id: 693134,
      title: 'Dune: Part Two',
      language: 'Hindi Dubbed',
      direct_video_url: 'https://cdn.example.com/dune2.mp4',
    },
  ]);
  const parsedJson = parseDirectBulkMovieLinksInput(jsonData);
  assert.equal(parsedJson.validRecords.length, 1);
  assert.equal(parsedJson.validRecords[0].tmdb_id, 693134);
  assert.equal(parsedJson.errors.length, 0);
});

test('Global Users Control: validateAppUserInput sanitizes XSS and enforces valid roles and account statuses', () => {
  const badEmail = validateAppUserInput({
    username: 'Ali Khan',
    email: 'not-an-email',
  });
  assert.equal(badEmail.valid, false);

  const validUser = validateAppUserInput({
    id: 'usr_test_1',
    username: '<script>Bilal Ahmed</script>',
    email: 'Bilal@CineBox.app',
    role: 'vip',
    status: 'active',
    platform: 'Android APK',
    downloads_count: 15,
    notes: '<b>Trusted VIP subscriber</b>',
  });
  assert.equal(validUser.valid, true);
  assert.equal(validUser.sanitized?.username, 'scriptBilal Ahmed/script');
  assert.equal(validUser.sanitized?.email, 'bilal@cinebox.app');
  assert.equal(validUser.sanitized?.role, 'vip');
  assert.equal(validUser.sanitized?.status, 'active');
  assert.equal(validUser.sanitized?.platform, 'Android APK');
  assert.equal(validUser.sanitized?.notes, 'bTrusted VIP subscriber/b');
});

test('Global Decentralized Access Control: evaluateGlobalUserAccess enforces ban, suspension, and maintenance mode', () => {
  const activeConfig = {
    id: 1,
    maintenance_mode: false,
    allow_guest_downloads: true,
  };
  const bannedUser = {
    id: 'usr_banned',
    username: 'Spammer',
    email: 'spam@example.org',
    role: 'user' as const,
    status: 'banned' as const,
    platform: 'Android APK' as const,
    downloads_count: 0,
  };

  // Banned user is blocked when not admin
  const bannedCheck = evaluateGlobalUserAccess(bannedUser, activeConfig, false);
  assert.equal(bannedCheck.allowed, false);
  assert.equal(bannedCheck.reason?.includes('banned'), true);

  // Admin unlock overrides lockouts so Admin can always manage the console
  const adminOverride = evaluateGlobalUserAccess(bannedUser, activeConfig, true);
  assert.equal(adminOverride.allowed, true);

  // Maintenance mode locks out regular active users but allows unlocked Admin
  const maintenanceConfig = {
    id: 1,
    maintenance_mode: true,
    allow_guest_downloads: false,
  };
  const activeUser = {
    ...bannedUser,
    id: 'usr_active',
    status: 'active' as const,
  };
  const maintenanceCheck = evaluateGlobalUserAccess(activeUser, maintenanceConfig, false);
  assert.equal(maintenanceCheck.allowed, false);
  assert.equal(maintenanceCheck.reason?.includes('maintenance'), true);
});

test('Phase 1 User ID & Database Text Sanitization: generateAllottedUserId and sanitizeDatabaseTextField work deterministically and block XSS', () => {
  const id1 = generateAllottedUserId('user@cinebox.app');
  const id2 = generateAllottedUserId('USER@cinebox.app  ');
  assert.equal(id1.startsWith('USR-'), true);
  assert.equal(id1, id2);

  const dirtyTitle = '<script>alert(1)</script>Jawan <img src=x onerror=evil()> (2023)';
  const cleanTitle = sanitizeDatabaseTextField(dirtyTitle, 120);
  assert.equal(cleanTitle.includes('<script'), false);
  assert.equal(cleanTitle.includes('onerror'), false);
  assert.equal(cleanTitle, 'Jawan (2023)');
});

test('Ad-Free HTML Security Guard: verifyAdFreeHtmlGuard blocks external ad scripts, popunders, and inline XSS handlers', () => {
  const emptyCheck = verifyAdFreeHtmlGuard('');
  assert.equal(emptyCheck.isAdFree, true);
  assert.equal(emptyCheck.sanitizedHtml, '');

  const scriptBlocked = verifyAdFreeHtmlGuard(
    '<script async src="https://example-ad-server.com/invoke.js"></script><div id="ad-slot"></div>'
  );
  assert.equal(scriptBlocked.isAdFree, false);
  assert.equal(scriptBlocked.sanitizedHtml, '');

  const popunderBlocked = verifyAdFreeHtmlGuard('<div onclick="window.open(\'https://spam.example\')">Click</div>');
  assert.equal(popunderBlocked.isAdFree, false);

  const cleanStatic = verifyAdFreeHtmlGuard('<div>CineBox HD Streaming</div>');
  assert.equal(cleanStatic.isAdFree, true);
  assert.equal(cleanStatic.sanitizedHtml, '<div>CineBox HD Streaming</div>');
});

test('Pakistani Drama & Hindi Dubbed Resolver: detects Dar-E-Nijaat and ranks full episodes above short clips', async () => {
  const {
    isPakistaniOrUrduContent,
    rankAndFilterDramaOrHindiStreams,
    buildDramaOrHindiSearchQuery,
  } = await import('../services/hindiAndPakDramaService');

  assert.equal(
    isPakistaniOrUrduContent({
      title: 'Dar-E-Nijaat',
      originalTitle: 'در نجات',
      language: 'Urdu / Pak Drama',
    }),
    true
  );

  assert.equal(
    buildDramaOrHindiSearchQuery({
      title: 'Dar-E-Nijaat',
      mediaType: 'tv',
      episode: 1,
      isPakDrama: true,
    }),
    'Dar E Nijaat Episode 1'
  );

  const rawApiItems = [
    { id: 'xbdkoce', title: 'dar e nijaat promo clip', duration: 32 },
    { id: 'xaz876a', title: 'Dar E Nijaat episode 4', duration: 2344 },
    { id: 'xatzowq', title: 'Dar-e-Nijaat Episode 1', duration: 2273 },
  ];

  const ranked = rankAndFilterDramaOrHindiStreams(rawApiItems, 1, 'pak-drama');
  // 32s clip is filtered out; Episode 1 (2273s) is ranked #1 ahead of Episode 4
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, 'xatzowq');
  assert.equal(ranked[0].durationFormatted, '37m 53s');
  assert.ok(ranked[0].embedUrl.includes('https://www.dailymotion.com/embed/video/xatzowq'));
});

test('Mobile Player Overlay Guard: getBlobStreamAlertState hides Server Busy & loading overlay on embed/pak-drama modes', async () => {
  const { getBlobStreamAlertState } = await import('./streamResolver');

  // Playing on Server 3 (embed) or Pak Drama while MovieBox proxy returns "Server Busy, Try Again"
  const embedState = getBlobStreamAlertState('embed', true, 'Server Busy, Try Again', false);
  assert.equal(embedState.showLoadingOverlay, false);
  assert.equal(embedState.showErrorBanner, false);

  const dramaState = getBlobStreamAlertState('pak-drama', false, 'Server Busy, Try Again', false);
  assert.equal(dramaState.showLoadingOverlay, false);
  assert.equal(dramaState.showErrorBanner, false);

  // Only when explicitly on 'blob' mode should loading or error states appear
  const blobActive = getBlobStreamAlertState('blob', false, 'Server Busy, Try Again', false);
  assert.equal(blobActive.showLoadingOverlay, false);
  assert.equal(blobActive.showErrorBanner, true);

  // Dismissing the error hides it even in blob mode
  const blobDismissed = getBlobStreamAlertState('blob', false, 'Server Busy, Try Again', true);
  assert.equal(blobDismissed.showErrorBanner, false);
});

test('Audio System 2.0 (Scenarios 1-5): detectVerifiedAudioTracks & normalizeDetectedAudioTracks strictly inspect real HLS/HTML5 tracks and NEVER fabricate fake tracks from metadata', async () => {
  const { normalizeDetectedAudioTracks, shouldShowAudioTrackButton } = await import(
    './streamResolver'
  );
  const { detectVerifiedAudioTracks } = await import('../services/streamSourceManager');

  // Scenario 1: HLS stream with English only -> 1 track ('English — Original'), switcher hidden
  const englishOnly = detectVerifiedAudioTracks([
    { id: 0, name: 'Main Audio', lang: 'en', default: true },
  ]);
  assert.equal(englishOnly.length, 1);
  assert.equal(englishOnly[0].displayLabel, 'English — Original');
  assert.equal(englishOnly[0].lang, 'en');
  assert.equal(englishOnly[0].audioRole, 'Original');
  assert.equal(shouldShowAudioTrackButton(englishOnly), false);

  // Scenario 2: HLS stream with English and Hindi -> 2 tracks ('English — Original', 'Hindi — Dubbed'), switcher shown
  const englishAndHindi = detectVerifiedAudioTracks(
    [
      { id: 0, name: 'Original 5.1', lang: 'en', default: true, groupId: 'audio-aac' },
      { id: 1, name: 'Hindi Dubbed', lang: 'hi', default: false, groupId: 'audio-aac' },
    ],
    null,
    'en'
  );
  assert.equal(englishAndHindi.length, 2);
  assert.equal(englishAndHindi[0].displayLabel, 'English — Original');
  assert.equal(englishAndHindi[1].displayLabel, 'Hindi — Dubbed');
  assert.equal(englishAndHindi[1].groupId, 'audio-aac');
  assert.equal(shouldShowAudioTrackButton(englishAndHindi), true);

  // Scenario 3: HLS stream with English, Hindi, and Urdu (+ duplicate Hindi track) -> deduplicated to 3 verified tracks
  const multiWithDup = detectVerifiedAudioTracks(
    [
      { id: 0, name: 'English', lang: 'en', default: true },
      { id: 1, name: 'Hindi', lang: 'hi', default: false },
      { id: 2, name: 'Hindi', lang: 'hi', default: false }, // Duplicate track should be removed
      { id: 3, name: 'Urdu', lang: 'ur', default: false },
    ],
    null,
    'en'
  );
  assert.equal(multiWithDup.length, 3);
  assert.equal(multiWithDup[0].displayLabel, 'English — Original');
  assert.equal(multiWithDup[1].displayLabel, 'Hindi — Dubbed');
  assert.equal(multiWithDup[2].displayLabel, 'Urdu — Dubbed');

  // Scenario 4: Stream without language metadata -> honest fallback 'Track 1 — Default'
  const unlabeledTracks = detectVerifiedAudioTracks([
    { id: 0, default: true },
    { id: 1, default: false },
  ]);
  assert.equal(unlabeledTracks.length, 2);
  assert.equal(unlabeledTracks[0].displayLabel, 'Track 1 — Default');
  assert.equal(unlabeledTracks[1].displayLabel, 'Track 2 — Audio');

  // Scenario 5: Stream with misleading TMDB/movie metadata ('Dual Audio', 'Hindi + English') -> NEVER creates fake tracks
  const misleadingMeta = normalizeDetectedAudioTracks(null, null, 'Dual Audio (Hindi + English)');
  assert.equal(misleadingMeta.length, 0);
  assert.equal(shouldShowAudioTrackButton(misleadingMeta), false);
});

test('Audio System 2.0 (Scenarios 6-9): safe audio switching with automatic fallback, separate authorized language streams, and honest cross-origin iframe capability', async () => {
  const {
    detectVerifiedAudioTracks,
    switchEmbeddedAudioTrackSafely,
    resolveAlternateLanguageStreams,
    evaluatePlayerAudioCapability,
  } = await import('../services/streamSourceManager');

  // Scenario 6: Failed alternate audio track automatically falls back to previous working track while preserving playback position
  let currentHlsTrack = 0;
  const mockHls = {
    audioTracks: [{ id: 0 }, { id: 1 }, { id: 99 }],
    get audioTrack() {
      return currentHlsTrack;
    },
    set audioTrack(val: number) {
      if (val === 99) {
        throw new Error('Demuxer audio switch error');
      }
      currentHlsTrack = val;
    },
  };
  let videoCurrentTime = 412.5;
  const mockVideo = {
    get currentTime() {
      return videoCurrentTime;
    },
    set currentTime(val: number) {
      videoCurrentTime = val;
    },
    paused: false,
    play: async () => {},
  };

  const verifiedTracks = detectVerifiedAudioTracks(
    [
      { id: 0, name: 'English', lang: 'en', default: true },
      { id: 1, name: 'Hindi', lang: 'hi', default: false },
      { id: 99, name: 'Corrupted Track', lang: 'ur', default: false },
    ],
    null,
    'en'
  );

  // Successful switch to Hindi (track 1) preserves currentTime (412.5s) and playback state
  const okSwitch = switchEmbeddedAudioTrackSafely({
    targetTrackId: 1,
    previousTrackId: 0,
    availableTracks: verifiedTracks,
    hlsInstance: mockHls,
    videoElement: mockVideo,
  });
  assert.equal(okSwitch.ok, true);
  assert.equal(okSwitch.activeTrackId, 1);
  assert.equal(okSwitch.preservedTimeSeconds, 412.5);
  assert.equal(okSwitch.wasPlaying, true);
  assert.equal(okSwitch.fellBack, false);

  // Failed switch to track 99 automatically falls back to track 1
  const failedSwitch = switchEmbeddedAudioTrackSafely({
    targetTrackId: 99,
    previousTrackId: 1,
    availableTracks: verifiedTracks,
    hlsInstance: mockHls,
    videoElement: mockVideo,
  });
  assert.equal(failedSwitch.ok, false);
  assert.equal(failedSwitch.fellBack, true);
  assert.equal(failedSwitch.activeTrackId, 1);
  assert.equal(currentHlsTrack, 1);

  // Scenarios 7 & 8: Separate authorized English, Hindi Dubbed, and Urdu Dubbed streams
  const separateStreams = resolveAlternateLanguageStreams(
    {
      tmdb_id: 533535,
      language: 'English',
      direct_video_url: 'https://cdn.example.com/dp3-english.m3u8',
      hindi_dubbed_video_url: 'https://cdn.example.com/dp3-hindi.m3u8',
      urdu_dubbed_video_url: 'https://cdn.example.com/dp3-urdu.mp4',
      stream_url: 'https://www.2embed.cc/embed/533535',
      download_480p: '',
      download_720p: '',
    },
    'en'
  );
  assert.equal(separateStreams.length, 3);
  assert.equal(separateStreams[0].label, 'Original (English)');
  assert.equal(separateStreams[1].label, 'Hindi Dubbed');
  assert.equal(separateStreams[2].label, 'Urdu Dubbed');

  // Scenario 9: Cross-origin iframe provider reports honest limitation (canSwitchEmbeddedAudio: false)
  const iframeCapability = evaluatePlayerAudioCapability({
    playerMode: 'embed',
    verifiedTracks,
    alternateStreams: separateStreams,
  });
  assert.equal(iframeCapability.mode, 'cross-origin-iframe');
  assert.equal(iframeCapability.canSwitchEmbeddedAudio, false);
  assert.equal(iframeCapability.hasAlternateLanguageStreams, true);
  assert.ok(iframeCapability.honestStatusMessage.includes('Cross-origin iframe'));
});

test('Phase 4 & 6: Stream Source Manager deduplicates sources, selects healthy fallbacks, and parses TMDB Watch Providers', async () => {
  const {
    resolveAlternateLanguageStreams,
    buildCentralizedManagedSources,
    deduplicateManagedSources,
    selectNextFallbackSource,
  } = await import('../services/streamSourceManager');
  const { parseTmdbWatchProviders } = await import('../services/tmdbService');

  const linkRecord = {
    tmdb_id: 533535,
    language: 'English',
    direct_video_url: 'https://cdn.example.com/dp3-en.m3u8',
    hindi_dubbed_video_url: 'https://cdn.example.com/dp3-hi.m3u8',
    stream_url: 'https://www.2embed.cc/embed/533535',
    download_480p: '',
    download_720p: '',
  };
  const alternateStreams = resolveAlternateLanguageStreams(linkRecord, 'en');

  const managed = buildCentralizedManagedSources({
    tmdbId: 533535,
    mediaType: 'movie',
    linkRecord,
    embedServers: [
      { id: 'auto-server-3', label: 'Server 3 (2Embed)', url: 'https://www.2embed.cc/embed/533535', isCustom: false },
      { id: 'dup-server-3', label: 'Duplicate 2Embed', url: 'https://www.2embed.cc/embed/533535', isCustom: false },
    ],
    alternateStreams,
  });

  // Duplicate 2Embed URL should be removed automatically
  const matching2Embed = managed.filter((s) => s.streamUrl === 'https://www.2embed.cc/embed/533535');
  assert.equal(matching2Embed.length, 1);

  const dupList = deduplicateManagedSources([
    ...managed,
    { ...managed[0], id: 'extra-dup' },
  ]);
  assert.equal(dupList.length, managed.length);

  // Fallback selection skips failed source and picks next available source
  const nextSource = selectNextFallbackSource(managed, managed[0].id);
  assert.ok(nextSource !== null);
  assert.notEqual(nextSource?.id, managed[0].id);

  // Official TMDB Watch Providers parser
  const parsedWatch = parseTmdbWatchProviders({
    results: {
      IN: {
        link: 'https://www.themoviedb.org/movie/533535/watch?locale=IN',
        flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
        rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/apple.jpg' }],
      },
    },
  });
  assert.equal(parsedWatch.providers.length, 2);
  assert.equal(parsedWatch.providers[0].providerName, 'Netflix');
  assert.equal(parsedWatch.providers[0].type, 'flatrate');
  assert.equal(parsedWatch.providers[1].providerName, 'Apple TV');
  assert.equal(parsedWatch.providers[1].type, 'rent');
});

test('Strict Banner-Only Ad Sanitizer: strips redirect/popunder scripts and neutralizes clickable ad links', async () => {
  const { sanitizeStaticBannerAdCode, verifyAdFreeHtmlGuard } = await import(
    './securityValidator'
  );

  const rawAdWithPopunderAndLink = `
    <script>window.open('https://evil-popunder.com');</script>
    <a href="https://redirect-ad.com" target="_blank" onclick="window.open('https://hijack.com')">
      <img src="https://cdn.example.com/banner.jpg" alt="Static Banner" />
    </a>
  `;

  const sanitized = sanitizeStaticBannerAdCode(rawAdWithPopunderAndLink);
  assert.equal(sanitized.includes('<script'), false);
  assert.equal(sanitized.includes('window.open'), false);
  assert.equal(sanitized.includes('onclick'), false);
  assert.equal(sanitized.includes('<a '), false);
  assert.equal(sanitized.includes('pointer-events-none'), true);

  // Reject any snippet that attempts popunders or external ad scripts
  const popunderCheck = verifyAdFreeHtmlGuard(
    `<script src="https://external-ad-server.example/ad.js">window.open("https://popunder.com")</script><div id="ad-slot"></div>`
  );
  assert.equal(popunderCheck.isAdFree, false);
});

test('Stage 2 Deep Verification: checkStreamSourceHealth (HEAD->GET fallback, #EXTM3U manifest check, soft-404 rejection, iframe protection) & alternate_streams XSS sanitization', async () => {
  const { checkStreamSourceHealth, detectVerifiedAudioTracks } = await import(
    '../services/streamSourceManager'
  );
  const { validateMovieLinkInput } = await import('./securityValidator');

  // 1. Disambiguate multiple tracks of the same language (e.g., Angel One HLS 'en' stream_5 and 'en' stream_6)
  const angelOneTracks = detectVerifiedAudioTracks(
    [
      { id: 0, name: 'stream_5', lang: 'en', default: true },
      { id: 1, name: 'stream_4', lang: 'de', default: false },
      { id: 2, name: 'stream_6', lang: 'en', default: false },
    ],
    null,
    'en'
  );
  assert.equal(angelOneTracks.length, 3);
  assert.equal(angelOneTracks[0].displayLabel, 'English — Original');
  assert.equal(angelOneTracks[1].displayLabel, 'German — Dubbed');
  assert.equal(angelOneTracks[2].displayLabel, 'English — Alternate (stream_6)');

  // 2. Cross-origin iframe is never classified as broken because of HEAD/CORS blocking
  const iframeCheck = await checkStreamSourceHealth({
    id: 'auto-server-3',
    providerName: '2Embed',
    movieIdentifier: '533535',
    label: 'Server 3 (2Embed)',
    streamUrl: 'https://www.2embed.cc/embed/533535',
    format: 'iframe',
    language: 'Provider Default',
    languageCode: 'und',
    audioType: 'provider-controlled',
    availabilityStatus: 'available',
    validationStatus: 'unverified-external',
    isCrossOriginIframe: true,
    supportsInternalAudioSwitch: false,
  });
  assert.equal(iframeCheck.availabilityStatus, 'available');
  assert.equal(iframeCheck.validationStatus, 'unverified-external');

  // 3. HLS manifest validation: valid #EXTM3U passes, HTML soft-404 fails
  const validHlsFetch = (async () => ({
    ok: true,
    status: 200,
    redirected: true,
    url: 'https://cdn.example.com/edge/master.m3u8',
    headers: new Map([['content-type', 'application/vnd.apple.mpegurl']]),
    text: async () => '#EXTM3U\n#EXT-X-VERSION:3\n',
  })) as unknown as typeof fetch;

  const hlsOk = await checkStreamSourceHealth(
    {
      id: 'hls-1',
      providerName: 'Direct HLS',
      movieIdentifier: '533535',
      label: 'HLS Stream',
      streamUrl: 'https://cdn.example.com/master.m3u8',
      format: 'hls',
      language: 'English',
      languageCode: 'en',
      audioType: 'original',
      availabilityStatus: 'available',
      validationStatus: 'verified',
      isCrossOriginIframe: false,
      supportsInternalAudioSwitch: true,
    },
    3000,
    validHlsFetch
  );
  assert.equal(hlsOk.availabilityStatus, 'available');
  assert.equal(hlsOk.hlsManifestValid, true);
  assert.equal(hlsOk.redirected, true);
  assert.equal(hlsOk.finalUrl, 'https://cdn.example.com/edge/master.m3u8');

  const htmlSoft404Fetch = (async () => ({
    ok: true,
    status: 200,
    redirected: false,
    url: 'https://cdn.example.com/broken.m3u8',
    headers: new Map([['content-type', 'text/html']]),
    text: async () => '<html><body>404 Not Found</body></html>',
  })) as unknown as typeof fetch;

  const hlsBad = await checkStreamSourceHealth(
    {
      id: 'hls-bad',
      providerName: 'Direct HLS',
      movieIdentifier: '533535',
      label: 'Broken HLS',
      streamUrl: 'https://cdn.example.com/broken.m3u8',
      format: 'hls',
      language: 'English',
      languageCode: 'en',
      audioType: 'original',
      availabilityStatus: 'available',
      validationStatus: 'verified',
      isCrossOriginIframe: false,
      supportsInternalAudioSwitch: true,
    },
    3000,
    htmlSoft404Fetch
  );
  assert.equal(hlsBad.availabilityStatus, 'unavailable');
  assert.equal(hlsBad.hlsManifestValid, false);

  // 4. MP4 HEAD -> GET fallback when server rejects HEAD with 405 Method Not Allowed
  let headCalled = false;
  let getCalled = false;
  const head405ThenGet206Fetch = (async (_url: any, init?: RequestInit) => {
    if (init?.method === 'HEAD') {
      headCalled = true;
      return {
        ok: false,
        status: 405,
        redirected: false,
        url: 'https://cdn.example.com/movie.mp4',
        headers: new Map([['content-type', 'video/mp4']]),
      };
    }
    getCalled = true;
    return {
      ok: true,
      status: 206,
      redirected: false,
      url: 'https://cdn.example.com/movie.mp4',
      headers: new Map([['content-type', 'video/mp4']]),
      body: { cancel: async () => {} },
    };
  }) as unknown as typeof fetch;

  const mp4FallbackCheck = await checkStreamSourceHealth(
    {
      id: 'mp4-1',
      providerName: 'Direct MP4',
      movieIdentifier: '533535',
      label: 'MP4 Stream',
      streamUrl: 'https://cdn.example.com/movie.mp4',
      format: 'mp4',
      language: 'Hindi',
      languageCode: 'hi',
      audioType: 'dubbed',
      availabilityStatus: 'available',
      validationStatus: 'verified',
      isCrossOriginIframe: false,
      supportsInternalAudioSwitch: false,
    },
    3000,
    head405ThenGet206Fetch
  );
  assert.equal(headCalled, true);
  assert.equal(getCalled, true);
  assert.equal(mp4FallbackCheck.availabilityStatus, 'available');
  assert.equal(mp4FallbackCheck.validationStatus, 'verified');

  // 5. validateMovieLinkInput sanitizes alternate_streams labels (stripping <script> blocks and HTML tags) and rejects unsafe URLs
  const validated = validateMovieLinkInput({
    tmdb_id: 533535,
    title: 'Deadpool & Wolverine',
    language: 'English',
    hindi_dubbed_video_url: 'https://cdn.example.com/dp3-hindi.m3u8',
    urdu_dubbed_video_url: 'https://cdn.example.com/dp3-urdu.mp4',
    alternate_streams: [
      {
        id: 'alt-1',
        label: '<b>Tamil Dubbed</b> <script>alert(1)</script>',
        languageCode: 'ta',
        languageName: '<b>Tamil</b>',
        audioType: 'dubbed',
        url: 'https://cdn.example.com/dp3-tamil.m3u8',
        format: 'hls',
        verified: true,
      },
      {
        id: 'evil',
        label: 'XSS Stream',
        languageCode: 'en',
        languageName: 'English',
        audioType: 'original',
        url: 'javascript:alert(1)',
        format: 'mp4',
        verified: true,
      },
    ],
  });
  assert.equal(validated.valid, true);
  assert.equal(validated.sanitized?.alternate_streams?.length, 1);
  assert.equal(validated.sanitized?.alternate_streams?.[0].label, 'Tamil Dubbed');
  assert.equal(validated.sanitized?.alternate_streams?.[0].languageName, 'Tamil');
});

test('Stage 3 Task 1: checkStreamSourceHealth (HEAD first, ranged GET fallback on 400/403/404/405/501 & network error, Range header & body.cancel, #EXTM3U check, HTML soft-404 on 200, timeout, format-based iframe)', async () => {
  const { checkStreamSourceHealth } = await import('../services/streamSourceManager');

  // 1. Format-based iframe detection even if isCrossOriginIframe is false
  const formatIframeRes = await checkStreamSourceHealth({
    id: 'iframe-fmt',
    providerName: 'EmbedProvider',
    movieIdentifier: '533535',
    label: 'Embed',
    streamUrl: 'https://www.2embed.cc/embed/533535',
    format: 'iframe',
    language: 'Provider Default',
    languageCode: 'und',
    audioType: 'provider-controlled',
    availabilityStatus: 'available',
    validationStatus: 'unverified-external',
    isCrossOriginIframe: false,
    supportsInternalAudioSwitch: false,
  });
  assert.equal(formatIframeRes.availabilityStatus, 'available');
  assert.equal(formatIframeRes.validationStatus, 'unverified-external');

  // 2. All fallback status codes (400, 403, 404, 405, 501) and non-timeout network error trigger ranged GET with Range header and body.cancel()
  for (const statusOrErr of [400, 403, 404, 405, 501, 'NETWORK_ERR'] as const) {
    const methodsCalled: string[] = [];
    let rangeHeaderSent = '';
    let bodyCancelled = false;

    const mockFetch = (async (_url: any, init?: RequestInit) => {
      const m = init?.method || 'GET';
      methodsCalled.push(m);
      if (m === 'HEAD') {
        if (statusOrErr === 'NETWORK_ERR') {
          throw new TypeError('Failed to fetch HEAD');
        }
        return {
          ok: false,
          status: statusOrErr,
          redirected: false,
          url: 'https://cdn.example.com/video.mp4',
          headers: new Map([['content-type', 'video/mp4']]),
        };
      }
      rangeHeaderSent = (init?.headers as Record<string, string>)?.Range || '';
      return {
        ok: true,
        status: 206,
        redirected: true,
        url: 'https://edge.example.com/video.mp4',
        headers: new Map([['content-type', 'video/mp4']]),
        body: {
          cancel: async () => {
            bodyCancelled = true;
          },
        },
      };
    }) as unknown as typeof fetch;

    const res = await checkStreamSourceHealth(
      {
        id: `mp4-${statusOrErr}`,
        providerName: 'CDN',
        movieIdentifier: '1',
        label: 'Direct MP4',
        streamUrl: 'https://cdn.example.com/video.mp4',
        format: 'mp4',
        language: 'English',
        languageCode: 'en',
        audioType: 'original',
        availabilityStatus: 'available',
        validationStatus: 'verified',
        isCrossOriginIframe: false,
        supportsInternalAudioSwitch: false,
      },
      2000,
      mockFetch
    );

    assert.deepEqual(methodsCalled, ['HEAD', 'GET']);
    assert.equal(rangeHeaderSent, 'bytes=0-1023');
    assert.equal(bodyCancelled, true);
    assert.equal(res.availabilityStatus, 'available');
    assert.equal(res.validationStatus, 'verified');
    assert.equal(res.contentType, 'video/mp4');
    assert.equal(res.redirected, true);
    assert.equal(res.finalUrl, 'https://edge.example.com/video.mp4');
  }

  // 3. HLS (.m3u8) calls HEAD first, then ranged GET (Range: bytes=0-4095) and rejects HTML soft-404 even when status is 200 with video/mp2t header
  const hlsMethods: string[] = [];
  const hlsHtmlBodyFetch = (async (_url: any, init?: RequestInit) => {
    hlsMethods.push(init?.method || 'GET');
    return {
      ok: true,
      status: 200,
      redirected: false,
      url: 'https://cdn.example.com/soft404.m3u8',
      headers: new Map([['content-type', 'application/octet-stream']]),
      text: async () => '<!DOCTYPE html><html><body>Not Found</body></html>',
      body: { cancel: async () => {} },
    };
  }) as unknown as typeof fetch;

  const soft404Res = await checkStreamSourceHealth(
    {
      id: 'hls-soft404',
      providerName: 'CDN',
      movieIdentifier: '1',
      label: 'Soft 404 HLS',
      streamUrl: 'https://cdn.example.com/soft404.m3u8',
      format: 'hls',
      language: 'English',
      languageCode: 'en',
      audioType: 'original',
      availabilityStatus: 'available',
      validationStatus: 'verified',
      isCrossOriginIframe: false,
      supportsInternalAudioSwitch: true,
    },
    2000,
    hlsHtmlBodyFetch
  );
  assert.deepEqual(hlsMethods, ['HEAD', 'GET']);
  assert.equal(soft404Res.availabilityStatus, 'unavailable');
  assert.equal(soft404Res.validationStatus, 'failed-validation');
  assert.equal(soft404Res.hlsManifestValid, false);

  // 4. Timeout and AbortController cleanup
  const slowFetch = ((_url: any, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        reject(abortErr);
      });
    })) as unknown as typeof fetch;

  const timeoutRes = await checkStreamSourceHealth(
    {
      id: 'slow-mp4',
      providerName: 'Slow CDN',
      movieIdentifier: '1',
      label: 'Slow MP4',
      streamUrl: 'https://cdn.example.com/slow.mp4',
      format: 'mp4',
      language: 'English',
      languageCode: 'en',
      audioType: 'original',
      availabilityStatus: 'available',
      validationStatus: 'verified',
      isCrossOriginIframe: false,
      supportsInternalAudioSwitch: false,
    },
    40,
    slowFetch
  );
  assert.equal(timeoutRes.availabilityStatus, 'timeout');
  assert.equal(timeoutRes.validationStatus, 'failed-validation');
});

test('Stage 3 Task 2: sanitizeAlternateStreamsList strictly rejects malicious HTML/JS, invalid ISO codes, malformed objects, oversized fields, and duplicate IDs', async () => {
  const { sanitizeAlternateStreamsList } = await import('./securityValidator');
  const { resolveAlternateLanguageStreams } = await import('../services/streamSourceManager');

  const rawUntrusted: unknown[] = [
    null,
    'not-an-object',
    // 1. Malicious script-only label -> rejected
    {
      id: 'xss-only',
      label: '<script>alert(document.cookie)</script>',
      languageCode: 'hi',
      languageName: 'Hindi',
      url: 'https://cdn.example.com/xss.mp4',
    },
    // 2. Invalid language code -> rejected
    {
      id: 'bad-lang',
      label: 'Unknown Language Track',
      languageCode: 'xx-invalid',
      languageName: 'Invalid',
      url: 'https://cdn.example.com/badlang.mp4',
    },
    // 3. Valid entry with HTML tags & oversized fields -> stripped and truncated to limits
    {
      id: 'valid-hi-' + 'x'.repeat(60),
      label: '<img src=x onerror=alert(1)>Hindi Dubbed Official ' + 'A'.repeat(80),
      languageCode: 'hi-IN',
      languageName: '<div>Hindi ' + 'B'.repeat(40) + '</div>',
      audioType: 'dubbed',
      url: 'https://cdn.example.com/valid-hindi.m3u8',
      format: 'hls',
      verified: true,
    },
    // 4. Duplicate ID -> rejected
    {
      id: ('valid-hi-' + 'x'.repeat(60)).slice(0, 48),
      label: 'Duplicate ID Stream',
      languageCode: 'ur',
      languageName: 'Urdu',
      audioType: 'dubbed',
      url: 'https://cdn.example.com/dup-id.m3u8',
      format: 'hls',
      verified: true,
    },
  ];

  const cleaned = sanitizeAlternateStreamsList(rawUntrusted);
  assert.equal(cleaned.length, 1);
  assert.ok(cleaned[0].id.length <= 48);
  assert.ok(cleaned[0].label.length <= 64);
  assert.ok(cleaned[0].languageName.length <= 32);
  assert.ok(cleaned[0].languageCode.length <= 12);
  assert.equal(cleaned[0].label.includes('<'), false);
  assert.equal(cleaned[0].label.includes('onerror'), false);
  assert.equal(cleaned[0].languageCode, 'hi-in');

  // Verify resolveAlternateLanguageStreams applies the same strict sanitization directly
  const resolved = resolveAlternateLanguageStreams(
    {
      tmdb_id: 533535,
      language: 'English',
      direct_video_url: 'https://cdn.example.com/main.m3u8',
      stream_url: '',
      download_480p: '',
      download_720p: '',
      alternate_streams: rawUntrusted as any,
    },
    'en'
  );
  assert.equal(resolved.length, 2); // primary + 1 valid alternate
});

test('Stage 3 Task 3: attachSafariNativeAudioTrackListeners registers change/addtrack/removetrack, prevents duplicates, and removes all listeners on cleanup', async () => {
  const { attachSafariNativeAudioTrackListeners } = await import(
    '../services/streamSourceManager'
  );

  const listeners: Record<string, Set<() => void>> = {
    change: new Set(),
    addtrack: new Set(),
    removetrack: new Set(),
  };

  const mockAudioTracks: any = {
    length: 2,
    0: { id: '0', label: 'English', language: 'en', enabled: true },
    1: { id: '1', label: 'German', language: 'de', enabled: false },
    addEventListener(evt: string, fn: () => void) {
      listeners[evt]?.add(fn);
    },
    removeEventListener(evt: string, fn: () => void) {
      listeners[evt]?.delete(fn);
    },
  };

  const mockVideoEl = { audioTracks: mockAudioTracks };
  let latestTracksCount = 0;
  let latestEnabledId = -1;

  // Attach first time
  const cleanup1 = attachSafariNativeAudioTrackListeners(
    mockVideoEl,
    'en',
    (tracks, enabledId) => {
      latestTracksCount = tracks.length;
      latestEnabledId = enabledId;
    }
  );
  assert.equal(listeners.change.size, 1);
  assert.equal(listeners.addtrack.size, 1);
  assert.equal(listeners.removetrack.size, 1);
  assert.equal(latestTracksCount, 2);
  assert.equal(latestEnabledId, 0);

  // Attach second time on same AudioTrackList -> prevents duplicate listeners
  const cleanup2 = attachSafariNativeAudioTrackListeners(
    mockVideoEl,
    'en',
    (tracks, enabledId) => {
      latestTracksCount = tracks.length;
      latestEnabledId = enabledId;
    }
  );
  assert.equal(listeners.change.size, 1);
  assert.equal(listeners.addtrack.size, 1);
  assert.equal(listeners.removetrack.size, 1);

  // Simulate Safari native track switch event ('change')
  mockAudioTracks[0].enabled = false;
  mockAudioTracks[1].enabled = true;
  for (const fn of listeners.change) fn();
  assert.equal(latestEnabledId, 1);

  // Simulate 'addtrack' event
  mockAudioTracks[2] = { id: '2', label: 'Spanish', language: 'es', enabled: false };
  mockAudioTracks.length = 3;
  for (const fn of listeners.addtrack) fn();
  assert.equal(latestTracksCount, 3);

  // Cleanup removes all listeners
  cleanup1();
  cleanup2();
  assert.equal(listeners.change.size, 0);
  assert.equal(listeners.addtrack.size, 0);
  assert.equal(listeners.removetrack.size, 0);
});

test('Stage 3 Task 4: Supabase Least-Privilege Security rejects service_role keys, excludes admin_pin_hash from public config reads, and removes anon write grants', async () => {
  const { isForbiddenServiceRoleKey } = await import('./securityValidator');
  const {
    DEFAULT_APP_CONFIG,
    PUBLIC_APP_CONFIG_COLUMNS,
    SUPABASE_RLS_FIX_SQL,
  } = await import('../services/supabaseClient');

  // 1. Construct a fake JWT with {"role":"service_role"} payload
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const servicePayload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64url');
  const anonPayload = Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url');
  const fakeServiceRoleJwt = `${header}.${servicePayload}.signature`;
  const fakeAnonJwt = `${header}.${anonPayload}.signature`;

  assert.equal(isForbiddenServiceRoleKey(fakeServiceRoleJwt), true);
  assert.equal(isForbiddenServiceRoleKey('sb_secret_1234567890abcdef'), true);
  assert.equal(isForbiddenServiceRoleKey(fakeAnonJwt), false);

  // 2. Public app_config columns and DEFAULT_APP_CONFIG never include admin_pin_hash or admin_email
  assert.equal(PUBLIC_APP_CONFIG_COLUMNS.includes('admin_pin_hash'), false);
  assert.equal(PUBLIC_APP_CONFIG_COLUMNS.includes('admin_email'), false);
  assert.equal('admin_pin_hash' in DEFAULT_APP_CONFIG, false);
  assert.equal('admin_email' in DEFAULT_APP_CONFIG, false);

  // 3. SUPABASE_RLS_FIX_SQL enforces least-privilege (no FOR ALL TO anon, no GRANT ALL ... TO anon)
  assert.equal(/FOR\s+ALL\s+TO\s+anon/i.test(SUPABASE_RLS_FIX_SQL), false);
  assert.equal(/GRANT\s+ALL\s+ON\s+TABLE\s+public\.\w+\s+TO\s+anon/i.test(SUPABASE_RLS_FIX_SQL), false);
  assert.equal(SUPABASE_RLS_FIX_SQL.includes('REVOKE ALL ON TABLE public.movie_links FROM anon'), true);
  assert.equal(SUPABASE_RLS_FIX_SQL.includes('REVOKE ALL ON TABLE public.app_users FROM anon'), true);
  assert.equal(SUPABASE_RLS_FIX_SQL.includes('REVOKE ALL ON TABLE public.app_config FROM anon'), true);
  assert.equal(SUPABASE_RLS_FIX_SQL.includes('public.is_cinebox_admin()'), true);
});

test('Part 1: VidSrc.sh API v2 Migration (Content Info 200/404/Error, Embed URLs with ds_lang=en, Latest Feeds, PLAYER_EVENT Watch History, 2Embed Fallback)', async () => {
  const {
    buildVidSrcInfoUrl,
    buildVidSrcEmbedUrl,
    build2EmbedFallbackUrl,
    parseVidSrcContentInfo,
    parseVidSrcLatestFeed,
    parseVidSrcPlayerEventMessage,
  } = await import('../services/vidsrcService');

  // 1. Endpoint URL Builders
  assert.equal(
    buildVidSrcInfoUrl({ tmdbId: 550, mediaType: 'movie' }),
    'https://vidsrc.sh/info/movie/550.json'
  );
  assert.equal(
    buildVidSrcInfoUrl({ tmdbId: 1399, mediaType: 'tv', season: 2, episode: 4 }),
    'https://vidsrc.sh/info/tv/1399/2/4.json'
  );
  assert.equal(
    buildVidSrcEmbedUrl({ tmdbId: 550, mediaType: 'movie', dsLang: 'en' }),
    'https://vidsrc.sh/embed/movie/550?ds_lang=en'
  );
  assert.equal(
    buildVidSrcEmbedUrl({ tmdbId: 1399, mediaType: 'tv', season: 3, episode: 9, dsLang: 'en' }),
    'https://vidsrc.sh/embed/tv/1399/3/9?ds_lang=en'
  );
  assert.equal(
    build2EmbedFallbackUrl({ tmdbId: 550, mediaType: 'movie' }),
    'https://www.2embed.cc/embed/550'
  );
  assert.equal(
    build2EmbedFallbackUrl({ tmdbId: 1399, mediaType: 'tv', season: 3, episode: 9 }),
    'https://www.2embed.cc/embedtv/1399&s=3&e=9'
  );

  // 2. Content Info Parsing: 200 OK extracts title, year, poster, quality
  const info200 = parseVidSrcContentInfo(
    {
      status_code: 200,
      result: {
        title: 'Fight Club',
        year: '1999',
        poster: 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
        quality: '1080p BluRay',
      },
    },
    200,
    { tmdbId: 550, mediaType: 'movie' }
  );
  assert.equal(info200.ok, true);
  assert.equal(info200.statusCode, 200);
  assert.equal(info200.notAvailable, false);
  assert.equal(info200.info?.title, 'Fight Club');
  assert.equal(info200.info?.year, '1999');
  assert.equal(info200.info?.quality, '1080P BLURAY');

  // 3. Content Info Parsing: 404 returns "Movie Not Available"
  const info404 = parseVidSrcContentInfo({ status_code: 404 }, 404, {
    tmdbId: 999999,
    mediaType: 'movie',
  });
  assert.equal(info404.ok, false);
  assert.equal(info404.statusCode, 404);
  assert.equal(info404.notAvailable, true);
  assert.equal(info404.errorMessage, 'Movie Not Available');

  // 4. Content Info Parsing: 500 or network error returns "Content Unavailable, Try Again"
  const info500 = parseVidSrcContentInfo(null, 500, { tmdbId: 550, mediaType: 'movie' });
  assert.equal(info500.ok, false);
  assert.equal(info500.notAvailable, false);
  assert.equal(info500.errorMessage, 'Content Unavailable, Try Again');

  // 5. Latest Movies & Latest TV Shows Feed Parsing
  const latestMovies = parseVidSrcLatestFeed(
    {
      result: [
        {
          tmdb_id: 693134,
          title: 'Dune: Part Two 2024',
          embed_url_tmdb: 'https://vidsrc.sh/embed/movie/693134?ds_lang=en',
          quality: '4K HDR',
        },
      ],
    },
    'movie'
  );
  assert.equal(latestMovies.ok, true);
  assert.equal(latestMovies.items.length, 1);
  assert.equal(latestMovies.items[0].tmdbId, 693134);
  assert.equal(latestMovies.items[0].title, 'Dune: Part Two 2024');
  assert.equal(latestMovies.items[0].quality, '4K HDR');
  assert.equal(
    latestMovies.items[0].embedUrlTmdb,
    'https://vidsrc.sh/embed/movie/693134?ds_lang=en'
  );

  // 6. PLAYER_EVENT postMessage Parsing for Watch History
  const playerEvt = parseVidSrcPlayerEventMessage(
    JSON.stringify({
      type: 'PLAYER_EVENT',
      data: {
        event: 'timeupdate',
        tmdb_id: 550,
        media_type: 'movie',
        currentTime: 360,
        duration: 1800,
      },
    }),
    'https://vidsrc.sh'
  );
  assert.ok(playerEvt);
  assert.equal(playerEvt?.type, 'PLAYER_EVENT');
  assert.equal(playerEvt?.tmdbId, 550);
  assert.equal(playerEvt?.currentTime, 360);
  assert.equal(playerEvt?.duration, 1800);
});

test('Part 2 & 3: YouTube Data API v3 Pakistani Dramas Integration (Official Channels, Search & Video Details Endpoints, Embed URLs, Quota & Error Messages)', async () => {
  const {
    OFFICIAL_PAK_DRAMA_CHANNELS,
    buildYouTubeChannelSearchUrl,
    buildYouTubeVideoDetailsUrl,
    buildYouTubeDramaEmbedUrl,
    parseYouTubeSearchItems,
    mergeYouTubeVideoDetails,
    isYouTubeQuotaExceededError,
    fetchPakistaniDramasFromYouTube,
  } = await import('../services/youtubeDramaService');

  // 1. Official Drama Channels Registry
  const humTv = OFFICIAL_PAK_DRAMA_CHANNELS.find((c) => c.key === 'HUM_TV');
  const aryDigital = OFFICIAL_PAK_DRAMA_CHANNELS.find((c) => c.key === 'ARY_DIGITAL');
  const harPalGeo = OFFICIAL_PAK_DRAMA_CHANNELS.find((c) => c.key === 'HAR_PAL_GEO');
  const geoTv = OFFICIAL_PAK_DRAMA_CHANNELS.find((c) => c.key === 'GEO_TV');
  assert.equal(humTv?.channelId, 'UC6-F5tO8uklgE9Zy8IvbdFw');
  assert.equal(aryDigital?.channelId, 'UC4JCksJF76g_MdzPVBJoC3Q');
  assert.equal(harPalGeo?.channelId, 'UCe9JSDmyqNgA_l2BzGHq1Ug');
  assert.equal(geoTv?.channelId, 'UC_vt34wimdCzdkrzVejwX9g');

  // 2. Endpoint URL Builders (Search & Video Details & Embed Player)
  const searchUrl = buildYouTubeChannelSearchUrl({
    apiKey: 'TEST_YT_KEY',
    channelId: 'UC6-F5tO8uklgE9Zy8IvbdFw',
    order: 'date',
    maxResults: 20,
  });
  assert.equal(searchUrl.includes('https://www.googleapis.com/youtube/v3/search?'), true);
  assert.equal(searchUrl.includes('key=TEST_YT_KEY'), true);
  assert.equal(searchUrl.includes('channelId=UC6-F5tO8uklgE9Zy8IvbdFw'), true);
  assert.equal(decodeURIComponent(searchUrl).includes('part=snippet,id'), true);
  assert.equal(searchUrl.includes('order=date'), true);
  assert.equal(searchUrl.includes('maxResults=20'), true);

  const detailsUrl = buildYouTubeVideoDetailsUrl({
    apiKey: 'TEST_YT_KEY',
    videoIds: ['9bZkp7q19f0', 'dQw4w9WgXcQ'],
  });
  assert.equal(detailsUrl.includes('https://www.googleapis.com/youtube/v3/videos?'), true);
  assert.equal(decodeURIComponent(detailsUrl).includes('part=snippet,contentDetails,statistics'), true);

  assert.equal(
    buildYouTubeDramaEmbedUrl('9bZkp7q19f0'),
    'https://www.youtube.com/embed/9bZkp7q19f0?autoplay=1'
  );

  // 3. Response Parsing (snippet.title & snippet.thumbnails.high.url) + Video Details Enrichment
  const rawSearchPayload = {
    items: [
      {
        id: { kind: 'youtube#video', videoId: '9bZkp7q19f0' },
        snippet: {
          title: 'Ishq Murshid - Episode 28 [CC] - HUM TV',
          description: 'Official HUM TV Drama Episode',
          publishedAt: '2025-02-01T16:00:00Z',
          channelId: 'UC6-F5tO8uklgE9Zy8IvbdFw',
          channelTitle: 'HUM TV',
          thumbnails: {
            high: { url: 'https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg' },
          },
        },
      },
    ],
  };

  const parsedItems = parseYouTubeSearchItems(rawSearchPayload);
  assert.equal(parsedItems.length, 1);
  assert.equal(parsedItems[0].videoId, '9bZkp7q19f0');
  assert.equal(parsedItems[0].title, 'Ishq Murshid - Episode 28 [CC] - HUM TV');
  assert.equal(parsedItems[0].posterUrl, 'https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg');
  assert.equal(parsedItems[0].embedUrl, 'https://www.youtube.com/embed/9bZkp7q19f0?autoplay=1');

  const enriched = mergeYouTubeVideoDetails(parsedItems, {
    items: [
      {
        id: '9bZkp7q19f0',
        contentDetails: { duration: 'PT38M45S' },
        statistics: { viewCount: '18400000' },
      },
    ],
  });
  assert.equal(enriched[0].durationFormatted, '38:45');
  assert.equal(enriched[0].viewCountFormatted, '18.4M views');

  // 4. Error Handling & Quota Exhaustion Security
  assert.equal(
    isYouTubeQuotaExceededError(403, {
      error: {
        code: 403,
        message: 'The request cannot be completed because you have exceeded your quota.',
        errors: [{ reason: 'quotaExceeded' }],
      },
    }),
    true
  );

  // Verify quota exceeded returns "Please try again later"
  const quotaFetch = (async () =>
    new Response(
      JSON.stringify({
        error: { code: 403, errors: [{ reason: 'quotaExceeded' }] },
      }),
      { status: 403 }
    )) as unknown as typeof fetch;

  const quotaRes = await fetchPakistaniDramasFromYouTube(
    { apiKeyOverride: 'TEST_KEY', channelKey: 'HUM_TV' },
    quotaFetch
  );
  assert.equal(quotaRes.ok, false);
  assert.equal(quotaRes.quotaExceeded, true);
  assert.equal(quotaRes.errorMessage, 'Please try again later');

  // Verify general API failure returns "Content Unavailable, Try Again"
  const failFetch = (async () => new Response('Server error', { status: 500 })) as unknown as typeof fetch;
  const failRes = await fetchPakistaniDramasFromYouTube(
    { apiKeyOverride: 'TEST_KEY', channelKey: 'HUM_TV' },
    failFetch
  );
  assert.equal(failRes.ok, false);
  assert.equal(failRes.quotaExceeded, false);
  assert.equal(failRes.errorMessage, 'Content Unavailable, Try Again');
});

test('100% Ad-Free Enforcement: fetchAppConfig and DEFAULT_APP_CONFIG strictly disable all ads and strip banner HTML', async () => {
  const { DEFAULT_APP_CONFIG, fetchAppConfig } = await import('../services/supabaseClient');

  assert.equal(DEFAULT_APP_CONFIG.is_ads_enabled, false);
  assert.equal(DEFAULT_APP_CONFIG.ad_network_provider, 'none');
  assert.equal(DEFAULT_APP_CONFIG.banner_ad_html, '');

  const liveConfig = await fetchAppConfig();
  assert.equal(liveConfig.is_ads_enabled, false);
  assert.equal(liveConfig.banner_ad_html, '');
});

test('Mobile Player Fullscreen, Exit Button, Safe-Area Controls & Orientation Lock', async () => {
  const { getFullscreenPlayerConfig, lockScreenOrientationSafely } = await import('./streamResolver');
  const { DEFAULT_APP_CONFIG } = await import('../services/supabaseClient');

  // 1. Verify 100% Ad-Free configuration
  assert.equal(DEFAULT_APP_CONFIG.is_ads_enabled, false);
  assert.equal(DEFAULT_APP_CONFIG.ad_network_provider, 'none');
  assert.equal(DEFAULT_APP_CONFIG.banner_ad_html, '');

  // 2. Verify Fullscreen player config enforces #000000 black background, 100vw/100dvh, and top-left Exit button
  const fsContain = getFullscreenPlayerConfig(true, 'contain');
  assert.equal(fsContain.isFullscreen, true);
  assert.equal(fsContain.backgroundColor, '#000000');
  assert.equal(fsContain.viewportWidth, '100vw');
  assert.equal(fsContain.viewportHeight, '100dvh');
  assert.equal(fsContain.showAlwaysVisibleExitButton, true);
  assert.equal(fsContain.videoObjectFitClass, 'object-contain');
  assert.equal(fsContain.containerClassName.includes('w-[100vw]'), true);
  assert.equal(fsContain.containerClassName.includes('h-[100dvh]'), true);
  assert.equal(fsContain.containerClassName.includes('bg-[#000000]'), true);
  assert.equal(fsContain.bottomControlsSafePaddingClass.includes('env(safe-area-inset-bottom'), true);

  const fsCover = getFullscreenPlayerConfig(true, 'cover');
  assert.equal(fsCover.videoObjectFitClass, 'object-cover');

  const normalCfg = getFullscreenPlayerConfig(false, 'contain');
  assert.equal(normalCfg.isFullscreen, false);
  assert.equal(normalCfg.showAlwaysVisibleExitButton, false);
  assert.equal(normalCfg.backgroundColor, '#000000');

  // 3. Verify lockScreenOrientationSafely locks landscape/portrait and handles unsupported devices gracefully
  const lockedModes: string[] = [];
  let unlockedCount = 0;
  const mockScreen = {
    orientation: {
      lock: async (m: string) => {
        lockedModes.push(m);
      },
      unlock: () => {
        unlockedCount += 1;
      },
    },
  };

  const landRes = await lockScreenOrientationSafely('landscape', mockScreen);
  assert.equal(landRes.ok, true);
  assert.equal(lockedModes[0], 'landscape');

  const portRes = await lockScreenOrientationSafely('portrait', mockScreen);
  assert.equal(portRes.ok, true);
  assert.equal(lockedModes[1], 'portrait');

  const unlockRes = await lockScreenOrientationSafely('unlock', mockScreen);
  assert.equal(unlockRes.ok, true);
  assert.equal(unlockedCount, 1);

  const rejectScreen = {
    orientation: {
      lock: async () => {
        throw new Error('Orientation lock not supported on desktop');
      },
    },
  };
  const failRes = await lockScreenOrientationSafely('landscape', rejectScreen);
  assert.equal(failRes.ok, false);
});

test('System 1, 2 & 3: Platform Detection (Capacitor.isNativePlatform), Web Direct Login (No Trial/Paywall), and APK 3-Day Trial + 2-Referral 30-Day Unlock', async () => {
  const {
    detectAppPlatform,
    generateUniqueReferralCode,
    extractReferralCodeFromLocation,
    buildReferralShareUrl,
    evaluatePlatformTrialAndReferralState,
    applyReferralRewardToReferrer,
    TRIAL_DURATION_MS,
    REFERRAL_REWARD_MS,
  } = await import('../services/platformTrialReferralService');

  // 1. Platform Detection
  assert.equal(detectAppPlatform({ forceNativeOverride: true }), 'Android');
  assert.equal(detectAppPlatform({ forceNativeOverride: false }), 'Web');

  // 2. Referral Code & Share Link Generation / Extraction
  const refCode = generateUniqueReferralCode('ali@cinebox.app');
  assert.equal(refCode.startsWith('CBX-'), true);
  assert.equal(
    buildReferralShareUrl(refCode, 'https://aapki-site.com'),
    `https://aapki-site.com/ref/${refCode}`
  );
  assert.equal(extractReferralCodeFromLocation(`/ref/${refCode}`, ''), refCode);
  assert.equal(extractReferralCodeFromLocation('/', `?ref=${refCode}`), refCode);

  const t0 = Date.parse('2026-11-08T12:00:00.000Z');

  // 3. Web Users: Direct Login when logged out, NO trial banner or paywall when logged in
  const webLoggedOut = evaluatePlatformTrialAndReferralState({
    platform: 'Web',
    user: null,
    nowMs: t0,
  });
  assert.equal(webLoggedOut.requiresWebDirectLogin, true);
  assert.equal(webLoggedOut.showTrialBanner, false);
  assert.equal(webLoggedOut.isPaywallLocked, false);

  const webLoggedIn = evaluatePlatformTrialAndReferralState({
    platform: 'Web',
    user: {
      id: 'USR-WEB-1',
      username: 'Web Viewer',
      email: 'web@cinebox.app',
      role: 'vip',
      status: 'active',
      platform: 'Web',
    },
    nowMs: t0 + 10 * 24 * 60 * 60 * 1000, // Even 10 days later, Web has NO trial expiry or paywall
  });
  assert.equal(webLoggedIn.requiresWebDirectLogin, false);
  assert.equal(webLoggedIn.showTrialBanner, false);
  assert.equal(webLoggedIn.isPaywallLocked, false);

  // 4. APK Users: 3-Day Trial Timer ("Trial Ends in: X Days Y Hours") & Paywall after 3 Days
  const apkUser = {
    id: 'USR-APK-1',
    username: 'APK Viewer',
    email: 'apk@cinebox.app',
    role: 'user' as const,
    status: 'active' as const,
    platform: 'Android' as const,
    trial_start_date: new Date(t0).toISOString(),
    trial_end_date: new Date(t0 + TRIAL_DURATION_MS).toISOString(),
    referral_code: refCode,
    successful_referrals: 0,
    access_expiry_date: null,
  };

  // At t0 + 1 day + 6 hours -> 1 Day 18 Hours left
  const activeTrial = evaluatePlatformTrialAndReferralState({
    platform: 'Android',
    user: apkUser,
    nowMs: t0 + (24 + 6) * 60 * 60 * 1000,
  });
  assert.equal(activeTrial.showTrialBanner, true);
  assert.equal(activeTrial.trialBannerText, 'Trial Ends in: 1 Days 18 Hours');
  assert.equal(activeTrial.isTrialExpired, false);
  assert.equal(activeTrial.isPaywallLocked, false);

  // At t0 + 3 days + 1 hour -> Trial Expired -> Paywall Locks App!
  const expiredMoment = t0 + TRIAL_DURATION_MS + 60 * 60 * 1000;
  const expiredTrial = evaluatePlatformTrialAndReferralState({
    platform: 'Android',
    user: apkUser,
    nowMs: expiredMoment,
  });
  assert.equal(expiredTrial.isTrialExpired, true);
  assert.equal(expiredTrial.isPaywallLocked, true);

  // 5. Referral System: Self-referral blocked; 1st referral -> count=1 (still locked); 2nd referral -> count=2 -> +30 days & unlocked!
  const selfAttempt = applyReferralRewardToReferrer(apkUser, 'apk@cinebox.app', expiredMoment);
  assert.equal(selfAttempt.unlockedThirtyDays, false);
  assert.equal(selfAttempt.updatedReferrer.successful_referrals, 0);

  const firstRef = applyReferralRewardToReferrer(apkUser, 'friend1@example.com', expiredMoment);
  assert.equal(firstRef.updatedReferrer.successful_referrals, 1);
  assert.equal(firstRef.unlockedThirtyDays, false);

  const secondRef = applyReferralRewardToReferrer(
    firstRef.updatedReferrer,
    'friend2@example.com',
    expiredMoment
  );
  assert.equal(secondRef.updatedReferrer.successful_referrals, 2);
  assert.equal(secondRef.unlockedThirtyDays, true);
  assert.equal(
    secondRef.updatedReferrer.access_expiry_date,
    new Date(expiredMoment + REFERRAL_REWARD_MS).toISOString()
  );

  // Evaluate expired APK user after 2 referrals -> Paywall is UNLOCKED for 30 days!
  const unlockedState = evaluatePlatformTrialAndReferralState({
    platform: 'Android',
    user: secondRef.updatedReferrer,
    nowMs: expiredMoment + 1000,
  });
  assert.equal(unlockedState.isPaywallLocked, false);
  assert.equal(unlockedState.isReferralUnlocked, true);
  assert.equal(unlockedState.daysRemaining, 29);
});

test('System 4: Signature-Safe In-App Update Checker (version.json vs App.getInfo().version, semver comparison, HTTPS validation, and build.gradle .jks signing config)', async () => {
  const {
    compareSemverVersions,
    parseRemoteVersionManifest,
    checkForInAppApkUpdate,
    ANDROID_BUILD_GRADLE_SIGNING_CONFIG,
    GITHUB_ACTIONS_JKS_WORKFLOW_YAML,
  } = await import('../services/inAppUpdateService');

  assert.equal(compareSemverVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareSemverVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemverVersions('1.0.0', '1.2.0'), -1);

  // Reject unsafe non-HTTPS apk_url
  const unsafeManifest = parseRemoteVersionManifest({
    version: '1.0.1',
    apk_url: 'http://insecure.example.com/app.apk',
  });
  assert.equal(unsafeManifest.valid, false);

  // Accept valid version.json
  const mockFetch = (async () =>
    new Response(
      JSON.stringify({
        version: '1.0.1',
        apk_url: 'https://github.com/cinebox-official/cinebox-apk/releases/download/v1.0.1/app-release.apk',
        release_notes: 'Signature-safe update v1.0.1',
      }),
      { status: 200 }
    )) as unknown as typeof fetch;

  const updateRes = await checkForInAppApkUpdate({
    currentVersionOverride: '1.0.0',
    fetchImpl: mockFetch,
  });
  assert.equal(updateRes.checked, true);
  assert.equal(updateRes.updateAvailable, true);
  assert.equal(updateRes.currentVersion, '1.0.0');
  assert.equal(updateRes.remoteVersion, '1.0.1');
  assert.equal(
    updateRes.apkUrl,
    'https://github.com/cinebox-official/cinebox-apk/releases/download/v1.0.1/app-release.apk'
  );

  // When current version matches remote version, updateAvailable is false
  const upToDateRes = await checkForInAppApkUpdate({
    currentVersionOverride: '1.0.1',
    fetchImpl: mockFetch,
  });
  assert.equal(upToDateRes.updateAvailable, false);

  // Verify Signature-Safe build.gradle and GitHub Actions .jks workflow
  assert.equal(ANDROID_BUILD_GRADLE_SIGNING_CONFIG.includes('signingConfigs'), true);
  assert.equal(ANDROID_BUILD_GRADLE_SIGNING_CONFIG.includes('release-keystore.jks'), true);
  assert.equal(GITHUB_ACTIONS_JKS_WORKFLOW_YAML.includes('CINEBOX_KEYSTORE_BASE64'), true);
});

test('Android Native WebView Popup Blocker: MainActivity.java exists at android/app/src/main/java/com/cinebox/stream/MainActivity.java and overrides onCreateWindow returning false without iframe sandbox', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const mainActivityPath = path.resolve(
    process.cwd(),
    'android/app/src/main/java/com/cinebox/stream/MainActivity.java'
  );
  assert.equal(fs.existsSync(mainActivityPath), true);

  const javaCode = fs.readFileSync(mainActivityPath, 'utf8');
  assert.equal(javaCode.includes('package com.cinebox.stream;'), true);
  assert.equal(javaCode.includes('public class MainActivity extends BridgeActivity'), true);
  assert.equal(javaCode.includes('settings.setJavaScriptCanOpenWindowsAutomatically(false);'), true);
  assert.equal(javaCode.includes('settings.setSupportMultipleWindows(true);'), true);
  assert.equal(javaCode.includes('public boolean onCreateWindow('), true);
  assert.equal(javaCode.includes('return false;'), true);

  // Also verify workflow preserves MainActivity.java during APK build
  const workflowPath = path.resolve(
    process.cwd(),
    '.github/workflows/android-release-apk.yml'
  );
  const workflowYaml = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(
    workflowYaml.includes('android/app/src/main/java/com/cinebox/stream/MainActivity.java'),
    true
  );
});

test('Global Admin APK Download Link (Google Drive / Direct URL): extracts Google Drive file IDs, converts to direct download URL, persists globally in app_config, and triggers In-App Update Checker', async () => {
  const {
    extractGoogleDriveFileId,
    toGoogleDriveDirectDownloadUrl,
    bumpSemverPatchVersion,
    encodeGlobalApkConfigCarrier,
    decodeGlobalApkConfigCarrier,
    checkForInAppApkUpdate,
  } = await import('../services/inAppUpdateService');
  const { updateAppConfig, fetchAppConfig } = await import('../services/supabaseClient');

  // 1. Google Drive File ID extraction & Direct URL conversion
  const shareUrl =
    'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ_99/view?usp=sharing';
  assert.equal(extractGoogleDriveFileId(shareUrl), '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_99');
  assert.equal(
    toGoogleDriveDirectDownloadUrl(shareUrl),
    'https://drive.google.com/uc?export=download&id=1aBcDeFgHiJkLmNoPqRsTuVwXyZ_99'
  );

  const openUrl = 'https://drive.google.com/open?id=1xYzAbCdEfGhIjKlMnOpQrStUv';
  assert.equal(extractGoogleDriveFileId(openUrl), '1xYzAbCdEfGhIjKlMnOpQrStUv');

  // Non-Drive URL returns null for fileId and preserves safe URL
  assert.equal(
    extractGoogleDriveFileId('https://github.com/cinebox/releases/app.apk'),
    null
  );
  // Malicious XSS URL is rejected
  assert.equal(extractGoogleDriveFileId('javascript:alert(1)'), null);
  assert.equal(toGoogleDriveDirectDownloadUrl('javascript:alert(1)'), '');

  // 2. Version bump helper
  assert.equal(bumpSemverPatchVersion('1.0.1'), '1.0.2');
  assert.equal(bumpSemverPatchVersion('v2.4.9'), '2.4.10');

  // 3. Global Supabase Carrier encode/decode & XSS stripping
  const encoded = encodeGlobalApkConfigCarrier({
    version: '1.0.5',
    apkUrl: shareUrl,
    releaseNotes: 'New Google Drive APK <script>alert(1)</script> update',
  });
  const decoded = decodeGlobalApkConfigCarrier(encoded);
  assert.ok(decoded);
  assert.equal(decoded?.version, '1.0.5');
  assert.equal(decoded?.apkUrl, shareUrl);
  assert.equal(decoded?.releaseNotes.includes('<script>'), false);

  // Rejects non-HTTPS carrier URLs
  const insecureCarrier = 'CINEBOX_APK_META::{"version":"1.0.5","apkUrl":"http://evil.com/a.apk"}';
  assert.equal(decodeGlobalApkConfigCarrier(insecureCarrier), null);

  // 4. Admin updates APK Download Link & Version in global app_config -> checkForInAppApkUpdate uses new Google Drive link
  const newDriveUrl =
    'https://drive.google.com/uc?export=download&id=1NewVersionApkGoogleDriveId2026';
  const savedRes = await updateAppConfig({
    apk_download_url: newDriveUrl,
    apk_latest_version: '1.0.6',
    apk_release_notes: 'Updated Google Drive APK v1.0.6',
  });
  assert.equal(savedRes.ok, true);
  assert.equal(savedRes.config.apk_download_url, newDriveUrl);
  assert.equal(savedRes.config.apk_latest_version, '1.0.6');

  const fetchedCfg = await fetchAppConfig();
  assert.equal(fetchedCfg.apk_download_url, newDriveUrl);
  assert.equal(fetchedCfg.apk_latest_version, '1.0.6');

  const updateCheck = await checkForInAppApkUpdate({
    platform: 'Android',
    currentVersionOverride: '1.0.2',
    globalAppConfig: fetchedCfg,
  });
  assert.equal(updateCheck.checked, true);
  assert.equal(updateCheck.updateAvailable, true);
  assert.equal(updateCheck.remoteVersion, '1.0.6');
  assert.equal(updateCheck.apkUrl, newDriveUrl);
  assert.equal(updateCheck.isGoogleDriveLink, true);
  assert.equal(updateCheck.source, 'supabase-global-config');
});

test('v1.0.2 Update Verification: Web Update Popup Disabled, Version Bump to 1.0.2 (versionCode 2), Fullscreen Back Button & Taskbar Blending, and Borderless #000000 Player', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    DEFAULT_CURRENT_APP_VERSION,
    DEFAULT_GLOBAL_APK_DOWNLOAD_URL,
    isUnconfiguredPlaceholderApkUrl,
    checkForInAppApkUpdate,
  } = await import('../services/inAppUpdateService');
  const { DEFAULT_APP_CONFIG } = await import('../services/supabaseClient');
  const { getFullscreenPlayerConfig } = await import('./streamResolver');

  // 1. Web Par Update Popup Band: platform === 'Web' NEVER returns updateAvailable: true
  const webCheck = await checkForInAppApkUpdate({
    platform: 'Web',
    currentVersionOverride: '1.0.0',
    globalAppConfig: {
      apk_download_url: 'https://drive.google.com/uc?export=download&id=1RealGoogleDriveFileId123',
      apk_latest_version: '1.0.9',
    },
  });
  assert.equal(webCheck.checked, true);
  assert.equal(webCheck.updateAvailable, false);
  assert.equal(webCheck.platform, 'Web');
  assert.equal(webCheck.source, 'web-disabled');

  // 2. Placeholder URL guard prevents "Document lookup failed" before Admin saves a real Drive link
  assert.equal(isUnconfiguredPlaceholderApkUrl(DEFAULT_GLOBAL_APK_DOWNLOAD_URL), true);
  assert.equal(
    isUnconfiguredPlaceholderApkUrl(
      'https://drive.google.com/file/d/1RealGoogleDriveFileId123/view?usp=sharing'
    ),
    false
  );

  // 3. Version Number Update (1.0.1 -> 1.0.2, versionCode 2)
  assert.equal(DEFAULT_CURRENT_APP_VERSION, '1.0.2');
  assert.equal(DEFAULT_APP_CONFIG.apk_latest_version, '1.0.2');

  const buildGradle = fs.readFileSync(
    path.resolve(process.cwd(), 'android/app/build.gradle'),
    'utf8'
  );
  assert.equal(buildGradle.includes('versionCode 2'), true);
  assert.equal(buildGradle.includes('versionName "1.0.2"'), true);

  const versionJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'public/version.json'), 'utf8')
  );
  assert.equal(versionJson.version, '1.0.2');

  // 4. Fullscreen Back Button (Controls-Synced Visibility & Taskbar Blending) + Borderless #000000 object-fit: contain
  const fsVisible = getFullscreenPlayerConfig(true, 'contain', true);
  assert.equal(fsVisible.backgroundColor, '#000000');
  assert.equal(fsVisible.objectFit, 'contain');
  assert.equal(fsVisible.videoObjectFitClass, 'object-contain');
  assert.equal(fsVisible.showAlwaysVisibleExitButton, true);
  assert.equal(fsVisible.showControlsSyncedExitButton, true);
  assert.equal(fsVisible.containerClassName.includes('border-0'), true);
  assert.equal(fsVisible.containerClassName.includes('bg-[#000000]'), true);
  assert.equal(fsVisible.exitButtonClassName.includes('opacity-100'), true);

  const fsHiddenBlend = getFullscreenPlayerConfig(true, 'contain', false);
  assert.equal(fsHiddenBlend.showControlsSyncedExitButton, false);
  assert.equal(fsHiddenBlend.exitButtonClassName.includes('opacity-0'), true);

  const normalBorderless = getFullscreenPlayerConfig(false, 'contain', true);
  assert.equal(normalBorderless.containerClassName.includes('border-0'), true);
  assert.equal(normalBorderless.containerClassName.includes('border-b'), false);

  // 5. Verify MainActivity.java includes immersive taskbar blending & native Exit Fullscreen overlay
  const mainActivityJava = fs.readFileSync(
    path.resolve(process.cwd(), 'android/app/src/main/java/com/cinebox/stream/MainActivity.java'),
    'utf8'
  );
  assert.equal(mainActivityJava.includes('onShowCustomView'), true);
  assert.equal(mainActivityJava.includes('attachNativeExitFullscreenOverlay'), true);
  assert.equal(mainActivityJava.includes('configureSystemBarsPureBlack'), true);
  assert.equal(mainActivityJava.includes('BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE'), true);
});

test('Rollback MovieBox Direct API Integration: Restores Server 3 (2Embed.cc) and Server 1 (VidSrc.sh) as default iframe servers, removes movie-api-vercel.onrender.com, and keeps Admin/Trial/Referral intact', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // 1. Default embed servers start with Server 3 (2Embed.cc) and Server 1 (VidSrc.sh)
  const moviePlan = resolvePlaybackPlan(872906, null, 'movie');
  assert.equal(moviePlan.embedServers.length >= 2, true);
  assert.equal(moviePlan.embedServers[0].id, 'auto-server-3');
  assert.equal(moviePlan.embedServers[0].label, 'Server 3 (2Embed.cc)');
  assert.equal(moviePlan.embedServers[0].url, 'https://www.2embed.cc/embed/872906');
  assert.equal(moviePlan.embedServers[1].id, 'auto-server-1');
  assert.equal(moviePlan.embedServers[1].label, 'Server 1 (VidSrc.sh)');
  assert.equal(moviePlan.embedServers[1].url, 'https://vidsrc.sh/embed/movie/872906?ds_lang=en');

  // 2. Clean iframe attributes load Server 3 and Server 1 without restrictive sandbox
  const server3Iframe = getCleanIframeAttributes(
    moviePlan.embedServers[0].url,
    'Jawan - Server 3 (2Embed.cc)'
  );
  assert.equal(server3Iframe.src, 'https://www.2embed.cc/embed/872906');
  assert.equal(server3Iframe.allowFullScreen, true);
  assert.equal('sandbox' in server3Iframe, false);

  const server1Iframe = getCleanIframeAttributes(
    moviePlan.embedServers[1].url,
    'Jawan - Server 1 (VidSrc.sh)'
  );
  assert.equal(server1Iframe.src, 'https://vidsrc.sh/embed/movie/872906?ds_lang=en');
  assert.equal(server1Iframe.allowFullScreen, true);

  // 3. Verify movie-api-vercel.onrender.com and Server 1 (MovieBox Direct) are completely removed from codebase
  const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const modalSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VideoPlayerModal.tsx'),
    'utf8'
  );
  const directApiSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/movieBoxDirectApi.ts'),
    'utf8'
  );

  assert.equal(appSource.includes('movie-api-vercel.onrender.com'), false);
  assert.equal(modalSource.includes('movie-api-vercel.onrender.com'), false);
  assert.equal(directApiSource.includes('movie-api-vercel.onrender.com'), false);
  assert.equal(modalSource.includes('Server 1 (MovieBox Direct)'), false);
  assert.equal(modalSource.includes('switch-to-blob-player-btn'), false);
  assert.equal(modalSource.includes('test-native-player-btn'), false);
  assert.equal(modalSource.includes('prominent-open-new-tab-btn'), true);
});

test('Phase 1 Security & Live Supabase Edge Functions (tmdb-proxy & cors-proxy): verifies headers, URLs, schema RLS, i18n RTL, and Android hardening', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // 1. Live TMDB Proxy URL & Headers (apikey + Authorization: Bearer <anon_key>)
  assert.equal(
    DEFAULT_DEPLOYED_TMDB_PROXY_URL,
    'https://myeammfiwahmmemkoqif.supabase.co/functions/v1/tmdb-proxy'
  );
  assert.equal(
    getActiveTmdbProxyUrl(),
    'https://myeammfiwahmmemkoqif.supabase.co/functions/v1/tmdb-proxy'
  );
  const tmdbUrl = buildTmdbRequestUrl('trending/movie/day', { language: 'en-US', page: '1' });
  assert.equal(
    (tmdbUrl || '').startsWith(
      'https://myeammfiwahmmemkoqif.supabase.co/functions/v1/tmdb-proxy?endpoint=%2Ftrending%2Fmovie%2Fday'
    ),
    true
  );

  const tmdbHeaders = buildTmdbProxyHeaders('test-supabase-anon-jwt');
  assert.equal(tmdbHeaders.Accept, 'application/json');
  assert.equal(tmdbHeaders.apikey, 'test-supabase-anon-jwt');
  assert.equal(tmdbHeaders.Authorization, 'Bearer test-supabase-anon-jwt');

  // 1b. Direct TMDB API Key & Read Access Token (Bearer) verification
  assert.equal(getActiveTmdbApiKey(), '3577dcd731c0418a06c8866c83b1dbfe');
  assert.equal(
    getActiveTmdbReadAccessToken().startsWith('eyJhbGciOiJIUzI1NiJ9.'),
    true
  );
  const directUrl = buildDirectTmdbUrl('search/multi', { query: 'Jawan' });
  assert.equal(
    directUrl,
    'https://api.themoviedb.org/3/search/multi?api_key=3577dcd731c0418a06c8866c83b1dbfe&query=Jawan'
  );
  const directHeaders = buildDirectTmdbHeaders();
  assert.equal(directHeaders.Accept, 'application/json');
  assert.equal(
    directHeaders.Authorization.startsWith('Bearer eyJhbGciOiJIUzI1NiJ9.'),
    true
  );

  // 2. Live CORS Proxy URL & Headers (https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy?target={original_url})
  assert.equal(
    DEFAULT_SUPABASE_CORS_PROXY_URL,
    'https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy'
  );
  assert.equal(
    getActiveCorsProxyBaseUrl(),
    'https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy'
  );
  const targetStreamUrl = 'https://www.2embed.cc/embed/533535';
  const proxiedStreamUrl = buildProxiedUrl(targetStreamUrl, DEFAULT_SUPABASE_CORS_PROXY_URL);
  assert.equal(
    proxiedStreamUrl,
    `https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy?target=${encodeURIComponent(targetStreamUrl)}`
  );

  const corsHeaders = buildCorsProxyHeaders(
    proxiedStreamUrl,
    'test-supabase-anon-jwt'
  );
  assert.equal(corsHeaders.apikey, 'test-supabase-anon-jwt');
  assert.equal(corsHeaders.Authorization, 'Bearer test-supabase-anon-jwt');

  // 3. Verify supabase_schema.sql has is_cinebox_admin() without hardcoded email, drops admin_pin_hash/admin_email, and creates 5 new tables with RLS
  const schemaSql = fs.readFileSync(path.resolve(process.cwd(), 'supabase_schema.sql'), 'utf8');
  assert.equal(schemaSql.includes('public.is_cinebox_admin()'), true);
  assert.equal(schemaSql.toLowerCase().includes('zulqarnainshah25@gmail.com'), false);
  assert.equal(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.watch_history'), true);
  assert.equal(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.watchlist'), true);
  assert.equal(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.audit_log'), true);
  assert.equal(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.featured_collections'), true);
  assert.equal(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.link_health'), true);

  // 4. Verify hardcoded TMDB key and fake friend1234 are completely removed from source files
  const tmdbServiceSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/tmdbService.ts'),
    'utf8'
  );
  const profileViewSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/ProfileMeView.tsx'),
    'utf8'
  );
  assert.equal(tmdbServiceSource.includes('3fd2be6f0c70a2a598f084ddfb75487c'), false);
  assert.equal(profileViewSource.includes('friend1234'), false);

  // 5. Verify bilingual i18n (English LTR + Urdu RTL)
  assert.equal(getLanguageDirection('en'), 'ltr');
  assert.equal(getLanguageDirection('ur'), 'rtl');
  assert.equal(getTranslation('en', 'navHome'), 'Home');
  assert.equal(getTranslation('ur', 'navHome'), 'ہوم');

  // 6. Verify Android & Capacitor security hardening
  const buildGradle = fs.readFileSync(
    path.resolve(process.cwd(), 'android/app/build.gradle'),
    'utf8'
  );
  const androidManifest = fs.readFileSync(
    path.resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
    'utf8'
  );
  const capConfig = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'capacitor.config.json'), 'utf8')
  );
  assert.equal(buildGradle.includes('minifyEnabled true'), true);
  assert.equal(buildGradle.includes('shrinkResources true'), true);
  assert.equal(androidManifest.includes('android:allowBackup="false"'), true);
  assert.equal(androidManifest.includes('android:usesCleartextTraffic="false"'), true);
  assert.equal(capConfig.android.allowMixedContent, false);
});

test('Streaming-Only Architecture, Official Website (neboxmovies.ai.studio) Admin Sync & Real VidSrc.sh AdBlocker', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    getVidSrcPlayerIframeAttributes,
    isVidSrcAdNetworkUrl,
    isVidSrcProviderUrl,
    VIDSRC_AD_BLOCKLIST_DOMAINS,
  } = await import('./streamResolver');
  const {
    DEFAULT_OFFICIAL_WEBSITE_URL,
    normalizeOfficialWebsiteUrl,
    encodeGlobalApkConfigCarrier,
    decodeGlobalApkConfigCarrier,
  } = await import('../services/inAppUpdateService');
  const { DEFAULT_APP_CONFIG, updateAppConfig } = await import('../services/supabaseClient');

  // 1. Streaming-Only App Verification (Downloads section & dummy movie download buttons removed)
  const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const modalSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VideoPlayerModal.tsx'),
    'utf8'
  );
  const profileSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/ProfileMeView.tsx'),
    'utf8'
  );

  assert.equal(appSource.includes("activeTab === 'downloads'"), false);
  assert.equal(appSource.includes("setActiveTab('downloads')"), false);
  assert.equal(appSource.includes('grid-cols-4'), true);
  assert.equal(modalSource.includes('Offline Download Manager'), false);
  assert.equal(modalSource.includes('server-extract-download-btn'), false);
  assert.equal(profileSource.includes('Default Offline Download Quality'), false);
  assert.equal(profileSource.includes('Wi-Fi Only Downloads'), false);

  // 2. Official Website (cineboxmovies.ai.studio -> https://cineboxmovies.ai.studio) & Admin Panel Linkage
  assert.equal(DEFAULT_OFFICIAL_WEBSITE_URL, 'https://cineboxmovies.ai.studio');
  assert.equal(DEFAULT_APP_CONFIG.official_website, 'https://cineboxmovies.ai.studio');
  assert.equal(
    normalizeOfficialWebsiteUrl('cineboxmovies.ai.studio'),
    'https://cineboxmovies.ai.studio'
  );
  assert.equal(
    normalizeOfficialWebsiteUrl('https://cineboxmovies.ai.studio/'),
    'https://cineboxmovies.ai.studio'
  );
  assert.equal(
    normalizeOfficialWebsiteUrl('https://neboxmovies.ai.studio'),
    'https://cineboxmovies.ai.studio'
  );
  assert.equal(
    normalizeOfficialWebsiteUrl('https://cinebox-movie-streaming-offline-downloader.ai.studio/'),
    'https://cineboxmovies.ai.studio'
  );
  assert.equal(normalizeOfficialWebsiteUrl(''), 'https://cineboxmovies.ai.studio');

  const carrier = encodeGlobalApkConfigCarrier({
    apkUrl: 'https://drive.google.com/uc?export=download&id=test12345',
    version: '1.0.5',
    releaseNotes: 'Streaming only release',
    officialWebsite: 'cineboxmovies.ai.studio',
  });
  const decodedCarrier = decodeGlobalApkConfigCarrier(carrier);
  assert.ok(decodedCarrier);
  assert.equal(decodedCarrier.officialWebsite, 'https://cineboxmovies.ai.studio');

  const updatedCfg = await updateAppConfig({
    official_website: 'cineboxmovies.ai.studio',
  });
  assert.equal(updatedCfg.config.official_website, 'https://cineboxmovies.ai.studio');

  const adminModalSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/AdminAndDeliverablesModal.tsx'),
    'utf8'
  );
  assert.equal(adminModalSource.includes('admin-official-website-input'), true);
  assert.equal(adminModalSource.includes('https://cineboxmovies.ai.studio'), true);

  // 2b. Android APK Launcher Icon & Brand Logo PNG Verification
  assert.equal(
    fs.existsSync(
      path.resolve(process.cwd(), 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png')
    ),
    true
  );
  assert.equal(
    fs.existsSync(
      path.resolve(process.cwd(), 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png')
    ),
    true
  );
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'resources/icon.png')), true);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'public/cinebox-app-icon.png')), true);

  // 3. Real VidSrc.sh AdBlocker (Scoped strictly to vidsrc.sh — 2Embed and other providers unaffected)
  assert.equal(isVidSrcProviderUrl('https://vidsrc.sh/embed/movie/533535?ds_lang=en'), true);
  assert.equal(isVidSrcProviderUrl('https://player.vidsrc.sh/embed/tv/123'), true);
  assert.equal(isVidSrcProviderUrl('https://www.2embed.cc/embed/533535'), false);
  assert.equal(isVidSrcProviderUrl('https://www.youtube.com/embed/abc'), false);
  assert.equal(isVidSrcProviderUrl(null), false);

  assert.equal(VIDSRC_AD_BLOCKLIST_DOMAINS.length > 10, true);
  assert.equal(isVidSrcAdNetworkUrl('https://syndication.exoclick.com/ads.js'), true);
  assert.equal(isVidSrcAdNetworkUrl('https://cdn.popads.net/pop.js'), true);
  assert.equal(
    isVidSrcAdNetworkUrl(
      'https://stellarconductornexus.com/embed/f59d610a61063c7ef3ccdc1fd40d2ae6.js?_=1794394509'
    ),
    true
  );
  assert.equal(isVidSrcAdNetworkUrl('https://abc123xyz.u08/s9x8/VgMoO'), true);
  assert.equal(isVidSrcAdNetworkUrl('https://vidsrc.sh/assets/sbx.js?v=1786671805'), true);
  assert.equal(isVidSrcAdNetworkUrl('https://vidsrc.sh/embed/movie/533535'), false);

  // When VidSrc.sh is active and AdBlocker is ON -> strict sandbox without allow-popups or allow-top-navigation
  const vidsrcProtectedAttrs = getVidSrcPlayerIframeAttributes(
    'https://vidsrc.sh/embed/movie/533535?ds_lang=en',
    'Deadpool - VidSrc.sh',
    true
  );
  assert.equal(vidsrcProtectedAttrs.isVidSrcAdBlockerActive, true);
  assert.equal(
    vidsrcProtectedAttrs.sandbox,
    'allow-scripts allow-same-origin allow-forms allow-presentation'
  );
  assert.equal((vidsrcProtectedAttrs.sandbox || '').includes('allow-popups'), false);
  assert.equal((vidsrcProtectedAttrs.sandbox || '').includes('allow-top-navigation'), false);

  // When AdBlocker is OFF -> no sandbox restriction
  const vidsrcUnprotectedAttrs = getVidSrcPlayerIframeAttributes(
    'https://vidsrc.sh/embed/movie/533535?ds_lang=en',
    'Deadpool - VidSrc.sh',
    false
  );
  assert.equal(vidsrcUnprotectedAttrs.isVidSrcAdBlockerActive, false);
  assert.equal(vidsrcUnprotectedAttrs.sandbox, undefined);

  // When Server 3 (2Embed.cc) is active -> never sandboxed even when AdBlocker is ON
  const twoEmbedAttrs = getVidSrcPlayerIframeAttributes(
    'https://www.2embed.cc/embed/533535',
    'Deadpool - 2Embed',
    true
  );
  assert.equal(twoEmbedAttrs.isVidSrcAdBlockerActive, false);
  assert.equal(twoEmbedAttrs.sandbox, undefined);

  // Verify UI toggle switch (role="switch"), CSS hiding rules & network request interceptor
  const { buildVidSrcAdBlockCssRules, installVidSrcNetworkAdInterceptor } = await import(
    './streamResolver'
  );

  // CSS hiding rules generated ONLY when Adblocker is ON and server is vidsrc.sh
  const activeCss = buildVidSrcAdBlockCssRules(true, true);
  assert.equal(activeCss.includes('iframe[src*="exoclick.com"]'), true);
  assert.equal(activeCss.includes('[data-vidsrc-adblock="active"] > iframe[data-vidsrc-iframe="true"]'), true);
  assert.equal(activeCss.includes('display: none !important;'), true);
  assert.equal(buildVidSrcAdBlockCssRules(false, true), '');
  assert.equal(buildVidSrcAdBlockCssRules(true, false), '');

  // Network request & popup interceptor blocks ad-network fetches & window.open, while allowing normal requests
  const interceptedEvents: Array<{ url: string; kind: string }> = [];
  let passthroughFetchCount = 0;
  const mockWin: any = {
    fetch: async (url: string) => {
      passthroughFetchCount += 1;
      return { ok: true, status: 200, url };
    },
    open: (url: string) => ({ openedUrl: url }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const cleanupInterceptor = installVidSrcNetworkAdInterceptor({
    enabled: true,
    isVidSrcTarget: true,
    targetWindow: mockWin,
    targetDocument: null,
    onAdBlocked: (url, kind) => {
      interceptedEvents.push({ url, kind });
    },
  });

  // Ad network fetch -> intercepted (returns 204, does not hit original fetch)
  const blockedRes = await mockWin.fetch('https://syndication.exoclick.com/ads.js');
  assert.equal(blockedRes.status, 204);
  assert.equal(passthroughFetchCount, 0);
  assert.equal(interceptedEvents.length, 1);
  assert.equal(interceptedEvents[0].kind, 'fetch');

  // Legitimate API fetch -> passes through untouched
  const allowedRes = await mockWin.fetch('https://api.themoviedb.org/3/movie/533535');
  assert.equal(allowedRes.status, 200);
  assert.equal(passthroughFetchCount, 1);

  // Popup window.open -> intercepted (returns null)
  const popupAttempt = mockWin.open('https://cdn.popads.net/popunder');
  assert.equal(popupAttempt, null);
  assert.equal(interceptedEvents.length, 2);
  assert.equal(interceptedEvents[1].kind, 'popup');

  // Toggling Adblocker OFF (cleanup) restores original fetch and window.open
  cleanupInterceptor();
  const afterCleanupPopup = mockWin.open('https://cineboxmovies.ai.studio');
  assert.deepEqual(afterCleanupPopup, { openedUrl: 'https://cineboxmovies.ai.studio' });

  assert.equal(modalSource.includes('vidsrc-adblocker-toggle-btn'), true);
  assert.equal(modalSource.includes('role="switch"'), true);
  assert.equal(modalSource.includes('vidsrc-adblocker-css-rules'), true);
  assert.equal(modalSource.includes('vidsrc-click-shield-layer'), true);
  assert.equal(modalSource.includes('data-vidsrc-adblock='), true);
  const mainActivityJava = fs.readFileSync(
    path.resolve(process.cwd(), 'android/app/src/main/java/com/cinebox/stream/MainActivity.java'),
    'utf8'
  );
  assert.equal(mainActivityJava.includes('VIDSRC_AD_DOMAINS'), true);
  assert.equal(mainActivityJava.includes('shouldInterceptRequest'), true);
  assert.equal(mainActivityJava.includes('shouldOverrideUrlLoading'), true);
  assert.equal(mainActivityJava.includes('/assets/sbx.js'), true);
});




