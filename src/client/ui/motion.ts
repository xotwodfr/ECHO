import { type RefObject, useLayoutEffect, useRef, useState } from 'react';

// Motion (DESIGN_SYSTEM.md §11): the owner's spring, and how much moves.

/**
 * A damped spring (mass 1) sampled from rest to settled, for a CSS `linear()` curve: 49 points
 * by default, settled when its envelope is within 0.2%. tokens.css carries (230, 21).
 */
export function springPoints(stiffness: number, damping: number, samples = 48) {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const x = (t: number) =>
    1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  const T = Math.log(500) / (zeta * w0);
  const points = Array.from({ length: samples + 1 }, (_, i) =>
    i === samples ? 1 : Math.round(x((i / samples) * T) * 1e4) / 1e4,
  );
  return { points, durationMs: Math.round(T * 1000) };
}

export type MotionPref = 'system' | 'full' | 'reduced' | 'off';
export type MotionLevel = 'full' | 'less' | 'off';

/** Settings → Motion against the device's reduce-motion setting: Full wins over the device. */
export function motionLevel(pref: MotionPref, systemReduced: boolean): MotionLevel {
  if (pref === 'off') return 'off';
  if (pref === 'reduced' || (pref === 'system' && systemReduced)) return 'less';
  return 'full';
}

export type Timing = 'spring' | 'fade' | 'exit' | 'exit-move' | 'exit-big';

/** A token's value as written in tokens.css (after the build's minifier). */
const token = (p: string) => getComputedStyle(document.documentElement).getPropertyValue(p).trim();

/** A time token in milliseconds (`--stagger`, `--dur-spring`). */
export const tokenMs = (p: string) => toMs(token(p));

/** A spacing token (tokens.css `--sp-<n>`), for distances things travel. */
export const space = (n: number) => token(`--sp-${n}`);

/** A CSS time in milliseconds: `592ms`, or `.592s` as the build's minifier writes it. */
export function toMs(time: string) {
  const n = Number.parseFloat(time);
  if (!Number.isFinite(n)) return 0;
  return /\ds$/.test(time.trim()) && !time.trim().endsWith('ms') ? n * 1000 : n;
}

/** A motion token as Web Animations options (tokens.css; zero under less motion or off). */
export function timing(name: Timing): KeyframeAnimationOptions {
  return {
    duration: toMs(token(`--dur-${name}`)),
    easing: token(name === 'exit-move' ? '--ease-exit' : `--ease-${name}`) || 'linear',
  };
}

/**
 * Resolves once every animation on `el` and inside it has finished or been cancelled. Endless
 * ones (a spinner, the now-playing bars) are not waited for: they would keep it forever.
 */
export function settle(el: Element): Promise<void> {
  const finite = el
    .getAnimations({ subtree: true })
    .filter((a) => a.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY);
  return Promise.allSettled(finite.map((a) => a.finished)).then(() => undefined);
}

/**
 * Plays an element's exit (its `[data-leaving]` style, DESIGN_SYSTEM.md §11.2) and waits for it.
 * Leaving, it is already gone for assistive technology (focus moves out first). False when it was
 * called back meanwhile (`stay`): it is staying after all.
 */
export async function leave(el: HTMLElement): Promise<boolean> {
  if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  el.dataset.leaving = '';
  el.setAttribute('aria-hidden', 'true');
  await settle(el);
  return el.dataset.leaving !== undefined;
}

/** Calls a leaving element back: it turns round from where it is (`leave` then reports false). */
export function stay(el: HTMLElement) {
  delete el.dataset.leaving;
  el.removeAttribute('aria-hidden');
}

/**
 * Whether a closable element is mounted: it stays after `open` turns false until its exit has
 * played, and opening again mid-exit keeps the same element, which turns back from where it is.
 */
export function useExit(open: boolean, ref: RefObject<HTMLElement | null>): boolean {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (open) {
      if (el) stay(el);
      return;
    }
    if (!el) return setMounted(false);
    let live = true;
    void leave(el).then((gone) => live && gone && setMounted(false));
    return () => {
      live = false;
    };
  }, [open, ref]);
  return mounted;
}

/**
 * Keys that follow a row through a reorder when the same key can appear twice (a song queued
 * twice): each key numbered by its occurrence, `['a', 'b', 'a']` → `['a#0', 'b#0', 'a#1']`.
 */
export function occurrenceKeys(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}#${n}`;
  });
}

interface Place {
  el: HTMLElement;
  top: number;
  left: number;
  width: number;
}

/** Where each row (`[data-flip-key]`) under `root` is, relative to `root`. */
function places(root: HTMLElement): Map<string, Place> {
  const base = root.getBoundingClientRect();
  const out = new Map<string, Place>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-flip-key]')) {
    if (el.classList.contains('flip-ghost') || !el.dataset.flipKey) continue;
    const r = el.getBoundingClientRect();
    out.set(el.dataset.flipKey, {
      el,
      top: r.top - base.top,
      left: r.left - base.left,
      width: r.width,
    });
  }
  return out;
}

