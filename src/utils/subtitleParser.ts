import { SubtitleTrackOption } from '../types/movie';
import { sanitizeSafeUrl, stripHtmlAndScriptContent } from './securityValidator';

export interface ParsedSubtitleCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export type SubtitleFontSizeOption = 'sm' | 'normal' | 'large' | 'xl';
export type SubtitleBgOpacityOption = 0 | 50 | 75 | 100;

export interface UserSubtitlePreferences {
  enabled: boolean;
  preferredLang: string;
  fontSize: SubtitleFontSizeOption;
  bgOpacity: SubtitleBgOpacityOption;
  delayMs: number;
}

const SUBTITLE_PREFS_STORAGE_KEY = 'cinebox_subtitle_preferences_v2';

const memorySubtitlePrefs: Record<string, string> = {};

function safeReadStorage(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // fallback
  }
  return memorySubtitlePrefs[key] ?? null;
}

function safeWriteStorage(key: string, value: string): void {
  memorySubtitlePrefs[key] = value;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // ignore storage errors
  }
}

export const DEFAULT_SUBTITLE_PREFERENCES: UserSubtitlePreferences = {
  enabled: false,
  preferredLang: 'en',
  fontSize: 'normal',
  bgOpacity: 75,
  delayMs: 0,
};

export function getSavedSubtitlePreferences(userId: string = 'guest'): UserSubtitlePreferences {
  const key = `${SUBTITLE_PREFS_STORAGE_KEY}::${userId || 'guest'}`;
  const raw = safeReadStorage(key) || safeReadStorage(SUBTITLE_PREFS_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SUBTITLE_PREFERENCES };
  try {
    const parsed = JSON.parse(raw);
    const fontSize: SubtitleFontSizeOption =
      parsed.fontSize === 'sm' ||
      parsed.fontSize === 'normal' ||
      parsed.fontSize === 'large' ||
      parsed.fontSize === 'xl'
        ? parsed.fontSize
        : 'normal';
    const bgOpacity: SubtitleBgOpacityOption =
      parsed.bgOpacity === 0 ||
      parsed.bgOpacity === 50 ||
      parsed.bgOpacity === 75 ||
      parsed.bgOpacity === 100
        ? parsed.bgOpacity
        : 75;
    const delayMs =
      typeof parsed.delayMs === 'number' && Number.isFinite(parsed.delayMs)
        ? Math.max(-15000, Math.min(15000, Math.round(parsed.delayMs)))
        : 0;
    const preferredLang =
      typeof parsed.preferredLang === 'string' && parsed.preferredLang.trim()
        ? parsed.preferredLang.trim().slice(0, 24)
        : 'en';
    return {
      enabled: Boolean(parsed.enabled),
      preferredLang,
      fontSize,
      bgOpacity,
      delayMs,
    };
  } catch {
    return { ...DEFAULT_SUBTITLE_PREFERENCES };
  }
}

export function saveSubtitlePreferences(
  prefs: Partial<UserSubtitlePreferences>,
  userId: string = 'guest'
): UserSubtitlePreferences {
  const current = getSavedSubtitlePreferences(userId);
  const merged: UserSubtitlePreferences = {
    ...current,
    ...prefs,
  };
  const key = `${SUBTITLE_PREFS_STORAGE_KEY}::${userId || 'guest'}`;
  const serialized = JSON.stringify(merged);
  safeWriteStorage(key, serialized);
  safeWriteStorage(SUBTITLE_PREFS_STORAGE_KEY, serialized);
  return merged;
}

/**
 * Validates and sanitizes the `subtitles` JSON column from `movie_links`:
 * Array of `{ lang, label, url }`.
 */
export function sanitizeSubtitleTracksList(
  rawList: unknown,
  maxItems = 16
): SubtitleTrackOption[] {
  if (!Array.isArray(rawList)) return [];
  const result: SubtitleTrackOption[] = [];
  const seenUrls = new Set<string>();

  for (const item of rawList) {
    if (result.length >= maxItems) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const safeUrl = sanitizeSafeUrl(typeof obj.url === 'string' ? obj.url : null);
    if (!safeUrl || seenUrls.has(safeUrl)) continue;

    const rawLang =
      typeof obj.lang === 'string' && obj.lang.trim()
        ? obj.lang.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12)
        : 'en';
    const cleanLabel =
      stripHtmlAndScriptContent(obj.label, 48) ||
      (rawLang === 'ur'
        ? 'Urdu (اردو)'
        : rawLang === 'hi'
        ? 'Hindi (हिन्दी)'
        : rawLang === 'en'
        ? 'English'
        : rawLang.toUpperCase());

    seenUrls.add(safeUrl);
    result.push({
      lang: rawLang || 'en',
      label: cleanLabel,
      url: safeUrl,
    });
  }

  return result;
}

