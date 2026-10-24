import { createRoot } from 'react-dom/client';
import type { FeatureSource } from '../shared/types.ts';
import './fonts.css';
import './tokens.css';
import './main.css';
import './ui/ui.css';
import './stage/stage.css';
import { createNavidromeLibrary } from './library-navidrome.ts';
import { startPalette } from './palette/live.ts';
import { createPlaybackController } from './playback/controller.ts';
import { NavidromeProvider } from './playback/navidrome.ts';
import { startQueueSync } from './playback/queueSync.ts';
import { loadSession } from './session.ts';
import { Shell } from './shell/Shell.tsx';
import { lyricPrefs, lyricsStore } from './stage/status.ts';
import { toastStore } from './ui/logic.ts';
import { createViewStore } from './view.ts';

// A signed-in user with a Navidrome connection plays their own library (M5). Without one,
// development builds play the fixture library (M2 task 3); the image (ECHO_SPECIMEN=0) has no
// fixtures and sends visitors to sign in.
const fixtures = __ECHO_FIXTURES__ ? await import('./fixtures/playback.ts') : null;

const store = createViewStore(window);

// Deterministic mode (VISUALIZER_SPEC.md §10): `fixture` supplies Features (a lyric fixture's name
// supplies its paired track), and `track` (ECHO's own param) cues that track paused at the frame
// time.
const { route } = store.getState();
const frame = route.view === 'listen' ? route.frame : undefined;
let features: FeatureSource | undefined;
if (frame?.fixture) {
  features = (await fixtures?.loadFeatureFixture(frame.fixture)) ?? undefined;
  if (!fixtures) console.error('Deterministic mode: this build has no Features fixtures');
}

// Development builds let e2e flip the Settings → Lyrics preferences that have no UI yet (M8).
if (__ECHO_FIXTURES__) Object.assign(window, { __echoLyricPrefs: lyricPrefs });

// Deterministic frames never ask the server who is signed in: the same frame on every load.
const session = frame ? null : await loadSession();
if (!fixtures && session && route.view !== 'login' && route.view !== 'setup') {
  if (session.status === 'setup') store.getState().navigate({ view: 'setup' }, { replace: true });
  if (session.status === 'anonymous')
    store.getState().navigate({ view: 'login' }, { replace: true });
}
const ownLibrary = session?.status === 'signedIn' && session.navidrome;
const library = ownLibrary ? createNavidromeLibrary() : (fixtures?.fixtureLibrary ?? null);

const controller = createPlaybackController({
  provider: ownLibrary ? new NavidromeProvider() : (fixtures?.createFixtureProvider() ?? null),
  notify: (message) => toastStore.getState().show(message),
  features,
});

// Lyrics: the guide tracks sing their fixture documents (LYRICS_EXPERIENCE.md §16) until the
// lyrics loader arrives (M6).
const showLyrics = (track: ReturnType<typeof controller.player.getState>['track']) =>
  lyricsStore.setState({
    trackKey: track?.key ?? null,
    doc: fixtures?.fixtureLyrics(track) ?? null,
  });
controller.player.subscribe((s, prev) => s.track !== prev.track && showLyrics(s.track));

// OS media keys and lock-screen controls (PLAYBACK_ARCHITECTURE.md §5; PLAY-07): the provider sets
// play, pause and seek; next and previous go through the queue.
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('nexttrack', () => controller.next());
  navigator.mediaSession.setActionHandler('previoustrack', () => controller.previous());
}

// The queue follows a signed-in user across sessions and devices (M5).
if (ownLibrary) void startQueueSync(controller, (m) => toastStore.getState().show(m));

// The album's palette on :root (VISUALIZER_SPEC.md §6.4); deterministic frames show it at once.
startPalette(controller, { instant: !!frame, ...(frame?.palette && { albumKey: frame.palette }) });

// `fixture=<lyric fixture>` also cues its guide track (LYRICS_EXPERIENCE.md §16).
const cueId = frame?.track ?? (frame?.fixture ? fixtures?.guideTrackId(frame.fixture) : undefined);
if (frame && cueId) {
  const id = cueId;
  const album = fixtures?.fixtureLibrary.albums.find((a) => a.tracks.some((t) => t.id === id));
  if (album) {
    const index = album.tracks.findIndex((t) => t.id === id);
    const context = { kind: 'album', id: album.id, title: album.title } as const;
    controller.cue(album.tracks, index, context, frame.ms);
  } else console.error(`Deterministic mode: no track "${id}"`);
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(<Shell store={store} controller={controller} library={library} />);
