import { useStore } from 'zustand';
import { type Source, setSource, sourceStore } from '../source.ts';
import { strings } from '../strings.ts';

// The library switch (source.ts): Navidrome or Spotify, a Fluent segmented control in the top bar,
// built like the app's other segmented controls (Settings' choices, the album sort): a fieldset of
// pressed buttons. Only with both sources connected.

const ORDER: Source[] = ['navidrome', 'spotify'];

export function SourceSwitch() {
  const { source, available } = useStore(sourceStore);
  if (available.length < 2) return null;
  return (
    <fieldset className="source-switch">
      <legend className="visually-hidden">{strings.source.label}</legend>
      {ORDER.map((s) => (
        <button key={s} type="button" aria-pressed={s === source} onClick={() => setSource(s)}>
          {strings.source[s]}
        </button>
      ))}
    </fieldset>
  );
}
