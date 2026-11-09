import { MovieLinkRecord } from '../types/movie';
import { sanitizeSafeUrl } from '../utils/securityValidator';

export interface VideoHosterAccountConfig {
  hoster: 'streamwish' | 'filemoon' | 'vidhide' | 'doodstream' | 'custom';
  apiKey: string;
  apiBaseUrl?: string;
}

export interface VideoHosterFileItem {
  fileCode: string;
  title: string;
  embedUrl: string;
  directDownloadUrl?: string;
  fileSizeMb?: number;
  matchedTmdbId?: number;
  matchedTitle?: string;
  matchedYear?: string;
}

export interface BulkImportReport {
  totalProcessed: number;
  matchedCount: number;
  unmatchedCount: number;
  savedCount: number;
  errors: string[];
}

export const HOSTER_API_PRESETS: Record<
  string,
  { name: string; baseUrl: string; docUrl: string; fileListPath: string; clonePath: string; cloneParam: string }
> = {
  streamwish: {
    name: 'StreamWish',
    baseUrl: 'https://api.streamwish.com',
    docUrl: 'https://streamwish.com/api',
    fileListPath: '/api/file/list',
    clonePath: '/api/file/clone',
    cloneParam: 'file_code',
  },
  filemoon: {
    name: 'FileMoon',
    baseUrl: 'https://filemoon.sx/api',
    docUrl: 'https://filemoon.sx/api',
    fileListPath: '/file/list',
    clonePath: '/file/clone',
    cloneParam: 'file_code',
  },
  vidhide: {
    name: 'VidHide',
    baseUrl: 'https://vidhideapi.com/api',
    docUrl: 'https://vidhideapi.com',
    fileListPath: '/file/list',
    clonePath: '/file/clone',
    cloneParam: 'file_code',
  },
  doodstream: {
    name: 'DoodStream',
    baseUrl: 'https://doodapi.co/api',
    docUrl: 'https://doodstream.com',
    fileListPath: '/file/list',
    clonePath: '/file/clone',
    cloneParam: 'file_code',
  },
};

/**
 * Extracts a clean movie search title and year from typical video file names:
 * e.g., "Deadpool.and.Wolverine.2024.1080p.WEBRip.Hindi.x264.mp4" -> { cleanTitle: "Deadpool and Wolverine", year: "2024" }
 */
