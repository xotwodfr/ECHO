import type { LyricLine, LyricsDoc, LyricWord } from '../../../shared/types.ts';
import { LYRICS } from './lyricsConfig.ts';

// Line layout (LYRICS_EXPERIENCE.md §3.3, DESIGN_SYSTEM.md §4.3): every line is built and measured
// once per document and per resize, at active size. Depth is a transform, so nothing reflows when a
// line changes state, and the frame loop never reads layout.

export const LINE_HEIGHT = 1.12;
export const LINE_HEIGHT_CJK = 1.2;
const WDTH_MIN = 100; // Figtree has no width axis: a long line shrinks, then wraps
const WDTH_STEP = 2;
const SIZE_STEP = 0.02;
export const BG_SIZE = 0.62; // backing vocals under their lead line (§5.6)

const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Base direction from the first strong (letter) character (§5.4). */
export function dirOf(text: string): 'ltr' | 'rtl' {
  const first = text.match(/\p{L}/u)?.[0];
  return first && RTL.test(first) ? 'rtl' : 'ltr';
}

export const isCJK = (text: string) => CJK.test(text);
/** Cursive scripts: letters join their neighbours, so they cannot be set one box per grapheme. */
const JOINED =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Adlam}]/u;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (text: string) => [...segmenter.segment(text)].map((s) => s.segment);

export interface Fit {
  wdth: number; // width axis, 100 = normal (Figtree has none: always 100)
  size: number; // shrink multiplier, 0.88–1
  rows: number;
}

/**
 * Two rows at most: shrink by up to 12%, then allow 3 rows (or more: the stack's overflow rule
 * copes). `rowsAt` measures the line at a setting.
 */
export function fitLine(rowsAt: (wdth: number, size: number) => number): Fit {
  let wdth = 100;
  let size = 1;
  let rows = rowsAt(wdth, size);
  while (rows > LYRICS.maxRows && wdth > WDTH_MIN) {
    wdth = Math.max(WDTH_MIN, wdth - WDTH_STEP);
    rows = rowsAt(wdth, size);
  }
  const minSize = 1 - LYRICS.shrinkMax;
  while (rows > LYRICS.maxRows && size > minSize + 1e-9) {
    size = Math.max(minSize, size - SIZE_STEP);
    rows = rowsAt(wdth, size);
  }
  return { wdth, size: Math.round(size * 100) / 100, rows };
}

export interface Emphasis {
  swell: number; // peak scale − 1, ≤ 0.08
  lift: number; // peak lift in em, ≤ 0.08
  spread: number; // peak push apart per grapheme from the word's middle, em, ≤ 0.04 (AMLL, Spicy)
  stepMs: number; // graphemes start this far apart
}

const E = LYRICS.emphasis;
const LIFT_EM = 0.05;
const LIFT_MAX_EM = 0.08;
const SPREAD_MAX_EM = 0.04;
const NO_EMPHASIS_BELOW_MS = 150; // rap words (§9.9)

/**
 * Held-word emphasis (§5.5): ≥ 1000 ms and 2–7 graphemes (CJK: duration only), never under 150 ms
 * and never in a joined script (its graphemes would lose their joins). The last word of a line
 * swells 1.4× more, capped at +8%.
 */
export function emphasisOf(w: LyricWord, last: boolean): Emphasis | null {
  const dur = w.end - w.start;
  if (dur < NO_EMPHASIS_BELOW_MS || dur < E.minMs || JOINED.test(w.text)) return null;
  const n = graphemes(w.text).length;
  if (!isCJK(w.text) && (n < E.minG || n > E.maxG)) return null;
  const a = Math.min(1.2, (dur - E.minMs) / 1500 + 0.6) * (last ? 1.4 : 1);
  return {
    swell: Math.min(E.swellMax, 0.05 * a),
    lift: Math.min(LIFT_MAX_EM, LIFT_EM),
    spread: Math.min(SPREAD_MAX_EM, 0.03 * a),
    stepMs: dur / 2.5 / n,
  };
}

/** Line-timed sources mark backing vocals with parentheses (§5.6): `lead (backing)`. */
export function splitBacking(text: string): { lead: string; backing: string[] } {
  const backing: string[] = [];
  const lead = text
    .replace(/\s*\(([^()]+)\)/g, (_, b: string) => {
      backing.push(b.trim());
      return '';
    })
    .trim();
  return lead ? { lead, backing } : { lead: text, backing: [] };
}

export type Side = 'centre' | 'left' | 'right';

/**
 * Duet sides, decided once per document (§4.4): with opposite-aligned lines, those go right and the
 * rest left; with two or more agents and no flags, the first agent goes left and the others right.
 * Group agents stay centred (an ECHO reading: a line everyone sings belongs to neither side).
 */
export function sidesOf(doc: LyricsDoc): (line: LyricLine) => Side {
  const agents = [...new Set(doc.lines.map((l) => l.agent).filter(Boolean))];
  const flagged = doc.lines.some((l) => l.oppositeAligned);
  if (!flagged && agents.length < 2) return () => 'centre';
  const group = new Set(doc.agents?.filter((a) => a.kind === 'group').map((a) => a.id));
  return (l) => {
    if (l.agent && group.has(l.agent)) return 'centre';
    if (flagged) return l.oppositeAligned ? 'right' : 'left';
    return l.agent && l.agent !== agents[0] ? 'right' : 'left';
  };
}

// ---------- DOM ----------

