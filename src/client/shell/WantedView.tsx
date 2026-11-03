import { type FormEvent, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useLibrary, usePlayback } from '../playback/context.tsx';
import { sessionStore } from '../session.ts';
import { strings } from '../strings.ts';
import { Button, Field, IconButton, Pill } from '../ui/controls.tsx';
import { toastStore } from '../ui/logic.ts';
import { BlockError, RowsLoading } from '../ui/states.tsx';
import {
  addWanted,
  ago,
  loadWanted,
  removeWanted,
  type WantedItem,
  wantedStore,
  youTubeMusicSearch,
} from './wanted.ts';

// Your Library → Wanted (layout A, owner's choice 2026-11-03): an intro, a field to add something,
// then one list, newest first. Each item says who added it and when; once the library has it, it is
// marked and plays from its album; until then it links to YouTube Music. Anyone removes anything.

const t = strings.wanted;

export function WantedList() {
  const items = useStore(wantedStore, (s) => s.items);
  const [text, setText] = useState('');
  // Opening the page has the server look for what is still missing.
  useEffect(() => void loadWanted(), []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const r = await addWanted(text);
    if (!r) return toastStore.getState().show(t.failed);
    if (r.known) toastStore.getState().show(t.known);
    setText('');
  }

  return (
    <div className="wanted">
      <p className="wanted-intro">{t.intro}</p>
      <form className="wanted-add" onSubmit={(e) => void add(e)}>
        <Field
          label={t.add}
          placeholder={t.addHint}
          autoComplete="off"
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button variant="primary" type="submit">
          {t.addButton}
        </Button>
      </form>
      {items === null ? (
        <RowsLoading label={t.title} />
      ) : items === 'error' ? (
        <BlockError what={t.loadFailed} onRetry={() => void loadWanted()} />
      ) : items.length ? (
        <ul className="wanted-list" aria-label={t.title}>
          {items.map((item) => (
            <WantedRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="empty">{t.empty}</p>
      )}
    </div>
  );
}

function WantedRow({ item }: { item: WantedItem }) {
  const session = useStore(sessionStore);
  const me = session.status === 'signedIn' ? session.username : null;
  const play = usePlayFound();
  const who = item.addedBy && item.addedBy === me ? t.you : item.addedBy;
  return (
    <li className="wanted-row">
      <span className="wanted-text">
        <span className="wanted-name">{item.text}</span>
        <span className="wanted-sub">{t.by(who, ago(item.addedAt))}</span>
      </span>
      {item.found ? (
        <>
          <Pill tone="pos">{t.found}</Pill>
          <IconButton
            label={t.play(item.found.title)}
            icon="play"
            onClick={() => void play(item.found as NonNullable<WantedItem['found']>)}
          />
        </>
      ) : (
        <>
          <Pill tone="neutral">{t.missing}</Pill>
          <a
            className="wanted-elsewhere"
            href={youTubeMusicSearch(item.text)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.youTubeMusic}
          </a>
        </>
      )}
      <IconButton
        label={t.remove(item.text)}
        icon="close"
        onClick={() =>
          void removeWanted(item.id).then((ok) => ok || toastStore.getState().show(t.failed))
        }
      />
    </li>
  );
}

/** Plays what the library matched: an album from its start, a song in its album. */
function usePlayFound() {
  const c = usePlayback();
  const library = useLibrary();
  return async (found: NonNullable<WantedItem['found']>) => {
    const albumId = found.kind === 'album' ? found.id : found.albumId;
    if (!albumId || !library) return;
    const album =
      (await library.loadAlbum?.(albumId).catch(() => undefined)) ?? library.album(albumId);
    if (!album?.tracks.length) return toastStore.getState().show(strings.states.albumFailed);
    const index =
      found.kind === 'song'
        ? Math.max(
            0,
            album.tracks.findIndex((x) => x.id === found.id),
          )
        : 0;
    c.playList(album.tracks, index, { kind: 'album', id: album.id, title: album.title });
  };
}
