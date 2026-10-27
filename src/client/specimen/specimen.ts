// Static Stage type specimen (docs/IMPLEMENTATION_PLAN.md M1 task 7).
// A frozen frame of the lyric field built from the documented geometry
// (docs/LYRICS_EXPERIENCE.md §3, §4, §5, §8) so the two candidate faces can be judged where they
// will live. Not the real lyric engine: no springs, no clock. That is M3.
import '../fonts.css';
import './geologica.css';
import '../tokens.css';
import './specimen.css';
import { DURATION_MS, LINES, LONG_LINES, NOW, SONG, type SpecimenLine } from './lyrics.ts';

type Face = 'geologica' | 'mona';
const FACES: Record<Face, string> = { geologica: 'Geologica', mona: 'Mona Sans' };
const PALETTES = ['sodium', 'tide', 'ember'] as const;
type Palette = (typeof PALETTES)[number];

// §4.1 depth tables (linear interpolation between points).
const OPACITY: [number, number][] = [
  [0, 1],
  [0.22, 0.74],
  [0.44, 0.64],
  [0.66, 0.55],
  [0.8, 0.24],
  [1, 0.12],
];
const BLUR: [number, number][] = [
  [0, 0],
  [0.22, 1],
  [0.44, 2],
  [0.66, 3.2],
  [0.8, 4],
  [0.9, 6],
  [1, 8],
];
const LINE_HEIGHT = 1.12; // DESIGN_SYSTEM §4.3
const DOCK = 88;

const interp = (table: [number, number][], z: number) => {
  for (let i = 1; i < table.length; i++) {
    const [z1, v1] = table[i] as [number, number];
    const [z0, v0] = table[i - 1] as [number, number];
    if (z <= z1) return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
  }
  return (table[table.length - 1] as [number, number])[1];
};
const scaleAt = (z: number) => 1 - 0.3 * z;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const $ = (id: string) => document.getElementById(id) as HTMLElement;

const params = new URLSearchParams(location.search);
// Mona Sans is ECHO's face (M1 decision); Geologica stays for comparison.
let face: Face = params.get('face') === 'geologica' ? 'geologica' : 'mona';
let palette: Palette = PALETTES.find((p) => p === params.get('palette')) ?? 'sodium';

// ---------- line fitting (§3.3, DESIGN_SYSTEM §4.3) ----------

interface Fit {
  rows: number;
  wdth: number; // Mona Sans width axis, 100 = normal
  size: number; // shrink multiplier, 0.88–1
  w: number;
  h: number;
}

/** One layout per line at active size: balance to ≤ 2 rows, else condense (Mona), shrink, wrap. */
function fitLine(el: HTMLElement, lineFace: Face, fontPx: number, maxWidth: number): Fit {
  let wdth = 100;
  let size = 1;
  el.style.maxWidth = `${maxWidth}px`;
  const apply = () => {
    el.style.fontSize = `${fontPx * size}px`;
    el.style.fontStretch = lineFace === 'mona' ? `${wdth}%` : '';
  };
  const rows = () => Math.round(el.offsetHeight / (fontPx * size * LINE_HEIGHT));
  apply();
  if (lineFace === 'mona') {
    while (rows() > 2 && wdth > 82) {
      wdth -= 2;
      apply();
    }
  }
  while (rows() > 2 && size > 0.88) {
    size = Math.max(0.88, size - 0.02);
    apply();
  }
  return { rows: rows(), wdth, size, w: el.offsetWidth, h: el.offsetHeight };
}

function makeLine(line: SpecimenLine, cls: string): HTMLElement {
  const el = document.createElement('p');
  el.className = `line ${cls}`;
  el.textContent = line.text;
  return el;
}

function makeActive(line: SpecimenLine): HTMLElement {
  const el = document.createElement('p');
  el.className = 'line active';
  line.text.split(' ').forEach((word, i) => {
    if (i > 0) el.append(' ');
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = word;
    if (i < NOW.sweepWord) span.classList.add('lit');
    if (i === NOW.sweepWord) {
      span.classList.add('sweep');
      span.style.setProperty('--p', `${NOW.sweepProgress * 100}%`);
    }
    el.append(span);
  });
  return el;
}

