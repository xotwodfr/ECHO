import {
  COMPOSITE_FRAG,
  ENERGY_FRAG,
  FULLSCREEN_VERT,
  GLASS_FRAG,
  PROBE_FRAG,
  ROOM_FRAG,
} from './shaders.ts';

// The Android client draws the Stage with these same shaders (docs/ANDROID_CLIENT.md), from assets
// that scripts/android-shaders.ts writes. Its renderer prepends `#version 300 es`, as three.js does.

export const ANDROID_SHADER_DIR = 'Android/app/src/main/assets/stage';

export const androidShaders = () => ({
  fullscreen_vert: FULLSCREEN_VERT,
  room_frag: ROOM_FRAG,
  energy_frag: ENERGY_FRAG,
  composite_frag: COMPOSITE_FRAG,
  glass_frag: GLASS_FRAG,
  probe_frag: PROBE_FRAG,
});
