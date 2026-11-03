import type { Track } from './types.ts';

// YouTube Music mode's shapes (src/server/youtube/catalogue.ts makes them, src/client/youtube shows
// them). Every page (Home, Explore, Library, search, an album, an artist, a playlist, Related) is a
// YtPage: an optional header, an optional track list, and shelves of items. A song or video item
// carries its playable Track (`provider: 'youtube'`, `id`: the video id).

export type YtKind = 'song' | 'video' | 'album' | 'playlist' | 'artist';

export interface YtItem {
  kind: YtKind;
  /** The video id (song, video), or the browse id (album, artist, playlist). */
  id: string;
  title: string;
  subtitle: string;
  /** Through ECHO's image proxy, or empty. */
  thumb: string;
  track?: Track;
}

export interface YtShelf {
  title: string;
  strapline?: string;
  /** Rows: song lists (Quick picks, Top songs). Cards: albums, playlists, artists. */
  layout: 'rows' | 'cards';
  items: YtItem[];
}

export interface YtPage {
  title: string;
  subtitle?: string;
  description?: string;
  thumb?: string;
  kind?: YtKind;
  id?: string;
  /** What Play plays: an album's or playlist's songs, an artist's top songs. */
  tracks?: Track[];
  shelves: YtShelf[];
}

export const YT_TABS = ['all', 'songs', 'albums', 'artists', 'playlists'] as const;
export type YtTab = (typeof YT_TABS)[number];

export interface YtUpNext {
  tracks: Track[];
}

export interface YtLyrics {
  text: string;
  source: string;
}
