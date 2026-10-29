// The Stage's shaders for the Android client (docs/ANDROID_CLIENT.md): the web's GLSL ES 3.00
// strings exactly, one asset each, so both renderers draw the same room. Run after changing
// src/client/stage/shaders.ts: node scripts/android-shaders.ts (android-shaders.test.ts checks it).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANDROID_SHADER_DIR, androidShaders } from '../src/client/stage/android-shaders.ts';

mkdirSync(ANDROID_SHADER_DIR, { recursive: true });
for (const [name, source] of Object.entries(androidShaders())) {
  writeFileSync(join(ANDROID_SHADER_DIR, `${name}.glsl`), source);
  console.log(`${name}.glsl`);
}
