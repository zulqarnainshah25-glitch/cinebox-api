import { sanitizeSafeUrl } from './securityValidator';

export interface CustomHeaderConfig {
  userAgent: string;
  referer: string;
  origin?: string;
  authorization?: string;
}

export interface BlobFetchProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  speedMBps: number;
}

export interface BlobFetchResult {
  blob: Blob;
  blobUrl: string;
  sizeBytes: number;
  mimeType: string;
}

/**
 * Maximum safe in-memory Blob size (1.5 GB) to prevent Out-Of-Memory (OOM) browser crashes.
 */
export const MAX_SAFE_BLOB_SIZE_BYTES = 1536 * 1024 * 1024;

export const DEFAULT_CUSTOM_HEADERS: CustomHeaderConfig = {
  userAgent:
    'com.community.mbox.in/50020130 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)',
  referer: 'https://api3.aoneroom.com/',
};

/**
 * Strips CRLF (`\r`, `\n`) and control characters from HTTP header values
 * to prevent HTTP Header Injection / Response Splitting attacks.
 */
export function sanitizeHeaderValue(value?: string | null): string {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, '').trim();
}

/**
 * Builds a sanitized HTTP headers object with `User-Agent`, `Referer`, and optional extra headers.
 */
export function buildCustomFetchHeaders(config: Partial<CustomHeaderConfig>): Record<string, string> {
  const headers: Record<string, string> = {};

  const ua = sanitizeHeaderValue(config.userAgent);
  const ref = sanitizeHeaderValue(config.referer);
  const orig = sanitizeHeaderValue(config.origin);
  const auth = sanitizeHeaderValue(config.authorization);

  if (ua) {
    headers['User-Agent'] = ua;
  }
  if (ref) {
    headers['Referer'] = ref;
  }
  if (orig) {
    headers['Origin'] = orig;
  }
  if (auth) {
    headers['Authorization'] = auth;
  }

  return headers;
}

/**
 * Downloads an MP4 video stream using `fetch` with custom headers (`User-Agent`, `Referer`),
 * streams chunks into a `Blob` while reporting live progress, and creates a `blob:` URL via `URL.createObjectURL(blob)`.
 */
export async function fetchVideoAsBlobUrl(options: {
  url: string;
  headersConfig: Partial<CustomHeaderConfig>;
  signal?: AbortSignal;
  onProgress?: (progress: BlobFetchProgress) => void;
}): Promise<BlobFetchResult> {
  const safeUrl = sanitizeSafeUrl(options.url);
  if (!safeUrl) {
    throw new Error('Server Busy, Try Again');
  }

  const headers = buildCustomFetchHeaders(options.headersConfig);
  const safeReferer = sanitizeSafeUrl(options.headersConfig.referer || '');

  const fetchInit: RequestInit = {
    method: 'GET',
    headers,
    mode: 'cors',
    credentials: 'omit',
    signal: options.signal,
  };

  if (safeReferer) {
    try {
      fetchInit.referrer = safeReferer;
    } catch {
      // Ignore if cross-origin referrer string is rejected by browser policy
    }
  }

  const candidateUrls = [
    safeUrl,
    `https://corsproxy.io/?${encodeURIComponent(safeUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(safeUrl)}`,
  ];

  let response: Response | null = null;
  for (const candidate of candidateUrls) {
    try {
      const res = await fetch(candidate, fetchInit);
      if (res.ok) {
        response = res;
        break;
      }
    } catch {
      // Try next candidate or proxy
      continue;
    }
  }

  if (!response || !response.ok) {
    throw new Error('Server Busy, Try Again');
  }

  const contentLengthHeader = response.headers.get('content-length');
  const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) || 0 : 0;

  if (totalBytes > MAX_SAFE_BLOB_SIZE_BYTES) {
    throw new Error(
      `Video file size (${Math.round(totalBytes / (1024 * 1024))}MB) exceeds safe in-memory Blob limit (1.5GB).`
    );
  }

  const rawContentType = response.headers.get('content-type') || '';
  const mimeType =
    rawContentType.includes('video/') || rawContentType.includes('application/octet-stream')
      ? 'video/mp4'
      : 'video/mp4';

  // If ReadableStream is available, stream chunks to provide live progress & speed
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loadedBytes = 0;
    const startTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        loadedBytes += value.byteLength;
        if (loadedBytes > MAX_SAFE_BLOB_SIZE_BYTES) {
          await reader.cancel();
          throw new Error('Stream exceeded maximum safe in-memory Blob size (1.5GB).');
        }
        chunks.push(value);

        if (options.onProgress) {
          const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
          const speedMBps = Math.round((loadedBytes / (1024 * 1024) / elapsedSec) * 100) / 100;
          const percent =
            totalBytes > 0
              ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100))
              : Math.min(95, Math.round((loadedBytes / (10 * 1024 * 1024)) * 100));

          options.onProgress({
            loadedBytes,
            totalBytes,
            percent,
            speedMBps,
          });
        }
      }
    }

    const blob = new Blob(chunks as BlobPart[], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    options.onProgress?.({
      loadedBytes: blob.size,
      totalBytes: blob.size,
      percent: 100,
      speedMBps: 0,
    });

    return {
      blob,
      blobUrl,
      sizeBytes: blob.size,
      mimeType,
    };
  }

  // Fallback to direct response.blob()
  const rawBlob = await response.blob();
  const videoBlob = new Blob([rawBlob], { type: mimeType });
  const blobUrl = URL.createObjectURL(videoBlob);

  options.onProgress?.({
    loadedBytes: videoBlob.size,
    totalBytes: videoBlob.size,
    percent: 100,
    speedMBps: 0,
  });

  return {
    blob: videoBlob,
    blobUrl,
    sizeBytes: videoBlob.size,
    mimeType,
  };
}
