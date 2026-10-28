import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  RawShaderMaterial,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import blueNoiseUrl from './blue-noise-64.png';
import { BASE_EXPOSURE, type PaletteUniforms } from './palette.ts';
import { type ReverbFrame, ringLight, safeTint } from './reverb.ts';
import { COMPOSITE_FRAG, ENERGY_FRAG, FULLSCREEN_VERT, PROBE_FRAG, ROOM_FRAG } from './shaders.ts';

// StageRenderer (VISUALIZER_SPEC.md §5): room pass into a reduced-resolution float target, then
// the composite to the canvas. three.js is used only for its context, render-target and
// context-loss plumbing; there is no scene graph beyond one full-screen triangle.

export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

/** §8.1: backing-store DPR cap and room-pass resolution per tier. */
export const TIERS: Record<Tier, { dprCap: number; roomScale: number }> = {
  T0: { dprCap: 1.5, roomScale: 1 / 2 },
  T1: { dprCap: 1.25, roomScale: 1 / 2 },
  T2: { dprCap: 1.0, roomScale: 1 / 3 },
  T3: { dprCap: 1.0, roomScale: 1 / 3 },
};

/** Render targets are rebuilt only when the size changes by more than this (§5.5). */
const RESIZE_TOLERANCE = 0.02;

/**
 * The room's base cover (owner, 2026-10-28), blurred once on a 96 px canvas instead of every frame:
 * stretched over the stage by linear filtering it stays smooth, and costs one texture fetch.
 */
const COVER_PX = 96;
const COVER_BLUR = 5; // canvas px: ≈ 75 CSS px across a 1440 px stage

