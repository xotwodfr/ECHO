import { useRef } from 'react';
import { useStore } from 'zustand';
import { type Source, setSource, sourceStore } from '../source.ts';
import { strings } from '../strings.ts';
import { useSlide } from '../ui/motion.ts';
import { switchTransition } from './page-transition.ts';

// The library switch (source.ts): Navidrome or Spotify, a Fluent segmented control in the top bar,
// built like the app's other segmented controls (Settings' choices, the album sort): a fieldset of
// pressed buttons. Only with both sources connected.

const ORDER: Source[] = ['navidrome', 'spotify'];

export function SourceSwitch() {
  const { source, available } = useStore(sourceStore);
  const ref = useRef<HTMLFieldSetElement>(null);
  useSlide(ref, '[aria-pressed="true"]', source);
  if (available.length < 2) return null;
  return (
    <fieldset className="source-switch" ref={ref}>
      <legend className="visually-hidden">{strings.source.label}</legend>
      {ORDER.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={s === source}
          onClick={() => switchTransition(() => setSource(s))}
        >
          {strings.source[s]}
        </button>
      ))}
    </fieldset>
  );
}
