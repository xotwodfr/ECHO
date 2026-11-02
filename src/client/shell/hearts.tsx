import { useStore } from 'zustand';
import type { Track } from '../../shared/types.ts';
import type { Album } from '../library.ts';
import { sourceOf } from '../source.ts';
import { spotifyScopes } from '../spotify/api.ts';
import { strings } from '../strings.ts';
import { Icon } from '../ui/icons.tsx';
import { canStar, setStar, sourceOfItem, useStarred } from './collections.ts';

// Spotify's heart (a song) and save-to-library check (an album): outline when not saved, filled
// when saved. Each saves to its item's own source (a Navidrome star, Spotify's library), whichever
// source is active.

export function HeartButton({ track: t, size = 'md' }: { track: Track; size?: 'md' | 'lg' }) {
  const source = sourceOfItem('track', t);
  const on = useStarred('track', t.id, source);
  useStore(spotifyScopes); // re-render once the connection's scopes are known
  if (!canStar(source)) return null;
  return (
    <button
      type="button"
      className={`heart heart--${size}`}
      aria-pressed={on}
      aria-label={on ? strings.liked.unlike(t.title) : strings.liked.like(t.title)}
      title={on ? strings.liked.unlike(t.title) : strings.liked.like(t.title)}
      onClick={() => void setStar('track', t, !on)}
    >
      <Icon name="heart" solid={on} />
    </button>
  );
}

export function SaveAlbumButton({ album: a }: { album: Album }) {
  const on = useStarred('album', a.id);
  useStore(spotifyScopes);
  if (!canStar(sourceOf(a.id))) return null;
  return (
    <button
      type="button"
      className="heart heart--lg"
      aria-pressed={on}
      aria-label={on ? strings.liked.unsave(a.title) : strings.liked.save(a.title)}
      title={on ? strings.liked.unsave(a.title) : strings.liked.save(a.title)}
      onClick={() => void setStar('album', a, !on)}
    >
      <Icon name={on ? 'check' : 'plus'} />
    </button>
  );
}
