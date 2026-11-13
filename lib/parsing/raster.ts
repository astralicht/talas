import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';

/** Image-asset budgets (specs/005 FR-008): raster images are best-effort. */
export const MAX_IMAGES_PER_MATERIAL = 10;
export const MIN_IMAGE_BYTES = 8 * 1024;
export const MAX_IMAGE_DIMENSION = 1280;
/** Memory guard: never attempt to decode absurd rasters. */
export const MAX_IMAGE_PIXELS = 4096 * 4096;

/** pdfjs internal pixel kinds. */
export const PDF_IMAGE_KIND = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3,
} as const;

export type PdfImageKind =
  (typeof PDF_IMAGE_KIND)[keyof typeof PDF_IMAGE_KIND];

export function imageHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

function rawToRgba(kind: PdfImageKind, width: number, height: number, data: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  if (kind === PDF_IMAGE_KIND.RGBA_32BPP) {
    rgba.set(data.subarray(0, rgba.length));
    return rgba;
  }
  if (kind === PDF_IMAGE_KIND.RGB_24BPP) {
    const source = data.subarray(0, width * height * 3);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      rgba[pixel * 4] = source[pixel * 3] ?? 0;
      rgba[pixel * 4 + 1] = source[pixel * 3 + 1] ?? 0;
      rgba[pixel * 4 + 2] = source[pixel * 3 + 2] ?? 0;
      rgba[pixel * 4 + 3] = 255;
    }
    return rgba;
  }
  // GRAYSCALE_1BPP: packed bits, rows aligned to whole bytes.
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const packed = data[y * rowBytes + (x >> 3)] ?? 0;
      const bit = (packed >> (7 - (x & 7))) & 1;
      const value = bit ? 0 : 255; // pdfjs 1bpp is inverted (0 = black bit set)
      const offset = (y * width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

/** Encodes raw pdfjs pixel data to a PNG, downscaling beyond MAX_IMAGE_DIMENSION. */
export function encodeRasterToPng(
  kind: PdfImageKind,
  width: number,
  height: number,
  data: Uint8Array,
): { png: Buffer; width: number; height: number } | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    return null;
  }

  const rgba = rawToRgba(kind, width, height, data);
  const scale =
    Math.max(width, height) > MAX_IMAGE_DIMENSION
      ? MAX_IMAGE_DIMENSION / Math.max(width, height)
      : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const source = createCanvas(width, height);
  const sourceContext = source.getContext('2d') as SKRSContext2D;
  const imageData = sourceContext.createImageData(width, height);
  imageData.data.set(rgba);
  sourceContext.putImageData(imageData, 0, 0);

  if (scale === 1) {
    return { png: source.toBuffer('image/png'), width, height };
  }

  const target = createCanvas(targetWidth, targetHeight);
  const targetContext = target.getContext('2d') as SKRSContext2D;
  targetContext.imageSmoothingEnabled = true;
  targetContext.drawImage(source, 0, 0, targetWidth, targetHeight);
  return { png: target.toBuffer('image/png'), width: targetWidth, height: targetHeight };
}