/** Ink for ranks ≠ 0: active ink mixed 18% toward the room per 0.33 z (§4.1). */
function inkAt(z: number) {
  return `color-mix(in oklab, var(--lyric-ink-active), var(--art-room) ${Math.min(100, (18 * z) / 0.33).toFixed(1)}%)`;
}

function place(
  el: HTMLElement,
  f: Fit,
  cx: number,
  cy: number,
  z: number,
  opacity: number,
  blur: number,
) {
  el.style.transform = `translate(${cx - f.w / 2}px, ${cy - f.h / 2}px) scale(${scaleAt(z)})`;
  el.style.opacity = opacity.toFixed(3);
  el.style.filter = blur > 0 ? `blur(${blur.toFixed(2)}px)` : '';
  if (!el.classList.contains('active')) el.style.color = inkAt(z);
  el.dataset.z = z.toFixed(3);
}

// Deterministic PRNG so the background field arranges the same way every run (§8.2).
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the stage ----------

function layoutStage() {
  const stage = $('stage');
  const field = $('field');
  field.replaceChildren();
  const W = stage.clientWidth;
  const H = stage.clientHeight - DOCK; // §3.2: H is the stage above the dock
  const fontPx = Number.parseFloat(getComputedStyle(field).fontSize);
  const maxWidth = 0.64 * W;
  $('readout').textContent = `${W}×${stage.clientHeight} · --ly-active ${fontPx.toFixed(1)}px`;

  const fitted = (el: HTMLElement) => {
    field.append(el);
    return fitLine(el, face, fontPx, maxWidth);
  };

  const ai = NOW.activeIndex;
  const active = makeActive(LINES[ai] as SpecimenLine);
  const fActive = fitted(active);
  const y0 = 0.4 * H;
  place(active, fActive, W / 2, y0, 0, 1, 0);

  // Transition zone +1…+3 (§4.2, §4.3), at settled slots.
  const zone = [1, 2, 3].map((k) => {
    const line = LINES[ai + k] as SpecimenLine;
    const prev = LINES[ai + k - 1] as SpecimenLine;
    const g = clamp((line.startMs - prev.startMs) / 3200, 0.8, 1.5);
    const el = makeLine(line, 'upcoming');
    return { el, f: fitted(el), g, z: 0, y: 0 };
  });
  let z = 0;
  for (const item of zone) {
    z = Math.min(0.72, z + 0.22 * item.g);
    item.z = z;
  }
  const stack = (gapScale: number) => {
    let y = y0;
    let h = fActive.h;
    let s = 1;
    for (const item of zone) {
      const si = scaleAt(item.z);
      y += (h * s + item.f.h * si) / 2 + 0.04 * H * item.g * gapScale;
      item.y = y;
      h = item.f.h;
      s = si;
    }
    const last = zone[2] as (typeof zone)[number];
    return last.y + (last.f.h * scaleAt(last.z)) / 2;
  };
  const bottom = 0.86 * H;
  let zoneBottom = stack(1);
  if (zoneBottom > bottom) {
    const gaps = zone.reduce((sum, item) => sum + 0.04 * H * item.g, 0);
    zoneBottom = stack(Math.max(0.5, 1 - (zoneBottom - bottom) / gaps));
  }
  const third = zone[2] as (typeof zone)[number];
  const second = zone[1] as (typeof zone)[number];
  let demoted = false;
  if (zoneBottom > bottom) {
    // Still overflowing: +3 takes its background depth until room appears (§4.3). It keeps its
    // own slot: drawn on top of +2 it would veil the +2 line (LYR-03). Ambiguity noted for M3.
    demoted = true;
    third.z = 0.78;
    zoneBottom = second.y + (second.f.h * scaleAt(second.z)) / 2;
  }
  for (const item of zone) {
    const isDemoted = demoted && item === third;
    const opacity = isDemoted ? 0.24 : interp(OPACITY, item.z);
    place(item.el, item.f, W / 2, item.y, item.z, opacity, Math.min(4, interp(BLUR, item.z)));
    item.el.dataset.rank = isDemoted ? 'demoted' : 'zone';
  }

  // The line just sung, decaying above (§7): ~450 ms into its tail.
  const past = makeLine(LINES[ai - 1] as SpecimenLine, 'past');
  const fPast = fitted(past);
  const zPast = 0.2;
  const yPast = y0 - (fActive.h + fPast.h * scaleAt(zPast)) / 2 - 0.04 * H - 0.02 * H;
  place(
    past,
    fPast,
    W / 2,
    Math.max(0.1 * H + (fPast.h * scaleAt(zPast)) / 2, yPast),
    zPast,
    Math.exp(-450 / 520),
    1.5,
  );

  // Background field (§8): everything after +3, nearest first, seeded placement.
  const rand = mulberry32(0x5eed_ec40);
  const corridor = {
    x0: 0.12 * W,
    x1: 0.88 * W,
    y0: y0 - fActive.h / 2 - 0.04 * H,
    y1: zoneBottom + 0.02 * H,
  };
  const homes: [number, number][] = [[W / 2, yPast]];
  for (const line of LINES.slice(ai + 4, ai + 4 + 24)) {
    const el = makeLine(line, 'background');
    const f = fitted(el);
    let zb = 0.78 + 0.22 * clamp((line.startMs - NOW.tMs) / 60_000, 0, 1);
    const w = f.w * scaleAt(zb);
    const h = f.h * scaleAt(zb);
    let spot: [number, number] | null = null;
    for (let tries = 0; tries < 80 && !spot; tries++) {
      const cx = w < W ? w / 2 + rand() * (W - w) : W / 2;
      const cy = h / 2 + rand() * (H - h);
      // Homes are sampled from the stage minus the reading corridor (§8.2).
      if (cx > corridor.x0 && cx < corridor.x1 && cy > corridor.y0 && cy < corridor.y1) continue;
      if (homes.every(([hx, hy]) => Math.hypot(hx - cx, hy - cy) >= 0.16 * H)) spot = [cx, cy];
    }
    if (!spot) {
      el.remove();
      continue;
    }
    homes.push(spot);
    const [cx, cy] = spot;
    const crosses =
      cx + w / 2 > corridor.x0 &&
      cx - w / 2 < corridor.x1 &&
      cy + h / 2 > corridor.y0 &&
      cy - h / 2 < corridor.y1;
    if (crosses) zb = Math.max(zb, 0.85); // the corridor only admits deep, faint lines (§3.2)
    const opacity = crosses ? Math.min(0.1, interp(OPACITY, zb)) : interp(OPACITY, zb);
    place(el, f, cx, cy, zb, opacity, interp(BLUR, zb));
    el.dataset.rank = 'background';
  }
}

