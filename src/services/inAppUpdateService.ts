import { AppConfigRecord } from '../types/movie';
import { sanitizeSafeUrl } from '../utils/securityValidator';
import { DetectedPlatform, detectAppPlatform } from './platformTrialReferralService';

export const DEFAULT_CURRENT_APP_VERSION = '1.0.2';
export const DEFAULT_VERSION_JSON_URL = '/version.json';
export const DEFAULT_GLOBAL_APK_DOWNLOAD_URL =
  'https://drive.google.com/file/d/1CineBoxOfficialReleaseApk/view?usp=sharing';
export const DEFAULT_GLOBAL_APK_RELEASE_NOTES =
  'Latest CineBox Android APK (Google Drive Global Download, Native WebView Popup Blocker & Signature-Safe Update).';
export const DEFAULT_OFFICIAL_WEBSITE_URL = 'https://cineboxmovies.ai.studio';
export const GITHUB_VERSION_JSON_EXAMPLE_URL =
  'https://raw.githubusercontent.com/cinebox-official/cinebox-apk/main/version.json';

export const CINEBOX_APK_META_PREFIX = 'CINEBOX_APK_META::';

/**
 * Normalizes an official website URL or domain (e.g. `cineboxmovies.ai.studio` -> `https://cineboxmovies.ai.studio`)
 * and upgrades legacy/typo placeholder URLs (`cinebox-movie-streaming-offline-downloader.ai.studio` / `neboxmovies.ai.studio` / `movie-box.co`)
 * to `https://cineboxmovies.ai.studio`.
 */
export function normalizeOfficialWebsiteUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return DEFAULT_OFFICIAL_WEBSITE_URL;
  const trimmed = rawUrl.trim();
  if (
    !trimmed ||
    trimmed.includes('cinebox-movie-streaming-offline-downloader.ai.studio') ||
    trimmed.includes('neboxmovies.ai.studio') ||
    trimmed === 'https://movie-box.co' ||
    trimmed === 'http://movie-box.co'
  ) {
    return DEFAULT_OFFICIAL_WEBSITE_URL;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const safe = sanitizeSafeUrl(withProtocol);
  return safe ? safe.replace(/\/+$/, '') : DEFAULT_OFFICIAL_WEBSITE_URL;
}

export interface RemoteVersionManifest {
  version: string;
  apk_url: string;
  release_notes?: string;
}

export interface InAppUpdateCheckResult {
  checked: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  remoteVersion: string;
  apkUrl: string;
  releaseNotes: string;
  platform?: DetectedPlatform;
  isGoogleDriveLink?: boolean;
  source?: 'supabase-global-config' | 'version-json' | 'web-disabled';
  error?: string;
}

/**
 * Returns true if the URL is the default unconfigured placeholder link (`1CineBoxOfficialReleaseApk`)
 * before the Admin saves a real Google Drive or direct APK link.
 */
export function isUnconfiguredPlaceholderApkUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return true;
  return rawUrl.includes('1CineBoxOfficialReleaseApk');
}

/**
 * Extracts a Google Drive File ID from common Google Drive URL formats:
 * - `https://drive.google.com/file/d/{FILE_ID}/view?usp=sharing`
 * - `https://drive.google.com/open?id={FILE_ID}`
 * - `https://drive.google.com/uc?export=download&id={FILE_ID}`
 * - `https://drive.usercontent.google.com/download?id={FILE_ID}&export=download`
 */
