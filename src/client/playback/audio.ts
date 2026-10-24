// The <audio> → Web Audio path (VISUALIZER_SPEC.md §3.1): each element → its own ReplayGain → one
// shared analyser tap → user volume → output. One AudioContext, created on the first user gesture
// (autoplay policy). The Navidrome provider attaches two elements (A/B, for gapless hand-overs);
// the fixture provider one.

/** ReplayGain in dB as a linear gain, limited so the peak stays under full scale; unknown: unity. */
export function replayGainLinear(db: number | undefined, peak: number | undefined) {
  const g = db === undefined ? 1 : 10 ** (db / 20);
  return peak && peak > 0 ? Math.min(g, 1 / peak) : g;
}

export function createAudioGraph() {
  let ctx: AudioContext | null = null;
  let volumeNode: GainNode | null = null;
  let tapNode: AnalyserNode | null = null;
  let volume = 1;
  const perceptual = (v: number) => v ** 3;
  const voices: { el: HTMLAudioElement; gain: number; node: GainNode | null }[] = [];

  const wire = (v: (typeof voices)[number]) => {
    if (!ctx || !tapNode || v.node) return;
    v.node = ctx.createGain();
    v.node.gain.value = v.gain;
    v.el.volume = 1; // volume is applied in the graph, after the tap
    ctx.createMediaElementSource(v.el).connect(v.node);
    v.node.connect(tapNode);
  };

  return {
    /** Adds an element; its ReplayGain is set per track. */
    attach(el: HTMLAudioElement) {
      const v = { el, gain: 1, node: null as GainNode | null };
      voices.push(v);
      wire(v);
      return {
        el,
        setReplayGain(db: number | undefined, peak: number | undefined) {
          v.gain = replayGainLinear(db, peak);
          if (v.node) v.node.gain.value = v.gain;
        },
      };
    },
    /** Builds the graph on first use and resumes a suspended context; call from a user gesture. */
    start() {
      if (!ctx) {
        ctx = new AudioContext({ latencyHint: 'playback' });
        tapNode = ctx.createAnalyser();
        tapNode.fftSize = 2048;
        tapNode.smoothingTimeConstant = 0;
        tapNode.minDecibels = -100;
        tapNode.maxDecibels = -10;
        volumeNode = ctx.createGain();
        volumeNode.gain.value = perceptual(volume);
        tapNode.connect(volumeNode).connect(ctx.destination);
        for (const v of voices) wire(v);
      }
      if (ctx.state === 'suspended') void ctx.resume();
    },
    setVolume(v: number) {
      volume = v;
      if (volumeNode) volumeNode.gain.value = perceptual(v);
      else for (const x of voices) x.el.volume = perceptual(v);
    },
    /** Output latency in ms (`outputLatency`, else `baseLatency`); 0 before the graph exists. */
    latencyMs() {
      return ctx ? 1000 * (ctx.outputLatency || ctx.baseLatency || 0) : 0;
    },
    /** The analyser tap (VISUALIZER_SPEC.md §3.1), once the graph exists. */
    analyser() {
      return tapNode;
    },
  };
}

/** One element on its own graph (the fixture provider). */
export function createAudioPath(el: HTMLAudioElement) {
  const graph = createAudioGraph();
  const voice = graph.attach(el);
  return { ...graph, el, setReplayGain: voice.setReplayGain };
}

export type AudioPath = ReturnType<typeof createAudioPath>;
