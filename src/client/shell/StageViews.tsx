import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { LyricsDoc } from '../../shared/types.ts';
import { isInstrumental, pinLyricsSource } from '../lyrics/loader.ts';
import { usePlayback, usePlayer, useQueue, useTicker } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { prefsStore } from '../prefs.ts';
import { sessionStore } from '../session.ts';
import { lyricHost, lyricOffset, lyricsStore, stageView } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { buttonClass } from '../ui/controls.tsx';
import { glass } from '../ui/glass.ts';
import { Icon } from '../ui/icons.tsx';
import { formatTime } from '../ui/logic.ts';
import { Artwork } from '../ui/media.tsx';
import { Menu } from '../ui/overlays.tsx';
import { Link, useView } from './link.tsx';
import { fixTrackStore } from './SpotifyViews.tsx';

// What sits on the lyrics view above the room (the cover, blurred and drifting): the top chrome,
// the song on the left and the lyric column on the right. The lyric field itself is drawn by the
// Stage engine into the host element below.

/** F, and the player's full screen button over the lyrics view. */
export const toggleFullscreen = () =>
  void (
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen()
  ).catch(() => undefined);

/**
 * The lyrics view's top: Spotify's chevron that closes it, and where the music is playing from.
 * Closing goes back to the page it was opened from (Home when it was opened directly).
 */
export function StageChrome() {
  const navigate = useView((s) => s.navigate);
  const source = useQueue((q) => q.contextSource);
  const close = () =>
    history.length > 1 && document.referrer !== '' ? history.back() : navigate({ view: 'home' });
  return (
    <div className="stage-chrome">
      <button
        type="button"
        className="stage-btn glass"
        ref={glass}
        aria-label={strings.nowPlaying.close}
        title={strings.nowPlaying.close}
        onClick={close}
      >
        <Icon name="chevronDown" />
      </button>
      {source && (
        <p className="stage-from">
          <span>
            {strings.nowPlaying.playingFrom} {strings.nowPlaying.from[source.kind] ?? ''}
          </span>
          <b>{source.title}</b>
        </p>
      )}
      <span className="stage-chrome-end" />
    </div>
  );
}

/**
 * The lyrics view after the owner's reference: the cover, the progress, the title and the artist
 * on the left, the lyric column on the right; with no lyrics, the cover and title alone, centred.
 * On phones the cover shrinks to a header above the lyrics.
 */
export function StageContent() {
  const view = useStore(stageView, (s) => s.view);
  const track = usePlayer((p) => p.track);
  const { doc, state, tried } = useStore(lyricsStore);
  const showUnsynced = useStore(prefsStore, (p) => p.lyrics.showUnsynced);
  // Nothing playing: one sentence and one action (DESIGN_SYSTEM.md §10; M9 critique).
  if (!track)
    return (
      <div className="stage-idle">
        <p>{strings.stage.idle}</p>
        <Link className={buttonClass('secondary')} to={{ view: 'home' }}>
          {strings.stage.idleAction}
        </Link>
      </div>
    );
  const missing = state === 'missing';
  // No lyrics, or the user's Cover view, or an untimed sheet with "Show unsynced lyrics" off:
  // the cover and title alone, with "No lyrics found" under them unless it is an instrumental.
  const cover =
    view !== 'lyrics' || missing || (state === 'ready' && doc?.sync === 'none' && !showUnsynced);
  return (
    <div className="np-view" data-mode={cover ? 'cover' : 'lyrics'}>
      <NowPlayingSide />
      {!cover && (
        <div className="ly-area">
          <LyricsView />
        </div>
      )}
      {missing && view === 'lyrics' && !isInstrumental(track.title, tried) && (
        <MissingLyrics tried={tried} />
      )}
    </div>
  );
}

