import { useCallback, useEffect, useRef, useState } from 'react';

// Back is instant (Spotify's): a page seen before shows its last answer at once and refreshes
// behind; only a first visit shows its skeleton. One answer per key, for the session.

const MAX = 60;
const seen = new Map<string, unknown>();

function remember(key: string, value: unknown) {
  seen.delete(key);
  seen.set(key, value);
  // ponytail: oldest first out at 60 pages; an LRU by size if pages ever get heavy.
  if (seen.size > MAX) seen.delete(seen.keys().next().value as string);
}

/** `[value | 'loading' | 'error', reload]`; a failed refresh keeps what was shown. */
export function useFresh<T>(key: string, fetch: () => Promise<T>) {
  const get = useRef(fetch);
  get.current = fetch;
  const [value, setValue] = useState<T | 'loading' | 'error'>(() =>
    seen.has(key) ? (seen.get(key) as T) : 'loading',
  );
  const load = useCallback(() => {
    setValue(seen.has(key) ? (seen.get(key) as T) : 'loading');
    let live = true;
    get.current().then(
      (x) => {
        remember(key, x);
        if (live) setValue(x);
      },
      () => live && !seen.has(key) && setValue('error'),
    );
    return () => {
      live = false;
    };
  }, [key]);
  useEffect(load, [load]);
  return [value, load] as const;
}
