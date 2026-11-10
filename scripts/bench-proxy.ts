// What ECHO's Navidrome proxy adds to a request (docs/deep-audit/PERFORMANCE.md): the same calls
// sent straight to the mock Subsonic server and through a real ECHO server on this machine, one
// after the other on a kept-alive connection. Loopback only: it measures ECHO's own work, not a
// network. node scripts/bench-proxy.ts [rounds]  (ports 18797/18798, data in a temp directory).
// Requests are 105 ms apart, inside a user's API budget of 10 a second (auth/ratelimit.ts).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { hashSecret } from '../src/server/auth/password.ts';
import { createSession } from '../src/server/auth/sessions.ts';
import { authParams } from '../src/server/navidrome/client.ts';
import { startMockSubsonic } from '../src/server/navidrome/mock.ts';

const rounds = Number(process.argv[2] ?? 100);
const port = 18797;
const dir = mkdtempSync(join(tmpdir(), 'echo-bench-'));
const keyFile = join(dir, 'master_key');
writeFileSync(keyFile, randomBytes(32).toString('base64'), { mode: 0o600 });

const mock = await startMockSubsonic({ port: port + 1 });
const server = spawn(process.execPath, ['src/server/index.ts'], {
  env: {
    ...process.env,
    ECHO_PORT: String(port),
    ECHO_LOG: 'warn',
    ECHO_MASTER_KEY_FILE: keyFile,
    ECHO_DATA_DIR: join(dir, 'data'),
    ECHO_NAVIDROME_URL: mock.url,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const echo = `http://127.0.0.1:${port}/api/v1`;

try {
  for (let i = 0; ; i++) {
    if (
      await fetch(`${echo}/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (i > 100) throw new Error('ECHO did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  const db = new Database(join(dir, 'data', 'echo.db'));
  const id = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES ('bench', ?, 'user', 0)",
      )
      .run(await hashSecret('bench bench bench bench')).lastInsertRowid,
  );
  const auth = { authorization: `Bearer ${createSession(db, id, 'device', Date.now())}` };
  db.close();
  const put = await fetch(`${echo}/me/connections/navidrome`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ada', password: 'navidrome-pass' }),
  });
  if (!put.ok) throw new Error(`connect: ${put.status} ${await put.text()}`);
  await fetch(`${mock.url}/__faults?bigLibrary=2000`);

  const direct = (method: string, q = '') =>
    `${mock.url}/rest/${method}?${new URLSearchParams(
      Object.entries(authParams({ username: 'ada', password: 'navidrome-pass' })),
    )}&v=1.16.1&c=bench&f=json&${q}`;

  /** Median and 95th percentile, in ms, of `rounds` requests read to their end (or first byte). */
  async function time(url: string, headers: Record<string, string>, firstByte = false) {
    const ms: number[] = [];
    let bytes = 0;
    for (let i = 0; i < rounds + 20; i++) {
      await new Promise((r) => setTimeout(r, 105));
      const t = performance.now();
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      if (firstByte) {
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        await reader.read();
        ms.push(performance.now() - t);
        for (;;) if ((await reader.read()).done) break;
      } else {
        bytes = (await res.arrayBuffer()).byteLength;
        ms.push(performance.now() - t);
      }
    }
    const s = ms.slice(20).sort((a, b) => a - b); // the first 20 warm the connection and the JIT
    const at = (p: number) => (s[Math.floor(s.length * p)] ?? 0).toFixed(2);
    return { p50: at(0.5), p95: at(0.95), bytes };
  }

  const cases: [string, string, string, Record<string, string>, boolean?][] = [
    ['ping', direct('ping'), `${echo}/navidrome/rest/ping`, {}],
    ['getAlbum', direct('getAlbum', 'id=al-1'), `${echo}/navidrome/rest/getAlbum?id=al-1`, {}],
    [
      'getAlbumList2 ×500',
      direct('getAlbumList2', 'type=alphabeticalByName&size=500'),
      `${echo}/navidrome/rest/getAlbumList2?type=alphabeticalByName&size=500`,
      {},
    ],
    [
      'cover',
      direct('getCoverArt', 'id=al-1&size=300'),
      `${echo}/navidrome/cover/al-1?size=300`,
      {},
    ],
    [
      'stream, first byte',
      direct('stream', 'id=al-1-t1&format=raw'),
      `${echo}/navidrome/stream/al-1-t1?format=raw`,
      { range: 'bytes=0-' },
      true,
    ],
  ];
  console.log(`${rounds} requests each, ms (median / p95)\n`);
  console.log('| Request | Direct to mock | Through ECHO | Body |');
  console.log('|---|---|---|---|');
  for (const [name, a, b, headers, firstByte] of cases) {
    const d = await time(a, headers, firstByte);
    const e = await time(b, { ...headers, ...auth }, firstByte);
    console.log(
      `| ${name} | ${d.p50} / ${d.p95} | ${e.p50} / ${e.p95} | ${firstByte ? '—' : `${e.bytes} B`} |`,
    );
  }
} finally {
  server.kill();
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
}