/** The left side: the cover, a slim progress bar with its times, the title and the artist. */
function NowPlayingSide() {
  const t = usePlayer((p) => p.track);
  const s = usePlayer((p) => p);
  useTicker(s.status === 'playing', 250);
  if (!t) return null;
  const at = positionNow(s, performance.now());
  const value = t.durationMs ? Math.min(1, at / t.durationMs) : 0;
  return (
    <div className="np-side">
      <Artwork size="cover" src={t.artwork[0]?.url} title={t.album.title} />
      <div className="np-progress" aria-hidden="true">
        <span className="num">{formatTime(at)}</span>
        <span className="np-progress-track" style={{ '--value': value } as CSSProperties}>
          <span />
        </span>
        <span className="num">{formatTime(t.durationMs)}</span>
      </div>
      <div className="np-titles">
        <p className="np-title">{t.title}</p>
        <p className="np-artist">{t.artists.map((a) => a.name).join(', ')}</p>
      </div>
    </div>
  );
}

/**
 * Lyrics (LYRICS_EXPERIENCE.md): the floating field, the static sheet when untimed (§9.3), and the
 * wait for them (§9.5): nothing for 600 ms (most answers come from the cache in < 50 ms), then the
 * interlude dots, with "Finding lyrics…" from 1.5 s; Cover mode with "No lyrics found" when there
 * are none (§9.4). A late answer replaces Cover mode as soon as it arrives.
 */
function LyricsView() {
  const { doc, state, since } = useStore(lyricsStore);
  const motionOff = useStore(prefsStore, (p) => p.visuals.motion === 'off');
  useTicker(state === 'waiting', 100);
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
const SOURCE_NAMES = strings.prefs.sourceNames;

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
  const { doc, pinnedSource, trackKey } = useStore(lyricsStore);
  const session = useStore(sessionStore);
  const navigate = useView((s) => s.navigate);
  if (!doc || doc.source === 'fixture') return null;
  // An admin can correct a Navidrome track's Spotify match, which picks its Spicy Lyrics.
  const navidromeId =
    session.status === 'signedIn' && session.role === 'admin' && trackKey?.startsWith('navidrome:')
      ? trackKey.slice('navidrome:'.length)
      : null;
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
        ...(navidromeId
          ? [
              {
                label: strings.stage.fixMatch,
                onSelect: () => {
                  fixTrackStore.setState({ id: navidromeId });
                  navigate({ view: 'settings', section: 'admin' });
                },
              },
            ]
          : []),
      ]}
    />
  );
}

/** §9.4: Cover mode, "No lyrics found" beneath, and the sources tried behind ⓘ. */
function MissingLyrics({ tried }: { tried: { source: string; outcome: string }[] }) {
  const list = tried.length
    ? tried
        .map(
          (t) =>
            `${SOURCE_NAMES[t.source] ?? t.source}: ${strings.stage.outcomes[t.outcome as keyof typeof strings.stage.outcomes] ?? t.outcome}`,
        )
        .join(' · ')
    : strings.stage.noAnswer;
  // ⓘ is a disclosure (a native <details>): keyboard and touch reach it, and a screen reader hears
  // "Sources tried, collapsed" rather than the glyph's name.
  return (
    <div className="stage-missing">
      {strings.stage.noLyrics}
      <details className="stage-missing-info">
        <summary aria-label={strings.stage.tried} title={list}>
          ⓘ
        </summary>
        <p>
          {strings.stage.tried} {list}
        </p>
      </details>
    </div>
  );
}

/** The engine mounts the lyric field into this element (TECHNICAL_ARCHITECTURE.md §4.1). */
function LyricHost() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lyricHost.setState({ el: ref.current });
    return () => lyricHost.setState({ el: null });
  }, []);
  return <div className="ly-host" ref={ref} />;
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
  return (
    <LyricSheet
      doc={doc}
      active={active}
      onLine={(ms) => {
        c.seek(ms + lyricOffset());
        c.resume();
      }}
    />
  );
}

function LyricSheet({
  doc,
  active,
  onLine,
}: {
  doc: LyricsDoc;
  active?: number;
  /** Timed lines are buttons that play from their start. */
  onLine?: (startMs: number) => void;
}) {
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
            {onLine && doc.sync !== 'none' ? (
              <button type="button" className="ly-sheet-jump" onClick={() => onLine(l.start)}>
                {l.text}
              </button>
            ) : (
              l.text
            )}
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
