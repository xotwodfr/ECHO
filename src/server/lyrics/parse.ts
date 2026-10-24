import type { LyricLine, LyricsDoc, LyricWord, SyncLevel } from '../../shared/types.ts';

// Lyric parsers (LYRICS_INTEGRATION.md §1, §5): LRC and enhanced LRC, OpenSubsonic structured
// lyrics (songLyrics v1 lines, v2 cues), Spicy Lyrics (Syllable / Line / Static, checked against
// the live API docs 2026-10-24), and plain text. Each returns the timed part of a LyricsDoc; the
// source adds its key, attribution and fetch time. A declared offset (LRC `[offset:]`,
// OpenSubsonic `offset`) is applied to the times here, so `offsetMs` is always 0 downstream and
// nothing applies it twice.

export type Parsed = Pick<LyricsDoc, 'sync' | 'lines' | 'offsetMs'> &
  Partial<Pick<LyricsDoc, 'language' | 'durationMs' | 'agents' | 'translations' | 'romanisation'>>;

export class LyricsInvalid extends Error {}

const ms = (s: number) => Math.round(s * 1000);

// ---- LRC ------------------------------------------------------------------------------------

const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const META = /^\[([a-z#]+):(.*)\]\s*$/i;

const lrcTime = (m: string, s: string) => (Number(m) * 60 + Number(s.replace(':', '.'))) * 1000;

/** LRC with optional enhanced word tags (`<mm:ss.xx>word`) and `[offset:±ms]`. */
export function parseLrc(text: string): Parsed {
  let offset = 0;
  let language: string | undefined;
  const timed: LyricLine[] = [];
  const plain: string[] = [];
  let words = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const meta = META.exec(line);
    if (meta && !/^\d/.test(meta[1] as string)) {
      const key = (meta[1] as string).toLowerCase();
      if (key === 'offset') offset = Number.parseInt((meta[2] as string).trim(), 10) || 0;
      if (key === 'la' || key === 'lang') language = (meta[2] as string).trim() || undefined;
      continue;
    }
    const tags = [...line.matchAll(TAG)];
    if (!tags.length) {
      plain.push(line);
      continue;
    }
    const body = line.slice((tags.at(-1)?.index ?? 0) + (tags.at(-1)?.[0].length ?? 0));
    const parsedWords = parseWordTags(body);
    if (parsedWords) words = true;
    const textOnly = body.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    // One line can carry several start tags (a repeated chorus).
    for (const t of tags) {
      const start = lrcTime(t[1] as string, t[2] as string);
      const shift = parsedWords?.length ? start - (parsedWords[0]?.start ?? start) : 0;
      timed.push({
        text: textOnly,
        start,
        ...(parsedWords && {
          words: parsedWords.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift })),
        }),
      });
    }
  }
  if (!timed.length)
    return {
      sync: 'none',
      offsetMs: 0,
      language,
      lines: plain.map((t) => ({ text: t, start: 0 })),
    };
  timed.sort((a, b) => a.start - b.start);
  // Each line ends where the next begins; words without an end tag end at the next word.
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i] as LyricLine;
    const next = timed[i + 1];
    const ws = line.words;
    if (ws?.length) {
      const last = ws[ws.length - 1] as LyricWord;
      if (!(last.end > last.start))
        last.end = next ? Math.max(last.start + 60, next.start) : last.start + 500;
    }
  }
  const sync: SyncLevel = words && timed.every((l) => l.words?.length || !l.text) ? 'word' : 'line';
  const lines = timed.map((l) => {
    const shifted = { ...l, start: l.start - offset };
    if (sync !== 'word') {
      const { words: _, ...rest } = shifted;
      return rest;
    }
    return {
      ...shifted,
      words: l.words?.map((w) => ({ ...w, start: w.start - offset, end: w.end - offset })),
    };
  });
  return { sync, offsetMs: 0, language, lines };
}