export function extractGoogleDriveFileId(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  const safe = sanitizeSafeUrl(trimmed);
  if (!safe) return null;

  try {
    const parsed = new URL(safe);
    const host = parsed.hostname.toLowerCase();
    if (
      host !== 'drive.google.com' &&
      host !== 'docs.google.com' &&
      host !== 'drive.usercontent.google.com'
    ) {
      return null;
    }

    // 1. Check /file/d/{FILE_ID}
    const pathMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{6,120})/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }

    // 2. Check ?id={FILE_ID}
    const queryId = parsed.searchParams.get('id');
    if (queryId && /^[a-zA-Z0-9_-]{6,120}$/.test(queryId.trim())) {
      return queryId.trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Converts a standard Google Drive share link (`/file/d/{ID}/view?usp=sharing`)
 * into a direct download link (`https://drive.google.com/uc?export=download&id={ID}`).
 * If the URL is not a Google Drive link, returns the sanitized URL unchanged.
 */
export function toGoogleDriveDirectDownloadUrl(rawUrl: string | null | undefined): string {
  const safe = sanitizeSafeUrl(rawUrl);
  if (!safe) return '';
  const fileId = extractGoogleDriveFileId(safe);
  if (!fileId) return safe;
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * Increments the patch segment of a semantic version string (e.g. "1.0.1" -> "1.0.2").
 */
export function bumpSemverPatchVersion(version: string | null | undefined): string {
  const clean = (version || '1.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const parts = clean.split('.').map((n) => parseInt(n, 10));
  const major = Number.isFinite(parts[0]) && parts[0] >= 0 ? parts[0] : 1;
  const minor = Number.isFinite(parts[1]) && parts[1] >= 0 ? parts[1] : 0;
  const patch = Number.isFinite(parts[2]) && parts[2] >= 0 ? parts[2] + 1 : 1;
  return `${major}.${minor}.${patch}`;
}

/**
 * Encodes global APK metadata (`version`, `apkUrl`, `releaseNotes`) into a compact string carrier
 * so it can be persisted inside existing guaranteed `public.app_config` columns in Supabase
 * even before optional schema migrations are executed.
 */
export function encodeGlobalApkConfigCarrier(meta: {
  version: string;
  apkUrl: string;
  releaseNotes?: string;
  officialWebsite?: string;
}): string {
  const safeUrl = sanitizeSafeUrl(meta.apkUrl) || '';
  const cleanVersion =
    (meta.version || '1.0.2')
      .trim()
      .replace(/^v/i, '')
      .replace(/[^0-9a-zA-Z._-]/g, '')
      .slice(0, 32) || '1.0.2';
  const cleanNotes = (meta.releaseNotes || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 280);

  const payload: Record<string, string> = {
    version: cleanVersion,
    apkUrl: safeUrl,
    releaseNotes: cleanNotes,
  };
  if (meta.officialWebsite) {
    payload.officialWebsite = normalizeOfficialWebsiteUrl(meta.officialWebsite);
  }

  return `${CINEBOX_APK_META_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Decodes a `CINEBOX_APK_META::` carrier string from Supabase `public.app_config`.
 */
export function decodeGlobalApkConfigCarrier(rawCarrier: string | null | undefined): {
  version: string;
  apkUrl: string;
  releaseNotes: string;
  officialWebsite?: string;
} | null {
  if (
    !rawCarrier ||
    typeof rawCarrier !== 'string' ||
    !rawCarrier.startsWith(CINEBOX_APK_META_PREFIX)
  ) {
    return null;
  }
  try {
    const jsonPart = rawCarrier.slice(CINEBOX_APK_META_PREFIX.length);
    const parsed = JSON.parse(jsonPart) as Record<string, unknown>;
    const safeUrl =
      typeof parsed.apkUrl === 'string' ? sanitizeSafeUrl(parsed.apkUrl) : null;
    if (!safeUrl || !safeUrl.startsWith('https://')) {
      return null;
    }
    const rawVer =
      typeof parsed.version === 'string' && parsed.version.trim()
        ? parsed.version.trim().replace(/^v/i, '')
        : '1.0.2';
    const notes =
      typeof parsed.releaseNotes === 'string'
        ? parsed.releaseNotes.replace(/[<>]/g, '').trim().slice(0, 280)
        : '';
    const officialWebsite =
      typeof parsed.officialWebsite === 'string' && parsed.officialWebsite.trim()
        ? normalizeOfficialWebsiteUrl(parsed.officialWebsite)
        : undefined;
    return {
      version: rawVer,
      apkUrl: safeUrl,
      releaseNotes: notes,
      ...(officialWebsite ? { officialWebsite } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Compares two semantic version strings (e.g. "1.0.2" vs "1.0.1").
 * Returns:
 *  - `1` if `versionA > versionB`
 *  - `-1` if `versionA < versionB`
 *  - `0` if equal
 */
export function compareSemverVersions(versionA: string, versionB: string): number {
  const cleanA = (versionA || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const cleanB = (versionB || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];

  const partsA = cleanA.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = cleanB.split('.').map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(partsA.length, partsB.length, 3);

  for (let i = 0; i < maxLen; i++) {
    const a = partsA[i] || 0;
    const b = partsB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Reads the installed APK version via Capacitor's `App.getInfo()` bridge when available,
 * falling back to `DEFAULT_CURRENT_APP_VERSION` ("1.0.2").
 */
export async function getInstalledAppVersion(overrideVersion?: string): Promise<string> {
  if (overrideVersion && overrideVersion.trim()) {
    return overrideVersion.trim();
  }

  if (typeof window !== 'undefined') {
    try {
      const capAppPlugin = (window as unknown as {
        Capacitor?: {
          Plugins?: {
            App?: {
              getInfo?: () => Promise<{ version?: string }>;
            };
          };
        };
      }).Capacitor?.Plugins?.App;

      if (capAppPlugin && typeof capAppPlugin.getInfo === 'function') {
        const info = await capAppPlugin.getInfo();
        if (info && typeof info.version === 'string' && info.version.trim()) {
          return info.version.trim();
        }
      }
    } catch {
      // Fallback to default version
    }
  }

  return DEFAULT_CURRENT_APP_VERSION;
}

/**
 * Validates and parses the `version.json` payload:
 * `{ "version": "1.0.2", "apk_url": "https://drive.google.com/... or https://github.com/.../app-release.apk" }`
 * Rejects non-HTTPS or XSS `apk_url` values.
 */
export function parseRemoteVersionManifest(rawPayload: unknown): {
  valid: boolean;
  manifest?: RemoteVersionManifest;
  error?: string;
} {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { valid: false, error: 'Invalid version.json object.' };
  }

  const obj = rawPayload as Record<string, unknown>;
  const rawVersion = typeof obj.version === 'string' ? obj.version.trim() : '';
  if (!rawVersion || !/^\d+\.\d+(\.\d+)?(-[a-zA-Z0-9._-]+)?$/.test(rawVersion.replace(/^v/i, ''))) {
    return { valid: false, error: 'Invalid semantic version string in version.json.' };
  }

  const rawApkUrl = typeof obj.apk_url === 'string' ? obj.apk_url.trim() : '';
  const safeApkUrl = sanitizeSafeUrl(rawApkUrl);
  if (!safeApkUrl || !safeApkUrl.startsWith('https://')) {
    return {
      valid: false,
      error: 'A valid HTTPS apk_url is required in version.json.',
    };
  }

  const releaseNotes =
    typeof obj.release_notes === 'string'
      ? obj.release_notes.replace(/[<>]/g, '').trim().slice(0, 280)
      : 'Bug fixes, performance improvements, and signature-safe APK update.';

  return {
    valid: true,
    manifest: {
      version: rawVersion.replace(/^v/i, ''),
      apk_url: safeApkUrl,
      release_notes: releaseNotes,
    },
  };
}

/**
 * Checks for an In-App APK Update on startup or when the Admin updates `app_config` globally:
 * - STRICT PLATFORM RULE: If `platform === 'Web'` (or running on Website in browser), returns
 *   `updateAvailable: false` immediately so Website users NEVER see the "New Update Available" popup.
 * - On Android APK (`platform === 'Android'`):
 *   1. Checks if a valid global APK download URL & version are configured in Supabase `app_config`.
 *   2. Otherwise fetches `/version.json` and compares its `version` against `App.getInfo().version`.
 */
export async function checkForInAppApkUpdate(options?: {
  platform?: DetectedPlatform;
  versionJsonUrl?: string;
  currentVersionOverride?: string;
  globalAppConfig?: Partial<AppConfigRecord> | null;
  fetchImpl?: typeof fetch;
}): Promise<InAppUpdateCheckResult> {
  const currentVersion = await getInstalledAppVersion(options?.currentVersionOverride);

  // Determine active platform: explicit option -> browser runtime detection -> Android in headless unit tests
  const effectivePlatform: DetectedPlatform =
    options?.platform ??
    (typeof window !== 'undefined' ? detectAppPlatform() : 'Android');

  // 0. STRICT RULE: Never show the In-App Update Popup on Website ('Web')
  if (effectivePlatform === 'Web') {
    return {
      checked: true,
      updateAvailable: false,
      currentVersion,
      remoteVersion: currentVersion,
      apkUrl: options?.globalAppConfig?.apk_download_url || '',
      releaseNotes: '',
      platform: 'Web',
      source: 'web-disabled',
    };
  }

  // 1. Check Admin-configured Global APK Link in Supabase `app_config` (ignore unconfigured placeholder URL)
  if (
    options?.globalAppConfig?.apk_download_url &&
    !isUnconfiguredPlaceholderApkUrl(options.globalAppConfig.apk_download_url)
  ) {
    const globalParsed = parseRemoteVersionManifest({
      version: options.globalAppConfig.apk_latest_version || '1.0.2',
      apk_url: options.globalAppConfig.apk_download_url,
      release_notes:
        options.globalAppConfig.apk_release_notes ||
        'New CineBox APK version available via Global Admin Download Link.',
    });

    if (globalParsed.valid && globalParsed.manifest) {
      const isNewer = compareSemverVersions(globalParsed.manifest.version, currentVersion) > 0;
      return {
        checked: true,
        updateAvailable: isNewer,
        currentVersion,
        remoteVersion: globalParsed.manifest.version,
        apkUrl: globalParsed.manifest.apk_url,
        releaseNotes: globalParsed.manifest.release_notes || '',
        platform: 'Android',
        isGoogleDriveLink: Boolean(extractGoogleDriveFileId(globalParsed.manifest.apk_url)),
        source: 'supabase-global-config',
      };
    }
  }

  const targetUrl = options?.versionJsonUrl || DEFAULT_VERSION_JSON_URL;
  const fetchFn = options?.fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined);

  if (!fetchFn) {
    return {
      checked: false,
      updateAvailable: false,
      currentVersion,
      remoteVersion: currentVersion,
      apkUrl: '',
      releaseNotes: '',
      platform: 'Android',
      error: 'Fetch API unavailable.',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetchFn(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        checked: false,
        updateAvailable: false,
        currentVersion,
        remoteVersion: currentVersion,
        apkUrl: '',
        releaseNotes: '',
        platform: 'Android',
        error: `HTTP ${response.status} when fetching version.json`,
      };
    }

    const json = await response.json();
    const parsed = parseRemoteVersionManifest(json);
    if (!parsed.valid || !parsed.manifest) {
      return {
        checked: false,
        updateAvailable: false,
        currentVersion,
        remoteVersion: currentVersion,
        apkUrl: '',
        releaseNotes: '',
        platform: 'Android',
        error: parsed.error || 'Malformed version.json',
      };
    }

    const isNewer = compareSemverVersions(parsed.manifest.version, currentVersion) > 0;
    return {
      checked: true,
      updateAvailable: isNewer,
      currentVersion,
      remoteVersion: parsed.manifest.version,
      apkUrl: parsed.manifest.apk_url,
      releaseNotes: parsed.manifest.release_notes || '',
      platform: 'Android',
      isGoogleDriveLink: Boolean(extractGoogleDriveFileId(parsed.manifest.apk_url)),
      source: 'version-json',
    };
  } catch (err) {
    return {
      checked: false,
      updateAvailable: false,
      currentVersion,
      remoteVersion: currentVersion,
      apkUrl: '',
      releaseNotes: '',
      platform: 'Android',
      error: err instanceof Error ? err.message : 'Network error checking version.json',
    };
  }
}

/**
 * Complete Android `android/app/build.gradle` Release Signing Config & GitHub Actions `.jks` Keystore guide
 * so every new APK build shares the exact same cryptographic signature and installs cleanly over the old APK
 * without "App not installed as package conflicts with an existing package".
 */
export const ANDROID_BUILD_GRADLE_SIGNING_CONFIG = `// File: android/app/build.gradle
apply plugin: 'com.android.application'

android {
    namespace "com.cinebox.stream"
    compileSdk rootProject.ext.compileSdkVersion

    defaultConfig {
        applicationId "com.cinebox.stream"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 2
        versionName "1.0.2"
    }

    // IMPORTANT: Signature-Safe Release Signing Config
    // Uses the exact same .jks keystore across every build so In-App Updates install over the existing APK!
    signingConfigs {
        release {
            storeFile file(System.getenv("CM_KEYSTORE_PATH") ?: "release-keystore.jks")
            storePassword System.getenv("CM_KEYSTORE_PASSWORD") ?: project.findProperty("RELEASE_STORE_PASSWORD")
            keyAlias System.getenv("CM_KEY_ALIAS") ?: project.findProperty("RELEASE_KEY_ALIAS")
            keyPassword System.getenv("CM_KEY_PASSWORD") ?: project.findProperty("RELEASE_KEY_PASSWORD")
            v1SigningEnabled true
            v2SigningEnabled true
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            shrinkResources false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
        debug {
            // Optional: also sign debug builds with the same keystore to prevent signature mismatch during testing
            if (file("release-keystore.jks").exists()) {
                signingConfig signingConfigs.release
            }
        }
    }
}`;

export const GITHUB_ACTIONS_JKS_WORKFLOW_YAML = `# File: .github/workflows/android-release-apk.yml
name: Build Signature-Safe Signed Android APK

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build-signed-apk:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up Node.js 20 & Java 17
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Install Dependencies & Build Web Assets
        run: |
          npm ci
          npm run build
          npx cap sync android

      - name: Decode Persistent .jks Keystore from GitHub Secrets
        env:
          KEYSTORE_BASE64: \${{ secrets.CINEBOX_KEYSTORE_BASE64 }}
        run: |
          echo "$KEYSTORE_BASE64" | base64 --decode > android/app/release-keystore.jks

      - name: Build Signed Release APK (Same Signature Guaranteed)
        working-directory: ./android
        env:
          CM_KEYSTORE_PATH: release-keystore.jks
          CM_KEYSTORE_PASSWORD: \${{ secrets.CINEBOX_KEYSTORE_PASSWORD }}
          CM_KEY_ALIAS: \${{ secrets.CINEBOX_KEY_ALIAS }}
          CM_KEY_PASSWORD: \${{ secrets.CINEBOX_KEY_PASSWORD }}
        run: |
          chmod +x gradlew
          ./gradlew assembleRelease

      - name: Upload Signed app-release.apk
        uses: actions/upload-artifact@v4
        with:
          name: app-release-signed
          path: android/app/build/outputs/apk/release/app-release.apk`;

export const ANDROID_MAIN_ACTIVITY_POPUP_BLOCKER_JAVA = `package com.cinebox.stream;

import android.graphics.Color;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.setBackgroundColor(Color.BLACK);
            WebSettings settings = webView.getSettings();

            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    Message resultMsg
                ) {
                    return false;
                }
            });
        }
    }
}`;
