import { type ComponentProps, createContext, type MouseEvent, useContext } from 'react';
import { useStore } from 'zustand';
import { type Route, routePath, type ViewState, type ViewStore } from '../view.ts';

export const ViewContext = createContext<ViewStore | null>(null);

export function useView<T>(select: (s: ViewState) => T): T {
  const store = useContext(ViewContext);
  if (!store) throw new Error('useView outside <Shell>');
  return useStore(store, select);
}

/** A real `<a href>` (open in new tab and copy link work); plain left clicks navigate in place. */
export function Link({ to, ...rest }: { to: Route } & ComponentProps<'a'>) {
  const navigate = useView((s) => s.navigate);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={routePath(to)} onClick={onClick} {...rest} />;
}