/** `<t>word <t>word <t>` → words; the last bare tag is the end of the last word. */
function parseWordTags(body: string): LyricWord[] | null {
  const marks = [...body.matchAll(WORD_TAG)];
  if (!marks.length) return null;
  const words: LyricWord[] = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i] as RegExpMatchArray;
    const from = (m.index ?? 0) + m[0].length;
    const to = marks[i + 1]?.index ?? body.length;
    const chunk = body.slice(from, to);
    const t = lrcTime(m[1] as string, m[2] as string);
    const prev = words.at(-1);
    if (prev && !(prev.end > prev.start)) prev.end = t;
    if (!chunk.trim()) continue; // a closing tag
    words.push({
      text: chunk.trim(),
      start: t,
      end: 0,
      isPartOfWord: !/\s$/.test(chunk) && i + 1 < marks.length,
    });
  }
  // The last word cannot run into a following word.
  const last = words.at(-1);
  if (last) last.isPartOfWord = false;
  return words;
}

// ---- OpenSubsonic -----------------------------------------------------------------------------

interface OsCue {
  start?: number;
  end?: number;
  value: string;
  byteStart?: number;
  byteEnd?: number;
}
interface OsCueLine {
  index: number;
  start?: number;
  end?: number;
  value: string;
  agentId?: string;
  cue: OsCue[];
}
export interface OsStructured {
  kind?: string;
  lang?: string;
  offset?: number;
  synced?: boolean;
  line?: { start?: number; value: string }[];
  cueLine?: OsCueLine[];
  agents?: { id: string; role?: string; name?: string }[];
}

/** Cues → words. Whitespace cues and gaps in the byte offsets mark word breaks. */
function cueWords(cl: OsCueLine): LyricWord[] {
  const out: LyricWord[] = [];
  const cues = cl.cue ?? [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i] as OsCue;
    if (!c.value.trim() || c.start === undefined) continue;
    const next = cues[i + 1];
    const touching =
      !!next &&
      !!next.value.trim() &&
      !/\s$/.test(c.value) &&
      !/^\s/.test(next.value) &&
      (c.byteEnd === undefined || next.byteStart === undefined || next.byteStart === c.byteEnd + 1);
    out.push({
      text: c.value.trim(),
      start: c.start,
      end: c.end ?? c.start,
      isPartOfWord: touching,
    });
  }
  return out;
}

/** The `main` (or only) entry of a getLyricsBySongId answer, preferring synced lyrics. */
export function parseOpenSubsonic(entries: OsStructured[]): Parsed {
  const main = entries.filter((e) => !e.kind || e.kind === 'main');
  const pick =
    main.find((e) => e.synced && e.cueLine?.length) ?? main.find((e) => e.synced) ?? main[0];
  if (!pick?.line?.length) throw new LyricsInvalid('no lines');
  const offset = pick.offset ?? 0;
  if (!pick.synced)
    return {
      sync: 'none',
      offsetMs: 0,
      language: pick.lang,
      lines: pick.line.map((l) => ({ text: l.value, start: 0 })),
    };

  const roles = new Map((pick.agents ?? []).map((a) => [a.id, a.role ?? 'main']));
  const byIndex = new Map<number, OsCueLine[]>();
  for (const cl of pick.cueLine ?? [])
    byIndex.set(cl.index, [...(byIndex.get(cl.index) ?? []), cl]);
  const hasCues = byIndex.size > 0;
  const lines: LyricLine[] = pick.line.map((l, i) => {
    const start = (l.start ?? 0) - offset;
    const cls = byIndex.get(i);
    if (!cls?.length) return { text: l.value, start };
    const lead = cls.find((c) => roles.get(c.agentId ?? '') !== 'bg') ?? (cls[0] as OsCueLine);
    const shift = (w: LyricWord) => ({ ...w, start: w.start - offset, end: w.end - offset });
    const words = cueWords(lead).map(shift);
    const bg = cls.filter((c) => c !== lead && roles.get(c.agentId ?? '') === 'bg');
    return {
      text: lead.value.trim(),
      start: (lead.start ?? l.start ?? 0) - offset,
      ...(lead.end !== undefined && { end: lead.end - offset }),
      words,
      ...(lead.agentId && { agent: lead.agentId }),
      ...(roles.get(lead.agentId ?? '') === 'voice' && { oppositeAligned: true }),
      ...(bg.length && {
        background: bg.map((b) => ({ text: b.value.trim(), words: cueWords(b).map(shift) })),
      }),
    };
  });
  const agents = pick.agents?.map((a) => ({
    id: a.id,
    name: a.name,
    kind: (a.role === 'group' ? 'group' : 'person') as 'group' | 'person',
  }));
  const allWords = hasCues && lines.every((l) => l.words?.length || !l.text.trim());
  return {
    sync: allWords ? 'word' : 'line',
    offsetMs: 0,
    language: pick.lang,
    ...(agents?.length && { agents }),
    lines: allWords ? lines : lines.map(({ words: _, background: __, ...rest }) => rest),
  };
}

