// Motion (DESIGN_SYSTEM.md §11): the owner's spring, and how much moves.

/**
 * A damped spring (mass 1) sampled from rest to settled, for a CSS `linear()` curve: 49 points
 * by default, settled when its envelope is within 0.2%. tokens.css carries (230, 21).
 */
export function springPoints(stiffness: number, damping: number, samples = 48) {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const x = (t: number) =>
    1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  const T = Math.log(500) / (zeta * w0);
  const points = Array.from({ length: samples + 1 }, (_, i) =>
    i === samples ? 1 : Math.round(x((i / samples) * T) * 1e4) / 1e4,
  );
  return { points, durationMs: Math.round(T * 1000) };
}

export type MotionPref = 'system' | 'full' | 'reduced' | 'off';
export type MotionLevel = 'full' | 'less' | 'off';

/** Settings → Motion against the device's reduce-motion setting: Full wins over the device. */
export function motionLevel(pref: MotionPref, systemReduced: boolean): MotionLevel {
  if (pref === 'off') return 'off';
  if (pref === 'reduced' || (pref === 'system' && systemReduced)) return 'less';
  return 'full';
}
