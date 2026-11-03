import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';
import { ytLike, ytLiked } from './api.ts';

/** Each song's like: YouTube's answer, then what is pressed here. */
const likes = createStore<Record<string, boolean>>()(() => ({}));

/** A song's like and its toggle, for the strip and Now spinning alike. */
export function useLike(id: string): [on: boolean, toggle: () => Promise<void>] {
  const on = useStore(likes, (l) => !!l[id]);
  useEffect(() => {
    if (id in likes.getState()) return;
    void ytLiked(id).then(
      (like) => !(id in likes.getState()) && likes.setState({ [id]: like }),
      () => undefined,
    );
  }, [id]);
  const toggle = async () => {
    const was = !!likes.getState()[id];
    likes.setState({ [id]: !was });
    try {
      await ytLike(id, !was);
    } catch {
      likes.setState({ [id]: was });
      toastStore.getState().show(strings.youtube.likeFailed);
    }
  };
  return [on, toggle];
}
