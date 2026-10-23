import type { FeatureSource, Features } from '../../shared/types.ts';

// Recorded Features for deterministic mode (VISUALIZER_SPEC.md §10): `?fixture=<name>` loads
// `features/<name>.json`, `{ "fps": n, "frames": [Features, …] }`, one entry per frame at `fps`.
// Development builds only, like the rest of `fixtures/`.

export interface FeatureTrack {
  fps: number;
  frames: Features[];
}

const LEVELS = ['sub', 'bass', 'mid', 'high', 'onset', 'intensity', 'bassImpulse'] as const;

const isFeatures = (f: unknown): f is Features => {
  if (typeof f !== 'object' || f === null) return false;
  const o = f as Record<string, unknown>;
  return (
    typeof o.available === 'boolean' &&
    LEVELS.every((k) => typeof o[k] === 'number' && (o[k] as number) >= 0 && (o[k] as number) <= 1)
  );
};

/** Validates a fixture file; returns why it is invalid instead of throwing. */
export function parseFeatureTrack(json: unknown): FeatureTrack | string {
  if (typeof json !== 'object' || json === null) return 'not an object';
  const { fps, frames } = json as Record<string, unknown>;
  if (typeof fps !== 'number' || !(fps > 0)) return '"fps" must be a positive number';
  if (!Array.isArray(frames) || frames.length === 0) return '"frames" must be a non-empty array';
  const bad = frames.findIndex((f) => !isFeatures(f));
  if (bad !== -1) return `frame ${bad} is not a Features object with levels in 0..1`;
  return { fps, frames };
}

/** The frame at song time `tMs`; before 0 the first, after the end the last frame holds. */
export const featureSource = (track: FeatureTrack): FeatureSource => ({
  sample: (tMs) => {
    const i = Math.floor((tMs * track.fps) / 1000);
    return track.frames[Math.min(Math.max(0, i), track.frames.length - 1)] as Features;
  },
});

const files = import.meta.glob<{ default: unknown }>('./features/*.json');

/** Loads `features/<name>.json`, or explains on the console why it cannot (and returns null). */
export async function loadFeatureFixture(name: string): Promise<FeatureSource | null> {
  const load = files[`./features/${name}.json`];
  if (!load) {
    console.error(`Deterministic mode: no Features fixture "${name}"`);
    return null;
  }
  const track = parseFeatureTrack((await load()).default);
  if (typeof track === 'string') {
    console.error(`Deterministic mode: Features fixture "${name}" is invalid: ${track}`);
    return null;
  }
  return featureSource(track);
}
