import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ApiError, api } from '../api.ts';
import type { Album } from '../library.ts';
import { sessionStore } from '../session.ts';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';
import { ConfirmDialog, type MenuItem } from '../ui/overlays.tsx';

// The album's animated lock-screen cover (docs/MOTION.md), for admins: in the album page's menu,
// upload a video to be the album's motion cover in the iPhone app, or remove it. Without an upload
// the server makes one from the cover itself; there is nothing to show for that here.

const MAX_BYTES = 50 * 1024 * 1024;
const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
};
const ACCEPT = 'video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v';

interface Upload {
  type: string;
  bytes: number;
  uploadedAt: number;
  status: 'queued' | 'working' | 'ready' | 'failed';
  error?: string;
}

const path = (albumId: string) => `/motion/${encodeURIComponent(albumId)}/upload`;
const toast = (message: string) => toastStore.getState().show(message);

/** The file's type as the server takes it: what the browser says, else its extension's. */
function typeOf(file: File) {
  if (Object.values(TYPES).includes(file.type)) return file.type;
  return TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** Follows the conversion for a while, and says how it went. */
async function follow(albumId: string) {
  const s = strings.motion;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1000 : 3000));
    const r = await api<{ upload: Upload | null }>(path(albumId)).catch(() => null);
    if (!r?.upload) return;
    if (r.upload.status === 'ready') return toast(s.ready);
    if (r.upload.status === 'failed') return toast(s.convertFailed(r.upload.error ?? ''));
  }
}

/** The menu items and the hidden parts (file picker, confirmation) for an admin; nothing for others. */
export function useMotionCover(album: Album | undefined): { items: MenuItem[]; ui: ReactNode } {
  const session = useStore(sessionStore);
  const admin = session.status === 'signedIn' && session.role === 'admin';
  // A Navidrome album (the server makes covers per Navidrome album), known by its tracks' key.
  const navidrome = !!album?.tracks.some((t) => t.album.key.startsWith('navidrome:'));
  const on = admin && navidrome;
  const albumId = album?.id ?? '';
  const [state, setState] = useState<{ enabled: boolean; upload: Upload | null } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const s = strings.motion;

  const refresh = useCallback(() => {
    if (!on) return setState(null);
    api<{ enabled: boolean; upload: Upload | null }>(path(albumId)).then(setState, () =>
      setState(null),
    );
  }, [on, albumId]);
  useEffect(refresh, [refresh]);

  async function send(file: File) {
    const type = typeOf(file);
    if (!type) return toast(s.notVideo);
    if (file.size > MAX_BYTES) return toast(s.tooLarge);
    toast(s.uploading);
    let res: Response;
    try {
      res = await fetch(`/api/v1${path(albumId)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': type },
        body: file,
      });
    } catch {
      return toast(s.failed);
    }
    if (res.status === 413) return toast(s.tooLarge);
    if (res.status === 415) return toast(s.notVideo);
    if (!res.ok) return toast(s.failed);
    toast(s.uploaded);
    refresh();
    void follow(albumId).then(refresh);
  }

  async function remove() {
    try {
      await api(path(albumId), { method: 'DELETE' });
      toast(s.removed);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) toast(s.failed);
    }
    refresh();
  }

  if (!on || !album || !state?.enabled) return { items: [], ui: null };
  const items: MenuItem[] = [
    {
      label: state.upload ? s.replace : s.upload,
      onSelect: () => input.current?.click(),
    },
    ...(state.upload
      ? [{ label: s.remove, onSelect: () => setConfirm(true), destructive: true }]
      : []),
  ];
  const ui = (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label={s.upload}
        data-testid="motion-cover-file"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void send(file);
        }}
      />
      <ConfirmDialog
        open={confirm}
        title={s.removeTitle}
        consequence={s.removeConsequence(album.title)}
        confirmLabel={s.removeConfirm}
        onConfirm={() => {
          setConfirm(false);
          void remove();
        }}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
  return { items, ui };
}
