import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { strings } from '../strings.ts';
import { Button, Field, Pill } from '../ui/controls.tsx';
import { ConfirmDialog } from '../ui/overlays.tsx';
import { BlockError, SectionLoading } from '../ui/states.tsx';
import { AdminServerSection } from './SpotifyViews.tsx';

// Settings → Admin (SETTINGS_AND_SECURITY.md §4.2, §7.2, §7.3; IMPLEMENTATION_PLAN.md M8 task 3):
// Server (the Spotify app, gates, Spicy key, "require TOTP for all"), Users & invites, Audit log.

const t = strings.admin;

interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  disabled: boolean;
  totpEnabled: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  lockedForMs: number;
  connections: { navidrome: boolean; spotify: boolean };
}
interface Invite {
  id: string;
  username: string | null;
  expiresAt: number;
}
interface AuditEntry {
  id: number;
  at: number;
  event: string;
  username: string | null;
  detail: Record<string, unknown> | null;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const why = (err: unknown): string =>
  (err instanceof ApiError ? t.errors[err.code] : null) ?? strings.prefs.notSaved;

export function AdminSection() {
  return (
    <>
      <AdminServerSection />
      <UsersSection />
      <AuditSection />
    </>
  );
}

function UsersSection() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [newInvite, setNewInvite] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const load = useCallback(() => {
    void api<User[]>('/admin/users').then(setUsers, (e) => setError(why(e)));
    void api<Invite[]>('/admin/invites').then(setInvites, () => undefined);
  }, []);
  useEffect(load, [load]);

  const act = async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(why(e));
    }
    load();
  };

  if (!users)
    return error ? (
      <BlockError what={error} onRetry={load} />
    ) : (
      <SectionLoading title={t.users} rows={4} />
    );
  return (
    <section className="connection" aria-labelledby="admin-users">
      <h3 id="admin-users">{t.users}</h3>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <ul className="admin-users">
        {users.map((u) => (
          <li key={u.id} className="admin-user">
            <div>
              <span className="admin-user-name">{u.username}</span>{' '}
              {u.role === 'admin' && <Pill tone="neutral">{t.admin}</Pill>}{' '}
              {u.disabled && <Pill tone="warn">{t.disabled}</Pill>}{' '}
              {u.lockedForMs > 0 && <Pill tone="warn">{t.locked}</Pill>}
              <p className="field-hint">
                {[
                  u.totpEnabled ? t.totpOn : t.totpOff,
                  u.lastSeenAt ? t.lastSeen(when(u.lastSeenAt)) : t.neverSeen,
                  u.connections.navidrome && 'Navidrome',
                  u.connections.spotify && 'Spotify',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="actions">
              {u.lockedForMs > 0 && (
                <Button
                  variant="tertiary"
                  onClick={() =>
                    act(() => api(`/admin/users/${u.id}/unlock`, { method: 'POST', body: {} }))
                  }
                >
                  {t.unlock}
                </Button>
              )}
              <Button
                variant="tertiary"
                onClick={() =>
                  act(() =>
                    api(`/admin/users/${u.id}`, {
                      method: 'PATCH',
                      body: { role: u.role === 'admin' ? 'user' : 'admin' },
                    }),
                  )
                }
              >
                {u.role === 'admin' ? t.demote : t.promote}
              </Button>
              <Button
                variant="tertiary"
                onClick={() =>
                  act(() =>
                    api(`/admin/users/${u.id}`, {
                      method: 'PATCH',
                      body: { disabled: !u.disabled },
                    }),
                  )
                }
              >
                {u.disabled ? t.enable : t.disable}
              </Button>
              <Button variant="tertiary" onClick={() => setDeleting(u)}>
                {t.delete}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <h4>{t.invites}</h4>
      {invites.length > 0 && (
        <ul className="admin-invites">
          {invites.map((i) => (
            <li key={i.id}>
              {i.username ?? t.anyName} · {t.expires(when(i.expiresAt))}{' '}
              <Button
                variant="tertiary"
                onClick={() => act(() => api(`/admin/invites/${i.id}`, { method: 'DELETE' }))}
              >
                {t.revoke}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            const r = await api<{ path: string }>('/admin/invites', {
              method: 'POST',
              body: presetName.trim() ? { username: presetName.trim() } : {},
            });
            setNewInvite(`${window.location.origin}${r.path}`);
            setPresetName('');
          });
        }}
      >
        <Field
          label={t.presetName}
          hint={t.presetHint}
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
        />
        <Button variant="secondary" type="submit">
          {t.invite}
        </Button>
      </form>
      {newInvite && (
        <div className="invite-link" role="status">
          <p>{t.inviteReady}</p>
          <code>{newInvite}</code>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t.deleteTitle(deleting?.username ?? '')}
        consequence={t.deleteConsequence}
        confirmLabel={t.delete}
        onConfirm={() => {
          const u = deleting;
          setDeleting(null);
          if (u) void act(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }));
        }}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

function AuditSection() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(true);
  const page = useCallback(async (before?: number) => {
    const q = new URLSearchParams({ limit: '50', ...(before && { before: String(before) }) });
    const next = await api<AuditEntry[]>(`/admin/audit?${q}`).catch(() => []);
    setMore(next.length === 50);
    setRows((r) => [...(before ? (r ?? []) : []), ...next]);
  }, []);
  useEffect(() => void page(), [page]);
  if (!rows) return <SectionLoading title={t.audit} rows={4} />;
  return (
    <section className="connection" aria-labelledby="admin-audit">
      <h3 id="admin-audit">{t.audit}</h3>
      {rows.length === 0 ? (
        <p className="empty">{t.auditEmpty}</p>
      ) : (
        <table className="audit">
          <thead>
            <tr>
              <th scope="col">{t.auditWhen}</th>
              <th scope="col">{t.auditWho}</th>
              <th scope="col">{t.auditWhat}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num">{when(r.at)}</td>
                <td>{r.username ?? '—'}</td>
                <td>
                  {r.event}
                  {r.detail && <span className="field-hint"> {JSON.stringify(r.detail)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more && rows.length > 0 && (
        <Button variant="tertiary" onClick={() => void page(rows.at(-1)?.id)}>
          {t.older}
        </Button>
      )}
    </section>
  );
}
