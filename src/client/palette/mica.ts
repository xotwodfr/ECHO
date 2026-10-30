import { linearSrgbToOklab, parseColor, type Vec3 } from '../../shared/oklab.ts';
import { DUR_PALETTE_MS, type Roles } from './animator.ts';
import { paletteStore } from './live.ts';

// Mica (DESIGN_SYSTEM.md §6): the playing album's glow behind the frame, as Windows 11 tints a
// window with the wallpaper. Blurred once per album into a still image, never per frame: no
// backdrop filter, no CSS blur (§7.11). Two layers crossfade by opacity. Palette colours only,
// never the cover, so Spotify's artwork is not blurred (§8).

/** Highlight, accent and room, capped dark and muted so the layer's text stays readable. */
export function micaStops(r: Roles): [string, string, string] {
  const cap = (css: string) => {
    const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css.trim());
    let L: number;
    let C: number;
    let h: number;
    if (ok) [L, C, h] = [Number(ok[1]), Number(ok[2]), Number(ok[3])];
    else {
      const [l, a, b] = linearSrgbToOklab(parseColor(css).rgb as Vec3);
      [L, C, h] = [l, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
    }
    const lch = `${Math.min(0.6, Math.max(0.25, L)).toFixed(4)} ${Math.min(0.15, C).toFixed(4)} ${h.toFixed(2)}`;
    return `oklch(${lch})`; // a computed colour, as the animator serialises (DS-01 allow-list)
  };
  return [cap(r.highlight), cap(r.accent), cap(r.room)];
}

export type Bake = (stops: [string, string, string], w: number, h: number) => Promise<Blob | null>;

/** Paints the stops on a small canvas, blurs it once and returns it as an image. */
export const bakeCanvas: Bake = (stops, w, h) => {
  const cs = getComputedStyle(document.documentElement);
  const scale = Number(cs.getPropertyValue('--mica-scale')) || 8;
  const pad = 10; // the blur's edge falls outside the image
  const W = Math.ceil(w / scale) + 3 * pad;
  const H = Math.ceil(h / scale) + 3 * pad;
  const src = document.createElement('canvas');
  src.width = W;
  src.height = H;
  const s = src.getContext('2d');
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const o = out.getContext('2d');
  if (!s || !o) return Promise.resolve(null);
  const g = s.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.45, stops[1]);
  g.addColorStop(1, stops[2]);
  s.fillStyle = g;
  s.fillRect(0, 0, W, H);
  o.filter = `blur(${cs.getPropertyValue('--mica-blur').trim()}) saturate(${cs.getPropertyValue('--mica-saturate').trim()})`;
  o.drawImage(src, -pad, -pad, W + 2 * pad, H + 2 * pad);
  return new Promise((resolve) => out.toBlob(resolve));
};

/** Follows the palette's target into the two `.mica-layer` children of `host`. */
export function startMica(host: HTMLElement, opts: { bake?: Bake } = {}) {
  const bake = opts.bake ?? bakeCanvas;
  const layers = [...(host.children as unknown as HTMLElement[])];
  let front = 0; // the layer showing (or last shown)
  let url: string | null = null;
  let gen = 0;
  let shown: string | null = null; // the stops the current or pending bake is for
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const retire = (u: string | null) => {
    if (!u) return;
    const t = setTimeout(() => {
      timers.delete(t);
      URL.revokeObjectURL(u);
    }, DUR_PALETTE_MS);
    timers.add(t);
  };
  const off = () => {
    for (const l of layers) delete l.dataset.on;
    retire(url);
    url = null;
  };

  const show = async (target: Roles | null, force = false) => {
    const stops = target && micaStops(target);
    const key = stops && JSON.stringify(stops);
    if (!force && key === shown) return;
    shown = key;
    const mine = ++gen;
    if (!stops) return off();
    let blob: Blob | null = null;
    try {
      blob = await bake(stops, innerWidth, innerHeight);
    } catch {
      blob = null;
    }
    if (mine !== gen) return; // a newer album won
    if (!blob) return off();
    const next = URL.createObjectURL(blob);
    const back = layers[1 - front];
    const cur = layers[front];
    if (!back || !cur) return;
    back.style.backgroundImage = `url("${next}")`;
    back.dataset.on = '';
    delete cur.dataset.on;
    front = 1 - front;
    retire(url);
    url = next;
  };

  const unsub = paletteStore.subscribe(
    (s, prev) => s.target !== prev.target && void show(s.target),
  );
  // A breakpoint changes the window's shape enough to bake again; a resize within one does not.
  const queries = ['(max-width: 719px)', '(max-width: 1279px)'].map((q) => matchMedia(q));
  const rebake = () => void show(paletteStore.getState().target, true);
  for (const q of queries) q.addEventListener('change', rebake);
  void show(paletteStore.getState().target);

  return () => {
    unsub();
    for (const q of queries) q.removeEventListener('change', rebake);
    gen++;
    for (const t of timers) clearTimeout(t);
    if (url) URL.revokeObjectURL(url);
  };
}
