import { createRoot } from 'react-dom/client';
import type { FeatureSource } from '../shared/types.ts';
import './fonts.css';
import './tokens.css';
import './main.css';
import './ui/ui.css';
import './stage/stage.css';
import { createPlaybackController } from './playback/controller.ts';
import { Shell } from './shell/Shell.tsx';
import { toastStore } from './ui/logic.ts';
import { createViewStore } from './view.ts';

// Development builds play the fixture library through the FakeProvider (M2 task 3). The image
// (ECHO_SPECIMEN=0) has neither until the Navidrome provider arrives in M5.
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

const controller = createPlaybackController({
  provider: fixtures?.createFixtureProvider() ?? null,
  notify: (message) => toastStore.getState().show(message),
  features,
});

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
    <Shell store={store} controller={controller} library={fixtures?.fixtureLibrary ?? null} />,
  );
