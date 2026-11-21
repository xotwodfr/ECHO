import { prefsStore } from '../prefs.ts';
import { eqGains } from './eq.ts';
import { KEY_RANGE, semitoneRatio } from './pitch.ts';

// This device's equalizer and Karaoke's key change, from Settings to the audio graph. The key is
// kept while Karaoke is off, and applies only while it's on (the owner's choice: a singer's key
// stays theirs between sessions, and ordinary listening is never pitch-shifted).

/** The key in effect, in semitones: 0 unless Karaoke is on. */
export function effectiveKey(p: { karaoke: boolean; karaokeKey: number }) {
  if (!p.karaoke) return 0;
  return Math.max(-KEY_RANGE, Math.min(KEY_RANGE, Math.round(p.karaokeKey || 0)));
}

export function startEffects(target: {
  setEq(on: boolean, gains: number[]): void;
  setPitchRatio(ratio: number): void;
}) {
  const apply = () => {
    const p = prefsStore.getState().playback;
    target.setEq(p.eq, eqGains(p.eqPreset, p.eqGains));
    target.setPitchRatio(semitoneRatio(effectiveKey(p)));
  };
  apply();
  prefsStore.subscribe((s, prev) => {
    const a = s.playback;
    const b = prev.playback;
    if (
      a.eq !== b.eq ||
      a.eqPreset !== b.eqPreset ||
      a.eqGains !== b.eqGains ||
      a.karaoke !== b.karaoke ||
      a.karaokeKey !== b.karaokeKey
    )
      apply();
  });
}
