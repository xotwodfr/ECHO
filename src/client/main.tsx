import { createRoot } from 'react-dom/client';
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

const controller = createPlaybackController({
  provider: fixtures?.createFixtureProvider() ?? null,
  notify: (message) => toastStore.getState().show(message),
});

const store = createViewStore(window);

// Deterministic mode (VISUALIZER_SPEC.md §10): `track` cues that track paused at the frame time.
const { route } = store.getState();
const frame = route.view === 'listen' ? route.frame : undefined;
if (frame?.fixture)
  console.error(
    `Deterministic mode: recorded Features fixtures are not implemented yet ("${frame.fixture}")`,
  );
if (frame?.track) {
  const id = frame.track;
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
