import type { FeatureSource } from '../../shared/types.ts';

/** No audio to analyse: the "unavailable" features of VISUALIZER_SPEC.md §3.4. */
export const SILENT_FEATURES: FeatureSource = {
  sample: () => ({
    available: false,
    sub: 0,
    bass: 0,
    mid: 0,
    high: 0,
    onset: 0,
    intensity: 0.6,
    bassImpulse: 0,
  }),
};
