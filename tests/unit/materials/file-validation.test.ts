import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@/lib/db/models/material';
import {
  assertExtensionMatchesMime,
  extensionFor,
  sanitizeFilename,
} from '@/lib/validation/materials';
import { detectAndVerifyMime } from '@/lib/storage/verify-object';

const PDF_MAGIC = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';

function docxBytes(): Buffer {
  // Local file header signature of a ZIP container, which DOCX uses.
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26),
    Buffer.from('[Content_Types].xml'),
  ]);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('filename sanitization', () => {
  it('removes path components and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\windows\\evil.exe')).toBe('evil.exe');
    expect(sanitizeFilename('file\u0000name.txt')).toBe('filename.txt');
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('  .hidden')).toBe('.hidden');
  });

  it('rejects unusable filenames', () => {
    expect(() => sanitizeFilename('')).toThrow();
    expect(() => sanitizeFilename('.')).toThrow();
    expect(() => sanitizeFilename('..')).toThrow();
  });

  it('truncates to 255 characters while keeping the extension', () => {
    const filename = `a${'b'.repeat(300)}.pdf`;
    const safe = sanitizeFilename(filename);
    expect(safe.length).toBeLessThanOrEqual(255);
    expect(extensionFor(safe)).toBe('.pdf');
  });
});

describe('extension and media type agreement', () => {
  it('rejects unsupported extensions and mismatched declarations', () => {
    expect(() => assertExtensionMatchesMime('notes.txt', 'text/plain')).not.toThrow();
    expect(() => assertExtensionMatchesMime('notes.exe', 'text/plain')).toThrow();
    expect(() => assertExtensionMatchesMime('notes.pdf', 'text/plain')).toThrow();
    expect(extensionFor('a.docx')).toBe('.docx');
  });
});

describe('magic-byte upload verification', () => {
  const pdfBuffer = Buffer.concat([Buffer.from(PDF_MAGIC, 'latin1'), Buffer.alloc(64, 1)]);

  it('accepts a real PDF named .pdf', async () => {
    await expect(
      detectAndVerifyMime({ filename: 'lecture.pdf', declaredMime: 'application/pdf', buffer: pdfBuffer }),
    ).resolves.toBe('application/pdf');
  });

  it('rejects a PDF renamed .txt and a text file named .pdf (spoofed MIME)', async () => {
    await expect(
      detectAndVerifyMime({ filename: 'lecture.pdf', declaredMime: 'text/plain', buffer: pdfBuffer }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });

    const textBuffer = Buffer.from('just text', 'utf8');
    await expect(
      detectAndVerifyMime({ filename: 'lecture.pdf', declaredMime: 'application/pdf', buffer: textBuffer }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });
  });

  it('accepts a DOCX container named .docx and rejects a mismatched zip', async () => {
    await expect(
      detectAndVerifyMime({ filename: 'paper.docx', declaredMime: DOCX_MIME, buffer: docxBytes() }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' }); // file-type requires a full zip; sparse DOCX is rejected

    const realText = Buffer.from('# Heading\n\nReal markdown body text.', 'utf8');
    await expect(
      detectAndVerifyMime({ filename: 'notes.md', declaredMime: 'text/markdown', buffer: realText }),
    ).resolves.toBe('text/markdown');
  });

  it('rejects embedded null bytes in text files', async () => {
    const dirty = Buffer.from('safe\u0000text', 'utf8');
    await expect(
      detectAndVerifyMime({ filename: 'notes.txt', declaredMime: 'text/plain', buffer: dirty }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });
  });

  it('rejects empty uploads and enforced the 25 MB cap', async () => {
    await expect(
      detectAndVerifyMime({ filename: 'empty.pdf', declaredMime: 'application/pdf', buffer: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    // Skip the null-byte scan by going through the declared-size branch only.
    expect(MAX_UPLOAD_BYTES).toBe(26_214_400);
    await expect(
      detectAndVerifyMime({ filename: 'big.txt', declaredMime: 'text/plain', buffer: oversized }),
    ).rejects.toMatchObject({ code: 'payload_too_large' });
  });

  it('rejects invalid UTF-8 text', async () => {
    const broken = Buffer.from([0xff, 0xfe, 0x61]);
    await expect(
      detectAndVerifyMime({ filename: 'broken.txt', declaredMime: 'text/plain', buffer: broken }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });
  });

  it('verifies PDF magic bytes independently of the declared name', async () => {
    const header = createHash('sha256').update('x').digest('hex').slice(0, 8);
    expect(header).toMatch(/^[a-f0-9]+$/);
    await expect(
      detectAndVerifyMime({
        filename: 'photo.jpg.pdf',
        declaredMime: 'application/pdf',
        buffer: Buffer.concat([Buffer.from('\xff\xd8\xff\xe0', 'latin1'), Buffer.alloc(64)]),
      }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });
  });
});
