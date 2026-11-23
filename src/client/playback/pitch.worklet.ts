import { PitchShifter } from './pitch.ts';

// Karaoke's key change as an AudioWorklet (pitch.ts). Loaded only when the key first moves off 0,
// and in a voice's chain only while it is off 0, so ordinary playback never passes through it.
// Messages: `{ ratio }` sets the frequency ratio, `{ reset: true }` forgets the audio so far.

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class EchoPitch extends AudioWorkletProcessor {
  private readonly shifter = new PitchShifter(sampleRate, 2);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ ratio?: number; reset?: boolean }>) => {
      if (e.data.reset) this.shifter.reset();
      if (e.data.ratio !== undefined) this.shifter.setRatio(e.data.ratio);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    if (out?.[0]) this.shifter.process(inputs[0] ?? [], out, out[0].length);
    return true;
  }
}

registerProcessor('echo-pitch', EchoPitch);
