import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { strings } from '../strings.ts';
import { Button, Field, Pill } from '../ui/controls.tsx';
import { ConfirmDialog } from '../ui/overlays.tsx';

// Account → Password, Two-factor, Sessions & devices, Delete account (SETTINGS_AND_SECURITY.md
// §4.3–§4.6, §10; IMPLEMENTATION_PLAN.md M8 task 2), and the invite page (§4.2).

const t = strings.account;
const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const why = (err: unknown): string =>
  (err instanceof ApiError ? (t.errors[err.code] ?? err.userMessage) : null) ??
  (t.errors.failed as string);

interface Account {
  username: string;
  role: 'admin' | 'user';
  createdAt: number;
  totpEnabled: boolean;
  recoveryCodesLeft: number;
}

/** Recovery codes, shown once (setup, enrolment, regeneration). */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div role="status">
      <p>{strings.auth.recoveryIntro}</p>
      <ul className="recovery-codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The TOTP key to enter in an authenticator app, and the otpauth link. */
export function TotpKey({ otpauth, secret }: { otpauth: string; secret: string }) {
  return (
    <>
      <p className="totp-key">
        {strings.auth.setupKey}: <code>{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
      </p>
      <a href={otpauth}>{strings.auth.setupLink}</a>
    </>
  );
}

export function AccountBlocks() {
  const [account, setAccount] = useState<Account | null>(null);
  const load = useCallback(() => {
    void api<Account>('/me/account').then(setAccount, () => undefined);
  }, []);
  useEffect(load, [load]);
  if (!account) return null;
  return (
    <>
      <PasswordBlock />
      <TotpBlock account={account} onChange={load} />
      <SessionsBlock />
      <DeleteBlock account={account} />
    </>
  );
}

function PasswordBlock() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNote(null);
    try {
      const r = await api<{ revoked: number }>('/me/password', {
        method: 'POST',
        body: { current, next },
      });
      setNote(t.passwordChanged(r.revoked));
      setCurrent('');
      setNext('');
    } catch (err) {
      setError(why(err));
    }
  };
  return (
    <section className="connection" aria-labelledby="acc-password">
      <h3 id="acc-password">{t.password}</h3>
      <form onSubmit={submit}>
        <Field
          label={t.currentPassword}
          secret
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <Field
          label={t.newPassword}
          secret
          hint={strings.auth.passwordHint}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={error ?? undefined}
          required
        />
        {note && <p role="status">{note}</p>}
        <Button variant="secondary" type="submit">
          {t.changePassword}
        </Button>
      </form>
    </section>
  );
}

function TotpBlock({ account, onChange }: { account: Account; onChange: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrol, setEnrol] = useState<{ otpauth: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'disable' | 'regenerate'>('idle');
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (err) {
      setError(why(err));
    }
  };
  const reset = () => {
    setPassword('');
    setCode('');
    setMode('idle');
  };
  return (
    <section className="connection" aria-labelledby="acc-totp">
      <h3 id="acc-totp">
        {t.totp}{' '}
        <Pill tone={account.totpEnabled ? 'pos' : 'neutral'}>
          {account.totpEnabled ? t.on : t.off}
        </Pill>
      </h3>
      {codes && <RecoveryCodes codes={codes} />}
      {account.totpEnabled ? (
        <>
          <p className="field-hint">{t.codesLeft(account.recoveryCodesLeft)}</p>
          {mode === 'idle' ? (
            <div className="actions">
              <Button variant="secondary" onClick={() => setMode('regenerate')}>
                {t.regenerate}
              </Button>
              {account.role !== 'admin' && (
                <Button variant="tertiary" onClick={() => setMode('disable')}>
                  {t.turnOff}
                </Button>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (mode === 'disable') {
                    await api('/me/totp/disable', { method: 'POST', body: { password, code } });
                    setCodes(null);
                  } else {
                    const r = await api<{ recoveryCodes: string[] }>('/me/recovery-codes', {
                      method: 'POST',
                      body: { password, code },
                    });
                    setCodes(r.recoveryCodes);
                  }
                  reset();
                  onChange();
                });
              }}
            >
              <Field
                label={strings.auth.password}
                secret
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Field
                label={strings.auth.code}
                hint={strings.auth.codeHint}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                error={error ?? undefined}
                required
              />
              <div className="actions">
                <Button variant="primary" type="submit">
                  {mode === 'disable' ? t.turnOff : t.regenerate}
                </Button>
                <Button variant="tertiary" onClick={reset}>
                  {strings.ui.cancel}
                </Button>
              </div>
            </form>
          )}
        </>
      ) : enrol ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api<{ recoveryCodes: string[] }>('/me/totp/enable', {
                method: 'POST',
                body: { code: code.trim() },
              });
              setCodes(r.recoveryCodes);
              setEnrol(null);
              reset();
              onChange();
            });
          }}
        >
          <p>{strings.auth.setupTotp}</p>
          <TotpKey {...enrol} />
          <Field
            label={strings.auth.code}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={error ?? undefined}
            required
          />
          <Button variant="primary" type="submit">
            {strings.auth.verify}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setEnrol(await api('/me/totp/start', { method: 'POST', body: { password } }));
              setPassword('');
            });
          }}
        >
          <p className="field-hint">{t.totpIntro}</p>
          <Field
            label={strings.auth.password}
            secret
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
            required
          />
          <Button variant="secondary" type="submit">
            {t.turnOn}
          </Button>
        </form>
      )}
    </section>
  );
}

