import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { strings } from '../strings.ts';
import { QrCode } from './Guests.tsx';
import { loadWall } from './wall.ts';

// The sign-in page (as on Android): the account's covers drift slowly behind a frosted card, the
// ECHO wordmark in its gradient over them; beside the form, "Sign in with your phone": a QR code
// the ECHO app scans and approves (src/server/qrlogin.ts).

const COLUMNS = 7;
const PER_COLUMN = 8;
/** The wall's fixed grid: columns and rows (each column twice over, so its drift loops). */
const COLUMN_IDS = Array.from({ length: COLUMNS }, (_, i) => i);
const ROW_IDS = Array.from({ length: PER_COLUMN * 2 }, (_, i) => i);

/** The drifting wall: tilted columns of covers (or coloured tiles), alternating up and down. */
export function CoverWall() {
  const covers = useMemo(loadWall, []);
  return (
    <div className="signin-wall" aria-hidden="true">
      <div className="signin-wall-tilt">
        {COLUMN_IDS.map((col) => (
          <div key={col} className="signin-col" data-dir={col % 2 ? 'up' : 'down'}>
            {ROW_IDS.map((row) => {
              const i = col * PER_COLUMN + (row % PER_COLUMN);
              const cover = covers.length ? covers[(i * 7) % covers.length] : null;
              return cover ? (
                <img key={row} className="signin-tile" src={cover} alt="" />
              ) : (
                <span key={row} className="signin-tile" data-tile={(i * 5 + col) % 8} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="signin-shade" />
    </div>
  );
}

type Request = { id: string; poll: string; url: string; expiresAt: number };

/** Sign in with your phone: a QR code that renews itself, waiting for the phone to approve. */
export function PhoneSignIn() {
  const s = strings.auth;
  const [req, setReq] = useState<Request | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` asks for a new request
  useEffect(() => {
    let live = true;
    setFailed(false);
    api<Request>('/auth/qr', { method: 'POST', body: {} })
      .then((r) => live && setReq(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [round]);

  useEffect(() => {
    if (!req) return;
    let live = true;
    const t = setInterval(async () => {
      if (Date.now() >= req.expiresAt) return setRound((r) => r + 1); // a fresh code
      const r = await api<{ status: string }>('/auth/qr/poll', {
        method: 'POST',
        body: { id: req.id, poll: req.poll },
      }).catch(() => null);
      if (!live || !r) return;
      if (r.status === 'approved') window.location.assign('/');
      else if (r.status === 'expired') setRound((x) => x + 1);
    }, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [req]);

  return (
    <section className="signin-phone" aria-labelledby="signin-phone-title">
      <h2 id="signin-phone-title">{s.phoneTitle}</h2>
      <div className="signin-qr">
        {req ? (
          <QrCode text={req.url} label={s.phoneQr} />
        ) : (
          <p className="field-hint">{failed ? s.phoneFailed : '…'}</p>
        )}
      </div>
      <ol className="signin-steps">
        {s.phoneSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

/** The whole page: the wall, the wordmark, the card with the form and the phone's QR code. */
export function SignInStage({ children, phone = true }: { children: ReactNode; phone?: boolean }) {
  return (
    <div className="signin-stage">
      <CoverWall />
      <div className="signin-content">
        <p className="signin-logo">
          {strings.app}
          <span>{window.location.host}</span>
        </p>
        <div className="signin-card" data-phone={phone || undefined}>
          <div className="signin-form">{children}</div>
          {phone && <PhoneSignIn />}
        </div>
      </div>
    </div>
  );
}