// ---- Spicy Lyrics -----------------------------------------------------------------------------

interface SpSyllable {
  Text: string;
  StartTime?: number;
  EndTime?: number;
  IsPartOfWord?: boolean;
}
interface SpGroup {
  Syllables: SpSyllable[];
  StartTime?: number;
  EndTime?: number;
  TranslatedText?: string;
}
export interface SpicyBody {
  Type: 'Syllable' | 'Line' | 'Static';
  source?: string;
  source_via?: string;
  SongWriters?: string[];
  StartTime?: number;
  EndTime?: number;
  UploadAttribution?: {
    Uploader: { username: string; url: string };
    Maker?: { username: string; url: string };
  };
  Content?: (
    | { Type: 'Vocal'; OppositeAligned?: boolean; Lead: SpGroup; Background?: SpGroup[] }
    | {
        Type: 'Vocal';
        OppositeAligned?: boolean;
        Text: string;
        StartTime?: number;
        EndTime?: number;
      }
  )[];
  Lines?: { Text: string }[];
}

const spWords = (g: SpGroup): LyricWord[] =>
  g.Syllables.filter((s) => s.Text.trim()).map((s) => ({
    text: s.Text.trimEnd(),
    start: ms(s.StartTime ?? 0),
    end: ms(s.EndTime ?? s.StartTime ?? 0),
    isPartOfWord: !!s.IsPartOfWord,
  }));
const joinWords = (ws: LyricWord[]) =>
  ws
    .map((w) => w.text + (w.isPartOfWord ? '' : ' '))
    .join('')
    .trim();

/** Spicy Lyrics `Body` (times in seconds). */
export function parseSpicy(body: SpicyBody): Parsed {
  const durationMs = body.EndTime ? ms(body.EndTime) : undefined;
  if (body.Type === 'Static')
    return {
      sync: 'none',
      offsetMs: 0,
      lines: (body.Lines ?? []).map((l) => ({ text: l.Text, start: 0 })),
    };
  const content = body.Content ?? [];
  if (!content.length) throw new LyricsInvalid('no content');
  if (body.Type === 'Line')
    return {
      sync: 'line',
      offsetMs: 0,
      durationMs,
      lines: content.map((c) => {
        const l = c as {
          Text: string;
          StartTime?: number;
          EndTime?: number;
          OppositeAligned?: boolean;
        };
        return {
          text: l.Text,
          start: ms(l.StartTime ?? 0),
          ...(l.EndTime !== undefined && { end: ms(l.EndTime) }),
          ...(l.OppositeAligned && { oppositeAligned: true }),
        };
      }),
    };
  const translated: string[] = [];
  const lines = content.map((c) => {
    const v = c as { Lead: SpGroup; Background?: SpGroup[]; OppositeAligned?: boolean };
    const words = spWords(v.Lead);
    translated.push(v.Lead.TranslatedText ?? '');
    return {
      text: joinWords(words),
      start: ms(v.Lead.StartTime ?? v.Lead.Syllables[0]?.StartTime ?? 0),
      end: ms(v.Lead.EndTime ?? v.Lead.Syllables.at(-1)?.EndTime ?? 0),
      words,
      ...(v.OppositeAligned && { oppositeAligned: true }),
      ...(v.Background?.length && {
        background: v.Background.map((b) => {
          const bw = spWords(b);
          return {
            text: joinWords(bw),
            start: ms(b.StartTime ?? 0),
            end: ms(b.EndTime ?? 0),
            words: bw,
          };
        }),
      }),
    };
  });
  return {
    sync: 'word',
    offsetMs: 0,
    durationMs,
    lines,
    ...(translated.some(Boolean) && { translations: [{ lang: 'und', lines: translated }] }),
  };
}