export function parseMovieFileName(rawName: string): { cleanTitle: string; year?: string } {
  if (!rawName) return { cleanTitle: '' };

  let name = rawName
    .replace(/\.[a-z0-9]{2,4}$/i, '') // strip extension (.mp4, .mkv)
    .replace(/[._]/g, ' ') // replace dots and underscores with spaces
    .trim();

  // Look for 4-digit release year (1950 - 2035)
  const yearMatch = name.match(/\b(19\d\d|20[0-3]\d)\b/);
  const year = yearMatch ? yearMatch[1] : undefined;

  if (year) {
    const parts = name.split(year);
    if (parts[0] && parts[0].trim().length > 1) {
      name = parts[0];
    }
  }

  // Remove common scene tags
  name = name
    .replace(
      /\b(1080p|720p|480p|2160p|4k|uhd|bluray|blu-ray|webrip|web-dl|hdrip|dvdrip|camrip|hdcam|x264|x265|hevc|aac|hindi|english|dual audio|org|dubbed|subbed)\b/gi,
      ''
    )
    .replace(/[\(\)\[\]\{\}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { cleanTitle: name || rawName.trim(), year };
}

/**
 * Search TMDb API for a given movie title to find its exact `tmdb_id`.
 */
export async function matchTitleWithTmdb(
  cleanTitle: string,
  year?: string,
  apiKey: string = '3fd2be6f0c70a2a598f084ddfb75487c'
): Promise<{ tmdbId: number; title: string; year: string; posterPath?: string } | null> {
  if (!cleanTitle || cleanTitle.trim().length === 0) return null;

  try {
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(
      apiKey
    )}&query=${encodeURIComponent(cleanTitle)}`;
    if (year) {
      url += `&year=${encodeURIComponent(year)}`;
    }

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data.results) && data.results.length > 0) {
      const top = data.results[0];
      return {
        tmdbId: Number(top.id),
        title: top.title || top.name || cleanTitle,
        year: (top.release_date || '').slice(0, 4) || year || '2025',
        posterPath: top.poster_path ? `https://image.tmdb.org/t/p/w500${top.poster_path}` : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses raw JSON or CSV data from Video Hosters (StreamWish, FileMoon, VidHide, etc.)
 * or custom lists into normalized file items.
 */
export function parseHosterFilesList(
  input: string,
  hoster: string = 'streamwish'
): VideoHosterFileItem[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // 1. Try parsing as JSON from hoster API
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const rawList = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.result?.files)
        ? parsed.result.files
        : Array.isArray(parsed.result)
        ? parsed.result
        : Array.isArray(parsed.files)
        ? parsed.files
        : [];

      return rawList.map((item: any) => {
        const fileCode = item.file_code || item.filecode || item.code || item.id || '';
        const title = item.title || item.file_title || item.name || `Movie_${fileCode}`;
        const embedUrl =
          item.embed_url ||
          (fileCode ? `https://${hoster}.com/e/${fileCode}` : '');
        const directDownload = item.download_url || item.direct_url || undefined;
        const sizeMb = item.size ? Math.round((Number(item.size) / (1024 * 1024)) * 10) / 10 : undefined;

        return {
          fileCode: String(fileCode),
          title: String(title),
          embedUrl: sanitizeSafeUrl(embedUrl) || '',
          directDownloadUrl: sanitizeSafeUrl(directDownload) || undefined,
          fileSizeMb: sizeMb,
        };
      }).filter((f: VideoHosterFileItem) => f.title && (f.embedUrl || f.fileCode));
    } catch {
      // Fallback to line-by-line parsing
    }
  }

  // 2. Parse text/CSV format: "Title | FileCode or EmbedURL | DirectDownloadURL (optional)"
  const lines = trimmed.split('\n');
  const items: VideoHosterFileItem[] = [];

  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) continue;

    // Split by pipe '|', comma, or tab
    const parts = l.includes('|')
      ? l.split('|')
      : l.includes('\t')
      ? l.split('\t')
      : l.split(',');

    if (parts.length >= 2) {
      const rawTitle = parts[0].trim();
      const rawSecond = parts[1].trim();
      const rawThird = parts[2]?.trim();

      let embedUrl = '';
      let fileCode = '';
      if (rawSecond.startsWith('http://') || rawSecond.startsWith('https://')) {
        embedUrl = rawSecond;
        const match = rawSecond.match(/\/e\/([a-zA-Z0-9_-]+)/);
        if (match) fileCode = match[1];
      } else {
        fileCode = rawSecond;
        embedUrl = `https://${hoster}.com/e/${fileCode}`;
      }

      items.push({
        fileCode,
        title: rawTitle,
        embedUrl: sanitizeSafeUrl(embedUrl) || '',
        directDownloadUrl: sanitizeSafeUrl(rawThird) || undefined,
      });
    }
  }

  return items;
}

/**
 * Converts a VideoHosterFileItem with matched TMDb metadata into a Supabase `MovieLinkRecord`.
 */
export function buildMovieLinkRecordFromHoster(
  item: VideoHosterFileItem,
  defaultLang: string = 'Hindi Dubbed'
): MovieLinkRecord | null {
  if (!item.matchedTmdbId) return null;

  return {
    tmdb_id: item.matchedTmdbId,
    title: item.matchedTitle || item.title,
    language: defaultLang,
    direct_video_url: item.directDownloadUrl || null,
    stream_url: item.embedUrl || null,
    download_480p: item.directDownloadUrl || null,
    download_720p: item.directDownloadUrl || null,
    download_1080p: item.directDownloadUrl || null,
    file_size_480p: item.fileSizeMb ? `${Math.round(item.fileSizeMb * 0.45)}MB` : '450.0MB',
    file_size_720p: item.fileSizeMb ? `${Math.round(item.fileSizeMb)}MB` : '1020.6MB',
    file_size_1080p: item.fileSizeMb ? `${Math.round(item.fileSizeMb * 1.8)}MB` : '2150.0MB',
    updated_at: new Date().toISOString(),
  };
}
