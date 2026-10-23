import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { LyricsDoc } from '../../shared/types.ts';
import { usePlayer } from '../playback/context.tsx';
import { lyricHost, lyricsStore, STAGE_VIEWS, stageView } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { buttonClass } from '../ui/controls.tsx';
import { Artwork } from '../ui/media.tsx';
import { Link } from './link.tsx';

// What sits on the Stage above the room (PRODUCT_SPEC.md §6.1): the top chrome, and the view mode's
// content. The lyric field itself is drawn by the Stage engine into the host element below.

/** Top chrome: back to the Library, and the view mode switch (V cycles it from the keyboard). */
export function StageChrome() {
  const view = useStore(stageView, (s) => s.view);
  return (
    <div className="stage-chrome">
      <Link className={buttonClass('tertiary')} to={{ view: 'library', tab: 'albums' }}>
        {strings.nav.library}
      </Link>
      <fieldset className="view-switch">
        <legend className="visually-hidden">{strings.stage.viewLabel}</legend>
        {STAGE_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => stageView.getState().set(v)}
          >
            {strings.stage.views[v]}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

export function StageContent() {
  const view = useStore(stageView, (s) => s.view);
  const track = usePlayer((p) => p.track);
  if (view === 'visual' || !track) return null; // Visual: the environment only
  if (view === 'cover') return <CoverView />;
  return <LyricsView />;
}

/** Lyrics (LYRICS_EXPERIENCE.md): the floating field, the static sheet when untimed (§9.3). */
function LyricsView() {
  const doc = useStore(lyricsStore, (s) => s.doc);
  if (!doc)
    return (
      <div className="stage-lyrics" aria-hidden="true">
        <p>{strings.stage.lyricsPlaceholder}</p>
      </div>
    );
  return (
    <>
      {doc.sync === 'none' ? <LyricSheet doc={doc} /> : <LyricHost />}
      {doc.sync !== 'none' && <p className="stage-attribution">{doc.attribution.text}</p>}
    </>
  );
}

/** The engine mounts the lyric field into this element (TECHNICAL_ARCHITECTURE.md §4.1). */
function LyricHost() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lyricHost.setState({ el: ref.current });
    return () => lyricHost.setState({ el: null });
  }, []);
  return <div ref={ref} />;
}

/**
 * Untimed lyrics (§9.3): a static sheet in a centred column, scrollable by wheel, touch and, once
 * focused, the arrow and page keys. A note under the first line says it is not time-synced.
 */
function LyricSheet({ doc }: { doc: LyricsDoc }) {
  const lines = doc.lines.filter((l) => l.text.trim());
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: §11, the sheet is focusable for scrolling
    <div className="ly-sheet" role="document" tabIndex={0} aria-label={strings.stage.sheetLabel}>
      <div className="ly-sheet-col">
        {lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are static and may repeat
          <p key={i} className="ly-sheet-line" dir="auto">
            {l.text}
            {i === 0 && (
              <span className="ly-sheet-note">
                {strings.stage.unsynced} · {doc.attribution.text}
              </span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

/** The Cover crossfade's exit (§8, --dur-art-out); a fallback if no animationend arrives. */
export const COVER_OUT_MS = 420;

interface Shown {
  id: string;
  src?: string;
  title: string;
  leaving: boolean;
}

/**
 * Cover mode (DESIGN_SYSTEM.md §8): the artwork up to min(60vh, 640px), never cropped or moved.
 * On a cover change, opacity only: the old one out over 420 ms, the new one in over 640 ms,
 * overlapping by 200 ms.
 */
function CoverView() {
  const track = usePlayer((p) => p.track);
  const src = track?.artwork[0]?.url;
  const title = track?.album.title ?? '';
  // One entry per distinct cover: tracks of the same album do not crossfade.
  const id = src ?? `title:${title}`;
  const [shown, setShown] = useState<Shown[]>(() => [{ id, src, title, leaving: false }]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setShown((prev) => {
      if (prev.some((c) => c.id === id && !c.leaving)) return prev;
      return [...prev.map((c) => ({ ...c, leaving: true })), { id, src, title, leaving: false }];
    });
    const t = setTimeout(() => setShown((prev) => prev.filter((c) => !c.leaving)), COVER_OUT_MS);
    timers.current.push(t);
  }, [id, src, title]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <div className="stage-cover">
      {shown.map((c, i) => (
        <div
          key={c.id}
          className="stage-cover-item"
          data-leaving={c.leaving || undefined}
          // The first cover shown appears at once; only changes crossfade.
          data-enter={i > 0 || undefined}
          onAnimationEnd={() =>
            c.leaving && setShown((prev) => prev.filter((x) => x.id !== c.id || !x.leaving))
          }
        >
          <Artwork size="cover" src={c.src} title={c.title} />
        </div>
      ))}
    </div>
  );
}
