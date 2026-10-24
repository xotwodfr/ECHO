// The mock Subsonic server (src/server/navidrome/mock.ts) on a fixed port, for E2E and for trying
// the Navidrome path by hand: node scripts/mock-subsonic.ts [port] (user ada / navidrome-pass).
import { startMockSubsonic } from '../src/server/navidrome/mock.ts';

const port = Number(process.argv[2] ?? process.env.MOCK_SUBSONIC_PORT ?? 18788);
const mock = await startMockSubsonic({ port });
console.log(`mock Subsonic on ${mock.url} (user ${mock.username})`);
