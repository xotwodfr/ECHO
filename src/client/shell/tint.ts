import { useEffect, useState } from 'react';

// A page header's colour (DESIGN_SYSTEM.md §3): the accent of the cover's palette, which the
// server already computes for the player. tokens.css turns it into Spotify's header tone
// (`[data-tint]`). Cached per album for the visit.

const cache = new Map<string, Promise<string | null>>();

function accentOf(albumKey: string, art?: string): Promise<string | null> {
  const key = `${albumKey}|${art ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    // Spotify albums name their cover: the server reads it into memory (gate G1, SP-03).
    const q = art && albumKey.startsWith('spotify:') ? `?art=${encodeURIComponent(art)}` : '';
    p = fetch(`/api/v1/palette/${encodeURIComponent(albumKey)}${q}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ accent?: string }>) : null))
      .then((x) => x?.accent ?? null)
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

export function useTint(albumKey: string | null, art?: string): string | null {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    setTint(null);
    if (!albumKey) return;
    let current = true;
    void accentOf(albumKey, art).then((x) => current && setTint(x));
    return () => {
      current = false;
    };
  }, [albumKey, art]);
  return tint;
}
