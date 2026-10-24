import { type FormEvent, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { ApiError, api } from '../api.ts';
import { sessionStore } from '../session.ts';
import { type DrmResult, drmGuidance, probeWidevine } from '../spotify/drm.ts';
import { strings } from '../strings.ts';
import { Button, Field, Toggle } from '../ui/controls.tsx';

// Settings → Account → Spotify (SETTINGS_AND_SECURITY.md §6.2, §8) and, for admins, Admin → Server
// → Spotify app and Lyrics (§6.3, §7.2). Connecting is a top-level navigation to ECHO's server,
// which runs PKCE with Spotify and returns here with `?spotify=<result>`.

const t = strings.spotify;

export interface SpotifyStatus {
  configured: boolean;
  clientId: string | null;
  gates: { artPalette: boolean; syncedLyrics: boolean };
  seatsFull: boolean;
  connection: {
    status: 'connected' | 'expired' | 'premium_required' | 'not_on_user_list';
    displayName: string | null;
    product: string | null;
  } | null;
}

export const spotifyStatus = () => api<SpotifyStatus>('/spotify/status');

/** The sign-in result Spotify's round trip came back with, read before the URL is tidied. */
const RESULT =
  typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('spotify');

export function SpotifyConnection() {
  const [st, setSt] = useState<SpotifyStatus | null>(null);
  const [drm, setDrm] = useState<DrmResult | null>(null);
  const result = RESULT;

  useEffect(() => {
    void spotifyStatus().then(setSt, () => undefined);
    void probeWidevine().then(setDrm);
  }, []);
  if (!st) return null;

  const resultText = result && (t.result[result] ?? null);
  const c = st.connection;
  const connect = () => window.location.assign('/api/v1/spotify/login');
  const disconnect = async () => {
    await api('/spotify/connection', { method: 'DELETE' });
    window.location.assign('/settings/account');
  };

  return (
    <section className="connection" aria-labelledby="sp-title">
      <h3 id="sp-title">{t.title}</h3>
      {resultText && <p role="status">{resultText}</p>}
      {drm && !drm.ok && (
        <p className="field-error" data-testid="drm-guidance">
          {drmGuidance(drm)}
        </p>
      )}
      {!st.configured ? (
        <p>{t.notConfigured}</p>
      ) : c ? (
        <>
          <p role="status">
            {c.status === 'connected' ? t.connected(c.displayName) : t.status[c.status]}
          </p>
          <LookupToggle />
          <div className="actions">
            {c.status !== 'connected' && (
              <Button variant="primary" onClick={connect}>
                {t.reconnect}
              </Button>
            )}
            <Button variant="tertiary" onClick={disconnect}>
              {t.disconnect}
            </Button>
          </div>
        </>
      ) : st.seatsFull ? (
        <p>{t.seatsFull}</p>
      ) : (
        <Button variant="primary" onClick={connect}>
          {t.connect}
        </Button>
      )}
    </section>
  );
}

interface AdminSettings {
  lyrics: { spicyKeySaved: boolean };
  spotify: {
    clientId: string | null;
    gates: { artPalette: boolean; syncedLyrics: boolean };
    seats: { used: number; max: number };
  };
}

const a = {
  title: 'Server',
  clientId: 'Spotify app Client ID',
  clientIdHint:
    'From your app in the Spotify Developer Dashboard. Redirect URI: this server’s address + /api/v1/spotify/callback.',
  seats: (used: number, max: number) => `Spotify seats: ${used} of ${max}`,
  artPalette: 'Colours from Spotify cover art (G1)',
  syncedLyrics: 'Timed lyrics during Spotify playback (G2)',
  spicyKey: 'Spicy Lyrics secret key',
  spicySaved: '•••••••• Saved',
  save: 'Save',
  saved: 'Saved',
};

/** Admin → Server: the Spotify app, the policy gates and the Spicy key. Admins only. */
export function AdminServerSection() {
  const session = useStore(sessionStore);
  const [s, setS] = useState<AdminSettings | null>(null);
  const [clientId, setClientId] = useState('');
  const [spicy, setSpicy] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = session.status === 'signedIn' && session.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    void api<AdminSettings>('/admin/settings').then((r) => {
      setS(r);
      setClientId(r.spotify.clientId ?? '');
    });
  }, [isAdmin]);
  if (!isAdmin || !s) return null;

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
    void put({
      spotify: { clientId: clientId.trim() || null },
      ...(spicy && { lyrics: { spicyKey: spicy.trim() } }),
    }).then(() => setSpicy(''));
  }

  return (
    <section className="connection" aria-labelledby="admin-title">
      <h3 id="admin-title">{a.title}</h3>
      <form onSubmit={save}>
        <Field
          label={a.clientId}
          hint={a.clientIdHint}
          autoComplete="off"
          spellCheck={false}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
        <p>{a.seats(s.spotify.seats.used, s.spotify.seats.max)}</p>
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
        label={a.artPalette}
        checked={s.spotify.gates.artPalette}
        onChange={(v) => void put({ spotify: { gates: { artPalette: v } } })}
      />
      <Toggle
        label={a.syncedLyrics}
        checked={s.spotify.gates.syncedLyrics}
        onChange={(v) => void put({ spotify: { gates: { syncedLyrics: v } } })}
      />
      {note && <p role="status">{note}</p>}
    </section>
  );
}

/** "Use my Spotify account to find lyrics for my library" (LYRICS_INTEGRATION.md §4.3), default off. */
function LookupToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void api<{ lyrics: { useSpotifyForLookup: boolean } }>('/me/settings').then(
      (r) => setOn(r.lyrics.useSpotifyForLookup),
      () => setOn(false),
    );
  }, []);
  if (on === null) return null;
  const set = async (v: boolean) => {
    const r = await api<{ lyrics: { useSpotifyForLookup: boolean } }>('/me/settings', {
      method: 'PUT',
      body: { lyrics: { useSpotifyForLookup: v } },
    });
    setOn(r.lyrics.useSpotifyForLookup);
  };
  return (
    <>
      <Toggle label={t.lookup} checked={on} onChange={(v) => void set(v)} />
      <p className="field-hint">{t.lookupHint}</p>
    </>
  );
}
