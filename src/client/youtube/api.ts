import type { YtLyrics, YtPage, YtUpNext } from '../../shared/youtube.ts';
import { api } from '../api.ts';

// YouTube Music mode's calls to ECHO (src/server/youtube/routes.ts). A 409 `youtube.signed_out`
// (with `stale` when a saved sign-in stopped working) arrives as an ApiError.

/** A page by its API path under /youtube: `home`, `album/<id>`, `search?q=…&tab=…`. */
export const ytPage = (path: string) => api<YtPage>(`/youtube/${path}`);

export const ytSuggest = async (q: string) =>
  (await api<{ items: string[] }>(`/youtube/suggest?${new URLSearchParams({ q })}`)).items;

export const ytUpNext = (videoId: string) =>
  api<YtUpNext>(`/youtube/up-next/${encodeURIComponent(videoId)}`);

export const ytLyrics = (videoId: string) =>
  api<YtLyrics>(`/youtube/lyrics/${encodeURIComponent(videoId)}`);

export const ytLike = (videoId: string, like: boolean) =>
  api<{ like: boolean }>(`/youtube/like/${encodeURIComponent(videoId)}`, {
    method: 'PUT',
    body: { like },
  });

export const ytLiked = async (videoId: string) =>
  (await api<{ like: boolean }>(`/youtube/like/${encodeURIComponent(videoId)}`)).like;

export const ytPrepare = (ids: string[]) =>
  api<null>('/youtube/prepare', { method: 'POST', body: { ids } });
