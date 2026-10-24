import { linearSrgbToOklab, oklchToOklab, parseColor, type Vec3 } from '../../shared/oklab.ts';

// Palette transitions between tracks (VISUALIZER_SPEC.md §6.4): every role interpolates in OKLab
// (Cartesian, so no hue wrap and no random hues near zero chroma) over 1200 ms with --ease-in-out.
// A new target mid-transition starts from the colour on screen, so colour is always continuous.
// Pure: `live.ts` drives it from the player and writes the CSS variables.

export const ROLES = ['room', 'accent', 'highlight', 'glow', 'shadow', 'inkActive'] as const;
export type Role = (typeof ROLES)[number];
export type Roles = Record<Role, string>;
/** The CSS custom property each role is published as (DESIGN_SYSTEM.md §3.3). */
export const VARS: Record<Role, string> = {
  room: '--art-room',
  accent: '--art-accent',
  highlight: '--art-highlight',
  glow: '--art-glow',
  shadow: '--art-shadow',
  inkActive: '--lyric-ink-active',
};

export const DUR_PALETTE_MS = 1200;

type Lab = [number, number, number, number]; // OKLab + alpha

/** --ease-in-out, cubic-bezier(.65,0,.35,1): the standard ease-in-out cubic. */
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** Any colour `parseColor` reads; OKLCH is converted exactly, everything else via linear sRGB. */
function labOf(css: string): Lab {
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(
    css.trim(),
  );
  if (ok) {
    const [L, a, b] = oklchToOklab(Number(ok[1]), Number(ok[2]), Number(ok[3]));
    return [L, a, b, ok[4] === undefined ? 1 : Number(ok[4])];
  }
  const { rgb, alpha } = parseColor(css);
  return [...linearSrgbToOklab(rgb as Vec3), alpha];
}

function cssOf([L, a, b, alpha]: Lab) {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  const lch = `${L.toFixed(4)} ${Math.hypot(a, b).toFixed(4)} ${(h < 0 ? h + 360 : h).toFixed(2)}`;
  return alpha < 1 ? `oklch(${lch} / ${alpha.toFixed(3)})` : `oklch(${lch})`;
}

export function createPaletteAnimator(initial: Roles) {
  const parse = (r: Roles) =>
    Object.fromEntries(ROLES.map((k) => [k, labOf(r[k])])) as Record<Role, Lab>;
  let now = parse(initial);
  let from = now;
  let to = now;
  let t = 1; // progress, 0..1

  return {
    /** Starts a transition to `target` from whatever is on screen now. */
    retarget(target: Roles) {
      from = now;
      to = parse(target);
      t = 0;
    },
    /** Advances by `dtMs`; true while the colours changed this step. */
    step(dtMs: number) {
      if (t >= 1) return false;
      t += dtMs / DUR_PALETTE_MS;
      if (t > 1 - 1e-9) t = 1; // 72 frames of 1000/60 ms sum to just under 1200
      const k = easeInOut(t);
      now = Object.fromEntries(
        ROLES.map((r) => [r, from[r].map((v, i) => v + ((to[r][i] as number) - v) * k)]),
      ) as Record<Role, Lab>;
      return true;
    },
    /** Jumps to `target` with no transition (deterministic frames). */
    set(target: Roles) {
      now = from = to = parse(target);
      t = 1;
    },
    get animating() {
      return t < 1;
    },
    /** The roles on screen, as CSS colours. */
    css(): Roles {
      return Object.fromEntries(ROLES.map((r) => [r, cssOf(now[r])])) as Roles;
    },
    /** The roles on screen in OKLab (tests: ΔE between frames). */
    lab(): Record<Role, Lab> {
      return now;
    },
  };
}

export type PaletteAnimator = ReturnType<typeof createPaletteAnimator>;
