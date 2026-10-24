import sharp from 'sharp';

// Cover image → 128×128 sRGB RGBA pixels (VISUALIZER_SPEC.md §6.1), for `extract.ts`.

export const DECODE_SIZE = 128;

export async function decodeCover(image: Buffer) {
  const { data, info } = await sharp(image, { failOn: 'error' })
    .resize(DECODE_SIZE, DECODE_SIZE, { fit: 'fill' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgba: data, width: info.width, height: info.height };
}
