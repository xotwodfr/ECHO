import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createSealer, loadMasterKey, type Sealer } from './crypto.ts';
import { type Db, openDb } from './db/db.ts';

// echo-admin (SETTINGS_AND_SECURITY.md §3.2, §11; IMPLEMENTATION_PLAN.md M8 task 10), run inside
// the container (distroless: no shell, node is the entrypoint):
//   docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts <command>
//
//   backup [file]                        a consistent copy of the database (VACUUM INTO), default
//                                        /data/backups/echo-<time>.db; the master key is NOT in it
//                                        (the server also writes echo-auto-<date>.db daily, keeps 7)
//   verify                               how many sealed values open with the current master key
//   rotate-master-key --new-key-file F   re-seals every secret with the key in F, in one
//                                        transaction; then replace the Docker secret with F and
//                                        restart at once (the running server still has the old key)

/** Every sealed column, and the AAD row id each value was sealed with. */
const SEALED = [
  { table: 'users', column: 'totp_secret_enc', key: 'id', rowId: (r: Row) => r.id as number },
  {
    table: 'connections',
    column: 'secret_enc',
    key: 'user_id, provider',
    rowId: (r: Row) => `${r.user_id}|${r.provider}`,
  },
  {
    table: 'server_settings',
    column: 'secret_enc',
    key: 'key',
    rowId: (r: Row) => r.key as string,
  },
] as const;
type Row = Record<string, unknown>;

function sealedValues(db: Db) {
  const out: {
    table: string;
    column: string;
    where: string;
    args: unknown[];
    rowId: string | number;
    value: string;
  }[] = [];
  for (const s of SEALED) {
    const keys = s.key.split(', ');
    const rows = db
      .prepare(
        `SELECT ${s.key}, ${s.column} AS value FROM ${s.table} WHERE ${s.column} IS NOT NULL`,
      )
      .all() as Row[];
    for (const r of rows)
      out.push({
        table: s.table,
        column: s.column,
        where: keys.map((k) => `${k} = ?`).join(' AND '),
        args: keys.map((k) => r[k]),
        rowId: s.rowId(r),
        value: r.value as string,
      });
  }
  return out;
}

export function backup(db: Db, file: string) {
  if (existsSync(file)) throw new Error(`${file} exists: choose another name`);
  mkdirSync(dirname(file), { recursive: true });
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

/**
 * The server's daily backup: `echo-auto-<date>.db` in `dir`, once per UTC day (a restart the same
 * day does nothing), keeping the newest `keep`. Manual `backup` files are never pruned.
 */
export function nightlyBackup(db: Db, dir: string, now = new Date(), keep = 7) {
  const file = join(dir, `echo-auto-${now.toISOString().slice(0, 10)}.db`);
  const made = existsSync(file) ? null : backup(db, file);
  const old = readdirSync(dir)
    .filter((f) => /^echo-auto-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .slice(0, -keep);
  for (const f of old) rmSync(join(dir, f));
  return { made, pruned: old };
}

export function verify(db: Db, sealer: Sealer) {
  const all = sealedValues(db);
  const unreadable = all.filter(
    (v) => sealer.tryOpen(v.value, { table: v.table, rowId: v.rowId, column: v.column }) === null,
  );
  return {
    total: all.length,
    unreadable: unreadable.map((v) => `${v.table}.${v.column} ${v.rowId}`),
  };
}

/** Re-seals every value readable with `from` under `to`; unreadable ones are left and reported. */
export function rotate(db: Db, from: Sealer, to: Sealer) {
  let resealed = 0;
  const skipped: string[] = [];
  db.transaction(() => {
    for (const v of sealedValues(db)) {
      const where = { table: v.table, rowId: v.rowId, column: v.column };
      const plain = from.tryOpen(v.value, where);
      if (plain === null) {
        skipped.push(`${v.table}.${v.column} ${v.rowId}`);
        continue;
      }
      db.prepare(`UPDATE ${v.table} SET ${v.column} = ? WHERE ${v.where}`).run(
        to.seal(plain, where),
        ...v.args,
      );
      resealed++;
    }
  })();
  return { resealed, skipped };
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  const dataDir = process.env.ECHO_DATA_DIR || './data';
  const keyFile = process.env.ECHO_MASTER_KEY_FILE || '/run/secrets/echo_master_key';
  const commands = ['backup', 'verify', 'rotate-master-key'];
  if (!commands.includes(cmd ?? '')) {
    console.log(
      'usage: echo-admin backup [file] | verify | rotate-master-key --new-key-file <file>',
    );
    process.exit(2);
  }
  const db = openDb(join(dataDir, 'echo.db'));
  try {
    if (cmd === 'backup') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = backup(db, args[0] ?? join(dataDir, 'backups', `echo-${stamp}.db`));
      console.log(`Backed up to ${file}. Keep the master key apart from it: without the key the`);
      console.log('connections and TOTP secrets in it cannot be read.');
    } else if (cmd === 'verify') {
      const r = verify(db, createSealer(loadMasterKey(keyFile)));
      console.log(
        `${r.total - r.unreadable.length} of ${r.total} sealed values open with this key.`,
      );
      for (const u of r.unreadable) console.log(`  unreadable: ${u}`);
      process.exitCode = r.unreadable.length ? 1 : 0;
    } else {
      const i = args.indexOf('--new-key-file');
      const next = i >= 0 ? args[i + 1] : undefined;
      if (!next) throw new Error('usage: echo-admin rotate-master-key --new-key-file <file>');
      const r = rotate(db, createSealer(loadMasterKey(keyFile)), createSealer(loadMasterKey(next)));
      console.log(`Re-sealed ${r.resealed} values with the new key.`);
      for (const s of r.skipped) console.log(`  left as is (unreadable with the old key): ${s}`);
      console.log('Now replace the echo_master_key secret with the new key file and restart ECHO.');
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
