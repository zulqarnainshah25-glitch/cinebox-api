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
export function buildCustomFetchHeaders(
  config: Partial<CustomHeaderConfig>
): Record<string, string> {
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

export async function fetchVideoAsBlobUrl(options: {
  url: string;
  headersConfig: Partial<CustomHeaderConfig>;
  signal?: AbortSignal;
  onProgress?: (progress: BlobFetchProgress) => void;
}): Promise<BlobFetchResult> {
  const safeUrl = sanitizeSafeUrl(options.url);
  if (!safeUrl) {
    throw new Error('Stream Unavailable');
  }

  const headers = buildCustomFetchHeaders(options.headersConfig);
  const response = await fetch(safeUrl, {
    method: 'GET',
    headers,
    mode: 'cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error('Stream Unavailable');
  }

  const rawBlob = await response.blob();
  const videoBlob = new Blob([rawBlob], { type: 'video/mp4' });
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
    mimeType: 'video/mp4',
  };
}
