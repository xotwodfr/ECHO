import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { LyricsDoc } from '../../shared/types.ts';
import { pinLyricsSource } from '../lyrics/loader.ts';
import { usePlayback, usePlayer, useTicker } from '../playback/context.tsx';
import { prefsStore } from '../prefs.ts';
import { lyricHost, lyricOffset, lyricsStore, STAGE_VIEWS, stageView } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { buttonClass } from '../ui/controls.tsx';
import { Artwork } from '../ui/media.tsx';
import { Menu } from '../ui/overlays.tsx';
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
  // Nothing playing: one sentence and one action (DESIGN_SYSTEM.md §10; M9 critique).
  if (!track)
    return (
      <div className="stage-idle">
        <p>{strings.stage.idle}</p>
        <Link className={buttonClass('secondary')} to={{ view: 'library', tab: 'albums' }}>
          {strings.stage.idleAction}
        </Link>
      </div>
    );
  if (view === 'visual') return null; // Visual: the environment only
  if (view === 'cover') return <CoverView />;
  return <LyricsView />;
}

/**
 * Lyrics (LYRICS_EXPERIENCE.md): the floating field, the static sheet when untimed (§9.3), and the
 * wait for them (§9.5): nothing for 600 ms (most answers come from the cache in < 50 ms), then the
 * interlude dots, with "Finding lyrics…" from 1.5 s; Cover mode with "No lyrics found" when there
 * are none (§9.4). A late answer replaces Cover mode as soon as it arrives.
 */
function LyricsView() {
  const { doc, state, since, tried } = useStore(lyricsStore);
  const showUnsynced = useStore(prefsStore, (p) => p.lyrics.showUnsynced);
  const motionOff = useStore(prefsStore, (p) => p.visuals.motion === 'off');
  useTicker(state === 'waiting', 100);
  if (state === 'missing') return <MissingLyrics tried={tried} />;
  if (state === 'waiting') {
    const waited = performance.now() - since;
    if (waited < WAIT_DOTS_MS) return null;
    return (
      <div className="stage-waiting" role="status">
        <span className="stage-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {waited >= WAIT_TEXT_MS && (
          <span className="stage-waiting-text">{strings.stage.finding}</span>
        )}
      </div>
    );
  }
  if (!doc)
    return (
      <div className="stage-lyrics" aria-hidden="true">
        <p>{strings.stage.lyricsPlaceholder}</p>
      </div>
    );
  // Settings → Lyrics → "Show unsynced lyrics" off: an untimed sheet gives way to the cover.
  if (doc.sync === 'none' && !showUnsynced) return <CoverView />;
  // Motion = Off (§10, WCAG 2.2.2): a static sheet, the active line marked, nothing moving.
  if (motionOff && doc.sync !== 'none')
    return (
      <>
        <StillLyrics doc={doc} />
        <div className="stage-attribution">
          <AttributionText attribution={doc.attribution} />
          <SourceMenu />
        </div>
      </>
    );
  return (
    <>
      {doc.sync === 'none' ? <LyricSheet doc={doc} /> : <LyricHost />}
      {doc.sync !== 'none' && (
        <div className="stage-attribution">
          <AttributionText attribution={doc.attribution} />
          <SourceMenu />
        </div>
      )}
    </>
  );
}

const WAIT_DOTS_MS = 600;
const WAIT_TEXT_MS = 1500;
const SOURCE_NAMES: Record<string, string> = {
  navidrome: 'Your library',
  spicy: 'Spicy Lyrics',
  lrclib: 'LRCLIB',
  'navidrome-plain': 'Your library (plain text)',
};

/** The attribution line (LYRICS_INTEGRATION.md §8), its named parts linked; it cannot be hidden. */
function AttributionText({ attribution }: { attribution: LyricsDoc['attribution'] }) {
  const parts: ReactNode[] = [];
  let rest = attribution.text;
  for (const [i, l] of (attribution.links ?? []).entries()) {
    const at = rest.indexOf(l.label);
    if (at < 0 || !/^https?:\/\//i.test(l.href)) continue; // a non-web link stays plain text
    parts.push(rest.slice(0, at));
    parts.push(
      <a key={i} href={l.href} target="_blank" rel="noopener noreferrer">
        {l.label}
      </a>,
    );
    rest = rest.slice(at + l.label.length);
  }
  parts.push(rest);
  return <span>{parts}</span>;
}

/** ⓘ: which source this is, and "always use this source for this track" (§4.1 pins). */
function SourceMenu() {
  const { doc, pinnedSource } = useStore(lyricsStore);
  if (!doc || doc.source === 'fixture') return null;
  const mark = (on: boolean, label: string) => (on ? `${label} ✓` : label);
  return (
    <Menu
      label={strings.stage.sourceMenu}
      icon="info"
      items={[
        {
          label: mark(!pinnedSource, strings.stage.sourceAuto),
          onSelect: () => void pinLyricsSource(null),
        },
        ...Object.entries(SOURCE_NAMES).map(([id, name]) => ({
          label: mark(pinnedSource === id, strings.stage.sourceUse(name)),
          onSelect: () => void pinLyricsSource(id),
        })),
      ]}
    />
  );
}

/** §9.4: Cover mode, "No lyrics found" beneath, and the sources tried behind ⓘ. */
function MissingLyrics({ tried }: { tried: { source: string; outcome: string }[] }) {
  const id = useId();
  const list = tried.length
    ? tried
        .map(
          (t) =>
            `${SOURCE_NAMES[t.source] ?? t.source}: ${strings.stage.outcomes[t.outcome as keyof typeof strings.stage.outcomes] ?? t.outcome}`,
        )
        .join(' · ')
    : strings.stage.noAnswer;
  return (
    <>
      <CoverView />
      <p className="stage-missing">
        {strings.stage.noLyrics}
        <span className="stage-missing-info" title={list} aria-describedby={id}>
          ⓘ
        </span>
        <span className="visually-hidden" id={id}>
          {strings.stage.tried} {list}
        </span>
      </p>
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
/**
 * Motion = Off: the sheet with the line at the song's time marked (`aria-current`, `--lit`), which
 * jumps into view on each hand-over, instantly.
 */
function StillLyrics({ doc }: { doc: LyricsDoc }) {
  const c = usePlayback();
  const playing = usePlayer((p) => p.status === 'playing');
  useTicker(playing, 250);
  const t = c.songTime() - lyricOffset();
  const lines = doc.lines.filter((l) => l.text.trim());
  let active = -1;
  for (const [i, l] of lines.entries()) if (l.start <= t) active = i;
  // biome-ignore lint/correctness/useExhaustiveDependencies: jump on each hand-over (`active`)
  useEffect(() => {
    document
      .querySelector('.ly-sheet-line[aria-current="true"]')
      ?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [active]);
  return <LyricSheet doc={doc} active={active} />;
}

function LyricSheet({ doc, active }: { doc: LyricsDoc; active?: number }) {
  const lines = doc.lines.filter((l) => l.text.trim());
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: §11, the sheet is focusable for scrolling
    <div className="ly-sheet" role="document" tabIndex={0} aria-label={strings.stage.sheetLabel}>
      <div className="ly-sheet-col">
        {lines.map((l, i) => (
          <p
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are static and may repeat
            key={i}
            className="ly-sheet-line"
            dir="auto"
            aria-current={i === active ? 'true' : undefined}
          >
            {l.text}
            {i === 0 && doc.sync === 'none' && (
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
