import { useEffect, useState } from 'react';

export const DEFAULT_DEBOUNCE_DELAY_MS = 300;

/**
 * Fix 6: Generic debounce hook (`useDebounce`).
 * Delays updating the returned value until `delayMs` (default 300ms) have elapsed
 * since the last change to `value`.
 */
export function useDebounce<T>(value: T, delayMs: number = DEFAULT_DEBOUNCE_DELAY_MS): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const safeDelay = Math.max(0, Number.isFinite(delayMs) ? delayMs : DEFAULT_DEBOUNCE_DELAY_MS);
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, safeDelay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
