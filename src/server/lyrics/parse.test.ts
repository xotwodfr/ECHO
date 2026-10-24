import { describe, expect, it } from 'vitest';
import {
  LyricsInvalid,
  type OsStructured,
  parseLrc,
  parseOpenSubsonic,
  parsePlain,
  parseSpicy,
  parseYrc,
  repair,
  type SpicyBody,
} from './parse.ts';

// LI-01: every parser yields a valid document; invalid input is repaired or rejected (§5).
// Samples follow the shapes in the live docs (OpenSubsonic songLyrics v1/v2, Spicy Lyrics API).

describe('LRC', () => {
  it('line-timed, with repeated tags, metadata and an offset', () => {
    const p = parseLrc(
      '﻿[ar:Muse]\n[la:en]\n[offset:+100]\n[00:01.50]First line\n[00:04.00][00:20.00]Chorus\n[00:08.25] Second  line \n',
    );
    expect(p.sync).toBe('line');
    expect(p.language).toBe('en');
    expect(p.lines.map((l) => [l.start, l.text])).toEqual([
      [1400, 'First line'],
      [3900, 'Chorus'],
      [8150, 'Second line'],
      [19900, 'Chorus'],
    ]);
    expect(p.offsetMs).toBe(0); // applied to the times
  });

  it('enhanced LRC: word timing, syllables, the closing tag', () => {
    const p = parseLrc(
      '[00:10.00]<00:10.00>Hel<00:10.40>lo <00:11.00>world <00:12.00>\n[00:13.00]<00:13.00>Next <00:14.00>',
    );
    expect(p.sync).toBe('word');
    const [a] = p.lines;
    expect(a?.text).toBe('Hello world');
    expect(a?.words).toEqual([
      { text: 'Hel', start: 10000, end: 10400, isPartOfWord: true },
      { text: 'lo', start: 10400, end: 11000, isPartOfWord: false },
      { text: 'world', start: 11000, end: 12000, isPartOfWord: false },
    ]);
  });

  it('no timestamps: static text', () => {
    const p = parseLrc('Just words\nand more');
    expect(p).toMatchObject({
      sync: 'none',
      lines: [
        { text: 'Just words', start: 0 },
        { text: 'and more', start: 0 },
      ],
    });
  });
});

describe('OpenSubsonic structured lyrics', () => {
  const v1: OsStructured = {
    lang: 'eng',
    offset: -100,
    synced: true,
    line: [
      { start: 0, value: "It's bugging me" },
      { start: 2000, value: 'Grating me' },
    ],
  };

  it('v1 lines (offset applied: −100 means later)', () => {
    const p = parseOpenSubsonic([v1]);
    expect(p).toMatchObject({ sync: 'line', language: 'eng' });
    expect(p.lines.map((l) => l.start)).toEqual([100, 2100]);
  });

  it('v2 cueLine: words from cues, whitespace cues and byte gaps break words', () => {
    const p = parseOpenSubsonic([
      { kind: 'translation', synced: true, line: [{ start: 0, value: 'x' }] },
      {
        kind: 'main',
        lang: 'ko',
        synced: true,
        line: [{ start: 2747, value: '눈을 뜬 순간' }],
        cueLine: [
          {
            index: 0,
            start: 2747,
            end: 6214,
            value: '눈을 뜬 순간',
            cue: [
              { start: 2747, end: 3018, value: '눈', byteStart: 0, byteEnd: 2 },
              { start: 3018, end: 3179, value: '을', byteStart: 3, byteEnd: 5 },
              { start: 3179, end: 3582, value: ' ', byteStart: 6, byteEnd: 6 },
              { start: 3582, end: 4100, value: '뜬', byteStart: 7, byteEnd: 9 },
              { start: 4100, end: 4500, value: ' ', byteStart: 10, byteEnd: 10 },
              { start: 4500, end: 5200, value: '순', byteStart: 11, byteEnd: 13 },
              { start: 5200, end: 6214, value: '간', byteStart: 14, byteEnd: 16 },
            ],
          },
        ],
      },
    ]);
    expect(p.sync).toBe('word');
    expect(p.lines[0]?.words?.map((w) => [w.text, w.isPartOfWord])).toEqual([
      ['눈', true],
      ['을', false],
      ['뜬', false],
      ['순', true],
      ['간', false],
    ]);
  });

  it('v2 agents: background vocals and a second voice', () => {
    const p = parseOpenSubsonic([
      {
        kind: 'main',
        synced: true,
        line: [{ start: 1000, value: 'You and I (ooh)' }],
        agents: [
          { id: 'lead', role: 'main', name: 'A' },
          { id: 'bv', role: 'bg' },
        ],
        cueLine: [
          {
            index: 0,
            start: 1000,
            end: 4000,
            value: 'You and I',
            agentId: 'lead',
            cue: [
              { start: 1000, end: 1800, value: 'You ', byteStart: 0, byteEnd: 3 },
              { start: 1800, end: 2400, value: 'and ', byteStart: 4, byteEnd: 7 },
              { start: 2400, end: 3200, value: 'I', byteStart: 8, byteEnd: 8 },
            ],
          },
          {
            index: 0,
            start: 3200,
            end: 3800,
            value: 'ooh',
            agentId: 'bv',
            cue: [{ start: 3200, end: 3800, value: 'ooh', byteStart: 0, byteEnd: 2 }],
          },
        ],
      },
    ]);
    const l = p.lines[0];
    expect(l?.text).toBe('You and I');
    expect(l?.words?.map((w) => w.text)).toEqual(['You', 'and', 'I']);
    expect(l?.background?.[0]?.text).toBe('ooh');
    expect(p.agents).toEqual([
      { id: 'lead', name: 'A', kind: 'person' },
      { id: 'bv', name: undefined, kind: 'person' },
    ]);
  });

  it('unsynced entries are static; no lines is invalid', () => {
    expect(parseOpenSubsonic([{ synced: false, line: [{ value: 'a' }] }]).sync).toBe('none');
    expect(() => parseOpenSubsonic([])).toThrow(LyricsInvalid);
  });
});

