import {
  BufferAttribute,
  BufferGeometry,
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
  type Texture,
  TextureLoader,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import blueNoiseUrl from './blue-noise-64.png';
import { BASE_EXPOSURE, type PaletteUniforms } from './palette.ts';
import { COMPOSITE_FRAG, FULLSCREEN_VERT, ROOM_FRAG } from './shaders.ts';

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

export interface FrameInput {
  flow: number;
  drift: number;
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
    uRoom: { value: new Vector3() },
    uAccent: { value: new Vector3() },
    uHighlight: { value: new Vector3() },
    uGlow: { value: new Vector3() },
    uKey: { value: new Vector2(0.5, 0.4) },
  };
  private readonly composite = {
    uRoomTex: { value: null as Texture | null },
    uNoise: { value: null as Texture | null },
    uRes: { value: new Vector2() },
    uDpr: { value: 1 },
    uShadow: { value: new Vector3() },
    uChrome: { value: 1 },
    uExposure: { value: BASE_EXPOSURE },
  };
  private readonly roomMat: RawShaderMaterial;
  private readonly compositeMat: RawShaderMaterial;
  private readonly geometry = new BufferGeometry();
  private roomRT: WebGLRenderTarget | null = null;
  private noise: Texture | null = null;
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
    this.roomScene.add(new Mesh(this.geometry, this.roomMat));
    this.compositeScene.add(new Mesh(this.geometry, this.compositeMat));
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

  setTier(tier: Tier) {
    this.tier = tier;
    this.backing.w = 0; // force a rebuild at the next setSize
  }

  setPalette(p: PaletteUniforms) {
    const u = this.room;
    u.uRoom.value.set(...p.room);
    u.uAccent.value.set(...p.accent);
    u.uHighlight.value.set(...p.highlight);
    u.uGlow.value.set(...p.glow);
    this.composite.uShadow.value.set(...p.shadow);
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
    r.uKey.value.set(f.key[0], f.key[1]);
    this.composite.uChrome.value = f.chrome;
    this.gl.setRenderTarget(this.roomRT);
    this.gl.render(this.roomScene, this.camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.compositeScene, this.camera);
  }

  /** After a context restore: rebuild targets and recompile materials (§5.6). */
  rebuild() {
    this.buildTargets();
    this.roomMat.needsUpdate = true;
    this.compositeMat.needsUpdate = true;
    if (this.noise) this.noise.needsUpdate = true;
  }

  dispose() {
    this.roomRT?.dispose();
    this.noise?.dispose();
    this.roomMat.dispose();
    this.compositeMat.dispose();
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
  }
}
