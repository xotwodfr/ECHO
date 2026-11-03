import type { AnimationEvent } from 'react';
import type { Track } from '../../shared/types.ts';
import type { Album } from '../library.ts';
import { strings } from '../strings.ts';
import { Icon } from '../ui/icons.tsx';
import { canStar, setStar, useStarred } from './collections.ts';

// A heart (a song) and a save-to-library check (an album): outline when not saved, filled when
// saved (a Navidrome star).

// A heart pops when it is clicked (main.css, data-pop), never when a page shows it already saved.
const pop = (el: HTMLElement, on: boolean) => {
  el.dataset.pop = on ? 'in' : 'out';
};
const popped = (e: AnimationEvent<HTMLButtonElement>) => {
  if (e.animationName !== 'heart-ring') delete e.currentTarget.dataset.pop;
};

export function HeartButton({ track: t, size = 'md' }: { track: Track; size?: 'md' | 'lg' }) {
  const on = useStarred('track', t.id);
  if (!canStar()) return null;
  return (
    <button
      type="button"
      className={`heart heart--${size}`}
      aria-pressed={on}
      aria-label={on ? strings.liked.unlike(t.title) : strings.liked.like(t.title)}
      title={on ? strings.liked.unlike(t.title) : strings.liked.like(t.title)}
      onClick={(e) => {
        pop(e.currentTarget, !on);
        void setStar('track', t, !on);
      }}
      onAnimationEnd={popped}
    >
      <Icon name="heart" solid={on} />
    </button>
  );
}

export function SaveAlbumButton({ album: a }: { album: Album }) {
  const on = useStarred('album', a.id);
  if (!canStar()) return null;
  return (
    <button
      type="button"
      className="heart heart--lg"
      aria-pressed={on}
      aria-label={on ? strings.liked.unsave(a.title) : strings.liked.save(a.title)}
      title={on ? strings.liked.unsave(a.title) : strings.liked.save(a.title)}
      onClick={(e) => {
        pop(e.currentTarget, !on);
        void setStar('album', a, !on);
      }}
      onAnimationEnd={popped}
    >
      <Icon name={on ? 'check' : 'plus'} />
    </button>
  );
}