describe('Spicy Lyrics', () => {
  const syllable: SpicyBody = {
    Type: 'Syllable',
    source: 'spicy_lyrics',
    StartTime: 7.357,
    EndTime: 234.731,
    Content: [
      {
        Type: 'Vocal',
        OppositeAligned: true,
        Lead: {
          StartTime: 7.357,
          EndTime: 9.1,
          Syllables: [
            { Text: 'Hel', StartTime: 7.357, EndTime: 7.6, IsPartOfWord: true },
            { Text: 'lo', StartTime: 7.6, EndTime: 8.0, IsPartOfWord: false },
            { Text: 'there', StartTime: 8.0, EndTime: 9.1, IsPartOfWord: false },
          ],
        },
        Background: [
          {
            StartTime: 8.5,
            EndTime: 9.0,
            Syllables: [{ Text: 'oh', StartTime: 8.5, EndTime: 9.0 }],
          },
        ],
      },
    ],
  };

  it('Syllable: seconds to ms, syllables joined, background and duet side kept', () => {
    const p = parseSpicy(syllable);
    expect(p).toMatchObject({ sync: 'word', durationMs: 234731 });
    expect(p.lines[0]).toMatchObject({
      text: 'Hello there',
      start: 7357,
      end: 9100,
      oppositeAligned: true,
    });
    expect(p.lines[0]?.words?.[0]).toEqual({
      text: 'Hel',
      start: 7357,
      end: 7600,
      isPartOfWord: true,
    });
    expect(p.lines[0]?.background?.[0]).toMatchObject({ text: 'oh', start: 8500, end: 9000 });
  });

  it('Line and Static', () => {
    const line = parseSpicy({
      Type: 'Line',
      source: 'spotify',
      Content: [{ Type: 'Vocal', Text: 'A line (bg)', StartTime: 10.81, EndTime: 12 }],
    });
    expect(line).toMatchObject({
      sync: 'line',
      lines: [{ text: 'A line (bg)', start: 10810, end: 12000 }],
    });
    expect(parseSpicy({ Type: 'Static', Lines: [{ Text: 'one' }, { Text: 'two' }] })).toMatchObject(
      {
        sync: 'none',
        lines: [{ text: 'one' }, { text: 'two' }],
      },
    );
    expect(() => parseSpicy({ Type: 'Syllable', Content: [] })).toThrow(LyricsInvalid);
  });
});

describe('validation and repair (§5)', () => {
  it('integer, non-negative times; ordered words without overlaps; ends from words', () => {
    const p = repair({
      sync: 'word',
      offsetMs: 0,
      lines: [
        {
          text: ' a  b ',
          start: -20.4,
          words: [
            { text: 'b', start: 300.6, end: 200, isPartOfWord: false },
            { text: 'a', start: -5, end: 450, isPartOfWord: false },
          ],
        },
      ],
    });
    const l = p.lines[0];
    expect(l?.start).toBe(0);
    expect(l?.text).toBe('a b');
    expect(l?.words).toEqual([
      { text: 'a', start: 0, end: 301, isPartOfWord: false },
      { text: 'b', start: 301, end: 361, isPartOfWord: false },
    ]);
    expect(l?.end).toBe(361);
  });

  it('timing that does not hold up becomes static text', () => {
    const shuffled = repair({
      sync: 'line',
      offsetMs: 0,
      lines: [5000, 1000, 9000, 2000].map((start, i) => ({ text: `l${i}`, start })),
    });
    expect(shuffled.sync).toBe('none');
    const past = repair(
      { sync: 'line', offsetMs: 0, lines: [{ text: 'late', start: 400_000 }] },
      200_000,
    );
    expect(past.sync).toBe('none');
  });

  it('untimed empty lines are dropped; a document with no text is rejected', () => {
    expect(repair(parsePlain('a\n\n \nb')).lines.map((l) => l.text)).toEqual(['a', 'b']);
    expect(() => repair({ sync: 'line', offsetMs: 0, lines: [{ text: ' ', start: 0 }] })).toThrow(
      LyricsInvalid,
    );
  });
});

describe('NetEase YRC', () => {
  it('word-timed lines; syllables join, punctuation sticks; JSON and credit lines dropped', () => {
    const p = parseYrc(
      [
        '{"t":0,"c":[{"tx":"作词: "},{"tx":"Someone"}]}',
        '[100,900](100,300,0)作词 : (400,600,0)Someone',
        "[27360,1290](27360,240,0)I've (27600,90,0)been (27690,360,0)try(28050,600,0)na",
        '[34620,1050](34620,120,0)to (34740,900,0)love(35640,30,0), ',
      ].join('\n'),
    );
    expect(p.sync).toBe('word');
    expect(p.lines.map((l) => l.text)).toEqual(["I've been tryna", 'to love,']);
    expect(p.lines[0]).toMatchObject({ start: 27360, end: 28650 });
    expect(p.lines[0]?.words?.map((w) => [w.text, w.start, w.end, w.isPartOfWord])).toEqual([
      ["I've", 27360, 27600, false],
      ['been', 27600, 27690, false],
      ['try', 27690, 28050, true],
      ['na', 28050, 28650, false],
    ]);
    expect(p.lines[1]?.words?.[1]).toMatchObject({ text: 'love', isPartOfWord: true });
  });

  it('nothing timed is invalid', () => {
    expect(() => parseYrc('{"t":0,"c":[]}')).toThrow(LyricsInvalid);
  });
});
