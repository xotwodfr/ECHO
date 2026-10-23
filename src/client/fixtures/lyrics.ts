import type { LyricLine, LyricsDoc, LyricWord } from '../../shared/types.ts';

// Mock LyricsDocs for M3 (LYRICS_EXPERIENCE.md §16): original text written for ECHO. Timestamps are
// derived from the text by a fixed pacing per fixture, so they are reproducible and reviewable.
// Markup in a line: `syl~la~ble` joins syllables (isPartOfWord), `word*3` holds a word 3× as long,
// `|` is a 600 ms rest inside the line (§5.1 hold). Development builds only, like `fixtures/`.

interface Pace {
  dur: (syllable: string) => number; // ms
  wordGap: number; // between words
  lineGap: number; // between a line's last word and the next line
  perChar?: boolean; // CJK: every character is a timed unit, no spaces
}

interface Opts {
  after?: number; // gap before this line instead of `lineGap`
  agent?: string;
  opposite?: boolean;
  bg?: string; // backing vocals as `background[]`, from the middle of the lead line
}

type Entry = string | [string, Opts];

const REST_MS = 600;
const letters = (s: string) => s.match(/\p{L}/gu)?.length ?? 1;

function timeWords(text: string, at: number, pace: Pace): LyricWord[] {
  const out: LyricWord[] = [];
  let t = at;
  for (const token of text.split(' ')) {
    if (token === '|') {
      t += REST_MS;
      continue;
    }
    const [, base = '', hold = '1'] = /^(.*?)(?:\*(\d+(?:\.\d+)?))?$/u.exec(token) ?? [];
    const parts = pace.perChar ? [...base] : base.split('~');
    parts.forEach((text, j) => {
      const d = Math.round(pace.dur(text) * Number(hold));
      out.push({ text, start: t, end: t + d, isPartOfWord: pace.perChar || j < parts.length - 1 });
      t += d;
    });
    t += pace.wordGap;
  }
  const last = out.at(-1);
  if (last) last.isPartOfWord = false;
  return out;
}

const joinWords = (ws: LyricWord[]) =>
  ws
    .map((w) => w.text + (w.isPartOfWord ? '' : ' '))
    .join('')
    .trim();

/** Lines from `at`, one after the other; returns them and when the last word ends. */
function section(at: number, pace: Pace, entries: Entry[]): { lines: LyricLine[]; end: number } {
  const lines: LyricLine[] = [];
  let t = at;
  entries.forEach((e, i) => {
    const [text, o] = typeof e === 'string' ? [e, {} as Opts] : e;
    if (i > 0) t += o.after ?? pace.lineGap;
    const words = timeWords(text, t, pace);
    const first = words[0] as LyricWord;
    const last = words.at(-1) as LyricWord;
    const line: LyricLine = { text: joinWords(words), start: first.start, end: last.end, words };
    if (o.agent) line.agent = o.agent;
    if (o.opposite) line.oppositeAligned = true;
    if (o.bg) {
      const bw = timeWords(o.bg, Math.round((first.start + last.end) / 2), pace);
      const bEnd = (bw.at(-1) as LyricWord).end;
      line.background = [
        { text: joinWords(bw), start: (bw[0] as LyricWord).start, end: bEnd, words: bw },
      ];
      line.end = Math.max(last.end, bEnd);
    }
    lines.push(line);
    t = last.end;
  });
  return { lines, end: t };
}

/** Sections in order, each starting `gap` ms after the previous one's last word. */
function song(pace: Pace, start: number, parts: (Entry[] | { gap: number })[]): LyricLine[] {
  const lines: LyricLine[] = [];
  let t = start;
  let gap = 0;
  for (const p of parts) {
    if (!Array.isArray(p)) {
      gap = p.gap;
      continue;
    }
    const s = section(t + gap, pace, p);
    lines.push(...s.lines);
    t = s.end;
    gap = pace.lineGap;
  }
  return lines;
}

