// The <audio> → Web Audio path (VISUALIZER_SPEC.md §3.1): each element → its own ReplayGain → one
// shared analyser tap → user volume → output. One AudioContext, created on the first user gesture
// (autoplay policy). The Navidrome provider attaches two elements (A/B, for gapless hand-overs);
// the fixture provider one.

/** ReplayGain in dB as a linear gain, limited so the peak stays under full scale; unknown: unity. */
export function replayGainLinear(db: number | undefined, peak: number | undefined) {
  const g = db === undefined ? 1 : 10 ** (db / 20);
  return peak && peak > 0 ? Math.min(g, 1 / peak) : g;
}

/**
 * Karaoke mode's mix (docs/KARAOKE.md): ECHO's karaoke files are 5.1, the instrumental on front
 * left/right and the vocals on rear left/right, so the vocals level can change at once. Each voice
 * is up-mixed to six channels by speaker layout (stereo stays front left/right, mono lands in the
 * centre), split and back to stereo: front + centre + rear × level. For a karaoke file the centre is
 * silent and the rears are the vocals at the slider's level; for anything else the centre (a mono
 * file) is kept whole and the rears (a rare 5.1 song) folded in as an ordinary downmix.
 */
export function vocalGains(karaoke: boolean, level: number) {
  return karaoke
    ? { centre: 0, rear: Math.min(1, Math.max(0, level)) }
    : { centre: 1, rear: Math.SQRT1_2 };
}

/** A karaoke file's rear channels hold nothing at all while its fronts play: the browser downmixed 5.1. */
export function looksDownmixed(front: Float32Array, rear: Float32Array) {
  let f = 0;
  let r = 0;
  for (const x of front) f = Math.max(f, Math.abs(x));
  for (const x of rear) r = Math.max(r, Math.abs(x));
  return f > 1e-3 && r === 0;
}

export function createAudioGraph() {
  let ctx: AudioContext | null = null;
  let volumeNode: GainNode | null = null;
  let tapNode: AnalyserNode | null = null;
  let volume = 1;
  let vocalLevel = 0;
  const perceptual = (v: number) => v ** 3;
  type Mix = {
    centre: GainNode;
    rears: [GainNode, GainNode];
    front: AnalyserNode;
    back: AnalyserNode;
  };
  const voices: {
    el: HTMLAudioElement;
    gain: number;
    node: GainNode | null;
    karaoke: boolean;
    mix: Mix | null;
  }[] = [];

  const setMix = (v: (typeof voices)[number]) => {
    if (!v.mix || !ctx) return;
    const g = vocalGains(v.karaoke, vocalLevel);
    // A short glide, so the slider never clicks.
    v.mix.centre.gain.setTargetAtTime(g.centre, ctx.currentTime, 0.015);
    for (const r of v.mix.rears) r.gain.setTargetAtTime(g.rear, ctx.currentTime, 0.015);
  };

  const wire = (v: (typeof voices)[number]) => {
    if (!ctx || !tapNode || v.node) return;
    v.node = ctx.createGain();
    v.node.gain.value = v.gain;
    v.el.volume = 1; // volume is applied in the graph, after the tap
    // FL FR C LFE BL BR → stereo: the fronts straight through, the centre to both sides, each
    // rear to its side at the vocals level. The LFE is left out (silent in a karaoke file).
    // A splitter only splits ("discrete"): this gain up-mixes first, by speaker layout, to six
    // channels (stereo onto the fronts, mono into the centre, 5.1 as it is).
    const upmix = ctx.createGain();
    upmix.channelCount = 6;
    upmix.channelCountMode = 'explicit';
    upmix.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(6);
    upmix.connect(split);
    const merge = ctx.createChannelMerger(2);
    const centre = ctx.createGain();
    const rears: [GainNode, GainNode] = [ctx.createGain(), ctx.createGain()];
    split.connect(merge, 0, 0);
    split.connect(merge, 1, 1);
    split.connect(centre, 2);
    centre.connect(merge, 0, 0);
    centre.connect(merge, 0, 1);
    split.connect(rears[0], 4);
    split.connect(rears[1], 5);
    rears[0].connect(merge, 0, 0);
    rears[1].connect(merge, 0, 1);
    // Watches for a browser that downmixed the 5.1 itself (its rears arrive empty); pulled
    // through a silent gain so every browser keeps them running.
    const front = ctx.createAnalyser();
    const back = ctx.createAnalyser();
    split.connect(front, 0);
    split.connect(back, 4);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    front.connect(sink);
    back.connect(sink);
    sink.connect(ctx.destination);
    ctx.createMediaElementSource(v.el).connect(upmix);
    merge.connect(v.node);
    v.node.connect(tapNode);
    v.mix = { centre, rears, front, back };
    const g = vocalGains(v.karaoke, vocalLevel);
    centre.gain.value = g.centre;
    for (const r of rears) r.gain.value = g.rear;
  };

  return {
    /** Adds an element; its ReplayGain is set per track. */
    attach(el: HTMLAudioElement) {
      const v = {
        el,
        gain: 1,
        node: null as GainNode | null,
        karaoke: false,
        mix: null as Mix | null,
      };
      voices.push(v);
      wire(v);
      return {
        el,
        setReplayGain(db: number | undefined, peak: number | undefined) {
          v.gain = replayGainLinear(db, peak);
          if (v.node) v.node.gain.value = v.gain;
        },
        /** Whether this voice plays a karaoke file (its rears are the vocals). */
        setKaraoke(on: boolean) {
          v.karaoke = on;
          setMix(v);
        },
        /** For a karaoke voice: true when its rears are silent while its fronts play. */
        downmixed() {
          if (!v.mix || !v.karaoke) return false;
          const f = new Float32Array(v.mix.front.fftSize);
          const r = new Float32Array(v.mix.back.fftSize);
          v.mix.front.getFloatTimeDomainData(f);
          v.mix.back.getFloatTimeDomainData(r);
          return looksDownmixed(f, r);
        },
      };
    },
    /** Karaoke mode's vocals level, 0..1, for every voice playing a karaoke file. */
    setVocalLevel(level: number) {
      vocalLevel = level;
      for (const v of voices) setMix(v);
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