/**
 * A list's rows (`[data-flip-key]` under `root`) glide when `order` (their keys, joined) changes: a moved row
 * springs from where it was, a new one rises in with a wash (`.fresh`), and a removed one fades
 * out where it was, as an inert copy (`.flip-ghost`). Where they were is read in render, just
 * before the change commits, so nothing that moved them since is missed.
 */
export function useFlip(root: RefObject<HTMLElement | null>, order: string) {
  const seen = useRef<string | null>(null);
  const before = useRef<Map<string, Place> | null>(null);
  const changed = seen.current !== null && seen.current !== order;
  if (changed && !before.current && root.current) before.current = places(root.current);
  useLayoutEffect(() => {
    seen.current = order;
    const was = before.current;
    before.current = null;
    const el = root.current;
    if (!was || !el || document.documentElement.dataset.motion !== 'full') return;
    const now = places(el);
    for (const [key, p] of now) {
      const old = was.get(key);
      if (!old) {
        p.el.classList.add('fresh');
        p.el.addEventListener('animationend', () => p.el.classList.remove('fresh'), { once: true });
        p.el.animate(
          [{ translate: `calc(-1 * ${space(3)}) 0` }, { translate: '0 0' }],
          timing('spring'),
        );
        p.el.animate([{ opacity: 0 }, { opacity: 1 }], timing('fade'));
        continue;
      }
      const dy = old.top - p.top;
      if (Math.abs(dy) > 0.5)
        p.el.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], timing('spring'));
    }
    for (const [key, p] of was) {
      if (now.has(key) || p.el.isConnected) continue;
      // React has removed it: back where it was, inert, to fade out.
      const ghost = p.el;
      ghost.classList.add('flip-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      Object.assign(ghost.style, { top: `${p.top}px`, left: `${p.left}px`, width: `${p.width}px` });
      el.append(ghost);
      const gone = () => ghost.remove();
      ghost
        .animate([{ opacity: 1 }, { opacity: 0, translate: `${space(4)} 0` }], timing('exit'))
        .finished.then(gone, gone);
    }
  }, [root, order]);
}

// Loaded content arrives in a wave (§11) only where a placeholder stood: a page restored from
// cache (Back) shows as it was, and tiles scrolled into a long list never wave.
let loadingSince = Number.NEGATIVE_INFINITY;
let routeSince = 0;
let clock = 0; // an order, not a time: two notes in one millisecond still compare
/** A placeholder (skeleton) is showing. */
export const noteLoading = () => {
  loadingSince = ++clock;
};
/** The page changed: what was loading before belongs to the old page. */
export const noteRoute = () => {
  routeSince = ++clock;
};
export const shouldArrive = () => loadingSince > routeSince;

/**
 * On mount, a list that replaced a placeholder waves in: `data-arrive` on it (main.css staggers its
 * children by `--i`), taken off again once the wave has played, so later children never wave.
 */
export function useArrival(ref: RefObject<HTMLElement | null>, ready = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!ready || !el || !shouldArrive() || document.documentElement.dataset.motion !== 'full')
      return;
    el.dataset.arrive = '';
    const wave = tokenMs('--dur-spring') + 12 * tokenMs('--stagger');
    const done = setTimeout(() => delete el.dataset.arrive, wave);
    return () => clearTimeout(done);
  }, [ref, ready]);
}

let pageSheet: CSSStyleSheet | null = null;
let pageSheets = 0;
/**
 * The page's own rules as one sheet, for copies kept in a shadow root: built again only when
 * the page has gained a stylesheet (the lyrics view's comes with its chunk).
 */
export function pageStyles(): CSSStyleSheet {
  if (pageSheet && pageSheets === document.styleSheets.length) return pageSheet;
  pageSheets = document.styleSheets.length;
  const rules = [...document.styleSheets].flatMap((s) => {
    try {
      return [...s.cssRules].filter((r) => !(r instanceof CSSImportRule)).map((r) => r.cssText);
    } catch {
      return []; // another origin's sheet: nothing of ours
    }
  });
  pageSheet = new CSSStyleSheet();
  pageSheet.replaceSync(rules.join('\n'));
  return pageSheet;
}

/**
 * A still copy of `el`, fixed over the box `r`, for a change that swaps something out at once but
 * should still be seen going (the lyrics view's open and close, a cover's flight). The copy lives
 * in a closed shadow root, styled like the page: nothing that looks into the page (selectors,
 * assistive technology, the page's own code) meets it. The caller animates `host` and removes it.
 */
