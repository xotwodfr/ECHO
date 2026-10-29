import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANDROID_SHADER_DIR, androidShaders } from './android-shaders.ts';

// The Android client's shader assets are the web's, byte for byte: a shader change that was not
// carried over (node scripts/android-shaders.ts) fails here, not on the owner's phone.
describe('Android Stage shaders', () => {
  for (const [name, source] of Object.entries(androidShaders())) {
    it(`${name}.glsl is current`, () => {
      expect(readFileSync(join(ANDROID_SHADER_DIR, `${name}.glsl`), 'utf8')).toBe(source);
    });
  }
});
