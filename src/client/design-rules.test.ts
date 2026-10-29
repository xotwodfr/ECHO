import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUR_PALETTE_MS } from './palette/animator.ts';
import { CHROME_IN_MS, CHROME_OUT_MS } from './stage/loop.ts';
import { TOAST_EXIT_MS } from './ui/logic.ts';

// Automated part of DS-01 and DS-02 (ACCEPTANCE_CRITERIA.md §7) over the client's component code.
// Out of scope by design: tokens.css (the token source), fonts.css and lyricsConfig.ts (M3, allowed by DS-01).

const ROOT = 'src/client';
const SKIP = [/^tokens\.css$/, /^fonts\.css$/, /^fonts\//, /\.test\.ts$/, /\.svg$/];
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
  { re: /^\s*@container\b/, reason: 'container queries cannot read custom properties either (§5)' },
  {
    re: /'\((max|min)-width: [\d.]+px\)'/,
    reason: "matchMedia takes CSS's breakpoint as a string (§5)",
  },
  {
    re: /`oklch\(\$\{lch\}/,
    reason: 'the palette animator serialises computed colours, not design values (§3.3)',
  },
];

describe('DS-01: no raw design values outside tokens.css', () => {
  it('scans the component code', () => {
    expect(files.map((f) => f.name)).toEqual(
      expect.arrayContaining(['main.css', 'ui/ui.css', 'stage/stage.css', 'stage/shaders.ts']),
    );
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
    expect(tokens).toContain(`--dur-pop: ${CHROME_IN_MS}ms`);
    expect(tokens).toContain(`--dur-art: ${CHROME_OUT_MS}ms`);
    expect(tokens).toContain(`--dur-palette: ${DUR_PALETTE_MS}ms`);
  });
});

// DS-01 for liquid glass (DESIGN_SYSTEM.md §7.11): every glass and scrim value the code reads is a
// token, each is documented, and the fallback frost keeps §6's blur cap.
describe('DS-01: liquid glass tokens', () => {
  const defined = new Map(
    [
      ...readFileSync(join(ROOT, 'tokens.css'), 'utf8').matchAll(
        /(--(?:glass|scrim)-[a-z-]+):\s*([^;]+);/g,
      ),
    ].map((m) => [String(m[1]), String(m[2]).trim()]),
  );
  const doc = readFileSync('docs/DESIGN_SYSTEM.md', 'utf8');
  const section = (from: string, to: string) => doc.slice(doc.indexOf(from), doc.indexOf(to));

  it('every one the code reads is defined in tokens.css', () => {
    const used = new Set<string>();
    for (const f of files) {
      for (const m of f.text.matchAll(/var\((--(?:glass|scrim)-[a-z-]+)/g)) used.add(String(m[1]));
      for (const m of f.text.matchAll(/'(--scrim-[a-z]+)'/g)) used.add(String(m[1]));
    }
    // ui/glass.ts reads the SVG filter's and the Stage's parameters by name.
    const glassTs = files.find((f) => f.name === 'ui/glass.ts')?.text ?? '';
    for (const m of glassTs.matchAll(/\bv\('([a-z]+)'\)/g)) used.add(`--glass-${m[1]}`);
    used.delete('--glass-filter'); // set per element by ui/glass.ts, not a token
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((t) => !defined.has(t))).toEqual([]);
  });

  it('every one is documented (glass in §7.11, scrims in §7)', () => {
    const glass = section('### 7.11 Liquid glass', '## 8.');
    const light = section('## 7. Light', '## 8.');
    const missing = [...defined.keys()].filter(
      (t) => !(t.startsWith('--glass-') ? glass : light).includes(`\`${t}\``),
    );
    expect(missing).toEqual([]);
  });

  it('the fallback frost stays within the 8 px blur cap (§6)', () => {
    expect(Number.parseFloat(defined.get('--glass-blur') ?? '')).toBeLessThanOrEqual(8);
  });
});

// DS-02 (inspection part), after the Spotify redesign (DESIGN_SYSTEM.md §1): no glows or
// monospace; shadows only from the elevation, shadow and ring tokens; letter-spacing only from the
// tracking tokens. Gradients are Spotify's own (page headers, Liked Songs) and allowed, built from
// tokens like everything else (DS-01).
describe('DS-02: shell light effects', () => {
  // The lyrics view (stage/) defines its own light (§7); DS-01 still applies to it.
  const css = files.filter((f) => f.name.endsWith('.css') && !f.name.startsWith('stage/'));
  const BANNED = [/text-shadow/, /monospace/];
  for (const f of css) {
    it(f.name, () => {
      const text = uncomment(f.text);
      for (const re of BANNED) expect(text, String(re)).not.toMatch(re);
      const shadows = [...text.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]?.trim());
      for (const s of shadows)
        expect(s).toMatch(
          /^var\(--(md-sys-elevation-level[1-3]|shadow-[a-z]+|card-shadow|ring-[a-z]+)\)$/,
        );
      const tracking = [...text.matchAll(/letter-spacing:\s*([^;]+);/g)].map((m) => m[1]?.trim());
      for (const t of tracking)
        expect(t).toMatch(/^(var\(--(md-sys-tracking|tracking)-[a-z-]+\)|normal)$/);
    });
  }

  // Characters that render as emoji: emoji presentation by default, or forced by VS16. Text symbols
  // such as ↔ are not emoji.
  it('no emoji in component code or copy', () => {
    for (const f of files)
      expect(uncomment(f.text), f.name).not.toMatch(/\p{Emoji_Presentation}|\uFE0F/u);
  });
});