function still(el: HTMLElement, r: DOMRect, className: string) {
  const host = document.createElement('div');
  host.className = className;
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  Object.assign(host.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.adoptedStyleSheets = [pageStyles()];
  const copy = el.cloneNode(true) as HTMLElement;
  shadow.append(copy);
  document.body.append(host);
  return { host, copy };
}

/** A still copy of an element where it stands (see `still`), scroll positions kept. */
export function ghost(el: HTMLElement) {
  const g = still(el, el.getBoundingClientRect(), 'motion-ghost');
  // A copy starts scrolled to the top: put each scroller where the original is, on the next
  // frame before it paints (writing now would lay the copy out inside the click).
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')];
  const scrolled = from.flatMap((src, i) =>
    src.scrollTop || src.scrollLeft ? [{ i, top: src.scrollTop, left: src.scrollLeft }] : [],
  );
  if (scrolled.length)
    requestAnimationFrame(() => {
      const to = [g.copy, ...g.copy.querySelectorAll<HTMLElement>('*')];
      for (const { i, top, left } of scrolled) to[i]?.scrollTo(left, top);
    });
  return g;
}

/**
 * A copy of `look` (by default `to` itself) flies from the box `from` into `to`'s place, `to`
 * hidden meanwhile, then goes. Copy something already shown: a cover just mounted may still be
 * loading its picture, and would fly blank.
 */
export function fly(
  from: DOMRect,
  to: HTMLElement,
  t: KeyframeAnimationOptions,
  look: HTMLElement = to,
): Promise<void> {
  const b = to.getBoundingClientRect();
  if (!from.width || !b.width) return Promise.resolve();
  const { host, copy } = still(look, b, 'motion-fly');
  Object.assign(copy.style, { width: '100%', height: '100%', margin: '0' });
  for (const img of copy.querySelectorAll('img')) {
    img.loading = 'eager';
    img.decoding = 'sync';
  }
  to.style.visibility = 'hidden';
  const dx = from.left - b.left;
  const dy = from.top - b.top;
  const start = `translate(${dx}px, ${dy}px) scale(${from.width / b.width}, ${from.height / b.height})`;
  const land = () => {
    host.remove();
    to.style.visibility = '';
  };
  return host.animate([{ transform: start }, { transform: 'none' }], t).finished.then(land, land);
}

/** A clip-path inset that shows only `r` of the box `of`, its corners rounded by `round`. */
export const insetTo = (r: DOMRect, of: DOMRect, round = token('--r-art')) =>
  `inset(${r.top - of.top}px ${of.right - r.right}px ${of.bottom - r.bottom}px ${r.left - of.left}px round ${round})`;

/** An element's corner radius in px, as drawn (a pill's 999px is its half height). */
export function cornerOf(el: Element): string {
  const r = el.getBoundingClientRect();
  const set = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return `${Math.min(set, r.height / 2, r.width / 2)}px`;
}

/**
 * A choice's highlight slides from the last choice to the new one (§11): the chosen item's
 * `pseudo` (its highlight, main.css) springs from where the last chosen one was. `chosen` finds
 * the chosen item in `host`; `value` is the choice.
 */
export function useSlide(
  host: RefObject<HTMLElement | null>,
  chosen: string,
  value: unknown,
  pseudo: '::before' | '::after' = '::before',
) {
  const last = useRef<{ centre: number; width: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new `value` is what moves the highlight
  useLayoutEffect(() => {
    const el = host.current?.querySelector<HTMLElement>(chosen);
    const h = host.current?.getBoundingClientRect();
    if (!el || !h) {
      last.current = null;
      return;
    }
    const b = el.getBoundingClientRect();
    const now = { centre: b.left - h.left + b.width / 2, width: b.width };
    const was = last.current;
    last.current = now;
    if (!was || document.documentElement.dataset.motion !== 'full') return;
    const dx = was.centre - now.centre;
    if (Math.abs(dx) < 0.5) return;
    const from = `translateX(${dx}px) scaleX(${was.width / now.width})`;
    el.animate([{ transform: from }, { transform: 'none' }], {
      ...timing('spring'),
      pseudoElement: pseudo,
    });
  }, [host, chosen, value, pseudo]);
}

/**
 * A new song's cover (the first `.art` under `host`) arrives on the spring when `key` changes,
 * not when it first shows. Spotify's artwork only fades (its Design Guidelines).
 */
export function useCoverChange(host: RefObject<HTMLElement | null>, key: string | undefined) {
  const shown = useRef(key);
  useLayoutEffect(() => {
    if (shown.current === key) return;
    const before = shown.current;
    shown.current = key;
    const art = host.current?.querySelector<HTMLElement>('.art');
    if (!art || !key || !before) return;
    art.animate([{ opacity: 0 }, { opacity: 1 }], timing('fade'));
    if (!document.querySelector('.shell[data-attribution]'))
      art.animate([{ scale: 0.9 }, { scale: 1 }], timing('spring'));
  }, [host, key]);
}