interface Session {
  id: string;
  kind: 'web' | 'device';
  name: string | null;
  createdAt: number;
  lastSeenAt: number;
  location: string | null;
  current: boolean;
}

function SessionsBlock() {
  const [list, setList] = useState<Session[] | null>(null);
  const load = useCallback(() => {
    void api<Session[]>('/me/sessions').then(setList, () => setList([]));
  }, []);
  useEffect(load, [load]);
  if (!list) return null;
  const others = list.filter((s) => !s.current).length;
  return (
    <section className="connection" aria-labelledby="acc-sessions">
      <h3 id="acc-sessions">{t.sessions}</h3>
      <ul className="sessions">
        {list.map((s) => (
          <li key={s.id}>
            <div>
              <span>{s.name ?? (s.kind === 'device' ? t.device : t.browser)}</span>{' '}
              {s.current && <Pill tone="pos">{t.thisBrowser}</Pill>}
              <p className="field-hint">
                {[t.lastSeen(when(s.lastSeenAt)), s.location, t.since(when(s.createdAt))]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            {!s.current && (
              <Button
                variant="tertiary"
                onClick={() => void api(`/me/sessions/${s.id}`, { method: 'DELETE' }).finally(load)}
              >
                {t.signOut}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 && (
        <Button
          variant="secondary"
          onClick={() =>
            void api('/me/sessions/revoke-others', { method: 'POST', body: {} }).finally(load)
          }
        >
          {t.signOutOthers}
        </Button>
      )}
    </section>
  );
}

function DeleteBlock({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setError(null);
    try {
      await api('/me', { method: 'DELETE', body: { password, ...(code && { code }) } });
      window.location.assign('/login');
    } catch (err) {
      setError(why(err));
    }
  };
  return (
    <section className="connection" aria-labelledby="acc-delete">
      <h3 id="acc-delete">{t.deleteAccount}</h3>
      <p className="field-hint">{t.deleteIntro}</p>
      {!open ? (
        <Button variant="tertiary" onClick={() => setOpen(true)}>
          {t.deleteAccount}
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirm(true);
          }}
        >
          <Field
            label={strings.auth.password}
            secret
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {account.totpEnabled && (
            <Field
              label={strings.auth.code}
              hint={strings.auth.codeHint}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="destructive" type="submit">
            {t.deleteAccount}
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={confirm}
        title={t.deleteTitle}
        consequence={t.deleteConsequence}
        confirmLabel={t.deleteAccount}
        onConfirm={() => {
          setConfirm(false);
          void remove();
        }}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}

/** /invite#<token>: choose a username (unless preset) and password; TOTP when the admin requires it. */
export function InviteView() {
  // The token travels in the fragment, so it never reaches a server log.
  const [token] = useState(() => window.location.hash.slice(1));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enrol, setEnrol] = useState<{ otpauth: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const home = () => window.location.assign('/');

  if (!token)
    return (
      <div className="auth">
        <h1 tabIndex={-1}>{t.inviteTitle}</h1>
        <p>{t.inviteNoToken}</p>
      </div>
    );
  if (codes)
    return (
      <div className="auth">
        <h1 tabIndex={-1}>{strings.auth.recoveryTitle}</h1>
        <RecoveryCodes codes={codes} />
        <Button variant="primary" onClick={home}>
          {strings.auth.continue}
        </Button>
      </div>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!enrol) {
        const r = await api<{ totpRequired: boolean; otpauth?: string; secret?: string }>(
          '/invite',
          {
            method: 'POST',
            body: { token, username: username.trim(), password },
          },
        );
        if (!r.totpRequired) {
          window.history.replaceState(null, '', '/invite');
          return home();
        }
        setEnrol({ otpauth: r.otpauth as string, secret: r.secret as string });
      } else {
        const r = await api<{ recoveryCodes: string[] }>('/invite/totp', {
          method: 'POST',
          body: { token, code: code.trim() },
        });
        window.history.replaceState(null, '', '/invite'); // the invite is spent: drop the token
        setCodes(r.recoveryCodes);
      }
    } catch (err) {
      setError(why(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth" onSubmit={submit}>
      <h1 tabIndex={-1}>{t.inviteTitle}</h1>
      {!enrol ? (
        <>
          <p>{t.inviteIntro}</p>
          <Field
            label={strings.auth.username}
            autoComplete="username"
            hint={t.inviteNameHint}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Field
            label={strings.auth.password}
            secret
            hint={strings.auth.passwordHint}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
            required
          />
        </>
      ) : (
        <>
          <p>{strings.auth.setupTotp}</p>
          <TotpKey {...enrol} />
          <Field
            label={strings.auth.code}
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
        {enrol ? strings.auth.verify : t.createAccount}
      </Button>
    </form>
  );
}
