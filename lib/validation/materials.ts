import { z } from 'zod';
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/db/models/material';
import { objectIdSchema, strictObject } from './common';

export const allowedMimeSchema = z.enum(
  ALLOWED_MIME_TYPES as unknown as [string, ...string[]],
);

const EXTENSION_BY_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/markdown': ['.md', '.markdown'],
  'text/plain': ['.txt'],
};

export function extensionFor(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? `.${match[1]?.toLowerCase()}` : '';
}

export function mimeForExtension(filename: string): string | null {
  const extension = extensionFor(filename);
  for (const [mime, extensions] of Object.entries(EXTENSION_BY_MIME)) {
    if (extensions.includes(extension)) return mime;
  }
  return null;
}

/**
 * Removes path components, control characters, and leading dots so the stored
 * filename cannot escape its virtual directory or confuse content disposition.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
    throw new Error('Filename is not usable');
  }
  const truncated =
    cleaned.length > 255
      ? `${cleaned.slice(0, 255 - extensionFor(cleaned).length)}${extensionFor(cleaned)}`
      : cleaned;
  return truncated;
}

export const presignSchema = strictObject({
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => /^[^\\/\u0000-\u001f]+$/.test(value), 'Filename contains unsupported characters'),
  declaredMime: allowedMimeSchema,
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});

export const confirmMaterialSchema = strictObject({
  materialId: objectIdSchema,
});

export const materialIdParamsSchema = strictObject({
  materialId: objectIdSchema,
});

export type PresignInput = z.infer<typeof presignSchema>;
export type ConfirmMaterialInput = z.infer<typeof confirmMaterialSchema>;

export function assertExtensionMatchesMime(filename: string, declaredMime: string): void {
  const expected = mimeForExtension(filename);
  if (!expected) {
    throw new Error('The filename extension is not supported');
  }
  if (expected !== declaredMime) {
    throw new Error('The filename extension does not match the declared media type');
  }
}
