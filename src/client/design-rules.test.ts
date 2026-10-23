import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOAST_EXIT_MS } from './ui/logic.ts';

// Automated part of DS-01 and DS-02 (ACCEPTANCE_CRITERIA.md §7) over the client's component code.
// Out of scope by design: tokens.css (the token source), fonts.css, the type specimen (a dev page
// reviewed in M1), and lyricsConfig.ts (M3, allowed by DS-01).

const ROOT = 'src/client';
const SKIP = [/^tokens\.css$/, /^fonts\.css$/, /^fonts\//, /^specimen\//, /\.test\.ts$/, /\.svg$/];
const files = readdirSync(ROOT, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(css|tsx?)$/.test(f) && !SKIP.some((re) => re.test(f)))
  .map((f) => ({ name: f, text: readFileSync(join(ROOT, f), 'utf8') }));

const uncomment = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// DS-01: raw colour, size, duration or easing values.
const RAW = [
  { what: 'hex colour', re: /#[0-9a-fA-F]{3,8}\b/ },
  { what: 'px size', re: /\b\d*\.?\d+px\b/ },
  { what: 'ms/s duration', re: /\b\d*\.?\d+m?s\b(?![\w-])/, css: true },
  { what: 'easing', re: /cubic-bezier\(/ },
  { what: 'colour function', re: /\b(rgba?|hsla?|oklch|oklab)\(/ },
];

// Each allowed raw value needs a technical reason.
const ALLOW = [
  { re: /^\s*@media\b/, reason: 'media queries cannot read custom properties (breakpoints, §5)' },
];

describe('DS-01: no raw design values outside tokens.css', () => {
  it('scans the component code', () => {
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(['main.css', 'ui/ui.css']));
  });

  for (const f of files) {
    it(f.name, () => {
      const found: string[] = [];
      uncomment(f.text)
        .split('\n')
        .forEach((line, i) => {
          if (ALLOW.some((a) => a.re.test(line))) return;
          for (const r of RAW) {
            if (r.css && !f.name.endsWith('.css')) continue;
            if (r.re.test(line)) found.push(`${f.name}:${i + 1} ${r.what}: ${line.trim()}`);
          }
        });
      expect(found).toEqual([]);
    });
  }

  it('JS durations that mirror a token stay equal to it', () => {
    const tokens = readFileSync(join(ROOT, 'tokens.css'), 'utf8');
    expect(tokens).toContain(`--dur-toast: ${TOAST_EXIT_MS}ms`);
  });
});

// DS-02 (inspection part): the shell has no gradients, glows, blur, monospace or tracked capitals,
// and the only shadow is --shadow-float, on floating surfaces.
describe('DS-02: shell light effects', () => {
  const css = files.filter((f) => f.name.endsWith('.css'));
  const BANNED = [
    /gradient\(/,
    /backdrop-filter/,
    /text-shadow/,
    /\bblur\(/,
    /monospace/,
    /text-transform/,
    /letter-spacing/,
  ];
  for (const f of css) {
    it(f.name, () => {
      const text = uncomment(f.text);
      for (const re of BANNED) expect(text, String(re)).not.toMatch(re);
      const shadows = [...text.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]?.trim());
      for (const s of shadows) expect(s).toBe('var(--shadow-float)');
    });
  }
});