/**
 * Parses an SRT or WebVTT timestamp (`00:01:23,450`, `00:01:23.450`, or `01:23.450`) into seconds.
 */
export function parseSubtitleTimestamp(raw: string): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    seconds = Number(parts[2]);
  } else {
    minutes = Number(parts[0]);
    seconds = Number(parts[1]);
  }

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    seconds < 0
  ) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Sanitizes cue text by removing `<script>`, event handlers, and unsafe HTML tags while preserving line breaks.
 */
export function sanitizeSubtitleCueText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';
  return rawText
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '') // Strip ASS/SSA style overrides like {\an8}
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 400);
}

/**
 * Converts `.srt` subtitle content into valid `.vtt` (WebVTT) text in the browser.
 */
export function convertSrtToVtt(srtText: string): string {
  if (!srtText || typeof srtText !== 'string') {
    return 'WEBVTT\n\n';
  }
  const normalized = srtText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (normalized.startsWith('WEBVTT')) {
    return normalized;
  }

  // Convert SRT timestamp commas (00:01:20,450 --> 00:01:23,100) to WebVTT dots (00:01:20.450 --> 00:01:23.100)
  const convertedBody = normalized.replace(
    /(\d{1,2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );

  return `WEBVTT\n\n${convertedBody}\n`;
}

/**
 * Parses either `.vtt` or `.srt` subtitle text into sorted `ParsedSubtitleCue[]`.
 * Returns an empty array if the input is empty or invalid (never returns fake/hardcoded cues).
 */
export function parseSubtitleCues(rawSubtitleText: string): ParsedSubtitleCue[] {
  if (!rawSubtitleText || typeof rawSubtitleText !== 'string') return [];

  const vttText = convertSrtToVtt(rawSubtitleText);
  const lines = vttText.split('\n');
  const cues: ParsedSubtitleCue[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip WEBVTT header, NOTE blocks, STYLE blocks, or empty lines
    if (
      !line ||
      line.startsWith('WEBVTT') ||
      line.startsWith('NOTE') ||
      line.startsWith('STYLE')
    ) {
      i += 1;
      continue;
    }

    // Check if current line or next line contains `-->`
    let timingLine = '';
    let cueId = `cue-${cues.length + 1}`;

    if (line.includes('-->')) {
      timingLine = line;
      i += 1;
    } else if (i + 1 < lines.length && lines[i + 1].includes('-->')) {
      cueId = line;
      timingLine = lines[i + 1].trim();
      i += 2;
    } else {
      i += 1;
      continue;
    }

    const arrowParts = timingLine.split('-->');
    if (arrowParts.length < 2) continue;

    const startRaw = arrowParts[0].trim().split(/\s+/)[0];
    const endRaw = arrowParts[1].trim().split(/\s+/)[0];
    const startTime = parseSubtitleTimestamp(startRaw);
    const endTime = parseSubtitleTimestamp(endRaw);

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i += 1;
    }

    if (startTime !== null && endTime !== null && endTime > startTime) {
      const cleanText = sanitizeSubtitleCueText(textLines.join('\n'));
      if (cleanText) {
        cues.push({
          id: cueId,
          startTime,
          endTime,
          text: cleanText,
        });
      }
    }
  }

  return cues.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Finds the active subtitle cue at `currentTimeSeconds` accounting for user-configured `delayMs` (+/- ms).
 * If `delayMs > 0`, subtitles appear later (`effectiveTime = currentTimeSeconds - delayMs / 1000`).
 */
export function findActiveSubtitleCue(
  cues: ParsedSubtitleCue[],
  currentTimeSeconds: number,
  delayMs: number = 0
): ParsedSubtitleCue | null {
  if (!Array.isArray(cues) || cues.length === 0) return null;
  if (!Number.isFinite(currentTimeSeconds) || currentTimeSeconds < 0) return null;

  const effectiveTime = currentTimeSeconds - delayMs / 1000;
  if (effectiveTime < 0) return null;

  for (const cue of cues) {
    if (effectiveTime >= cue.startTime && effectiveTime <= cue.endTime) {
      return cue;
    }
  }
  return null;
}

/**
 * Detects whether a subtitle track or cue should render in Right-to-Left (RTL) layout
 * with Urdu Nastaliq / Arabic typography.
 */
export function isRtlSubtitleLanguage(langOrLabel?: string | null, cueText?: string | null): boolean {
  const normalized = (langOrLabel || '').trim().toLowerCase();
  if (
    normalized === 'ur' ||
    normalized.startsWith('ur-') ||
    normalized.includes('urdu') ||
    normalized.includes('اردو') ||
    normalized === 'ar' ||
    normalized.startsWith('ar-') ||
    normalized === 'fa' ||
    normalized.startsWith('fa-')
  ) {
    return true;
  }

  if (cueText && /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(cueText)) {
    return true;
  }

  return false;
}
