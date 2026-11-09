import { sanitizeSafeUrl } from '../utils/securityValidator';

export const DEFAULT_CURRENT_APP_VERSION = '1.0.0';
export const DEFAULT_VERSION_JSON_URL = '/version.json';
export const GITHUB_VERSION_JSON_EXAMPLE_URL =
  'https://raw.githubusercontent.com/cinebox-official/cinebox-apk/main/version.json';

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
  error?: string;
}

/**
 * Compares two semantic version strings (e.g. "1.0.1" vs "1.0.0").
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
 * falling back to `DEFAULT_CURRENT_APP_VERSION` ("1.0.0").
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
 * `{ "version": "1.0.1", "apk_url": "https://github.com/.../app-release.apk" }`
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
 * Fetches `version.json` on app startup and compares its `version` against `App.getInfo().version`.
 */
export async function checkForInAppApkUpdate(options?: {
  versionJsonUrl?: string;
  currentVersionOverride?: string;
  fetchImpl?: typeof fetch;
}): Promise<InAppUpdateCheckResult> {
  const currentVersion = await getInstalledAppVersion(options?.currentVersionOverride);
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
    };
  } catch (err) {
    return {
      checked: false,
      updateAvailable: false,
      currentVersion,
      remoteVersion: currentVersion,
      apkUrl: '',
      releaseNotes: '',
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
        versionName "1.0.1"
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
