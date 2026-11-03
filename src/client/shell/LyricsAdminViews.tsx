import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { ApiError, api } from '../api.ts';
import { loadSession, sessionStore } from '../session.ts';
import { strings } from '../strings.ts';
import { Button, Field, Toggle } from '../ui/controls.tsx';
import { BlockError, SectionLoading } from '../ui/states.tsx';
import { YtdlpStatusBlock } from '../youtube/Connection.tsx';

// Admin → Server (the Spicy Lyrics key, matching the library for lyrics, "require TOTP for all")
// and Admin → Spotify matching: which Spotify track id each Navidrome track has, since that id is
// what Spicy Lyrics looks word-timed lyrics up by (LYRICS_INTEGRATION.md §4.3).

interface AdminSettings {
  lyrics: { spicyKeySaved: boolean };
  auth: { requireTotpForAll: boolean };
  spotify: { matchLibrary: boolean };
  youtube: { enabled: boolean };
}

const a = {
  title: 'Server',
  matchLibrary: 'Match the Navidrome library with Spotify track ids in the background',
  matchLibraryHint:
    'Sends track titles, artists, albums and ISRCs to ListenBrainz and MusicBrainz so Spicy Lyrics can find word-timed lyrics for your files.',
  spicyKey: 'Spicy Lyrics secret key',
  spicySaved: '•••••••• Saved',
  save: 'Save',
  saved: 'Saved',
};

/** Admin → Server: the Spicy key, library matching and two-factor policy. Admins only. */
export function AdminServerSection() {
  const session = useStore(sessionStore);
  const [s, setS] = useState<AdminSettings | null>(null);
  const [spicy, setSpicy] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = session.status === 'signedIn' && session.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    void api<AdminSettings>('/admin/settings').then(setS);
  }, [isAdmin]);
  if (!isAdmin) return null;
  if (!s) return <SectionLoading title={a.title} rows={4} />;

  async function put(body: unknown) {
    setError(null);
    try {
      setS(await api<AdminSettings>('/admin/settings', { method: 'PUT', body }));
      setNote(a.saved);
    } catch (err) {
      setError(err instanceof ApiError ? ((err.body.detail as string) ?? err.code) : String(err));
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!spicy) return;
    void put({ lyrics: { spicyKey: spicy.trim() } }).then(() => setSpicy(''));
  }

  return (
    <section className="connection" aria-labelledby="admin-title">
      <h3 id="admin-title">{a.title}</h3>
      <form onSubmit={save}>
        <Field
          label={a.spicyKey}
          secret
          autoComplete="off"
          placeholder={s.lyrics.spicyKeySaved ? a.spicySaved : undefined}
          value={spicy}
          onChange={(e) => setSpicy(e.target.value)}
          error={error ?? undefined}
        />
        <Button variant="primary" type="submit">
          {a.save}
        </Button>
      </form>
      <Toggle
        label={a.matchLibrary}
        checked={s.spotify.matchLibrary}
        onChange={(v) => void put({ spotify: { matchLibrary: v } })}
      />
      <p className="field-hint">{a.matchLibraryHint}</p>
      <Toggle
        label={strings.admin.requireTotp}
        checked={s.auth.requireTotpForAll}
        onChange={(v) => void put({ auth: { requireTotpForAll: v } })}
      />
      <Toggle
        label={strings.youtube.admin.enabled}
        checked={s.youtube.enabled}
        onChange={(v) => void put({ youtube: { enabled: v } }).then(() => loadSession())}
      />
      <p className="field-hint">{strings.youtube.admin.enabledHint}</p>
      {s.youtube.enabled && <YtdlpStatusBlock />}
      {note && <p role="status">{note}</p>}
    </section>
  );
}

interface Matching {
  status: {
    running: boolean;
    phase: 'scan' | 'musicbrainz' | null;
    scanned: number;
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
  };
  counts: { tracks: number; matched: number; manual: number; none: number; pending: number };
}
interface Miss {
  id: string;
  title: string;
  artist: string;
  album: string | null;
}

const m = {
  title: 'Spotify matching',
  intro:
    'Navidrome tracks need a Spotify ID before Spicy Lyrics can serve their word-timed lyrics. Matches are shared by everyone on this Navidrome server.',
  counts: (c: Matching['counts']) =>
    `${c.matched.toLocaleString('en-GB')} of ${c.tracks.toLocaleString('en-GB')} tracks matched (${c.manual} by hand) · ${c.none.toLocaleString('en-GB')} not found · ${c.pending.toLocaleString('en-GB')} waiting`,
  running: (s: Matching['status']) =>
    s.phase === 'musicbrainz'
      ? 'Matching: checking ISRCs with MusicBrainz (about one track a second)…'
      : `Matching: ${s.scanned.toLocaleString('en-GB')} tracks scanned…`,
  finished: (at: number) =>
    `Last run finished ${new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`,
  failed: (e: string) => `The last run stopped: ${e}`,
  run: 'Match now',
  misses: 'Not found',
  noMisses: 'Every track that was tried has a match.',
  more: 'Show more',
  link: (title: string) => `Spotify link for ${title}`,
  fix: 'Save',
  fixOne: 'Fix one track',
  fixOneHint:
    'Paste the track’s Spotify link (Share → Copy song link). Leave empty to match it again automatically.',
  current: (ids: string[], method: string | null) =>
    ids.length
      ? `Now: ${ids[0]} (${method === 'manual' ? 'set by hand' : method})`
      : 'Now: no match',
  saved: 'Saved. The track’s lyrics are looked up again next time it plays.',
  bad: 'That is not a Spotify track link.',
};

