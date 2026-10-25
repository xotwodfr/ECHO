import type { Features, LyricsDoc } from '../../../shared/types.ts';
import { strings } from '../../strings.ts';
import { Announcer } from './announce.ts';
import { hash } from './background.ts';
import {
  BG_SIZE,
  buildLine,
  type DocLayout,
  LINE_HEIGHT,
  type LineLayout,
  measureDoc,
} from './layout.ts';
import { LYRICS } from './lyricsConfig.ts';
import { blurAt, FieldModel, type Inst, type Mode } from './model.ts';
import { buildTimeline } from './timing.ts';

// The lyric field's DOM (LYRICS_EXPERIENCE.md §3, §13; TECHNICAL_ARCHITECTURE.md §4.1): created
// imperatively, never reconciled by React. Per frame it writes only transforms, opacity, filters
// and custom properties on existing nodes, and skips writes below the §13 thresholds. Layout is read
// only when a document is built and on resize.

export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

/** Background budget and bucket blurs per tier (§8.1, §13). */
const TIERS: Record<Tier, { budget: number; blur: number[] | null }> = {
  T0: { budget: LYRICS.background.budget[0], blur: [4, 6, 8] },
  T1: { budget: LYRICS.background.budget[1], blur: [3, 4, 5] },
  T2: { budget: LYRICS.background.budget[2], blur: null },
  T3: { budget: LYRICS.background.budget[3], blur: null },
};
const POOL = 40;
const RESIZE_DEBOUNCE_MS = 120; // §9.10
const RESIZE_DIP_MS = 200;
const WILL_CHANGE_MS = 500; // §13: layers dropped 500 ms after a line settles

export interface FieldFrame {
  t: number;
  dt: number;
  driftS: number;
  playing: boolean;
  mode: Mode;
  features?: Features;
  reduced?: boolean;
}

interface Written {
  x: number;
  y: number;
  s: number;
  o: number;
  b: number;
  m: number;
  f: number;
  bucket: number;
  still: number; // ms since the transform last changed
}

interface LineEl {
  root: HTMLElement;
  layout: LineLayout;
  words: WordEl[];
  backing: WordEl[][];
  wash: WordEl | null;
  w: Written;
}

interface WordEl {
  el: HTMLElement;
  state: 0 | 1 | 2; // unlit, sweeping, lit
  p: number;
  glow: number;
  gr: number; // glow radius written, em
  // Emphasis (§5.5): grapheme spans and where each sits along the sweep, in px of the word.
  gs: { el: HTMLElement; off: number; w: number; e: number; p: number }[];
  ww: number;
  // How far past each end the soft edge still shows on this word, as a share of its width (§5.1).
  ahead: number;
  behind: number;
}

const div = (cls: string) => {
  const d = document.createElement('div');
  d.className = cls;
  return d;
};

