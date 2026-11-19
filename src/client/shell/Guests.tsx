import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { strings } from '../strings.ts';
import { Button } from '../ui/controls.tsx';
import { Sheet } from '../ui/overlays.tsx';

// Guest accounts on the web (src/server/guests.ts): show a QR code a guest scans with the ECHO
// app (any screen does: a laptop, a TV), and keep or end the guests one invited. Guests themselves
// use the Android app; a guest link opened in a browser says so.

type Code = { code: string; url: string; expiresAt: number; durationMs: number };
type Guest = {
  id: number;
  username: string;
  invitedBy: string | null;
  createdAt: number;
  expiresAt: number;
  keep: { username: string; requestedAt: number } | null;
};

const HOUR = 3_600_000;
const DURATIONS = [HOUR, 24 * HOUR, 7 * 24 * HOUR] as const;

/** A QR code as SVG modules (crisp at any size). */
function QrCode({ text, label }: { text: string; label: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'H');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    const cells: string[] = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (q.isDark(y, x)) cells.push(`M${x} ${y}h1v1h-1z`);
    return { n, d: cells.join('') };
  }, [text]);
  return (
    <svg
      className="guest-qr"
      viewBox={`0 0 ${svg.n} ${svg.n}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={svg.d} />
    </svg>
  );
}

function useNow(every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** Invite a guest: a one-time QR code (10 minutes) for an hour, a day or a week of listening. */
export function InviteGuestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const g = strings.guests;
  const [duration, setDuration] = useState<number>(DURATIONS[1]);
  const [round, setRound] = useState(0);
  const [code, setCode] = useState<Code | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const now = useNow();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` asks for a new code
  useEffect(() => {
    if (!open) return;
    let live = true;
    setCode(null);
    setError(null);
    setJoined(null);
    api<Code>('/guests/codes', { method: 'POST', body: { durationMs: duration } })
      .then((c) => live && setCode(c))
      .catch(
        (e: unknown) =>
          live &&
          setError(
            e instanceof ApiError && e.body.error === 'too_many_codes' ? g.tooMany : g.failed,
          ),
      );
    return () => {
      live = false;
    };
  }, [open, duration, round, g]);

  // While the code shows, notice the guest joining.
  useEffect(() => {
    if (!open || !code) return;
    let live = true;
    let before: Set<number> | null = null;
    const check = async () => {
      const list = await api<Guest[]>('/guests').catch(() => null);
      if (!live || !list) return;
      if (!before) before = new Set(list.map((x) => x.id));
      else {
        const fresh = list.find((x) => !before?.has(x.id));
        if (fresh) setJoined(fresh.username);
      }
    };
    void check();
    const t = setInterval(check, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open, code]);

  const left = code ? Math.max(0, code.expiresAt - now) : 0;
  return (
    <Sheet open={open} onClose={onClose} title={g.invite}>
      <div className="guest-invite">
        <p className="field-hint">{g.inviteHint}</p>
        <div className="guest-qr-frame">
          {joined ? (
            <p className="guest-joined" role="status">
              {g.joined(joined)}
            </p>
          ) : code && left > 0 ? (
            <>
              <QrCode text={code.url} label={g.qrLabel} />
              <span className="guest-qr-mark" aria-hidden="true">
                ECHO
              </span>
            </>
          ) : code ? (
            <Button variant="secondary" onClick={() => setRound((r) => r + 1)}>
              {g.newCode}
            </Button>
          ) : (
            <p className="field-hint">{error ?? g.making}</p>
          )}
        </div>
        <div className="guest-durations" role="radiogroup" aria-label={g.howLong}>
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={duration === d}
              className="chip"
              data-on={duration === d || undefined}
              onClick={() => setDuration(d)}
            >
              {g.duration(d)}
            </button>
          ))}
        </div>
        <p className="field-hint num" aria-live="polite">
          {joined
            ? g.joinedHint(g.duration(duration))
            : code && left > 0
              ? g.codeLeft(Math.ceil(left / 1000))
              : code
                ? g.ranOut
                : ''}
        </p>
      </div>
    </Sheet>
  );
}

/** Settings → Account: invite a guest, and the guests this user invited (all, for an admin). */
export function GuestsBlock() {
  const g = strings.guests;
  const [inviting, setInviting] = useState(false);
  const [list, setList] = useState<Guest[] | null>(null);
  const [reload, setReload] = useState(0);
  const now = useNow(30_000);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` and closing the sheet refresh it
  useEffect(() => {
    if (inviting) return;
    let live = true;
    api<Guest[]>('/guests')
      .then((l) => live && setList(l))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [inviting, reload]);
  const act = async (path: string) => {
    await api(path, { method: 'POST', body: {} }).catch(() => {});
    setReload((r) => r + 1);
  };
  return (
    <section className="account-block" aria-labelledby="guests-title">
      <h3 id="guests-title">{g.title}</h3>
      <p className="field-hint">{g.blurb}</p>
      <Button variant="secondary" onClick={() => setInviting(true)}>
        {g.invite}
      </Button>
      {!!list?.length && (
        <ul className="guest-list">
          {list.map((x) => (
            <li key={x.id}>
              <span className="guest-avatar" aria-hidden="true">
                {(x.keep?.username ?? x.username).slice(0, 1).toUpperCase()}
              </span>
              <span className="guest-who">
                <span>{x.keep ? g.wantsToStay(x.keep.username) : x.username}</span>
                <span className="field-hint">{g.timeLeft(x.expiresAt - now)}</span>
              </span>
              {x.keep && (
                <Button variant="primary" onClick={() => void act(`/guests/${x.id}/approve`)}>
                  {g.approve}
                </Button>
              )}
              <Button variant="secondary" onClick={() => void act(`/guests/${x.id}/end`)}>
                {g.end}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <InviteGuestSheet open={inviting} onClose={() => setInviting(false)} />
    </section>
  );
}

/** A guest link opened in a browser: the pass is for the ECHO app. */
export function GuestLanding() {
  const g = strings.guests;
  return (
    <main className="guest-landing">
      <h1>{g.landingTitle}</h1>
      <p>{g.landingText}</p>
    </main>
  );
}
