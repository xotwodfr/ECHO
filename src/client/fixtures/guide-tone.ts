import type { LyricsDoc } from '../../shared/types.ts';

// Guide-tone audio for a fixture LyricsDoc (IMPLEMENTATION_PLAN.md M3 task 1): a soft sine "voice"
// per word (backing vocals an octave up and quieter), a short click at every line start, and for
// line-timed docs one quiet tone per line. Listening to it against the field shows whether the
// sweep and hand-overs land on time. Untimed docs are silent.

const SCALE = [220, 247.5, 275, 330, 366.7, 440]; // A minor pentatonic-ish, Hz
const ATTACK_S = 0.015;
const RELEASE_S = 0.04;

export function guideTone(doc: LyricsDoc, rate = 16_000): Float32Array {
  const lastEnd = Math.max(0, ...doc.lines.map((l) => l.end ?? l.start));
  const out = new Float32Array(Math.ceil(((doc.durationMs ?? lastEnd + 2000) * rate) / 1000));

  const tone = (startMs: number, endMs: number, hz: number, amp: number) => {
    const a = Math.floor((startMs * rate) / 1000);
    const n = Math.max(1, Math.floor(((endMs - startMs) * rate) / 1000));
    const fade = Math.min(n / 2, ATTACK_S * rate);
    const release = Math.min(n / 2, RELEASE_S * rate);
    for (let i = 0; i < n && a + i < out.length; i++) {
      const env = Math.min(1, i / fade, (n - i) / release);
      out[a + i] = (out[a + i] as number) + amp * env * Math.sin((2 * Math.PI * hz * i) / rate);
    }
  };
  const click = (atMs: number) => {
    const a = Math.floor((atMs * rate) / 1000);
    for (let i = 0; i < 0.006 * rate && a + i < out.length; i++)
      out[a + i] =
        (out[a + i] as number) +
        0.35 * Math.exp(-i / (0.0012 * rate)) * Math.sin((2 * Math.PI * 1800 * i) / rate);
  };

  if (doc.sync === 'none') return out;
  doc.lines.forEach((line, i) => {
    if (!line.text.trim()) return;
    click(line.start);
    const hz = (j: number) => SCALE[(i * 2 + j) % SCALE.length] as number;
    if (line.words)
      line.words.forEach((w, j) => {
        tone(w.start, w.end, hz(j), 0.18);
      });
    else tone(line.start, line.end ?? line.start + 1500, hz(0), 0.1);
    for (const b of line.background ?? [])
      b.words?.forEach((w, j) => {
        tone(w.start, w.end, 2 * hz(j + 3), 0.07);
      });
  });
  return out;
}

/** 16-bit PCM mono WAV. */
export function wav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true);
  });
  return bytes;
}