function fillDock() {
  const fmt = (ms: number) =>
    `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
  $('dock-title').textContent = SONG.title;
  $('dock-artist').textContent = SONG.artist;
  $('dock-art').textContent = SONG.album; // missing-artwork treatment (DESIGN_SYSTEM §8)
  $('elapsed').textContent = fmt(NOW.tMs);
  $('total').textContent = fmt(DURATION_MS);
  $('scrub-fill').style.width = `${((NOW.tMs / DURATION_MS) * 100).toFixed(2)}%`;
}

// ---------- the review sheet ----------

function measureDigits(family: string, numeric: string) {
  const host = $('probe-host');
  const width = (text: string) => {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.fontFamily = `"${family}"`;
    span.style.fontVariantNumeric = numeric;
    host.append(span);
    const w = span.getBoundingClientRect().width;
    span.remove();
    return w;
  };
  return { ones: width('1111111111'), zeros: width('0000000000') };
}

function fillTnum() {
  const body = $('tnum-body');
  body.replaceChildren();
  for (const [key, family] of Object.entries(FACES)) {
    const prop = measureDigits(family, 'proportional-nums');
    const tab = measureDigits(family, 'tabular-nums');
    const pass = Math.abs(tab.ones - tab.zeros) < 0.5 && Math.abs(prop.ones - prop.zeros) > 0.5;
    const row = document.createElement('tr');
    row.dataset.face = key;
    row.dataset.tnum = pass ? 'pass' : 'fail';
    for (const text of [
      family,
      `${prop.ones.toFixed(1)} / ${prop.zeros.toFixed(1)} px`,
      `${tab.ones.toFixed(1)} / ${tab.zeros.toFixed(1)} px`,
      pass ? 'tnum works' : 'tnum has no effect: use the system-ui fallback for numerals',
    ]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    row.firstElementChild?.setAttribute('data-col-face', key);
    body.append(row);
  }
}

// Real measures: 0.64 × width at the real --ly-active (clamp(32px, min(6.2vh, 4.6vw), 88px)).
const VIEWPORTS: [number, number][] = [
  [1440, 900],
  [1024, 640],
  [390, 844],
];

function fillWrapDemos() {
  const host = $('wrap-demos');
  host.replaceChildren();
  const pending: (() => void)[] = []; // fitLine measures, so it runs once the boxes are attached
  for (const [vw, vh] of VIEWPORTS) {
    const fontPx = clamp(Math.min(0.062 * vh, 0.046 * vw), 32, 88);
    const group = document.createElement('div');
    group.className = 'wrap-group';
    const label = document.createElement('h3');
    label.textContent = `${vw}×${vh}: measure ${Math.round(0.64 * vw)}px at ${fontPx.toFixed(1)}px`;
    group.append(label);
    for (const f of Object.keys(FACES) as Face[]) {
      const row = document.createElement('div');
      row.className = 'wrap-row';
      row.dataset.colFace = f;
      for (const text of LONG_LINES) {
        const box = document.createElement('div');
        box.className = 'wrap-box';
        box.style.width = `${0.64 * vw}px`;
        const line = document.createElement('p');
        line.className = 'line demo';
        line.dataset.lineFace = f;
        line.textContent = text;
        const meta = document.createElement('p');
        meta.className = 'wrap-meta num';
        box.append(line, meta);
        row.append(box);
        pending.push(() => {
          const fit = fitLine(line, f, fontPx, 0.64 * vw);
          meta.textContent = `${FACES[f]} · ${fit.rows} rows · wdth ${fit.wdth} · size ${Math.round(fit.size * 100)}%`;
          line.dataset.rows = String(fit.rows);
        });
      }
      group.append(row);
    }
    host.append(group);
  }
  for (const run of pending) run();
}

// ---------- controls ----------

function render() {
  document.body.dataset.face = face;
  document.body.dataset.palette = palette;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-face-btn]')) {
    b.setAttribute('aria-pressed', String(b.dataset.faceBtn === face));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-palette-btn]')) {
    b.setAttribute('aria-pressed', String(b.dataset.paletteBtn === palette));
  }
  const url = new URL(location.href);
  url.searchParams.set('face', face);
  url.searchParams.set('palette', palette);
  history.replaceState(null, '', url);
  layoutStage();
}

function wire() {
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button');
    if (!target) return;
    if (target.dataset.faceBtn) face = target.dataset.faceBtn as Face;
    if (target.dataset.paletteBtn) palette = target.dataset.paletteBtn as Palette;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') face = face === 'geologica' ? 'mona' : 'geologica';
    else if (e.key === 'p' || e.key === 'P')
      palette = PALETTES[(PALETTES.indexOf(palette) + 1) % PALETTES.length] as Palette;
    else return;
    render();
  });
  let timer = 0;
  addEventListener('resize', () => {
    clearTimeout(timer);
    timer = window.setTimeout(layoutStage, 120); // re-layout once resizing settles (§9.10)
  });
}

async function main() {
  // Lay out only after both faces (both subsets) are loaded, or measurements would be of the fallback.
  await Promise.all(
    Object.values(FACES).flatMap((family) => [
      document.fonts.load(`600 56px "${family}"`, 'Every'),
      document.fonts.load(`600 56px "${family}"`, 'Łódź'),
    ]),
  );
  fillDock();
  fillTnum();
  fillWrapDemos();
  wire();
  render();
  await new Promise((r) => requestAnimationFrame(r));
  document.body.dataset.ready = 'true';
}

main();
