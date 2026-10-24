import { type FormEvent, useState } from 'react';
import { useStore } from 'zustand';
import { ApiError, api } from '../api.ts';
import { login, logout, sessionStore, setupFinish, setupStart, totp } from '../session.ts';
import { strings } from '../strings.ts';
import { Button, Field } from '../ui/controls.tsx';
import { AccountBlocks } from './AccountViews.tsx';
import { SpotifyConnection } from './SpotifyViews.tsx';

// Sign-in, first-start setup and the Account section (SETTINGS_AND_SECURITY.md §4, §6.1, §7.3). A
// successful sign-in or connection reloads the page: the playback provider is chosen at start.

const s = strings.auth;
const home = () => window.location.assign('/');

function messageOf(err: unknown) {
  if (!(err instanceof ApiError)) return s.failed;
  if (err.status === 429) return s.rateLimited;
  return (
    err.userMessage ??
    (err.code === 'challenge_expired' ? s.expired : err.code === 'bad_code' ? s.badCode : s.failed)
  );
}

export function LoginView() {
  const [step, setStep] = useState<{ challenge: string } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!step) {
        const r = await login(username, password);
        if (r.totpRequired && r.challenge) setStep({ challenge: r.challenge });
        else home();
      } else {
        await totp(step.challenge, code.trim());
        home();
      }
    } catch (err) {
      setError(messageOf(err));
      if (err instanceof ApiError && err.code === 'challenge_expired') setStep(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h1 tabIndex={-1}>{s.signIn}</h1>
      {!step ? (
        <>
          <Field
            label={s.username}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Field
            label={s.password}
            secret
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
            required
          />
        </>
      ) : (
        <Field
          label={s.code}
          hint={s.codeHint}
          autoComplete="one-time-code"
          inputMode="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={error ?? undefined}
          autoFocus
          required
        />
      )}
      <Button variant="primary" type="submit" disabled={busy}>
        {step ? s.verify : s.signIn}
      </Button>
    </form>
  );
}

export function SetupView() {
  // The token travels in the fragment, so it never reaches a server log.
  const [token] = useState(() => window.location.hash.slice(1));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enrol, setEnrol] = useState<{ otpauth: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token)
    return (
      <div className="auth">
        <h1 tabIndex={-1}>{s.setupTitle}</h1>
        <p>{s.setupNoToken}</p>
      </div>
    );

  if (codes)
    return (
      <div className="auth">
        <h1 tabIndex={-1}>{s.recoveryTitle}</h1>
        <p>{s.recoveryIntro}</p>
        <ul className="recovery-codes">
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <Button variant="primary" onClick={home}>
          {s.continue}
        </Button>
      </div>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!enrol) setEnrol(await setupStart(token, username.trim(), password));
      else {
        const r = await setupFinish(token, code.trim());
        window.history.replaceState(null, '', '/setup'); // the token is spent: drop it
        setCodes(r.recoveryCodes);
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'bad_password' ? s.passwordHint : messageOf(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h1 tabIndex={-1}>{s.setupTitle}</h1>
      {!enrol ? (
        <>
          <p>{s.setupIntro}</p>
          <Field
            label={s.username}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Field
            label={s.password}
            secret
            hint={s.passwordHint}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
            required
          />
        </>
      ) : (
        <>
          <p>{s.setupTotp}</p>
          <p className="totp-key">
            {s.setupKey}: <code>{enrol.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </p>
          <a href={enrol.otpauth}>{s.setupLink}</a>
          <Field
            label={s.code}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={error ?? undefined}
            autoFocus
            required
          />
        </>
      )}
      <Button variant="primary" type="submit" disabled={busy}>
        {enrol ? s.verify : s.continue}
      </Button>
    </form>
  );
}

interface Connection {
  connected: boolean;
  defaultUrl?: string | null;
  url?: string;
  username?: string;
  serverVersion?: string;
}

/** Settings → Account: who is signed in, and the user's own Navidrome (§6.1). */
export function AccountSection() {
  const session = useStore(sessionStore);
  if (session.status !== 'signedIn') return <p className="empty">{strings.settings.empty}</p>;
  return (
    <>
      <p>{s.signedInAs(session.username, session.role)}</p>
      <Button
        variant="secondary"
        onClick={() => logout().finally(() => window.location.assign('/login'))}
      >
        {s.signOut}
      </Button>
      {session.mustEnrolTotp && (
        <p className="notice" role="alert">
          {strings.account.mustEnrol}
        </p>
      )}
      <AccountBlocks />
      <NavidromeConnection />
      <SpotifyConnection />
    </>
  );
}

function NavidromeConnection() {
  const n = strings.navidrome;
  const [conn, setConn] = useState<Connection | null>(null);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (conn === null) {
    void api<Connection>('/me/connections/navidrome').then((c) => {
      setConn(c);
      setUrl(c.url ?? c.defaultUrl ?? '');
      setUsername(c.username ?? '');
    });
    return null;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/me/connections/navidrome', {
        method: 'PUT',
        body: apiKey ? { url, apiKey } : { url, username, password },
      });
      setStatus(n.reload);
      home();
    } catch (err) {
      setError(err instanceof ApiError ? (err.userMessage ?? err.code) : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setError(null);
    try {
      const r = await api<{ serverInfo: { serverVersion: string; tracks: number } }>(
        '/me/connections/navidrome/test',
        {
          method: 'POST',
          body: {},
        },
      );
      setStatus(n.connected(r.serverInfo.serverVersion, r.serverInfo.tracks));
    } catch (err) {
      setError(err instanceof ApiError ? (err.userMessage ?? err.code) : String(err));
    }
  }

  async function disconnect() {
    await api('/me/connections/navidrome', { method: 'DELETE' });
    home();
  }

  return (
    <section className="connection" aria-labelledby="nd-title">
      <h3 id="nd-title">{n.title}</h3>
      {conn.connected ? (
        <>
          <p role="status">{status ?? n.connected(conn.serverVersion ?? '', 0)}</p>
          {error && <p className="field-error">{error}</p>}
          <div className="actions">
            <Button variant="secondary" onClick={test}>
              {n.test}
            </Button>
            <Button variant="tertiary" onClick={disconnect}>
              {n.disconnect}
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={save}>
          <Field
            label={n.url}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <Field
            label={n.username}
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Field
            label={n.password}
            secret
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            label={n.apiKey}
            secret
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            error={error ?? undefined}
          />
          {status && <p role="status">{status}</p>}
          <Button variant="primary" type="submit" disabled={busy}>
            {n.save}
          </Button>
        </form>
      )}
    </section>
  );
}
