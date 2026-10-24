// The <audio> → Web Audio path (VISUALIZER_SPEC.md §3.1): element → ReplayGain → analyser tap →
// user volume → output. One AudioContext, created on the first user gesture (autoplay policy).
// The fixture provider and the Navidrome provider use it.

/** ReplayGain in dB as a linear gain, limited so the peak stays under full scale; unknown: unity. */
export function replayGainLinear(db: number | undefined, peak: number | undefined) {
  const g = db === undefined ? 1 : 10 ** (db / 20);
  return peak && peak > 0 ? Math.min(g, 1 / peak) : g;
}

export function createAudioPath(el: HTMLAudioElement) {
  let ctx: AudioContext | null = null;
  let volumeNode: GainNode | null = null;
  let gainNode: GainNode | null = null;
  let tapNode: AnalyserNode | null = null;
  let volume = 1;
  let replayGain = 1;
  const perceptual = (v: number) => v ** 3;

  return {
    el,
    /** Builds the graph on first use and resumes a suspended context; call from a user gesture. */
    start() {
      if (!ctx) {
        ctx = new AudioContext({ latencyHint: 'playback' });
        gainNode = ctx.createGain();
        gainNode.gain.value = replayGain;
        const tap = ctx.createAnalyser();
        tapNode = tap;
        tap.fftSize = 2048;
        tap.smoothingTimeConstant = 0;
        tap.minDecibels = -100;
        tap.maxDecibels = -10;
        volumeNode = ctx.createGain();
        volumeNode.gain.value = perceptual(volume);
        el.volume = 1; // volume is applied in the graph, after the tap
        ctx.createMediaElementSource(el).connect(gainNode);
        gainNode.connect(tap).connect(volumeNode).connect(ctx.destination);
      }
      if (ctx.state === 'suspended') void ctx.resume();
    },
    /**
     * ReplayGain (PLAYBACK_ARCHITECTURE.md §5.6) in dB, limited so the peak stays under full scale.
     * Unknown gain plays at unity.
     */
    setReplayGain(db: number | undefined, peak: number | undefined) {
      replayGain = replayGainLinear(db, peak);
      if (gainNode) gainNode.gain.value = replayGain;
    },
    /** The analyser tap (VISUALIZER_SPEC.md §3.1), once the graph exists. */
    analyser() {
      return tapNode;
    },
    setVolume(v: number) {
      volume = v;
      if (volumeNode) volumeNode.gain.value = perceptual(v);
      else el.volume = perceptual(v);
    },
    /** Output latency in ms (`outputLatency`, else `baseLatency`); 0 before the graph exists. */
    latencyMs() {
      return ctx ? 1000 * (ctx.outputLatency || ctx.baseLatency || 0) : 0;
    },
  };
}

export type AudioPath = ReturnType<typeof createAudioPath>;