/** Line-timed copy: no word times anywhere. `keepEnd(i)` false drops a line's `end`. */
const lineTimed = (lines: LyricLine[], keepEnd: (i: number) => boolean = () => true) =>
  lines.map(({ words: _, background, end, ...l }, i) => ({
    ...l,
    ...(keepEnd(i) ? { end } : {}),
    ...(background ? { background: background.map(({ words: _w, ...b }) => b) } : {}),
  }));

const ms = (m: number, s: number) => (m * 60 + s) * 1000;

function doc(
  name: string,
  sync: LyricsDoc['sync'],
  durationMs: number,
  lines: LyricLine[],
  extra: Partial<LyricsDoc> = {},
): LyricsDoc {
  return {
    version: 1,
    trackKey: `fixture:${name}`,
    sync,
    source: 'fixture',
    attribution: { text: 'Fixture lyrics written for ECHO' },
    offsetMs: 0,
    durationMs,
    lines,
    fetchedAt: '2026-10-23T00:00:00.000Z',
    language: 'en',
    ...extra,
  };
}

// ── Paces ─────────────────────────────────────────────────────────────────────────────────────

const ballad: Pace = { dur: (s) => 260 + 30 * letters(s), wordGap: 60, lineGap: 700 };
const rap: Pace = { dur: (s) => Math.min(200, 78 + 12 * letters(s)), wordGap: 15, lineGap: 120 };
const pop: Pace = { dur: (s) => 180 + 25 * letters(s), wordGap: 40, lineGap: 450 };
const cjk: Pace = { dur: () => 300, wordGap: 0, lineGap: 900, perChar: true };

// ── Texts ─────────────────────────────────────────────────────────────────────────────────────

const balladChorus: Entry[] = [
  'So call me from the har~bour*3 when it’s late',
  'I’ll hear you through the sta~tic*2 and the waves',
  'ev~ery ech~o finds the shore*3 a~gain*2',
  'ev~ery ech~o finds its way*3 to you*3',
];

const rapHook: Entry[] = [
  'Sig~nal, noise, sig~nal, noise, sig~nal, noise',
  'we’re the sound be~tween the sta~tions on the dial',
  'sig~nal, noise, sig~nal, noise, sig~nal, noise',
  'turn~ing all the stat~ic in~to pa~tience for a while',
];

const popVerse: Entry[] = [
  'Neon on the wet street',
  'paper planes and bus fare',
  'every song is about you',
  'every chorus says your name',
];
const popChorus: Entry[] = [
  'Light it up, light it up',
  'paper satellites tonight',
  'we were never coming down',
  'light it up, light it up',
];

const longText: Entry[] = [
  'and if the long road home keeps fold~ing back in~to it~self like a map that was nev~er meant to close, I’ll fol~low it an~y~way',
  'past the pet~rol sta~tions and the shut~tered ci~ne~mas and the one late bak~ery that still leaves its lights on for the night shift',
  'Short line',
  'ev~ery win~dow on the av~e~nue is a small re~hears~al of the morn~ing, and I keep hum~ming the same three notes un~til they hold',
  'you can call it stub~born if you like, but some~one has to keep the porch light burn~ing for the trav~el~lers who are still on their way',
  'Home',
];

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

