import qrcode from 'qrcode-generator';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { usePlayer } from '../playback/context.tsx';
import { strings } from '../strings.ts';
import { Button } from '../ui/controls.tsx';
import { TrackList, TrackRow } from '../ui/media.tsx';
import { Sheet } from '../ui/overlays.tsx';
import { linkOf, type TogetherItem, together, togetherStore } from './session.ts';

// Listen together's UI (docs/TOGETHER.md): the button that starts a session (Now Playing, the
// queue), the sheet with its QR code, link and listeners, the offer a link opens, and the shared
// queue that stands in for the local one while in a session.

const s = strings.together;

function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
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
      aria-label={s.qrLabel}
      shapeRendering="crispEdges"
    >
      <path d={svg.d} />
    </svg>
  );
}

/** "Listen together", or while in a session "Listening together · 3": both open the sheet. */
export function TogetherButton() {
  const session = useStore(togetherStore, (x) => x.session);
  if (session)
    return (
      <button
        type="button"
        className="chip together-chip"
        data-on
        onClick={() => togetherStore.setState({ sheetOpen: true })}
      >
        {s.chip(session.members.length)}
      </button>
    );
  return (
    <Button variant="secondary" onClick={() => void together()?.start()}>
      {s.start}
    </Button>
  );
}

/** The session's sheet and a link's offer, mounted once in the shell. */
export function TogetherRoot() {
  const t = useStore(togetherStore);
  const [copied, setCopied] = useState(false);
  const close = () => togetherStore.setState({ sheetOpen: false });
  const session = t.session;
  const link = session ? linkOf(session) : '';
  const offer = t.offer;
  return (
    <>
      <Sheet open={t.sheetOpen} onClose={close} title={s.title}>
        <div className="guest-invite together-sheet">
          {session ? (
            <>
              <p className="field-hint">{s.blurb}</p>
              <div className="guest-qr-frame">
                <QrCode text={link} />
              </div>
              <div className="together-link">
                <code>{link}</code>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void navigator.clipboard?.writeText(link).then(() => setCopied(true))
                  }
                >
                  {copied ? s.copied : s.copy}
                </Button>
              </div>
              <h3 className="sheet-section">{s.members(session.members.length)}</h3>
              <ul className="guest-list together-members">
                {session.members.map((m) => (
                  <li key={m.id} data-away={m.online ? undefined : true}>
                    <span className="guest-avatar" aria-hidden="true">
                      {m.username.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="guest-who">
                      {m.username}
                      {[
                        m.host ? s.host : null,
                        m.id === session.you.id ? s.you : null,
                        m.online ? null : s.away,
                      ]
                        .filter(Boolean)
                        .map((x) => ` · ${x}`)
                        .join('')}
                    </span>
                  </li>
                ))}
              </ul>
              <Button variant="destructive" onClick={() => void together()?.leave()}>
                {session.you.host ? s.end : s.leave}
              </Button>
            </>
          ) : (
            <p className="field-hint" role="status">
              {t.error ?? s.starting}
            </p>
          )}
        </div>
      </Sheet>
      <Sheet
        open={!!offer && !session}
        onClose={() => togetherStore.setState({ offer: null })}
        title={s.joinTitle}
      >
        <div className="guest-invite together-sheet">
          <p className="field-hint" role="status">
            {offer?.state === 'ready'
              ? s.joinText(offer.host, offer.members)
              : offer?.state === 'other_library'
                ? s.otherLibrary(offer.host)
                : offer?.state === 'gone'
                  ? s.gone
                  : offer?.state === 'failed'
                    ? s.joinFailed
                    : s.starting}
          </p>
          <div className="together-actions">
            {offer?.state === 'ready' && (
              <Button variant="primary" onClick={() => void together()?.join(offer.id)}>
                {s.join}
              </Button>
            )}
            <Button variant="secondary" onClick={() => togetherStore.setState({ offer: null })}>
              {s.notNow}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** The shared queue, in place of the local one while in a session. */
export function TogetherQueue() {
  const session = useStore(togetherStore, (x) => x.session);
  const status = usePlayer((p) => p.status);
  if (!session) return null;
  const host = session.you.host;
  const row = (it: TogetherItem, now: boolean) => {
    const mine = it.addedBy.id === session.you.id;
    const menu = [
      ...(host && !now
        ? [{ label: s.playNow, onSelect: () => void together()?.jump(it.uid) }]
        : []),
      ...((host || mine) && !now
        ? [{ label: s.remove(it.track.title), onSelect: () => void together()?.remove(it.uid) }]
        : []),
    ];
    return (
      <TrackRow
        key={it.uid}
        title={it.track.title}
        artist={`${it.track.artist} · ${s.addedBy(mine ? s.you : it.addedBy.username)}`}
        durationMs={it.track.durationMs}
        artwork={{ src: it.track.cover, album: it.track.album }}
        nowPlaying={now && status === 'playing'}
        onPlay={() =>
          now ? host && void together()?.play() : host && void together()?.jump(it.uid)
        }
        {...(menu.length ? { menu } : {})}
      />
    );
  };
  return (
    <div className="together-queue">
      <TogetherButton />
      <h3 className="sheet-section">{s.nowPlaying}</h3>
      {session.now ? (
        <TrackList label={s.nowPlaying}>{row(session.now, true)}</TrackList>
      ) : (
        <p className="empty">{s.nothing}</p>
      )}
      <h3 className="sheet-section">{s.upNext}</h3>
      {session.queue.length ? (
        <TrackList label={s.upNext}>{session.queue.map((it) => row(it, false))}</TrackList>
      ) : (
        <p className="empty">{s.empty}</p>
      )}
    </div>
  );
}

/** Whether a session is on (the queue shows the shared one). */
export const useTogether = () => useStore(togetherStore, (x) => x.session !== null);