function coverTexture(img: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = c.height = COVER_PX;
  const ctx = c.getContext('2d');
  if (ctx) {
    // Scaled to cover the square plus an overscan, so the blur never pulls in a transparent edge.
    // No source rect: Chrome crops one wrongly from an SVG that has only a viewBox.
    const w = img.naturalWidth || COVER_PX;
    const h = img.naturalHeight || COVER_PX;
    const k = (COVER_PX + 4 * COVER_BLUR) / Math.min(w, h);
    ctx.filter = `blur(${COVER_BLUR}px) saturate(1.4)`;
    ctx.drawImage(img, (COVER_PX - w * k) / 2, (COVER_PX - h * k) / 2, w * k, h * k);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; // sampled as linear light, like the room
  t.minFilter = t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export interface FrameInput {
  flow: number;
  drift: number;
  /** The base cover's crossfade from the previous one, 0…1. */
  cover: number;
  /** Key light centre in stage uv (y down). The lyric layer publishes it from M3. */
  key: [number, number];
  chrome: number;
  seed: number;
}

export class StageRenderer {
  readonly gl: WebGLRenderer;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly roomScene = new Scene();
  private readonly compositeScene = new Scene();
  private readonly room = {
    uAspect: { value: 1 },
    uFlow: { value: 0 },
    uDrift: { value: 0 },
    uSeed: { value: 0 },
    uCover: { value: null as Texture | null },
    uCoverPrev: { value: null as Texture | null },
    uCoverOn: { value: new Vector2() },
    uCoverFade: { value: 1 },
    uBrightness: { value: 1 },
    uRoom: { value: new Vector3() },
    uAccent: { value: new Vector3() },
    uHighlight: { value: new Vector3() },
    uGlow: { value: new Vector3() },
    uKey: { value: new Vector2(0.5, 0.4) },
    uPoolScale: { value: 1 },
    uKeyScale: { value: 1 },
  };
  private readonly energy = {
    uPrev: { value: null as Texture | null },
    uAspect: { value: 1 },
    uDecay: { value: 0.93 },
    uWarp: { value: 0.002 },
    uFlow: { value: 0 },
    uKey: { value: new Vector2(0.5, 0.4) },
    uRings: { value: [new Vector4(), new Vector4(), new Vector4()] },
    uTint: { value: new Vector3() },
    uFlare: { value: 0 },
  };
  private readonly composite = {
    uRoomTex: { value: null as Texture | null },
    uNoise: { value: null as Texture | null },
    uRes: { value: new Vector2() },
    uDpr: { value: 1 },
    uShadow: { value: new Vector3() },
    uChrome: { value: 1 },
    uExposure: { value: BASE_EXPOSURE },
    uZoneExposure: { value: 0 },
    uZoneScrim: { value: 0 },
    uEnergyTex: { value: null as Texture | null },
    uEnergyOn: { value: 0 },
    uKeyUv: { value: new Vector2(0.5, 0.6) },
  };
  private readonly energyMat: RawShaderMaterial;
  private readonly energyScene = new Scene();
  private energyRT: [WebGLRenderTarget, WebGLRenderTarget] | null = null;
  private reverb: ReverbFrame | null = null;
  private lumaRT: WebGLRenderTarget | null = null;
  private readonly roomMat: RawShaderMaterial;
  private readonly compositeMat: RawShaderMaterial;
  private readonly probeMat: RawShaderMaterial;
  private readonly probeScene = new Scene();
  private readonly probeRT = new WebGLRenderTarget(8, 8, {
    type: UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: false,
  });
  private readonly probePixels = new Uint8Array(8 * 8 * 4);
  private readonly geometry = new BufferGeometry();
  private roomRT: WebGLRenderTarget | null = null;
  private noise: Texture | null = null;
  private covers: [Texture | null, Texture | null] = [null, null]; // previous, current
  private tier: Tier;
  private backing = { w: 0, h: 0, dpr: 1 };

  constructor(canvas: HTMLCanvasElement, tier: Tier) {
    // three.js r163+ is WebGL 2 only; it throws when the context can't be created (§9 fallback).
    this.gl = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.gl.outputColorSpace = LinearSRGBColorSpace; // the composite tone-maps and encodes itself
    this.gl.toneMapping = NoToneMapping;
    this.gl.autoClear = false;
    this.tier = tier;

    this.geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    const common = {
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      depthTest: false,
      depthWrite: false,
    };
    this.roomMat = new RawShaderMaterial({
      ...common,
      fragmentShader: ROOM_FRAG,
      uniforms: this.room,
    });
    this.compositeMat = new RawShaderMaterial({
      ...common,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: this.composite,
    });
    // The probe shares the composite's uniforms, so it sees exactly what is drawn.
    this.probeMat = new RawShaderMaterial({
      ...common,
      fragmentShader: PROBE_FRAG,
      uniforms: this.composite,
    });
    this.energyMat = new RawShaderMaterial({
      ...common,
      fragmentShader: ENERGY_FRAG,
      uniforms: this.energy,
    });
    this.energyScene.add(new Mesh(this.geometry, this.energyMat));
    this.roomScene.add(new Mesh(this.geometry, this.roomMat));
    this.compositeScene.add(new Mesh(this.geometry, this.compositeMat));
    this.probeScene.add(new Mesh(this.geometry, this.probeMat));
  }

  /** Loads the blue-noise texture; the first frame waits for it (dither is always on). */
  async init() {
    const tex = await new TextureLoader().loadAsync(blueNoiseUrl);
    tex.colorSpace = NoColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.magFilter = tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    this.noise = tex;
    this.composite.uNoise.value = tex;
  }

  /** The GPU's name where the browser tells it (WEBGL_debug_renderer_info), for the first tier. */
  gpuName(): string | null {
    const gl = this.gl.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  }

  setTier(tier: Tier) {
    this.tier = tier;
    this.backing.w = 0; // force a rebuild at the next setSize
  }

  setPalette(p: PaletteUniforms) {
    this.energy.uTint.value.set(...safeTint(p.highlight));
    const u = this.room;
    u.uRoom.value.set(...p.room);
    u.uAccent.value.set(...p.accent);
    u.uHighlight.value.set(...p.highlight);
    u.uGlow.value.set(...p.glow);
    this.composite.uShadow.value.set(...p.shadow);
  }

  /** The track's cover as the room's base, or null for --art-room; it crossfades from the last. */
  setCover(img: HTMLImageElement | null) {
    this.covers[0]?.dispose();
    this.covers = [this.covers[1], img ? coverTexture(img) : null];
    const [prev, cur] = this.covers;
    const u = this.room;
    u.uCoverPrev.value = prev;
    u.uCover.value = cur;
    u.uCoverOn.value.set(prev ? 1 : 0, cur ? 1 : 0);
  }

  /** The cover's brightness, 0…1 as the slider shows it; perceptual, so squared-ish into light. */
  setBrightness(b: number) {
    this.room.uBrightness.value = Math.max(0, b) ** 2.2;
  }

  /**
   * Reverb mode's state for the next frames (VISUALIZER_SPEC.md §4.3–§4.5), or null for Ambient
   * and Still: the energy buffer is cleared and unused.
   */
  setReverb(r: ReverbFrame | null) {
    if (!r && this.reverb) this.clearEnergy();
    this.reverb = r;
  }

  /** The contrast solver's darkening of the lyric zone (DESIGN_SYSTEM.md §3.4 rule 6). */
  setZone(exposure: number, scrim: number) {
    this.composite.uZoneExposure.value = exposure;
    this.composite.uZoneScrim.value = scrim;
  }

  /**
   * The safe zone as the last frame drew it, 8×8 sRGB pixels (VISUALIZER_SPEC.md §5.4). A small
   * synchronous read (64 pixels), every 250 ms at most.
   */
  probe(): Uint8Array | null {
    if (!this.roomRT || !this.noise) return null;
    this.gl.setRenderTarget(this.probeRT);
    this.gl.render(this.probeScene, this.camera);
    this.gl.readRenderTargetPixels(this.probeRT, 0, 0, 8, 8, this.probePixels);
    this.gl.setRenderTarget(null);
    return this.probePixels;
  }

  /**
   * Development: the mean relative luminance of a 4×4 grid over the stage as last drawn
   * (A11Y-08). The composite is re-rendered into a 64-px-wide target with its resolution uniforms
   * scaled, so vignette and scrims fall where they do on screen.
   */
  lumaGrid(): Float32Array | null {
    if (!this.roomRT || !this.noise) return null;
    const w = 64;
    const h = Math.max(4, Math.round((64 * this.backing.h) / Math.max(1, this.backing.w)));
    if (!this.lumaRT || this.lumaRT.height !== h) {
      this.lumaRT?.dispose();
      this.lumaRT = new WebGLRenderTarget(w, h, { type: UnsignedByteType, depthBuffer: false });
    }
    const c = this.composite;
    const [res, dpr] = [c.uRes.value.clone(), c.uDpr.value];
    c.uRes.value.set(w, h);
    c.uDpr.value = (dpr * w) / this.backing.w;
    this.gl.setRenderTarget(this.lumaRT);
    this.gl.render(this.compositeScene, this.camera);
    const px = new Uint8Array(w * h * 4);
    this.gl.readRenderTargetPixels(this.lumaRT, 0, 0, w, h, px);
    this.gl.setRenderTarget(null);
    c.uRes.value.copy(res);
    c.uDpr.value = dpr;
    const lin = (v: number) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const grid = new Float32Array(16);
    const count = new Float32Array(16);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const cell =
          Math.min(3, Math.floor((y / h) * 4)) * 4 + Math.min(3, Math.floor((x / w) * 4));
        grid[cell] =
          (grid[cell] as number) +
          0.2126 * lin(px[i] as number) +
          0.7152 * lin(px[i + 1] as number) +
          0.0722 * lin(px[i + 2] as number);
        count[cell] = (count[cell] as number) + 1;
      }
    for (let k = 0; k < 16; k++) grid[k] = (grid[k] as number) / (count[k] as number);
    return grid;
  }

  /** CSS size and devicePixelRatio; the backing store is capped per tier (§5.5). */
  setSize(cssW: number, cssH: number, devicePixelRatio: number) {
    const dpr = Math.min(devicePixelRatio, TIERS[this.tier].dprCap);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    const changed =
      !this.roomRT ||
      Math.abs(w - this.backing.w) > this.backing.w * RESIZE_TOLERANCE ||
      Math.abs(h - this.backing.h) > this.backing.h * RESIZE_TOLERANCE;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(cssW, cssH, false);
    this.backing = { w, h, dpr };
    this.composite.uRes.value.set(w, h);
    this.composite.uDpr.value = dpr;
    this.room.uAspect.value = cssW / Math.max(1, cssH);
    if (changed) this.buildTargets();
  }

  /** The current backing store, for tests and diagnostics. */
  get size() {
    return { ...this.backing, room: this.roomRT ? [this.roomRT.width, this.roomRT.height] : null };
  }

  render(f: FrameInput) {
    if (!this.roomRT || !this.noise) return;
    const r = this.room;
    r.uFlow.value = f.flow;
    r.uDrift.value = f.drift;
    r.uSeed.value = f.seed;
    r.uCoverFade.value = f.cover;
    r.uKey.value.set(f.key[0], f.key[1]);
    this.composite.uChrome.value = f.chrome;
    const rv = this.reverb;
    r.uPoolScale.value = rv?.poolScale ?? 1;
    r.uKeyScale.value = rv?.keyScale ?? 1;
    this.composite.uExposure.value = BASE_EXPOSURE * (rv?.exposure ?? 1);
    this.gl.setRenderTarget(this.roomRT);
    this.gl.render(this.roomScene, this.camera);
    if (rv && this.energyRT) {
      const [prev, next] = this.energyRT;
      const e = this.energy;
      e.uPrev.value = prev.texture;
      e.uAspect.value = r.uAspect.value;
      e.uDecay.value = rv.decay;
      e.uWarp.value = rv.warp;
      e.uFlow.value = rv.flow;
      e.uKey.value.set(f.key[0], f.key[1]);
      e.uFlare.value = rv.flare;
      for (let i = 0; i < 3; i++) {
        const ring = rv.rings[i];
        (e.uRings.value[i] as Vector4).set(
          ring?.x ?? 0,
          ring?.y ?? 0,
          ring ? rv.ringRadius(ring) : 0,
          ring ? ringLight(ring) : 0,
        );
      }
      this.gl.setRenderTarget(next);
      this.gl.render(this.energyScene, this.camera);
      this.energyRT = [next, prev];
      this.composite.uEnergyTex.value = next.texture;
      this.composite.uEnergyOn.value = 1;
      this.composite.uKeyUv.value.set(f.key[0], 1 - f.key[1]);
    } else this.composite.uEnergyOn.value = 0;
    this.gl.setRenderTarget(null);
    this.gl.render(this.compositeScene, this.camera);
  }

  /** After a context restore: rebuild targets and recompile materials (§5.6). */
  rebuild() {
    this.buildTargets();
    this.roomMat.needsUpdate = true;
    this.compositeMat.needsUpdate = true;
    this.probeMat.needsUpdate = true;
    this.energyMat.needsUpdate = true;
    if (this.noise) this.noise.needsUpdate = true;
    for (const t of this.covers) if (t) t.needsUpdate = true;
  }

  dispose() {
    this.roomRT?.dispose();
    this.noise?.dispose();
    for (const t of this.covers) t?.dispose();
    this.roomMat.dispose();
    this.compositeMat.dispose();
    this.probeMat.dispose();
    this.energyMat.dispose();
    this.lumaRT?.dispose();
    for (const t of this.energyRT ?? []) t.dispose();
    this.probeRT.dispose();
    this.geometry.dispose();
    this.gl.dispose();
    // Release the context now: browsers cap live contexts, and the Stage mounts per visit.
    this.gl.forceContextLoss();
  }

  private buildTargets() {
    this.roomRT?.dispose();
    const scale = TIERS[this.tier].roomScale;
    const float = this.gl.extensions.has('EXT_color_buffer_float');
    this.roomRT = new WebGLRenderTarget(
      Math.max(1, Math.round(this.backing.w * scale)),
      Math.max(1, Math.round(this.backing.h * scale)),
      {
        type: float ? HalfFloatType : UnsignedByteType, // RGBA16F when available, else RGBA8
        magFilter: LinearFilter,
        minFilter: LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      },
    );
    this.composite.uRoomTex.value = this.roomRT.texture;
    for (const t of this.energyRT ?? []) t.dispose();
    const make = () =>
      new WebGLRenderTarget(this.roomRT?.width ?? 1, this.roomRT?.height ?? 1, {
        type: float ? HalfFloatType : UnsignedByteType,
        magFilter: LinearFilter,
        minFilter: LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
    this.energyRT = [make(), make()];
    this.clearEnergy();
  }

  private clearEnergy() {
    for (const t of this.energyRT ?? []) {
      this.gl.setRenderTarget(t);
      this.gl.clear(true, false, false);
    }
    this.gl.setRenderTarget(null);
  }
}
