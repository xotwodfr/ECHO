import sharp from 'sharp';

// Cover image → 128×128 sRGB RGBA pixels (VISUALIZER_SPEC.md §6.1), for `extract.ts`.

export const DECODE_SIZE = 128;

export async function decodeCover(image: Buffer) {
  // A cover over 25 Mpx (5000²) is refused before decoding: a small file can declare a huge
  // image (a decompression bomb) from a user-chosen server. The caller falls back.
  const { data, info } = await sharp(image, { failOn: 'error', limitInputPixels: 25_000_000 })
    .resize(DECODE_SIZE, DECODE_SIZE, { fit: 'fill' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgba: data, width: info.width, height: info.height };
}
