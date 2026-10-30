import type { Track } from '../../shared/types.ts';
import type { Album } from '../library.ts';
import { strings } from '../strings.ts';
import { Icon } from '../ui/icons.tsx';
import { canStar, setStar, useStarred } from './collections.ts';

// Spotify's heart (a song) and save-to-library check (an album): outline when not saved, filled
// green when saved. Navidrome's star underneath. Only on Navidrome items, where it can be saved.

export function HeartButton({ track: t, size = 'md' }: { track: Track; size?: 'md' | 'lg' }) {
  const on = useStarred('track', t.id);
  if (!canStar() || t.provider !== 'navidrome') return null;
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
  if (!canStar() || a.id.startsWith('spotify:')) return null;
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
