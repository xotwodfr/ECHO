import { FakeProvider } from '../playback/fake.ts';

// Everything the fixture build adds, behind one dynamic import so the image leaves it out.
export { loadFeatureFixture } from './features.ts';
export { fixtureLibrary } from './library.ts';
export const createFixtureProvider = () => new FakeProvider();
