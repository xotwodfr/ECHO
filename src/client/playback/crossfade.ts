import type { Track } from '../../shared/types.ts';

// Crossfade (Settings → Playback, PLAYBACK_ARCHITECTURE.md §5.6): the song ending fades out while
// the next one fades in over it. Not between two songs of the same album, which often run into
// each other (live albums, DJ mixes, concept albums): those keep their gapless hand-over.

/** The longest crossfade Settings offers, in seconds. */
export const MAX_CROSSFADE_S = 12;

/** Whether `cur` → `next` should crossfade at all (the length is Settings'). */
export function crossfadeBetween(cur: Track | null | undefined, next: Track | null | undefined) {
  if (!cur || !next || cur.key === next.key) return false;
  const a = cur.album.id ?? cur.album.key;
  const b = next.album.id ?? next.album.key;
  return !(a && a === b);
}

/**
 * Equal-power gain curves, so the sum stays as loud through the fade: `in` rises as sin, `out`
 * falls as cos, in²+out² = 1 all along. `points` samples from start to end inclusive.
 */
export function fadeCurve(direction: 'in' | 'out', points = 64) {
  const c = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    c[i] = direction === 'in' ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2);
  }
  return c;
}
