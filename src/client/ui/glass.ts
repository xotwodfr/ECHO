// Liquid glass (DESIGN_SYSTEM.md §7.11). In Chromium every glass element gets its own SVG filter
// as its backdrop-filter: a light frost, a displacement whose map is computed here from Snell's law
// across the element's curved rim, saturation, and a specular rim light. The maps depend on the
// box, so the filter is rebuilt when the element resizes. Other engines keep ui.css's blur fallback.
// Over the Stage, while WebGL draws the room, its glass pass draws the same glass instead from the
// boxes of the glass elements attached here (stage/engine.ts).

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

/** The bend across the rim at `n` even steps (edge first), refraction applied: the Stage's lookup. */
export function bendProfile(g: GlassParams, n: number): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: n }, (_, i) => bend(g, i / (n - 1)) * g.refraction);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Glass boxes as the Stage's composite uniforms: CSS px from the canvas's top left (y down) as
 * x, y, w, h, and the corner radii in CSS order, four floats each. Boxes with no area or wholly off
 * the canvas are left out; at most `max`.
 */
export function glassUniforms(canvas: Box, items: { box: Box; radii: Radii }[], max: number) {
  const rects = new Float32Array(max * 4);
  const corners = new Float32Array(max * 4);
  let count = 0;
  for (const { box, radii } of items) {
    if (count === max) break;
    const x = box.x - canvas.x;
    const y = box.y - canvas.y;
    const off =
      x >= canvas.width || y >= canvas.height || x + box.width <= 0 || y + box.height <= 0;
    if (box.width < 1 || box.height < 1 || off) continue;
    rects.set([x, y, box.width, box.height], count * 4);
    corners.set(radii, count * 4);
    count++;
  }
  return { rects, corners, count };
}

/**
 * `glassUniforms` boxes as clip-space triangles, two per box (x, y, z each), over a `cssW`×`cssH`
 * canvas: the Stage's glass pass draws only these pixels.
 */
export function glassQuads(rects: Float32Array, count: number, cssW: number, cssH: number) {
  const out = new Float32Array(count * 18);
  for (let i = 0; i < count; i++) {
    const [x, y, w, h] = [0, 1, 2, 3].map((k) => rects[i * 4 + k] ?? 0) as [
      number,
      number,
      number,
      number,
    ];
    const x0 = (x / cssW) * 2 - 1;
    const x1 = ((x + w) / cssW) * 2 - 1;
    const y0 = 1 - (y / cssH) * 2;
    const y1 = 1 - ((y + h) / cssH) * 2;
    // Counter-clockwise, so they face the camera (three.js culls back faces).
    out.set([x0, y1, 0, x1, y1, 0, x1, y0, 0, x0, y1, 0, x1, y0, 0, x0, y0, 0], i * 18);
  }
  return out;
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

/** The element's corner radii in px, percentages resolved, each at most half the box. */
export function radii(cs: CSSStyleDeclaration, w: number, h: number): Radii {
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

/** The glass the --glass-* tokens describe, as `cs` (an element's computed style) resolves them. */
export function glassParams(
  cs: CSSStyleDeclaration,
): GlassParams & { frost: number; saturate: number } {
  const v = (name: string) => Number.parseFloat(cs.getPropertyValue(`--glass-${name}`));
  return {
    thickness: v('thickness'),
    bezel: v('bezel'),
    ior: v('ior'),
    refraction: v('refraction'),
    specular: v('specular'),
    light: v('light'),
    frost: v('frost'),
    saturate: v('saturate'),
  };
}

// Every attached glass element, for the Stage (engine.ts), which draws those over the room itself.
const attached = new Set<HTMLElement>();
const listeners = new Set<() => void>();
export const glassElements = (): ReadonlySet<HTMLElement> => attached;
export function onGlassChange(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
const changed = () => {
  for (const f of listeners) f();
};

/** Makes `el` liquid glass while attached; returns the detach. */
export function attachGlass(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return;
  attached.add(el);
  changed();
  const svgOff = svgBackdrop ? svgFilter(el) : undefined;
  return () => {
    svgOff?.();
    attached.delete(el);
    changed();
  };
}

/** The element's own SVG filter as its backdrop-filter (Chromium); returns the detach. */
function svgFilter(el: HTMLElement) {
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
    const g = glassParams(cs);
    const m = glassMaps(w, h, radii(cs, w, h), g);
    for (const [img, data] of [
      [map, m.displacement],
      [light, m.specular],
    ] as const) {
      img.setAttribute('width', String(w));
      img.setAttribute('height', String(h));
      img.setAttribute('href', png(data, w, h));
    }
    frost.setAttribute('stdDeviation', String(g.frost));
    shift.setAttribute('scale', String(m.scale));
    vivid.setAttribute('values', String(g.saturate));
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
