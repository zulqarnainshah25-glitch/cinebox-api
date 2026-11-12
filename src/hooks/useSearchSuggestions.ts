import { useEffect, useRef, useState } from 'react';
import { searchMovies } from '../services/tmdbService';
import { MovieItem, MovieLinkRecord } from '../types/movie';
import { sanitizeSearchQuery } from '../utils/streamResolver';
import { DEFAULT_DEBOUNCE_DELAY_MS, useDebounce } from './useDebounce';

export const MIN_SEARCH_SUGGESTION_CHARS = 2;
export const DEFAULT_MAX_SUGGESTIONS = 7; // Top 5–8 items
export const SEARCH_SUGGESTIONS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_SUGGESTIONS_CACHE_ENTRIES = 100;
const SUGGESTIONS_SESSION_STORAGE_KEY = 'cinebox_tmdb_search_suggestions_cache_v1';

export interface CachedSuggestionEntry {
  key: string;
  items: MovieItem[];
  cachedAt: number;
}

export interface SearchSuggestionsFetchResult {
  query: string;
  normalizedKey: string;
  suggestions: MovieItem[];
  fromCache: boolean;
  aborted: boolean;
  error: string | null;
}

const memorySuggestionsCache = new Map<string, CachedSuggestionEntry>();

/**
 * Normalizes a search query into a canonical cache key (lowercase, single spaces, sanitized).
 */
export function normalizeSuggestionQueryKey(rawQuery: string | null | undefined): string {
  const clean = sanitizeSearchQuery(rawQuery || '');
  return clean.replace(/\s+/g, ' ').trim().toLowerCase();
}

