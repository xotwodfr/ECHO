import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { loadSession } from '../session.ts';
import { strings } from '../strings.ts';
import { Button } from '../ui/controls.tsx';
import { SectionLoading } from '../ui/states.tsx';

// Settings → Account → YouTube Music (spec call 3): paste the Cookie header of a signed-in
// music.youtube.com tab. Google offers no proper sign-in for this; the cookie is what keeps
// working. The server checks it signs in before storing it, sealed, and never sends it back.

interface Connection {
  connected: boolean;
  name?: string;
  needsReentry?: boolean;
}

export function YouTubeConnection() {
  const y = strings.youtube.connection;
  const [conn, setConn] = useState<Connection | null>(null);
  const [cookie, setCookie] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    void api<Connection>('/me/connections/youtube').then(setConn, () =>
      setConn({ connected: false }),
    );
  }, []);
  if (conn === null) return <SectionLoading title={y.title} rows={3} />;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { name } = await api<{ name: string }>('/me/connections/youtube', {
        method: 'PUT',
        body: { cookie },
      });
      setCookie('');
      setConn({ connected: true, name });
      await loadSession(); // YouTube Music mode reads `signedIn` from the session
    } catch (err) {
      setError(err instanceof ApiError ? (err.userMessage ?? err.code) : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await api('/me/connections/youtube', { method: 'DELETE' });
    setConn({ connected: false });
    await loadSession();
  }

  return (
    <section className="connection" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{y.title}</h3>
      {conn.connected ? (
        <>
          <p role="status">{y.signedInAs(conn.name ?? '')}</p>
          <div className="actions">
            <Button variant="tertiary" onClick={signOut}>
              {y.signOut}
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={save}>
          <p>{conn.needsReentry ? y.reentry : y.intro}</p>
          <ol className="yt-steps">
            {y.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-cookie`}>
              {y.cookie}
            </label>
            <div className="field-control">
              <textarea
                id={`${id}-cookie`}
                className="field-input yt-cookie"
                rows={4}
                autoComplete="off"
                spellCheck={false}
                required
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                aria-describedby={`${id}-privacy`}
              />
            </div>
          </div>
          <p className="field-hint" id={`${id}-privacy`}>
            {y.privacy}
          </p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="primary" type="submit" disabled={busy}>
            {y.save}
          </Button>
        </form>
      )}
    </section>
  );
}

interface YtdlpStatus {
  version: string | null;
  updatedAt: number | null;
  lastError: string | null;
}

/** Admin → Server: yt-dlp's version and its last update or error (spec goal 11). */
export function YtdlpStatusBlock() {
  const a = strings.youtube.admin;
  const [s, setS] = useState<YtdlpStatus | null>(null);
  useEffect(() => {
    void api<YtdlpStatus>('/admin/youtube').then(setS, () => undefined);
  }, []);
  if (!s) return null;
  return (
    <div className="field-hint">
      <p>
        {a.ytdlp}: {a.version(s.version)} · {a.updated(s.updatedAt)}
      </p>
      {s.lastError && <p>{a.lastError(s.lastError)}</p>}
    </div>
  );
}
