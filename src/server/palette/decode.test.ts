import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodeCover } from './decode.ts';

// ON-DB-5: a cover's declared size is capped before it is decoded (a user-chosen server can send a
// small file that declares a huge image).
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#335' } })
    .png()
    .toBuffer();

describe('decodeCover', () => {
  it('decodes a large cover (4000², 16 Mpx)', async () => {
    expect((await decodeCover(await png(4000, 4000))).width).toBe(128);
  });

  it('refuses one over 25 Mpx before decoding it', async () => {
    await expect(decodeCover(await png(6000, 5000))).rejects.toThrow(/pixel limit/i);
  });
});
