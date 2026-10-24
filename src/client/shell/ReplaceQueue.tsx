import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { strings } from '../strings.ts';
import { ConfirmDialog } from '../ui/overlays.tsx';

// "Replace the queue?" (PRODUCT_SPEC.md §6.2, QUE-03): asked when music from the other provider
// would replace what is queued. The controller awaits the answer.

const replaceStore = createStore<{ label: string; answer: (ok: boolean) => void } | null>()(
  () => null,
);

export const confirmReplace = (provider: { label?: string; id: string }) =>
  new Promise<boolean>((answer) =>
    replaceStore.setState({ label: provider.label ?? provider.id, answer }, true),
  );

export function ReplaceQueueDialog() {
  const pending = useStore(replaceStore);
  const done = (ok: boolean) => {
    pending?.answer(ok);
    replaceStore.setState(null, true);
  };
  return (
    <ConfirmDialog
      open={!!pending}
      title={strings.spotify.replaceQueue(pending?.label ?? '')}
      consequence={strings.spotify.replaceConsequence}
      confirmLabel={strings.spotify.replace}
      onConfirm={() => done(true)}
      onCancel={() => done(false)}
    />
  );
}