export const lyricFixtures: Record<string, LyricsDoc> = {
  // 3:40, lines 4–7 s, held words, a 9 s intro and a 12 s instrumental bridge.
  'ballad-word': doc(
    'ballad-word',
    'word',
    ms(3, 40),
    song(ballad, 9000, [
      [
        'I left the porch light burn~ing for the night*3',
        'a small gold win~dow in the fall~ing rain*3',
        'you said the riv~er knows the way back home*3',
        'and I be~lieved it, | I be~lieved it then*3',
      ],
      { gap: 2500 },
      balladChorus,
      { gap: 4000 },
      [
        'The kitch~en clock is run~ning slow*2 to~night',
        'it counts the hours like a pa~tient friend*3',
        'I keep your coat be~side the o~pen door*3',
        'in case the weath~er chang~es, | in case you do*3',
      ],
      { gap: 2500 },
      balladChorus,
      { gap: 12_000 },
      ['Hold*4 on, | the light is com~ing slow*3', 'a~cross*2 the wa~ter, | o~ver ev~ery~thing*2'],
      { gap: 2500 },
      balladChorus,
      { gap: 4000 },
      ['porch light burn~ing*2 | burn~ing*2 for you*3'],
    ]),
  ),

  // 2:50, words 90–200 ms, lines 0.9–1.8 s, two interjections < 350 ms before the next line.
  'rap-word': doc(
    'rap-word',
    'word',
    ms(2, 50),
    song(rap, 10_000, [
      [
        'Clock in at the sta~tion where the sig~nal gets thin',
        'got a pock~et full of stat~ic and a ci~ty wired in',
        'ev~ery street~light on the cor~ner is a met~ro~nome',
        'count~ing down the min~utes till the last train home',
        'Yo',
        ['I keep it tight, keep it mov~ing, keep it all in check', { after: 60 }],
        'ev~ery word is on the beat like a stamp on a cheque',
        'pa~per sat~el~lites are drift~ing ov~er ne~on and rain',
        'I can map the whole sky~line by the sound of the train',
        'roof~top an~ten~nas catch~ing ev~ery fre~quen~cy loose',
        'I’m a ra~di~o that nev~er learned the mean~ing of snooze',
        'turn the di~al to the left and you can hear me a~gain',
        'one more verse for the night shift and the ov~er~time men',
      ],
      { gap: 1500 },
      rapHook,
      { gap: 8000 },
      [
        'Sec~ond verse and the tem~po’s run~ning fast~er than me',
        'got a heart~beat like a hi-hat at a hun~dred and three',
        'Go',
        ['ev~ery syl~la~ble’s a foot~step on the stair~well of sound', { after: 60 }],
        'I keep climb~ing till the ech~o does~n’t come back round',
        'win~dows flick~er like a tick~er tape of ev~ery~one’s dreams',
        'noth~ing’s ev~er qui~et, it’s just qui~et~er than it seems',
        'I can rhyme it in the dark, I can rhyme it in the day',
        'I can rhyme till morn~ing when the stat~ic fades a~way',
        're~mem~ber when the sig~nal drops and noth~ing comes through',
        'there’s a voice in~side the noise and it’s talk~ing to you',
      ],
      { gap: 1500 },
      rapHook,
      { gap: 8000 },
      rapHook,
    ]),
  ),

  // Two vocalists on opposite sides, a group line, backing vocals in parentheses and as background[].
  'duet-word': doc(
    'duet-word',
    'word',
    ms(2, 0),
    song(ballad, 6000, [
      [
        ['Meet me where the tram lines cross', { agent: 'v1' }],
        ['I’ll be the one in the yel~low coat', { agent: 'v2', opposite: true }],
        ['Bring the map we nev~er used (nev~er used)', { agent: 'v1' }],
        [
          'I’ll bring the songs we did~n’t lose',
          { agent: 'v2', opposite: true, bg: 'did~n’t lose' },
        ],
        ['Har~bour lights are com~ing on', { agent: 'v1', bg: 'com~ing on' }],
        ['ev~ery win~dow, one by one', { agent: 'v2', opposite: true }],
        ['We were nev~er far a~part*3', { agent: 'v3' }],
      ],
      { gap: 4000 },
      [
        ['Wait for me be~neath the clock', { agent: 'v1' }],
        ['I’ll be run~ning (run~ning) all the way', { agent: 'v2', opposite: true }],
        ['Keep the last seat on the tram', { agent: 'v1', bg: 'last seat' }],
        ['I’ll be there be~fore the rain', { agent: 'v2', opposite: true }],
        ['We were nev~er far a~part*3', { agent: 'v3', bg: 'nev~er far' }],
      ],
    ]),
    {
      agents: [
        { id: 'v1', name: 'First voice', kind: 'person' },
        { id: 'v2', name: 'Second voice', kind: 'person' },
        { id: 'v3', kind: 'group' },
      ],
    },
  ),

  // Line-timed only; every other line has no `end`, and an empty line marks the end of a chorus.
  'pop-line': doc(
    'pop-line',
    'line',
    ms(3, 0),
    (() => {
      const lines = lineTimed(
        song(pop, 8000, [popVerse, { gap: 1200 }, popChorus, { gap: 5000 }, popVerse, popChorus]),
        (i) => i % 2 === 0,
      );
      // An LRC-style empty timestamp 1.5 s after the first chorus: the gap that follows is silence.
      const chorusEnd = (lines[7] as LyricLine).start + 1500;
      lines.splice(8, 0, { text: '', start: chorusEnd });
      return lines;
    })(),
  ),

  // Untimed: a static sheet.
  static: doc(
    'static',
    'none',
    ms(2, 30),
    [
      'The tide comes in the way it always does',
      'and leaves the harbour quieter than before',
      'the gulls are counting boats along the pier',
      'the lighthouse keeps a promise to the shore',
      'I wrote your name in salt upon the glass',
      'the morning came and wiped it clean again',
      'but every wave remembers what it carried',
      'and every echo finds its way back home',
    ].map((text) => ({ text, start: 0 })),
  ),

  // Japanese, per-character timing. Robustness only (owner: Latin script is the design target).
  'cjk-word': doc(
    'cjk-word',
    'word',
    ms(1, 30),
    song(cjk, 5000, [
      [
        '夜の窓に 雨が光る',
        '遠い港の 灯り*2',
        'あなたの声が 聞こえる',
        '波の 向こう*2 から',
        'ゆっくり*2 歩いて 行こう',
        '朝が 来るまで*2',
        'この ままで*3',
        'ここに いて*4',
      ],
    ]),
    { language: 'ja' },
  ),

  // Hebrew, line-timed, one mixed-script line. Robustness only, as above.
  'rtl-line': doc(
    'rtl-line',
    'line',
    ms(1, 30),
    lineTimed(
      song(pop, 6000, [
        [
          'האור נשאר בחלון',
          'אני שומע את הים',
          'הלילה עוד ארוך',
          'שירו לי לאט',
          'רדיו FM בלילה',
          'הגשם יורד על העיר',
          'ואני מחכה לך',
          'עד שיגיע הבוקר',
        ],
      ]),
    ),
    { language: 'he' },
  ),

  // The typographic target: diacritics, ligature-prone pairs (fi, fl, ffi, ffl), apostrophes, dashes.
  'accents-word': doc(
    'accents-word',
    'word',
    ms(2, 30),
    song(ballad, 7000, [
      [
        'The ca~fé’s flu~o~res~cent glow — I’m wait~ing',
        'se~ño~ra, the souf~flé is still warm*3',
        'we’d share smør~brød by the fjord at dawn*3',
        'down the Stra~ße of of~fice lights',
        'baf~fled, we fly — the waf~fle stall’s closed',
        'na~ïve as a first off~line night*3',
      ],
      { gap: 3000 },
      [
        'crème brû~lée skies o~ver Mal~mö*3',
        'don’t say ‘fi~nal~ly’ — say ‘ef~flo~res~cent’',
        'the pi~ña~ta’s a~float in the fjord*3',
        'Zo~ë’s cliffs, Øy~stein’s cof~fee, Đor~đe’s flute',
        'it’s “dé~jà vu”, it’s the of~fice’s af~flu~ence',
        'au re~voir, Fran~çoise — æ~ther, œu~vre, fin*3',
      ],
    ]),
  ),

  // Lines that need three rows at 1024×640.
  'long-lines': doc('long-lines', 'word', ms(1, 50), song(pop, 4000, [longText])),

  // 25 s intro, ≥ 30 s outro.
  'intro-outro': doc(
    'intro-outro',
    'word',
    ms(1, 40),
    song(ballad, 25_000, [
      [
        'The sta~tion clock was strik~ing nine',
        'the plat~form emp~ty, | still*2 and wide',
        'I count~ed lan~terns on the line*2',
        'and wait~ed for the oth~er side*3',
      ],
      { gap: 2000 },
      ['The train came in a~cross the light', 'and took the qui~et far a~way*3'],
    ]),
  ),
};
