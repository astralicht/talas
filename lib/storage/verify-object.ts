import { fileTypeFromBuffer } from 'file-type';
import { MAX_UPLOAD_BYTES } from '@/lib/db/models/material';
import { errors } from '@/lib/http/errors';
import {
  assertExtensionMatchesMime,
  extensionFor,
  mimeForExtension,
} from '@/lib/validation/materials';

const TEXT_MIMES = new Set(['text/markdown', 'text/plain']);
const KNOWN_BINARY_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export interface VerifyObjectInput {
  filename: string;
  declaredMime: string;
  buffer: Buffer;
}

/**
 * Verifies that the stored bytes match the declared media type.
 * Binary types are detected from magic bytes; text types are checked for
 * valid UTF-8 and rejected when a binary signature is present.
 */
export async function detectAndVerifyMime(input: VerifyObjectInput): Promise<string> {
  const { filename, declaredMime, buffer } = input;

  if (buffer.byteLength === 0) {
    throw errors.validation(undefined, 'The uploaded file is empty.');
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw errors.payloadTooLarge('Files must be 25 MB or smaller.');
  }

  try {
    assertExtensionMatchesMime(filename, declaredMime);
  } catch (error) {
    throw errors.unsupportedMedia(
      error instanceof Error ? error.message : 'The file type is not supported.',
    );
  }

  if (buffer.includes(0)) {
    throw errors.unsupportedMedia('The file content does not match the declared media type.');
  }

  if (TEXT_MIMES.has(declaredMime)) {
    if (mimeForExtension(filename) !== declaredMime) {
      throw errors.unsupportedMedia('The filename extension does not match the declared media type.');
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw errors.unsupportedMedia('The file is not valid UTF-8 text.');
    }
    return declaredMime;
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !KNOWN_BINARY_MIMES.has(detected.mime)) {
    throw errors.unsupportedMedia('The file content does not match the declared media type.');
  }
  if (detected.mime !== declaredMime) {
    throw errors.unsupportedMedia('The file content does not match the declared media type.');
  }
  if (extensionFor(filename) !== (declaredMime === 'application/pdf' ? '.pdf' : '.docx')) {
    throw errors.unsupportedMedia('The filename extension does not match the declared media type.');
  }
  return detected.mime;
}