export function createLyricField(
  host: HTMLElement,
  opts: { tier: Tier; announce?: boolean; onReady?: () => void },
) {
  const tier = TIERS[opts.tier];
  host.classList.add('ly-field');
  // The animated field is hidden from assistive technology; the transcript and the live region
  // beside it are not (§11).
  const measure = div('ly-measure');
  measure.setAttribute('aria-hidden', 'true');
  const buckets = [0, 1, 2].map((b) => {
    const d = div('ly-bucket');
    d.style.filter = tier.blur ? `blur(${tier.blur[b]}px)` : '';
    return d;
  });
  const main = div('ly-main');
  const dotsEl = div('ly-dots');
  const dots = [0, 1, 2].map(() => {
    const d = document.createElement('span');
    d.className = 'ly-dot';
    dotsEl.append(d);
    return d;
  });
  const scene = div('ly-scene');
  scene.setAttribute('aria-hidden', 'true');
  scene.append(...buckets, main, dotsEl);
  const transcript = document.createElement('ol');
  transcript.className = 'visually-hidden';
  transcript.setAttribute('aria-label', strings.stage.transcriptLabel);
  const live = div('visually-hidden');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  host.append(measure, scene, transcript, live);
  const announcer = new Announcer();
  let announce = !!opts.announce;
  let current: HTMLElement | null = null; // the transcript item with aria-current

  const pool: HTMLElement[] = [];
  let W = 0;
  let H = 0;
  let doc: LyricsDoc | null = null;
  let layout: DocLayout | null = null;
  let model: FieldModel | null = null;
  let els = new Map<Inst, LineEl>();
  let build = 0; // document generation, so a late font load never builds a stale document
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let laidW = 0;
  let laidH = 0;
  let dock = 88;

  const stageSize = () => {
    const r = host.getBoundingClientRect();
    dock = dockPx();
    return { w: r.width, h: Math.max(1, r.height - dock) };
  };
  const dockPx = () => Number.parseFloat(getComputedStyle(host).getPropertyValue('--dock')) || 88;

  function acquire(inst: Inst): LineEl {
    const line = model?.lines[inst.i];
    const lay = layout?.lines[inst.i];
    if (!line || !lay || !layout) throw new Error('lyric field: no layout');
    const root = pool.pop() ?? document.createElement('div');
    buildLine(root, line, lay.fit, layout.fontPx, layout.maxWidth);
    root.dataset.side = lay.side;
    const lead = root.firstElementChild as HTMLElement;
    const spans = (parent: Element) => [...parent.querySelectorAll<HTMLElement>('.ly-w')];
    const em = layout.fontPx * lay.fit.size;
    const words = line.words
      ? spans(lead).map((el, k) => wordEl(el, lay.words[k], lay.dir, em))
      : [];
    const subs = [...root.querySelectorAll('.ly-bg')];
    const backing = line.words
      ? subs.map((sub, j) =>
          spans(sub).map((el, k) => wordEl(el, lay.backing[j]?.[k], lay.dir, em * BG_SIZE)),
        )
      : [];
    const wash = line.words
      ? null
      : wordEl(lead.querySelector('.ly-w') as HTMLElement, undefined, lay.dir, 0);
    root.style.opacity = '0';
    return {
      root,
      layout: lay,
      words,
      backing,
      wash,
      w: { x: Number.NaN, y: 0, s: 0, o: 0, b: -1, m: -1, f: -1, bucket: -2, still: 0 },
    };
  }

  function wordEl(
    el: HTMLElement,
    lay: LineLayout['words'][number] | undefined,
    dir: string,
    em: number,
  ): WordEl {
    const r = lay?.rect;
    const ww = r?.w || 1;
    const gs = [...el.querySelectorAll<HTMLElement>('.ly-g')].map((g, i) => {
      const gr = lay?.graphemes[i];
      const off = !gr || !r ? 0 : dir === 'rtl' ? r.x + r.w - (gr.x + gr.w) : gr.x - r.x;
      return { el: g, off, w: gr?.w || 1, e: -1, p: -1 };
    });
    return {
      el,
      state: 0,
      p: -1,
      glow: 0,
      gr: LYRICS.glow.radius,
      gs,
      ww,
      ahead: (LYRICS.sweep.edgeAhead * em) / ww,
      behind: (LYRICS.sweep.edgeBehind * em) / ww,
    };
  }

  function release(e: LineEl) {
    e.root.remove();
    e.root.removeAttribute('style');
    e.root.replaceChildren();
    if (pool.length < POOL) pool.push(e.root);
  }

  /** `p`: where the line's edge is through this word (model.ts lineEdges); the wash: 0…1. */
  function writeWord(w: WordEl, p: number) {
    const state = p <= -w.ahead ? 0 : p >= 1 + w.behind ? 2 : 1;
    if (state !== w.state) {
      w.el.classList.toggle('sweep', state === 1);
      w.el.classList.toggle('lit', state === 2);
      w.state = state;
    }
    if (state !== 1) return;
    if (w.gs.length) {
      for (const g of w.gs) {
        const gp = ((p * w.ww - g.off) / g.w) * 100;
        if (Math.abs(gp - g.p) < 0.5) continue;
        g.el.style.setProperty('--p', `${gp.toFixed(1)}%`);
        g.p = gp;
      }
    } else if (Math.abs(p - w.p) >= 0.002) {
      w.el.style.setProperty('--p', `${(p * 100).toFixed(2)}%`);
      w.p = p;
    }
  }

  function writeGlow(w: WordEl, a: number, r: number) {
    if (a > 0 && Math.abs(r - w.gr) >= 0.005) {
      w.el.style.setProperty('--gr', r.toFixed(3));
      w.gr = r;
    }
    if (Math.abs(a - w.glow) < 0.005 && !(a === 0 && w.glow !== 0)) return;
    w.el.classList.toggle('glow', a > 0);
    if (a > 0) w.el.style.setProperty('--ga', a.toFixed(3));
    w.glow = a;
  }

  function writeLine(inst: Inst, e: LineEl, dt: number) {
    const w = e.w;
    const parent = inst.bucket >= 0 ? (buckets[inst.bucket] as HTMLElement) : main;
    if (w.bucket !== inst.bucket || e.root.parentElement !== parent) {
      parent.append(e.root);
      w.bucket = inst.bucket;
    }
    const x = inst.x.x - e.layout.w / 2;
    const y = inst.y.x - e.layout.h / 2;
    const s = inst.scale;
    if (
      Math.abs(x - w.x) >= 0.1 ||
      Math.abs(y - w.y) >= 0.1 ||
      Math.abs(s - w.s) >= 0.0005 ||
      Number.isNaN(w.x)
    ) {
      e.root.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
      if (w.still >= WILL_CHANGE_MS || Number.isNaN(w.x))
        e.root.style.willChange = 'transform, opacity';
      w.x = x;
      w.y = y;
      w.s = s;
      w.still = 0;
    } else if (w.still < WILL_CHANGE_MS) {
      w.still += dt;
      if (w.still >= WILL_CHANGE_MS) e.root.style.willChange = '';
    }
    if (Math.abs(inst.opacity - w.o) >= 0.005 || (inst.opacity === 0) !== (w.o === 0)) {
      e.root.style.opacity = inst.opacity.toFixed(3);
      w.o = inst.opacity;
    }
    if (Math.abs(inst.blur - w.b) >= 0.05) {
      e.root.style.filter = inst.blur > 0.05 ? `blur(${inst.blur.toFixed(2)}px)` : '';
      w.b = inst.blur;
    }
    if (Math.abs(inst.mix - w.m) >= 0.01) {
      e.root.style.setProperty('--m', inst.mix.toFixed(3));
      w.m = inst.mix;
    }
    if (Math.abs(inst.fade - w.f) >= 0.01) {
      e.root.style.setProperty('--f', inst.fade.toFixed(3));
      w.f = inst.fade;
    }
    if (inst.role === 'bg') return; // not word-lit (§8.2)
    e.words.forEach((we, k) => {
      writeWord(we, inst.edge[k] as number);
      writeGlow(we, inst.glow[k] as number, inst.glowR);
      const em = inst.emph[k];
      if (!em?.length) return;
      const lay = e.layout.words[k]?.emphasis;
      // Letters also push a little apart from the word's middle (mirrored right to left).
      const mid = (we.gs.length - 1) / 2;
      const side = e.layout.dir === 'rtl' ? -1 : 1;
      we.gs.forEach((g, i) => {
        const v = em[i]?.x ?? 0;
        if (Math.abs(v - g.e) < 0.002 || !lay) return;
        g.el.style.transform =
          v > 0.001
            ? `translate(${(side * lay.spread * v * (i - mid)).toFixed(4)}em, ${(-lay.lift * v).toFixed(4)}em) scale(${(1 + lay.swell * v).toFixed(4)})`
            : '';
        g.e = v;
      });
    });
    e.backing.forEach((ws, j) => {
      ws.forEach((we, k) => {
        writeWord(we, inst.backing[j]?.[k] as number);
      });
    });
    if (e.wash) writeWord(e.wash, inst.wash);
  }

  function render(dt: number) {
    if (!model) return;
    const seen = new Set<Inst>();
    for (const inst of [...model.insts.values(), ...model.leaving]) {
      let e = els.get(inst);
      if (!e) {
        e = acquire(inst);
        els.set(inst, e);
      }
      seen.add(inst);
      writeLine(inst, e, dt);
    }
    for (const [inst, e] of els)
      if (!seen.has(inst)) {
        release(e);
        els.delete(inst);
      }
    const d = model.dots;
    dotsEl.style.opacity = d.opacity.toFixed(3);
    dotsEl.style.visibility = d.opacity > 0 ? '' : 'hidden';
    if (d.opacity > 0)
      dots.forEach((el, k) => {
        el.style.transform = `scale(${(d.scale[k] as number).toFixed(3)})`;
        el.style.opacity = (d.alpha[k] as number).toFixed(3);
      });
  }

  function clear() {
    for (const e of els.values()) release(e);
    els = new Map();
    model = null;
    layout = null;
  }

  /** The outgoing field recedes (§9.7): z → 1 and opacity → 0 over 420 ms, no stagger. */
  function recede() {
    if (!els.size) return;
    const old = div('ly-scene ly-receding');
    old.style.setProperty('--far-blur', `${blurAt(1)}px`);
    for (const e of els.values()) old.append(e.root);
    els = new Map();
    host.append(old);
    requestAnimationFrame(() => old.classList.add('go'));
    setTimeout(() => old.remove(), LYRICS.build.recedeMs + 50);
  }

  async function setDoc(next: LyricsDoc | null) {
    if (next === doc) return;
    recede();
    clear();
    doc = next;
    transcript.replaceChildren();
    current = null;
    live.textContent = '';
    const gen = ++build;
    if (!next || next.sync === 'none') return;
    const text = next.lines.map((l) => l.text).join(' ');
    await document.fonts?.load(`600 1rem "Mona Sans"`, text).catch(() => undefined);
    if (gen !== build) return;
    lay();
    opts.onReady?.();
  }

  function lay() {
    if (!doc) return;
    const size = stageSize();
    W = size.w;
    H = size.h;
    laidW = W;
    laidH = H;
    const tl = buildTimeline(doc);
    layout = measureDoc(measure, doc, tl.lines, W);
    const boxes = layout.lines.map((l) => ({ w: l.w, h: l.h, side: l.side, words: l.words }));
    if (model && model.tl.lines.length === tl.lines.length) {
      model.relayout(boxes);
      for (const e of els.values()) release(e);
      els = new Map(); // rebuilt at the new size on the next frame
    } else
      model = new FieldModel(tl, boxes, {
        seed: hash(doc.trackKey),
        budget: tier.budget,
        dotsH: layout.fontPx * LINE_HEIGHT,
      });
    if (!transcript.childElementCount)
      transcript.append(
        ...tl.lines.map((l) => {
          const li = document.createElement('li');
          li.textContent = l.text;
          return li;
        }),
      );
    scene.style.setProperty('--ly-dot', `${LYRICS.interlude.dotEm * layout.fontPx}px`);
    // Development builds expose the measured boxes, so e2e can run the timing tables on the
    // browser's real layout (LYR-05, LYR-27). Compiled out of the image.
    if (__ECHO_FIXTURES__)
      Object.assign(window, {
        __echoLyrics: {
          W,
          H,
          at: performance.now(),
          fontPx: layout.fontPx,
          boxes,
          lines: layout.lines,
        },
      });
  }

  /**
   * Resize (§9.10): while the window is being dragged the laid-out field scales with the stage;
   * 120 ms after the last change every line is re-measured and jumps to its new place behind a
   * 200 ms opacity dip. No springs, no stagger.
   */
  function resize() {
    if (!model) return;
    const size = stageSize();
    // ResizeObserver also reports the size it starts with: nothing to do then.
    if (!resizeTimer && size.w === laidW && size.h === laidH) return;
    const k = Math.min(size.w / (laidW || size.w), size.h / (laidH || size.h));
    scene.style.transform = Math.abs(k - 1) > 0.001 ? `scale(${k.toFixed(4)})` : '';
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      scene.style.transform = '';
      lay();
      scene.animate([{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], {
        duration: RESIZE_DIP_MS,
        easing: 'ease-in-out',
      });
      opts.onReady?.();
    }, RESIZE_DEBOUNCE_MS);
  }

  return {
    setDoc,
    resize,
    /** One frame (§4.2 step 4). Returns the key light's position (stage uv, y down), if any. */
    update(f: FieldFrame) {
      if (!model) return null;
      host.classList.toggle('ly-reduced', !!f.reduced);
      host.classList.toggle('ly-instant', f.mode !== 'run'); // scrub and still frames snap
      model.update({ ...f, W, H });
      render(f.dt);
      const a = model.active;
      const item = (transcript.children[a] as HTMLElement | undefined) ?? null;
      if (item !== current) {
        current?.removeAttribute('aria-current');
        item?.setAttribute('aria-current', 'true');
        current = item;
      }
      const say = announcer.update(a, model.lines[a]?.text ?? '', f.dt, announce, f.mode !== 'run');
      if (say !== null) live.textContent = say;
      const k = model.key;
      return k ? { x: k.x, y: (k.y * H) / (H + dock) } : null; // the room spans the dock too
    },
    get active() {
      return !!model;
    },
    /** Settings → Lyrics → "Announce lyric lines" (§11). */
    setAnnounce(on: boolean) {
      announce = on;
    },
    dispose() {
      build++;
      if (resizeTimer) clearTimeout(resizeTimer);
      clear();
      host.replaceChildren();
      host.classList.remove('ly-field');
    },
  };
}

export type LyricField = ReturnType<typeof createLyricField>;