/** The Stage's ⓘ → "Fix Spotify match…": the Navidrome track to open in Admin → Server. */
export const fixTrackStore = createStore<{ id: string | null }>()(() => ({ id: null }));

const putMatch = (id: string, spotify: string | null) =>
  api<{ match: { ids: string[]; method: string | null } | null }>(
    `/admin/spotify-matching/tracks/${encodeURIComponent(id)}`,
    { method: 'PUT', body: { spotify } },
  );

/** Admin → Server → Spotify matching: progress, a manual run, the misses and corrections. */
export function SpotifyMatchingSection() {
  const session = useStore(sessionStore);
  const isAdmin = session.status === 'signedIn' && session.role === 'admin';
  const [st, setSt] = useState<Matching | null>(null);
  const [misses, setMisses] = useState<Miss[]>([]);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setSt(await api<Matching>('/admin/spotify-matching'));
    const page = await api<Miss[]>('/admin/spotify-matching/misses?limit=51');
    setMore(page.length > 50);
    setMisses(page.slice(0, 50));
  }, []);
  // A failed first load is an error with Retry, not a skeleton for ever.
  const first = useCallback(() => {
    setFailed(false);
    void load().catch(() => setFailed(true));
  }, [load]);
  useEffect(() => {
    if (isAdmin) first();
  }, [isAdmin, first]);
  // While a run goes on, its progress refreshes every few seconds.
  useEffect(() => {
    if (!st?.status.running) return;
    const h = setInterval(() => void load().catch(() => undefined), 4000);
    return () => clearInterval(h);
  }, [st?.status.running, load]);
  if (!isAdmin) return null;
  if (!st)
    return failed ? (
      <BlockError what={strings.states.blockFailed} onRetry={first} />
    ) : (
      <SectionLoading title={m.title} rows={3} />
    );

  const showMore = async () => {
    const page = await api<Miss[]>(
      `/admin/spotify-matching/misses?limit=51&offset=${misses.length}`,
    );
    setMore(page.length > 50);
    setMisses([...misses, ...page.slice(0, 50)]);
  };

  return (
    <section className="connection" aria-labelledby="sm-title">
      <h3 id="sm-title">{m.title}</h3>
      <p className="field-hint">{m.intro}</p>
      <p role="status">
        {st.status.running
          ? m.running(st.status)
          : st.status.error
            ? m.failed(st.status.error)
            : st.status.finishedAt
              ? m.finished(st.status.finishedAt)
              : null}
      </p>
      <p className="num">{m.counts(st.counts)}</p>
      <div className="actions">
        <Button
          disabled={st.status.running}
          onClick={() =>
            void api<Matching>('/admin/spotify-matching/run', { method: 'POST' }).then(setSt)
          }
        >
          {m.run}
        </Button>
      </div>
      <FixOneTrack onSaved={() => void load()} />
      <h4>{m.misses}</h4>
      {misses.length ? (
        <ul className="match-misses">
          {misses.map((x) => (
            <MissRow
              key={x.id}
              miss={x}
              onFixed={() => setMisses((ms) => ms.filter((y) => y.id !== x.id))}
            />
          ))}
        </ul>
      ) : (
        <p>{m.noMisses}</p>
      )}
      {more && <Button onClick={() => void showMore()}>{m.more}</Button>}
    </section>
  );
}

function MissRow({ miss, onFixed }: { miss: Miss; onFixed: () => void }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await putMatch(miss.id, link.trim());
      onFixed();
    } catch {
      setError(m.bad);
    }
  };
  return (
    <li>
      <form onSubmit={(e) => void save(e)}>
        <p>
          <strong>{miss.title}</strong> · {miss.artist}
          {miss.album && ` · ${miss.album}`}
        </p>
        <Field
          label={m.link(miss.title)}
          autoComplete="off"
          spellCheck={false}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          error={error ?? undefined}
        />
        <Button type="submit" disabled={!link.trim()}>
          {m.fix}
        </Button>
      </form>
    </li>
  );
}

/** Opened from the Stage's ⓘ menu with the playing track; shows its match and takes a link. */
function FixOneTrack({ onSaved }: { onSaved: () => void }) {
  const { id } = useStore(fixTrackStore);
  const [current, setCurrent] = useState<{ ids: string[]; method: string | null } | null>(null);
  const [link, setLink] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    setNote(null);
    void api<{ match: { ids: string[]; method: string | null } | null }>(
      `/admin/spotify-matching/tracks/${encodeURIComponent(id)}`,
    ).then((r) => setCurrent(r.match ?? { ids: [], method: null }));
    document.getElementById('fix-one-track')?.scrollIntoView({ block: 'center' });
  }, [id]);
  if (!id) return null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await putMatch(id, link.trim() || null);
      setCurrent(r.match);
      setLink('');
      setNote(m.saved);
      onSaved();
    } catch {
      setError(m.bad);
    }
  };
  return (
    <form onSubmit={(e) => void save(e)} id="fix-one-track">
      <h4>{m.fixOne}</h4>
      {current && <p>{m.current(current.ids, current.method)}</p>}
      <Field
        label={m.link(id)}
        hint={m.fixOneHint}
        autoComplete="off"
        spellCheck={false}
        value={link}
        onChange={(e) => setLink(e.target.value)}
        error={error ?? undefined}
      />
      <Button variant="primary" type="submit">
        {m.fix}
      </Button>
      {note && <p role="status">{note}</p>}
    </form>
  );
}