function loadSessionSuggestionsMap(): Record<string, CachedSuggestionEntry> {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(SUGGESTIONS_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return {};
}

function persistSessionSuggestionsEntry(entry: CachedSuggestionEntry): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const current = loadSessionSuggestionsMap();
      current[entry.key] = entry;
      const keys = Object.keys(current);
      if (keys.length > MAX_SUGGESTIONS_CACHE_ENTRIES) {
        delete current[keys[0]];
      }
      window.sessionStorage.setItem(SUGGESTIONS_SESSION_STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function clearSearchSuggestionsCache(): void {
  memorySuggestionsCache.clear();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(SUGGESTIONS_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getCachedSearchSuggestions(
  rawQuery: string,
  nowMs: number = Date.now(),
  ttlMs: number = SEARCH_SUGGESTIONS_CACHE_TTL_MS
): MovieItem[] | null {
  const key = normalizeSuggestionQueryKey(rawQuery);
  if (key.length < MIN_SEARCH_SUGGESTION_CHARS) return null;

  const mem = memorySuggestionsCache.get(key);
  if (mem && nowMs - mem.cachedAt < ttlMs) {
    // Refresh LRU order
    memorySuggestionsCache.delete(key);
    memorySuggestionsCache.set(key, mem);
    return mem.items;
  }

  const sessionMap = loadSessionSuggestionsMap();
  const sessionEntry = sessionMap[key];
  if (sessionEntry && nowMs - sessionEntry.cachedAt < ttlMs && Array.isArray(sessionEntry.items)) {
    memorySuggestionsCache.set(key, sessionEntry);
    return sessionEntry.items;
  }

  return null;
}

export function setCachedSearchSuggestions(
  rawQuery: string,
  items: MovieItem[],
  nowMs: number = Date.now()
): void {
  const key = normalizeSuggestionQueryKey(rawQuery);
  if (key.length < MIN_SEARCH_SUGGESTION_CHARS) return;

  if (memorySuggestionsCache.size >= MAX_SUGGESTIONS_CACHE_ENTRIES) {
    const oldestKey = memorySuggestionsCache.keys().next().value;
    if (oldestKey) {
      memorySuggestionsCache.delete(oldestKey);
    }
  }

  const entry: CachedSuggestionEntry = {
    key,
    items,
    cachedAt: nowMs,
  };
  memorySuggestionsCache.set(key, entry);
  persistSessionSuggestionsEntry(entry);
}

/**
 * Fix 6: Pure, unit-testable function that fetches top 5–8 movie/TV suggestions from TMDB:
 * - Requires at least 2 characters (`MIN_SEARCH_SUGGESTION_CHARS = 2`).
 * - Returns cached results immediately (`fromCache: true`) if the normalized query was already searched
 *   within the TTL window (`SEARCH_SUGGESTIONS_CACHE_TTL_MS = 10 min`), protecting TMDB API rate limits.
 * - Passes `AbortSignal` to cancel stale in-flight TMDB requests when the user types a new character.
 * - Handles errors gracefully without crashing.
 */
export async function fetchTopSearchSuggestions(
  rawQuery: string,
  options?: {
    signal?: AbortSignal;
    maxResults?: number;
    nowMs?: number;
    ttlMs?: number;
    forceRefresh?: boolean;
    linksMap?: Record<number, MovieLinkRecord>;
    customSearchFn?: (
      query: string,
      linksMap: Record<number, MovieLinkRecord>,
      opts?: { signal?: AbortSignal }
    ) => Promise<MovieItem[]>;
  }
): Promise<SearchSuggestionsFetchResult> {
  const normalizedKey = normalizeSuggestionQueryKey(rawQuery);
  const clampedMax = Math.min(8, Math.max(5, options?.maxResults ?? DEFAULT_MAX_SUGGESTIONS));
  const nowMs = options?.nowMs ?? Date.now();
  const ttlMs = options?.ttlMs ?? SEARCH_SUGGESTIONS_CACHE_TTL_MS;

  if (normalizedKey.length < MIN_SEARCH_SUGGESTION_CHARS) {
    return {
      query: rawQuery,
      normalizedKey,
      suggestions: [],
      fromCache: false,
      aborted: false,
      error: null,
    };
  }

  if (options?.signal?.aborted) {
    return {
      query: rawQuery,
      normalizedKey,
      suggestions: [],
      fromCache: false,
      aborted: true,
      error: null,
    };
  }

  // 1. Check Rate-Limit-Saving Query Cache first
  if (!options?.forceRefresh) {
    const cached = getCachedSearchSuggestions(normalizedKey, nowMs, ttlMs);
    if (cached) {
      return {
        query: rawQuery,
        normalizedKey,
        suggestions: cached.slice(0, clampedMax),
        fromCache: true,
        aborted: false,
        error: null,
      };
    }
  }

  // 2. Execute TMDB Search with AbortSignal
  const searchFn = options?.customSearchFn || searchMovies;
  try {
    const matches = await searchFn(normalizedKey, options?.linksMap || {}, {
      signal: options?.signal,
    });

    if (options?.signal?.aborted) {
      return {
        query: rawQuery,
        normalizedKey,
        suggestions: [],
        fromCache: false,
        aborted: true,
        error: null,
      };
    }

    const topItems = Array.isArray(matches) ? matches.slice(0, clampedMax) : [];
    setCachedSearchSuggestions(normalizedKey, topItems, nowMs);

    return {
      query: rawQuery,
      normalizedKey,
      suggestions: topItems,
      fromCache: false,
      aborted: false,
      error: null,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || options?.signal?.aborted) {
      return {
        query: rawQuery,
        normalizedKey,
        suggestions: [],
        fromCache: false,
        aborted: true,
        error: null,
      };
    }
    return {
      query: rawQuery,
      normalizedKey,
      suggestions: [],
      fromCache: false,
      aborted: false,
      error: err instanceof Error ? err.message : 'Unable to load search suggestions',
    };
  }
}

/**
 * Fix 6: React Hook (`useSearchSuggestions`)
 * - Debounces user input by 300ms (`useDebounce`).
 * - Immediately clears suggestions and aborts any in-flight request when input length < 2.
 * - Uses `AbortController` to cancel previous in-flight TMDB requests whenever the user types a new character.
 * - Serves repeated queries from the 10-minute LRU cache to protect TMDB API rate limits.
 */
export function useSearchSuggestions(
  query: string,
  options?: {
    debounceMs?: number;
    maxResults?: number;
    linksMap?: Record<number, MovieLinkRecord>;
  }
): {
  suggestions: MovieItem[];
  isLoadingSuggestions: boolean;
  suggestionsError: string | null;
  fromCache: boolean;
  clearSuggestions: () => void;
} {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_DELAY_MS;
  const maxResults = options?.maxResults ?? DEFAULT_MAX_SUGGESTIONS;
  const debouncedQuery = useDebounce(query, debounceMs);

  const [suggestions, setSuggestions] = useState<MovieItem[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState<boolean>(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  // Immediately clear suggestions and abort in-flight requests as soon as raw `query` drops below 2 chars
  useEffect(() => {
    const rawKey = normalizeSuggestionQueryKey(query);
    if (rawKey.length < MIN_SEARCH_SUGGESTION_CHARS) {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }
      setSuggestions([]);
      setIsLoadingSuggestions(false);
      setSuggestionsError(null);
      setFromCache(false);
      return;
    }

    // If rawQuery is already in cache, show cached suggestions immediately without waiting for debounce
    const immediateCached = getCachedSearchSuggestions(rawKey);
    if (immediateCached) {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }
      setSuggestions(immediateCached.slice(0, maxResults));
      setIsLoadingSuggestions(false);
      setSuggestionsError(null);
      setFromCache(true);
    }
  }, [query, maxResults]);

  // Trigger debounced TMDB fetch with AbortController
  useEffect(() => {
    const debouncedKey = normalizeSuggestionQueryKey(debouncedQuery);
    if (debouncedKey.length < MIN_SEARCH_SUGGESTION_CHARS) {
      return;
    }

    // Cancel any previous in-flight TMDB request before starting a new one
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    const cached = getCachedSearchSuggestions(debouncedKey);
    if (cached) {
      setSuggestions(cached.slice(0, maxResults));
      setIsLoadingSuggestions(false);
      setSuggestionsError(null);
      setFromCache(true);
      return () => {
        controller.abort();
      };
    }

    setIsLoadingSuggestions(true);
    setSuggestionsError(null);

    fetchTopSearchSuggestions(debouncedQuery, {
      signal: controller.signal,
      maxResults,
      linksMap: options?.linksMap,
    }).then((res) => {
      if (res.aborted || controller.signal.aborted) {
        return;
      }
      setSuggestions(res.suggestions);
      setFromCache(res.fromCache);
      setSuggestionsError(res.error);
      setIsLoadingSuggestions(false);
    });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, maxResults, options?.linksMap]);

  const clearSuggestions = () => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    setSuggestions([]);
    setIsLoadingSuggestions(false);
    setSuggestionsError(null);
  };

  return {
    suggestions,
    isLoadingSuggestions,
    suggestionsError,
    fromCache,
    clearSuggestions,
  };
}
