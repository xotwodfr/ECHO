// Hardware verification for the OptiPlex (docs/IMPLEMENTATION_PLAN.md M1 task 5, DEP-04 hardware part).
// Run inside the production image on the target box:
//   docker run --rm echo:dev node scripts/verify-hardware.ts
// Exits non-zero if a required native module fails to load or work.
import { argon2Sync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const warnings: string[] = [];
process.on('warning', (w) => warnings.push(`${w.name}: ${w.message}`));
let failed = false;
const report = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${detail}`);
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const time = (fn: () => void, runs: number) =>
  median(
    Array.from({ length: runs }, () => {
      const t = performance.now();
      fn();
      return performance.now() - t;
    }),
  );

const cpu = readFileSync('/proc/cpuinfo', 'utf8');
const flags = new Set(/^flags\s*:\s*(.*)$/m.exec(cpu)?.[1]?.split(' '));
console.log(`node ${process.version} ${process.arch}`);
console.log(`cpu  ${/^model name\s*:\s*(.*)$/m.exec(cpu)?.[1]}`);
console.log(
  `     ${['sse4_2', 'popcnt', 'avx', 'avx2', 'fma', 'bmi2'].map((f) => `${f}:${flags.has(f) ? 'y' : 'n'}`).join(' ')}`,
);

// better-sqlite3 (required; docs/TECHNICAL_ARCHITECTURE.md §3)
try {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('create table t (id integer primary key, v text)');
  const insert = db.prepare('insert into t (v) values (?)');
  db.transaction(() => {
    for (let i = 0; i < 10_000; i++) insert.run(`row ${i}`);
  })();
  const { n } = db.prepare('select count(*) n from t').get() as { n: number };
  const { v } = db.prepare('select sqlite_version() v').get() as { v: string };
  report('better-sqlite3', n === 10_000, `SQLite ${v}, 10k inserts in a transaction`);
} catch (err) {
  report('better-sqlite3', false, String(err));
}

// node:sqlite (candidate built-in; adopted only once stable)
try {
  const { DatabaseSync } = await import('node:sqlite');
  const { v } = new DatabaseSync(':memory:').prepare('select sqlite_version() v').get() as {
    v: string;
  };
  console.log(`info  node:sqlite            loads, SQLite ${v}`);
} catch (err) {
  console.log(`info  node:sqlite            unavailable: ${err}`);
}

// sharp (required): decode a 1000×1000 JPEG and resize to 128×128 raw (VISUALIZER_SPEC §6)
try {
  const { default: sharp } = await import('sharp');
  const noise = randomBytes(1000 * 1000 * 3);
  const jpeg = await sharp(noise, { raw: { width: 1000, height: 1000, channels: 3 } })
    .jpeg()
    .toBuffer();
  const runs: number[] = [];
  let px = 0;
  for (let i = 0; i < 11; i++) {
    const t = performance.now();
    const { info } = await sharp(jpeg)
      .resize(128, 128, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    runs.push(performance.now() - t);
    px = info.width * info.height;
  }
  report(
    'sharp',
    px === 128 * 128,
    `libvips ${sharp.versions.vips}, 1000² JPEG → 128² raw median ${median(runs).toFixed(1)} ms`,
  );
} catch (err) {
  report('sharp', false, String(err));
}

// Argon2id at the starting parameters (docs/SETTINGS_AND_SECURITY.md §4.3), target 150–250 ms.
const argonParams = (passes: number) => ({
  message: 'correct horse battery staple',
  nonce: randomBytes(16),
  parallelism: 1,
  tagLength: 32,
  memory: 65_536, // KiB = 64 MiB
  passes,
});
try {
  for (const t of [2, 3, 4]) {
    const ms = time(() => argon2Sync('argon2id', argonParams(t)), 5);
    const inBand = ms >= 150 && ms <= 250;
    console.log(
      `${t === 3 ? (inBand ? 'PASS' : 'WARN') : 'info'}  node:crypto argon2id   m=64MiB t=${t} p=1 median ${ms.toFixed(0)} ms${inBand ? ' (in 150–250 band)' : ''}`,
    );
  }
} catch (err) {
  report('node:crypto argon2', false, String(err));
}

// @node-rs/argon2 (documented fallback; only present if installed)
try {
  const { hashRaw } = await import('@node-rs/argon2' as string);
  const p = argonParams(3);
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await hashRaw(p.message, {
      salt: p.nonce,
      memoryCost: p.memory,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
      algorithm: 2,
    });
    runs.push(performance.now() - t);
  }
  console.log(`info  @node-rs/argon2        m=64MiB t=3 p=1 median ${median(runs).toFixed(0)} ms`);
} catch {
  console.log(
    'info  @node-rs/argon2        not installed (built-in node:crypto argon2 used instead)',
  );
}

console.log(`runtime warnings: ${warnings.length ? warnings.join(' | ') : 'none'}`);
process.exit(failed ? 1 : 0);
