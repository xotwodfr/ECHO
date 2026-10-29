import type { DragEvent } from 'react';
import type { Track } from '../../shared/types.ts';

// Songs dragged onto a playlist, Liked Songs or the queue (Spotify's). The tracks travel here: a
// drag carries only text across the page, and a drop that is not ours is left alone.

const TYPE = 'text/x-echo-tracks';
let carried: Track[] = [];

/** On a song row: it can be picked up. */
export const dragTracks = (tracks: Track[]) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => {
    carried = tracks;
    e.dataTransfer.setData(TYPE, tracks.map((t) => t.title).join('\n'));
    e.dataTransfer.effectAllowed = 'copy';
  },
  onDragEnd: () => {
    carried = [];
  },
});

const ours = (e: DragEvent) => e.dataTransfer.types.includes(TYPE);

/** On a place songs can land: marked while one is over it (`data-drop`, ui.css). */
export const dropTracks = (land: (tracks: Track[]) => void) => ({
  onDragOver: (e: DragEvent<HTMLElement>) => {
    if (!ours(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.dataset.drop = '';
  },
  onDragLeave: (e: DragEvent<HTMLElement>) => {
    delete e.currentTarget.dataset.drop;
  },
  onDrop: (e: DragEvent<HTMLElement>) => {
    delete e.currentTarget.dataset.drop;
    if (!ours(e) || !carried.length) return;
    e.preventDefault();
    land(carried);
    carried = [];
  },
});
