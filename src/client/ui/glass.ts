// Liquid glass (DESIGN_SYSTEM.md §7.11). In Chromium every glass element gets its own SVG filter
// as its backdrop-filter: a light frost, a displacement whose map is computed here from Snell's law
// across the element's curved rim, saturation, and a specular rim light. The maps depend on the
// box, so the filter is rebuilt when the element resizes. Other engines keep ui.css's blur fallback.

export interface GlassParams {
  /** Slab thickness under the flat top, px. */
  thickness: number;
  /** Width of the curved rim, px. */
  bezel: number;
  ior: number;
  /** Scale on the computed bend. */
  refraction: number;
  /** Rim light opacity, 0…1. */
  specular: number;
  /** Rim light direction, degrees anticlockwise from +x (135 = from the top left). */
  light: number;
}

/** Corner radii, px, in CSS order: top-left, top-right, bottom-right, bottom-left. */
export type Radii = [number, number, number, number];

export interface GlassMaps {
  /** RGBA, R and G carry the x and y shift (128 = none). */
  displacement: Uint8ClampedArray<ArrayBuffer>;
  /** RGBA, white rim light; alpha is its strength. */
  specular: Uint8ClampedArray<ArrayBuffer>;
  /** feDisplacementMap's scale for `displacement`, px. */
  scale: number;
}

/** The rim's height, 0 at the outer edge to 1 where the flat top starts: a convex squircle. */
const rim = (t: number) => (1 - (1 - t) ** 4) ** 0.25;

/**
 * How far (px) the view through the rim shifts inward at fraction `t` across it (0 = the edge): a
 * vertical ray meets the rim's slope, bends by Snell's law, and crosses the glass below.
 */
export function bend(g: GlassParams, t: number): number {
  const dt = 1e-4;
  const slope = (rim(Math.min(t + dt, 1)) - rim(t)) / dt;
  const incidence = Math.atan(slope);
  const deviation = incidence - Math.asin(Math.sin(incidence) / g.ior);
  return (g.thickness + rim(t) * g.bezel) * Math.tan(deviation);
}

/** Both filter maps for a `w`×`h` box: refraction and light live only inside the rim. */
export function glassMaps(w: number, h: number, radii: Radii, g: GlassParams): GlassMaps {
  const n = w * h;
  const dx = new Float32Array(n);
  const dy = new Float32Array(n);
  const specular = new Uint8ClampedArray(n * 4);
  const lx = Math.cos((g.light * Math.PI) / 180);
  const ly = -Math.sin((g.light * Math.PI) / 180); // screen y points down
  const bezel = Math.max(1, Math.min(g.bezel, w / 2, h / 2));
  let max = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Rounded box: the pixel from the centre, and the radius of its quadrant's corner.
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const r = radii[py < 0 ? (px < 0 ? 0 : 1) : px < 0 ? 3 : 2];
      const qx = Math.abs(px) - (w / 2 - r);
      const qy = Math.abs(py) - (h / 2 - r);
      // Depth inside the edge, and the edge's outward normal.
      let depth: number;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        depth = r - len;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else {
        depth = r - Math.max(qx, qy);
        if (qx > qy) nx = Math.sign(px);
        else ny = Math.sign(py);
      }
      if (depth < 0 || depth >= bezel) continue;
      const t = depth / bezel;
      const s = bend(g, t) * g.refraction;
      const i = y * w + x;
      dx[i] = -nx * s;
      dy[i] = -ny * s;
      max = Math.max(max, s);
      specular.fill(255, i * 4, i * 4 + 3);
      specular[i * 4 + 3] = 255 * g.specular * Math.abs(nx * lx + ny * ly) * (1 - t) ** 6;
    }
  }
  const displacement = new Uint8ClampedArray(n * 4);
  const k = max ? 127 / max : 0;
  for (let i = 0; i < n; i++) {
    displacement[i * 4] = 128 + k * (dx[i] ?? 0);
    displacement[i * 4 + 1] = 128 + k * (dy[i] ?? 0);
    displacement[i * 4 + 2] = 128;
    displacement[i * 4 + 3] = 255;
  }
  // feDisplacementMap shifts by scale × (channel − 0.5): a full channel (255) is `max`.
  return { displacement, specular, scale: (max * 255) / 127 };
}

