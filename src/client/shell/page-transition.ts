import { flushSync } from 'react-dom';
import {
  fly,
  ghost,
  insetTo,
  noteRoute,
  pageStyles,
  space,
  timing,
  tokenMs,
} from '../ui/motion.ts';
import { type Route, routePath } from '../view.ts';

// Page changes (DESIGN_SYSTEM.md §11) as View Transitions: the page fades out, the new one rises in
// on the spring, and a cover flies between a card and its page's header, both ways.

const motionFull = () => document.documentElement.dataset.motion === 'full';

/** The cover of a card on screen that leads to `path`: where a page's header cover flies back to. */
export function cardFor(root: ParentNode, path: string): HTMLElement | null {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('.tile .tile-link')) {
    if (link.getAttribute('href') !== path) continue;
    const art = link.closest('.tile')?.querySelector<HTMLElement>('.art');
    const r = art?.getBoundingClientRect();
    if (art && r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight) return art;
  }
  return null;
}

/**
 * A page change: the page cross-fades and rises, and a clicked card's cover flies into its page's
 * header, or the header's cover back into its card on the page it came from (main.css, "Page
 * changes"); the rest of the frame holds still. Not with less motion. Into or out of the lyrics
 * view it is `stageTransition`: a View Transition would snapshot its live room, which is slow.
 */
export function pageTransition(update: () => void, from: Route, to: Route) {
  noteRoute(); // what loads from here on belongs to the new page (useArrival)
  if (switching) return update(); // inside a source switch's own change
  const stage = from.view === 'listen' || to.view === 'listen';
  // From a text field (the search box opens Search on focus) the page changes at once, under the typing.
  const typing = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
  if (!motionFull() || typing || document.hidden) return update();
  if (stage) return stageTransition(update, to.view === 'listen');
  if (!document.startViewTransition) return update();
  const tile = lastClicked?.closest('.tile');
  const card = tile?.querySelector<HTMLElement>('.art');
  lastClicked = null;
  const named: HTMLElement[] = [];
  const name = (el: HTMLElement, n: string) => {
    el.style.viewTransitionName = n;
    named.push(el);
  };
  // One cover per name in each page: the card's, or else the header's (main.css names it).
  const headers = () => document.querySelectorAll<HTMLElement>('.page-head .art');
  if (card) {
    for (const el of headers()) name(el, 'none');
    name(card, 'cover');
  }
  const back = !card && headers().length > 0;
  const root = document.documentElement;
  root.classList.add('vt'); // main.css names the page and its header cover only during the change
  const t = document.startViewTransition(() => {
    flushSync(update);
    const into = back && cardFor(document, routePath(from));
    if (into) {
      for (const el of headers()) name(el, 'none');
      name(into, 'cover');
    }
  });
  void t.finished.finally(() => {
    root.classList.remove('vt');
    for (const el of named) el.style.viewTransitionName = '';
  });
}

/**
 * Into the lyrics view: it grows out of the player's cover, the cover flying to its place, while
 * a still copy of the page sinks back behind it. Out of it: a still copy of the view shrinks back
 * into the player's cover over the page, which is live at once and springs back into place.
 */
function stageTransition(update: () => void, opening: boolean) {
  const cover = () => document.querySelector<HTMLElement>('.dock .art');
  const ends: Promise<unknown>[] = [];
  const settled = (a: Animation) => ends.push(a.finished.catch(() => undefined));
  // The click only copies what is leaving; React commits the change as usual, and the motion
  // starts on the next frame, before it is painted.
  const next = (play: () => void) => {
    update();
    requestAnimationFrame(play);
  };
  if (opening) {
    const from = cover()?.getBoundingClientRect();
    const shell = document.querySelector<HTMLElement>('.shell');
    const behind = shell ? ghost(shell) : null;
    behind?.copy.querySelector('.dock')?.remove();
    behind?.host.classList.add('motion-ghost--under');
    return next(() => {
      const canvas = document.querySelector<HTMLElement>('.canvas');
      if (canvas && from) {
        const clip = insetTo(from, canvas.getBoundingClientRect());
        settled(
          canvas.animate([{ clipPath: clip }, { clipPath: 'inset(0 round 0)' }], timing('spring')),
        );
      }
      behind?.host.animate([{ opacity: 1 }, { opacity: 0.2 }], {
        ...timing('exit-big'),
        fill: 'forwards',
      });
      const big = document.querySelector<HTMLElement>('.np-side .art--cover');
      if (from && big) ends.push(fly(from, big, timing('spring')));
      const rising = document.querySelectorAll<HTMLElement>('.np-titles, .np-progress, .ly-area');
      rising.forEach((el, i) => {
        const delay = { delay: (i + 1) * 3 * tokenMs('--stagger') }; // after the cover sets off
        el.animate([{ translate: `0 ${space(4)}` }, { translate: '0 0' }], {
          ...timing('spring'),
          ...delay,
          fill: 'backwards',
        });
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
          ...timing('fade'),
          ...delay,
          fill: 'backwards',
        });
      });
      void Promise.all(ends).then(() => behind?.host.remove());
    });
  }
  // The whole lyrics view (the shell in its listen form), without the player that stays.
  const shell = document.querySelector<HTMLElement>('.shell');
  const view = shell ? ghost(shell) : null;
  view?.copy.querySelector('.dock')?.remove();
  // The copied WebGL canvas is blank: the copy paints the CSS room in its place.
  view?.copy.querySelector('.stage')?.setAttribute('data-renderer', 'css');
  const bigCopy = view?.copy.querySelector<HTMLElement>('.np-side .art--cover');
  const big = bigCopy?.getBoundingClientRect();
  if (bigCopy) bigCopy.style.visibility = 'hidden';
  next(() => {
    const to = cover();
    if (view && to) {
      const clip = insetTo(to.getBoundingClientRect(), view.host.getBoundingClientRect());
      settled(
        view.host.animate([{ clipPath: 'inset(0 round 0)' }, { clipPath: clip }], {
          ...timing('exit-big'),
          fill: 'forwards',
        }),
      );
    }
    if (big && to) ends.push(fly(big, to, timing('exit-big')));
    // The page comes back up into place: moving, never scaling.
    for (const el of document.querySelectorAll<HTMLElement>(
      '.topbar, .library-panel, .canvas, .right-panel',
    )) {
      el.animate([{ translate: `0 ${space(4)}` }, { translate: '0 0' }], timing('spring'));
      el.animate([{ opacity: 0.2 }, { opacity: 1 }], timing('fade'));
    }
    void Promise.all(ends).then(() => view?.host.remove());
  });
}

let switching = false;

/**
 * Navidrome ↔ Spotify (§11): the page and Your Library cross over like a page change (main.css
 * names both while it runs). A page change the switch makes (to Home) is part of it.
 */
export function switchTransition(update: () => void) {
  if (!document.startViewTransition || !motionFull() || document.hidden) return update();
  const root = document.documentElement;
  root.classList.add('vt', 'vt-source');
  const t = document.startViewTransition(() => {
    switching = true;
    try {
      flushSync(update);
    } finally {
      switching = false;
    }
  });
  void t.finished.finally(() => root.classList.remove('vt', 'vt-source'));
}

// The first lyrics view change should not pay for the copies' stylesheet: build it when idle.
if (typeof requestIdleCallback === 'function') requestIdleCallback(() => pageStyles());

let lastClicked: Element | null = null;
document.addEventListener('click', (e) => (lastClicked = e.target as Element), { capture: true });
