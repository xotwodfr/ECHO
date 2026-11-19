import { fadeCurve } from './crossfade.ts';
import { bandFrequency, bandType, EQ_BANDS, EQ_Q, eqPreampDb } from './eq.ts';
import { pitchDelay } from './pitch.ts';
import pitchWorklet from './pitch.worklet.ts?worker&url';

// The <audio> → Web Audio path (VISUALIZER_SPEC.md §3.1): each element → karaoke mix → (key change,
// only while it is off 0) → its own ReplayGain → its crossfade gain → one shared analyser tap →
// (equalizer, only while it is on) → user volume → output. One AudioContext, created on the first
// user gesture (autoplay policy). The Navidrome provider attaches two elements (A/B, for gapless
// hand-overs and crossfades); the fixture provider one.

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
  /** Karaoke's key change as a frequency ratio; 1 leaves the pitch shifter out. */
  let pitchRatio = 1;
  /** The AudioWorklet module (pitch.worklet.ts), fetched the first time it's needed. */
  let pitchModule: 'none' | 'loading' | 'ready' | 'failed' = 'none';
  let eq: { on: boolean; gains: number[] } = { on: false, gains: [] };
  /** Whether the tap feeds the equalizer (else straight into the volume). */
  let eqRouted = false;
  let eqNodes: { pre: GainNode; bands: BiquadFilterNode[] } | null = null;
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
    /** The crossfade's gain, after the ReplayGain. */
    fade: GainNode | null;
    karaoke: boolean;
    mix: Mix | null;
    merge: ChannelMergerNode | null;
    pitch: AudioWorkletNode | null;
  }[] = [];

  /** Puts the pitch shifter in each voice's chain, or takes it out, as the key asks. */
  const routePitch = (v: (typeof voices)[number]) => {
    if (!ctx || !v.merge || !v.node) return;
    const want = pitchRatio !== 1;
    if (want && !v.pitch) {
      if (pitchModule === 'none') {
        // Lazy: the worklet's code is fetched the first time the key moves off 0.
        pitchModule = 'loading';
        ctx.audioWorklet
          .addModule(pitchWorklet)
          .then(() => {
            pitchModule = 'ready';
            for (const x of voices) routePitch(x);
          })
          .catch(() => {
            pitchModule = 'failed';
          });
      }
      if (pitchModule !== 'ready') return;
      v.pitch = new AudioWorkletNode(ctx, 'echo-pitch', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      v.merge.disconnect();
      v.merge.connect(v.pitch).connect(v.node);
    }
    if (!v.pitch) return;
    if (want) v.pitch.port.postMessage({ ratio: pitchRatio });
    else {
      v.merge.disconnect();
      v.merge.connect(v.node);
      v.pitch.disconnect();
      v.pitch = null; // a new one starts clean next time
    }
  };

  /** The equalizer between the tap and the volume, or straight through while it is off. */
  const routeEq = () => {
    if (!ctx || !tapNode || !volumeNode) return;
    const on = eq.on && eq.gains.some((g) => g !== 0);
    if (on && !eqNodes) {
      const c = ctx;
      const pre = c.createGain();
      const bands = EQ_BANDS.map((_, i) => {
        const b = c.createBiquadFilter();
        b.type = bandType(i);
        b.frequency.value = bandFrequency(i);
        b.Q.value = EQ_Q;
        b.gain.value = 0;
        return b;
      });
      let last: AudioNode = pre;
      for (const b of bands) last = last.connect(b);
      last.connect(volumeNode);
      eqNodes = { pre, bands };
    }
    if (on && eqNodes) {
      // A short glide, so moving a band never clicks.
      const t = ctx.currentTime;
      eqNodes.pre.gain.setTargetAtTime(10 ** (eqPreampDb(eq.gains) / 20), t, 0.02);
      eqNodes.bands.forEach((b, i) => {
        b.gain.setTargetAtTime(eq.gains[i] ?? 0, t, 0.02);
      });
    }
    if (on === eqRouted) return;
    eqRouted = on;
    tapNode.disconnect();
    tapNode.connect(on && eqNodes ? eqNodes.pre : volumeNode);
  };

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
    v.fade = ctx.createGain();
    v.node.connect(v.fade).connect(tapNode);
    v.mix = { centre, rears, front, back };
    v.merge = merge;
    routePitch(v);
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
        fade: null as GainNode | null,
        karaoke: false,
        mix: null as Mix | null,
        merge: null as ChannelMergerNode | null,
        pitch: null as AudioWorkletNode | null,
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
        /**
         * Crossfade: this voice's gain runs from where it is to silence (`out`) or from silence to
         * full (`in`) over `seconds`, on an equal-power curve.
         */
        fade(direction: 'in' | 'out', seconds: number) {
          if (!ctx || !v.fade) return;
          const g = v.fade.gain;
          g.cancelScheduledValues(0);
          g.setValueCurveAtTime(fadeCurve(direction), ctx.currentTime, Math.max(0.05, seconds));
        },
        /** Back to full at once (a fade finished or was cut short). */
        unfade() {
          if (!v.fade || !ctx) return;
          v.fade.gain.cancelScheduledValues(0);
          v.fade.gain.setValueAtTime(1, ctx.currentTime);
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
    /** Karaoke's key change as a frequency ratio (1: none, and the shifter leaves the chain). */
    setPitchRatio(ratio: number) {
      pitchRatio = ratio;
      for (const v of voices) routePitch(v);
    },
    /** The equalizer: on or off, and its ten bands' gains in dB (eq.ts). */
    setEq(on: boolean, gains: number[]) {
      eq = { on, gains };
      routeEq();
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
        routeEq();
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
      if (!ctx) return 0;
      // The key change delays the music by its grain and search (pitch.ts), so the lyrics wait too.
      const shift = voices.some((v) => v.pitch) ? pitchDelay(ctx.sampleRate) / ctx.sampleRate : 0;
      return 1000 * (ctx.outputLatency || ctx.baseLatency || 0) + 1000 * shift;
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
