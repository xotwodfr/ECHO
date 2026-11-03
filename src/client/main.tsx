import { createRoot } from 'react-dom/client';
import type { FeatureSource } from '../shared/types.ts';
import './fonts.css';
import './tokens.css';
import './main.css';
import './ui/ui.css';
import './stage/stage.css';
import { createNavidromeLibrary } from './library-navidrome.ts';
import { startLyricsLoader } from './lyrics/loader.ts';
import { startPalette } from './palette/live.ts';
import { createPlaybackController } from './playback/controller.ts';
import { NavidromeProvider } from './playback/navidrome.ts';
import { startQueueSync } from './playback/queueSync.ts';
import { loadPrefs, prefsStore, setPref } from './prefs.ts';
import { loadSession } from './session.ts';
import { startCollections } from './shell/collections.ts';
import { startHistory } from './shell/mixes.ts';
import { pageTransition } from './shell/page-transition.ts';
import { startAutoplay } from './shell/radio.ts';
import { Shell } from './shell/Shell.tsx';
import { loadWanted } from './shell/wanted.ts';
import { lyricPrefs, lyricsStore } from './stage/status.ts';
import { toastStore } from './ui/logic.ts';
import { motionLevel } from './ui/motion.ts';
import { AppErrorBoundary, ServerUnreachable } from './ui/states.tsx';
import { createViewStore } from './view.ts';
import { savedMode } from './youtube/mode.ts';

// A signed-in user with a Navidrome connection plays their own library (M5). Without one,
// development builds play the fixture library (M2 task 3); the image (ECHO_DEV_PAGES=0) has no
// fixtures and sends visitors to sign in.
const fixtures = __ECHO_FIXTURES__ ? await import('./fixtures/playback.ts') : null;

/** Settings → Motion, or the system's choice under "system": less motion is reduced or off. */
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const level = () => motionLevel(prefsStore.getState().visuals.motion, reducedQuery.matches);
// The shell's CSS motion reads it as <html data-motion> (tokens.css zeroes the motion tokens).
const markMotion = () => (document.documentElement.dataset.motion = level());
markMotion();
prefsStore.subscribe((s, prev) => s.visuals !== prev.visuals && markMotion());
reducedQuery.addEventListener('change', markMotion);

const store = createViewStore(window, pageTransition);

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

// Lyric preferences that live outside the engine: the announce opt-in and the size (a CSS
// variable on :root; the field re-measures on resize).
const applyLyricPrefs = () => {
  const l = prefsStore.getState().lyrics;
  lyricPrefs.setState({ announce: l.announceLines });
  if (document.documentElement.style.getPropertyValue('--ly-scale') !== String(l.sizeScale)) {
    document.documentElement.style.setProperty('--ly-scale', String(l.sizeScale));
    window.dispatchEvent(new Event('resize'));
  }
};
prefsStore.subscribe((s, prev) => s.lyrics !== prev.lyrics && applyLyricPrefs());

// Development builds let e2e flip the Settings → Lyrics preferences that have no UI yet (M8).
if (__ECHO_FIXTURES__) Object.assign(window, { __echoLyricPrefs: lyricPrefs });

// Deterministic frames never ask the server who is signed in: the same frame on every load.
const session = frame ? null : await loadSession();
if (!fixtures && session && !['login', 'setup', 'invite'].includes(route.view)) {
  if (session.status === 'setup') store.getState().navigate({ view: 'setup' }, { replace: true });
  if (session.status === 'anonymous')
    store.getState().navigate({ view: 'login' }, { replace: true });
}
// "Require TOTP for all" and no TOTP yet: Account is the only thing the server allows.
if (session?.status === 'signedIn' && session.mustEnrolTotp)
  store.getState().navigate({ view: 'settings', section: 'account' }, { replace: true });
// Production, and the server did not answer at start (a restart behind Caddy): say so and recover on
// its own, not an empty shell with no library (ON-UI-1). Development builds play the fixtures.
const unreachable = !fixtures && session?.status === 'offline';
const signedIn = session?.status === 'signedIn';
const ownLibrary = signedIn && session.navidrome;
// YouTube Music mode (src/client/youtube): this device's last world, while the admin switch is on.
const youtube = signedIn && !!session.youtube?.enabled;
if (youtube && route.view === 'home' && savedMode() === 'youtube')
  store.getState().navigate({ view: 'yt', page: { kind: 'home' } }, { replace: true });
if (!youtube && route.view === 'yt' && session?.status !== 'offline')
  store.getState().navigate({ view: 'home' }, { replace: true });
// Preferences (Settings → Preferences): the server's for a signed-in user, this device's own.
if (session?.status === 'signedIn') await loadPrefs();
const prefs = () => prefsStore.getState();

const library = ownLibrary ? createNavidromeLibrary() : (fixtures?.fixtureLibrary ?? null);

const controller = createPlaybackController({
  // Signed in: ECHO's <audio> provider, which plays Navidrome and YouTube songs alike (Navidrome
  // only once connected; YouTube Music needs no connection to search and play).
  provider: signedIn
    ? new NavidromeProvider(undefined, {
        transcodeOffset: true,
        get scrobble() {
          return prefs().playback.scrobble;
        },
        get quality() {
          return prefs().playback.quality;
        },
      })
    : (fixtures?.createFixtureProvider() ?? null),
  replayGain: () => prefs().playback.replayGain,
  notify: (message) => toastStore.getState().show(message),
  features,
});

// The volume is this device's, kept between visits (PLAYBACK_ARCHITECTURE.md §3).
controller.setVolume(prefs().playback.volume);
controller.player.subscribe(
  (s, prev) => s.volume !== prev.volume && void setPref('playback', 'volume', s.volume),
);

// Lyrics: the guide tracks sing their fixture documents (LYRICS_EXPERIENCE.md §16) until the
// lyrics loader arrives (M6).
// A signed-in user with Navidrome gets them from the server (M6).
if (signedIn) startLyricsLoader(controller, (m) => toastStore.getState().show(m));
else {
  const showLyrics = (track: ReturnType<typeof controller.player.getState>['track']) => {
    const doc = fixtures?.fixtureLyrics(track) ?? null;
    lyricsStore.setState({ trackKey: track?.key ?? null, doc, state: doc ? 'ready' : 'idle' });
  };
  controller.player.subscribe((s, prev) => s.track !== prev.track && showLyrics(s.track));
}

// OS media keys and lock-screen controls (PLAYBACK_ARCHITECTURE.md §5; PLAY-07): the provider sets
// play, pause and seek; next and previous go through the queue.
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('nexttrack', () => controller.next());
  navigator.mediaSession.setActionHandler('previoustrack', () => controller.previous());
}

// The queue follows a signed-in user across sessions and devices (M5).
if (signedIn) void startQueueSync(controller, (m) => toastStore.getState().show(m));

// Playlists and hearts for every page (one fetch, refreshed after changes), and Autoplay: similar
// songs when the music runs out.
startCollections(library);
if (session?.status === 'signedIn') void loadWanted();
startAutoplay(controller, library, () => prefs().playback.autoplay);
startHistory(controller, !!ownLibrary);

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
  createRoot(root).render(
    <AppErrorBoundary>
      {unreachable ? (
        <ServerUnreachable />
      ) : (
        <Shell store={store} controller={controller} library={library} />
      )}
    </AppErrorBoundary>,
  );