/** Plain text (Navidrome legacy `getLyrics`). */
export const parsePlain = (text: string): Parsed => ({
  sync: 'none',
  offsetMs: 0,
  lines: text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, start: 0 })),
});

// ---- validation and repair (§5) ----------------------------------------------------------------

/**
 * Integer, non-negative times; words sorted, with `end > start` and no overlaps; line ends from the
 * last word; untimed empty lines dropped. A document whose timing does not hold up (lines past the
 * track's end, fewer than 90% of starts in order) is downgraded to static text. Throws when nothing
 * is left.
 */
export function repair(p: Parsed, trackDurationMs?: number): Parsed {
  const t = (x: number) => Math.max(0, Math.round(x));
  let lines = p.lines.map((l): LyricLine => {
    const words = l.words
      ?.map((w) => ({ ...w, start: t(w.start), end: t(w.end) }))
      .sort((a, b) => a.start - b.start);
    words?.forEach((w, i) => {
      if (w.end <= w.start) w.end = w.start + 60;
      const next = words[i + 1];
      if (next && w.end > next.start) w.end = Math.max(w.start + 1, next.start);
    });
    const bg = l.background?.map((b) => ({
      ...b,
      ...(b.start !== undefined && { start: t(b.start) }),
      ...(b.end !== undefined && { end: t(b.end) }),
      ...(b.words && {
        words: b.words.map((w) => ({
          ...w,
          start: t(w.start),
          end: Math.max(t(w.end), t(w.start) + 60),
        })),
      }),
    }));
    const end = words?.length
      ? (words[words.length - 1] as LyricWord).end
      : l.end !== undefined
        ? t(l.end)
        : undefined;
    return {
      ...l,
      text: l.text.replace(/\s+/g, ' ').trim(),
      start: p.sync === 'none' ? 0 : t(l.start),
      ...(end !== undefined && { end }),
      ...(words && { words }),
      ...(bg && { background: bg }),
    };
  });
  let sync = p.sync;
  if (sync === 'none') lines = lines.filter((l) => l.text);
  else lines = lines.filter((l) => l.text || l.words?.length || l.start > 0);
  if (!lines.some((l) => l.text)) throw new LyricsInvalid('empty');
  if (sync !== 'none') {
    let ordered = 0;
    for (let i = 1; i < lines.length; i++)
      if ((lines[i] as LyricLine).start >= (lines[i - 1] as LyricLine).start) ordered++;
    const monotonic = lines.length < 2 || ordered / (lines.length - 1) >= 0.9;
    const fits =
      trackDurationMs === undefined || (lines.at(-1) as LyricLine).start < trackDurationMs;
    if (!monotonic || !fits) {
      sync = 'none';
      lines = lines
        .filter((l) => l.text)
        .map(({ words: _, background: __, end: ___, ...l }) => ({ ...l, start: 0 }));
    } else lines.sort((a, b) => a.start - b.start);
  }
  if (sync !== 'word') lines = lines.map(({ words: _, ...l }) => l);
  return { ...p, sync, lines };
}
