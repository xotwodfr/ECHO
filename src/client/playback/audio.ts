// The <audio> → Web Audio path (VISUALIZER_SPEC.md §3.1): element → ReplayGain → analyser tap →
// user volume → output. One AudioContext, created on the first user gesture (autoplay policy).
// The fixture provider uses it from M3; the Navidrome provider reuses it in M5.

export function createAudioPath(el: HTMLAudioElement) {
  let ctx: AudioContext | null = null;
  let volumeNode: GainNode | null = null;
  let volume = 1;
  const perceptual = (v: number) => v ** 3;

  return {
    el,
    /** Builds the graph on first use and resumes a suspended context; call from a user gesture. */
    start() {
      if (!ctx) {
        ctx = new AudioContext({ latencyHint: 'playback' });
        const replayGain = ctx.createGain(); // gain 1 until track metadata carries ReplayGain (M5)
        const tap = ctx.createAnalyser();
        tap.fftSize = 2048;
        tap.smoothingTimeConstant = 0;
        tap.minDecibels = -100;
        tap.maxDecibels = -10;
        volumeNode = ctx.createGain();
        volumeNode.gain.value = perceptual(volume);
        el.volume = 1; // volume is applied in the graph, after the tap
        ctx.createMediaElementSource(el).connect(replayGain);
        replayGain.connect(tap).connect(volumeNode).connect(ctx.destination);
      }
      if (ctx.state === 'suspended') void ctx.resume();
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