/** A box relative to its line's box at scale 1, CSS px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WordLayout {
  word: LyricWord;
  rect: Rect;
  emphasis: Emphasis | null;
  graphemes: Rect[]; // only for emphasised words
}

export interface LineLayout {
  w: number;
  h: number;
  rows: number;
  fit: Fit;
  dir: 'ltr' | 'rtl';
  cjk: boolean;
  side: Side;
  words: WordLayout[]; // the lead line's timed words (empty when line-timed)
  backing: WordLayout[][]; // per background sub-line
}

export interface DocLayout {
  fontPx: number;
  maxWidth: number;
  lines: LineLayout[];
}

/** Builds a line's content: lead words (syllables joined) and backing sub-lines. Same for every use. */
export function buildLine(
  el: HTMLElement,
  line: LyricLine,
  fit: Fit,
  fontPx: number,
  maxW: number,
) {
  el.className = 'ly-line';
  el.dir = dirOf(line.text);
  if (isCJK(line.text)) el.dataset.cjk = '';
  else delete el.dataset.cjk;
  el.style.fontSize = `${fontPx * fit.size}px`;
  el.style.fontStretch = `${fit.wdth}%`;
  el.style.maxWidth = `${maxW}px`;
  const lead = document.createElement('div');
  lead.className = 'ly-lead';
  const backing = line.words ? (line.background ?? []).map((b) => b.words ?? b.text) : [];
  if (line.words) appendWords(lead, line.words, true);
  else {
    const { lead: text, backing: b } = splitBacking(line.text);
    appendWash(lead, text);
    backing.push(...b);
  }
  el.replaceChildren(lead);
  for (const b of backing) {
    const sub = document.createElement('div');
    sub.className = 'ly-bg';
    sub.style.fontSize = `${BG_SIZE * 100}%`;
    if (typeof b === 'string') appendWash(sub, b);
    else appendWords(sub, b, false);
    el.append(sub);
  }
}

function appendWash(parent: HTMLElement, text: string) {
  const s = document.createElement('span');
  s.className = 'ly-w ly-wash';
  s.textContent = text;
  parent.append(s);
}

function appendWords(parent: HTMLElement, words: LyricWord[], emphasis: boolean) {
  // Syllables of one word share a no-wrap group, so a word never breaks between them. CJK lines
  // are not grouped: every character is its own unit and may wrap anywhere.
  const cjk = words.some((w) => isCJK(w.text));
  let group: HTMLElement = parent;
  words.forEach((w, k) => {
    if (!cjk && group === parent && w.isPartOfWord) {
      group = document.createElement('span');
      group.className = 'ly-vw';
      parent.append(group);
    }
    const s = document.createElement('span');
    s.className = 'ly-w';
    const em = emphasis && emphasisOf(w, k === words.length - 1);
    if (em) {
      s.classList.add('ly-emph');
      for (const g of graphemes(w.text)) {
        const gs = document.createElement('span');
        gs.className = 'ly-g';
        gs.textContent = g;
        s.append(gs);
      }
    } else s.textContent = w.text;
    group.append(s);
    if (!w.isPartOfWord) {
      group = parent;
      if (k < words.length - 1) parent.append(' ');
    }
  });
}

const rectIn = (el: HTMLElement, box: DOMRect): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
};

/**
 * Measures every displayed line in `measure` (an unscaled, hidden element inside the field) at the
 * stage width `W`. The only layout reads of the lyric field.
 */
export function measureDoc(
  measure: HTMLElement,
  doc: LyricsDoc,
  lines: readonly LyricLine[],
  W: number,
): DocLayout {
  const fontPx = Number.parseFloat(getComputedStyle(measure).fontSize) || 56;
  const maxWidth = LYRICS.maxWidth * W;
  const side = sidesOf(doc);
  const el = document.createElement('div');
  measure.replaceChildren(el);
  const out = lines.map((line): LineLayout => {
    const cjk = isCJK(line.text);
    const lh = cjk ? LINE_HEIGHT_CJK : LINE_HEIGHT;
    const rowsAt = (wdth: number, size: number) => {
      buildLine(el, line, { wdth, size, rows: 0 }, fontPx, maxWidth);
      const lead = el.firstElementChild as HTMLElement;
      return Math.max(1, Math.round(lead.offsetHeight / (fontPx * size * lh)));
    };
    const fit = fitLine(rowsAt);
    buildLine(el, line, fit, fontPx, maxWidth);
    const box = el.getBoundingClientRect();
    const words = (parent: Element | null, ws: readonly LyricWord[] | undefined) =>
      ws
        ? [...(parent?.querySelectorAll<HTMLElement>('.ly-w') ?? [])].map((s, k) => ({
            word: ws[k] as LyricWord,
            rect: rectIn(s, box),
            emphasis: s.classList.contains('ly-emph')
              ? emphasisOf(ws[k] as LyricWord, k === ws.length - 1)
              : null,
            graphemes: [...s.querySelectorAll<HTMLElement>('.ly-g')].map((g) => rectIn(g, box)),
          }))
        : [];
    const subs = [...el.querySelectorAll('.ly-bg')];
    return {
      w: box.width,
      h: box.height,
      rows: fit.rows,
      fit,
      dir: dirOf(line.text),
      cjk,
      side: side(line),
      words: words(el.firstElementChild, line.words),
      backing: line.words
        ? (line.background ?? []).map((b, i) => words(subs[i] ?? null, b.words))
        : [],
    };
  });
  measure.replaceChildren();
  return { fontPx, maxWidth, lines: out };
}
