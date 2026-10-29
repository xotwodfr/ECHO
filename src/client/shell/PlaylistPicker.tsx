import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Track } from '../../shared/types.ts';
import { strings } from '../strings.ts';
import { Icon } from '../ui/icons.tsx';
import { Sheet } from '../ui/overlays.tsx';
import { addToPlaylist, createPlaylist, usePlaylists } from './collections.ts';

// "Add to playlist" (Spotify's): a sheet listing the user's playlists, a new one first.

const picker = createStore<{ tracks: Track[] | null }>()(() => ({ tracks: null }));

export const openPicker = (tracks: Track[]) => picker.setState({ tracks });
const close = () => picker.setState({ tracks: null });

export function PlaylistPicker() {
  const tracks = useStore(picker, (s) => s.tracks);
  const playlists = usePlaylists();
  const s = strings.playlist;
  return (
    <Sheet open={!!tracks} onClose={close} title={s.addTo}>
      {tracks && (
        <ul className="picker">
          <li>
            <button
              type="button"
              onClick={() => {
                close();
                void createPlaylist(tracks);
              }}
            >
              <span className="picker-icon" aria-hidden="true">
                <Icon name="plus" />
              </span>
              {s.newPlaylist}
            </button>
          </li>
          {(Array.isArray(playlists) ? playlists : [])
            .filter((p) => !p.id.startsWith('spotify:'))
            .map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void addToPlaylist(p, tracks);
                  }}
                >
                  <span className="picker-icon" aria-hidden="true">
                    <Icon name="music" />
                  </span>
                  {p.name}
                </button>
              </li>
            ))}
        </ul>
      )}
    </Sheet>
  );
}
