import { createRoot } from 'react-dom/client';
import './fonts.css';
import './tokens.css';
import './main.css';
import './ui/ui.css';
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

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <Shell
      store={createViewStore(window)}
      controller={controller}
      library={fixtures?.fixtureLibrary ?? null}
    />,
  );