/** SVG filters as backdrop-filter work only in Chromium (Chrome, Edge, Electron); there is no
 * feature test for it, since other engines parse the url() and then draw nothing. */
const svgBackdrop = (
  (globalThis.navigator as { userAgentData?: { brands: { brand: string }[] } } | undefined)
    ?.userAgentData?.brands ?? []
).some((b) => b.brand === 'Chromium');

const NS = 'http://www.w3.org/2000/svg';
let defs: SVGDefsElement | undefined;
let count = 0;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function png(data: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')?.putImageData(new ImageData(data, w, h), 0, 0);
  return c.toDataURL();
}

function radii(cs: CSSStyleDeclaration, w: number, h: number): Radii {
  const r = (v: string) => {
    const n = Number.parseFloat(v) || 0;
    return Math.min(v.endsWith('%') ? (n / 100) * Math.min(w, h) : n, w / 2, h / 2);
  };
  return [
    r(cs.borderTopLeftRadius),
    r(cs.borderTopRightRadius),
    r(cs.borderBottomRightRadius),
    r(cs.borderBottomLeftRadius),
  ];
}

/** Makes `el` liquid glass while attached (Chromium only); returns the detach. */
export function attachGlass(el: HTMLElement | null): (() => void) | undefined {
  if (!el || !svgBackdrop) return;
  if (!defs) {
    const root = svg('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
    root.style.position = 'absolute';
    defs = svg('defs', {});
    root.append(defs);
    document.body.append(root);
  }
  const id = `glass-${++count}`;
  const frost = svg('feGaussianBlur', { in: 'SourceGraphic', result: 'frost' });
  const map = svg('feImage', { result: 'map', preserveAspectRatio: 'none' });
  const shift = svg('feDisplacementMap', {
    in: 'frost',
    in2: 'map',
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    result: 'bent',
  });
  const vivid = svg('feColorMatrix', { in: 'bent', type: 'saturate', result: 'vivid' });
  const light = svg('feImage', { result: 'light', preserveAspectRatio: 'none' });
  const merge = svg('feMerge', {});
  merge.append(svg('feMergeNode', { in: 'vivid' }), svg('feMergeNode', { in: 'light' }));
  const filter = svg('filter', {
    id,
    x: 0,
    y: 0,
    width: '100%',
    height: '100%',
    'color-interpolation-filters': 'sRGB',
  });
  filter.append(frost, map, shift, vivid, light, merge);
  defs.append(filter);

  let size = '';
  const build = () => {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w < 2 || h < 2 || `${w}x${h}` === size) return; // closed dialogs measure 0
    size = `${w}x${h}`;
    const cs = getComputedStyle(el);
    const v = (name: string) => Number.parseFloat(cs.getPropertyValue(`--glass-${name}`));
    const g: GlassParams = {
      thickness: v('thickness'),
      bezel: v('bezel'),
      ior: v('ior'),
      refraction: v('refraction'),
      specular: v('specular'),
      light: v('light'),
    };
    const m = glassMaps(w, h, radii(cs, w, h), g);
    for (const [img, data] of [
      [map, m.displacement],
      [light, m.specular],
    ] as const) {
      img.setAttribute('width', String(w));
      img.setAttribute('height', String(h));
      img.setAttribute('href', png(data, w, h));
    }
    frost.setAttribute('stdDeviation', String(v('frost')));
    shift.setAttribute('scale', String(m.scale));
    vivid.setAttribute('values', String(v('saturate')));
    el.style.setProperty('--glass-filter', `url(#${id})`);
  };
  const observer = new ResizeObserver(build);
  observer.observe(el);
  return () => {
    observer.disconnect();
    filter.remove();
    el.style.removeProperty('--glass-filter');
  };
}

/** `ref={glass}`: the element is liquid glass while it is mounted. */
export const glass = (el: HTMLElement | null) => attachGlass(el);
