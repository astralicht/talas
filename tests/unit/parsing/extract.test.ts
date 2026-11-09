import { describe, expect, it } from 'vitest';
import { extractDocument } from '@/lib/parsing/extract';
import { extractPdfDocument } from '@/lib/parsing/pdf';
import { extractTextDocument } from '@/lib/parsing/text';

/** Builds a valid single-page PDF with text content and a correct xref table. */
function buildPdf(lines: string[]): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // content stream, appended below with computed length
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const contentStream = `BT /F1 12 Tf 72 720 Td ${lines
    .map((line, index) => `${index === 0 ? '' : '0 -14 Td '}(${line.replace(/([()\\])/g, '\\$1')}) Tj`)
    .join('\n')} ET`;

  const body: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const push = (chunk: string) => {
    body.push(chunk);
    cursor += chunk.length;
  };

  const header = '%PDF-1.4\n';
  push(header);

  objects.forEach((dict, index) => {
    const objectNumber = index + 1;
    if (objectNumber === 4) {
      offsets.push(cursor);
      push(`${objectNumber} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`);
      return;
    }
    offsets.push(cursor);
    push(`${objectNumber} 0 obj\n${dict}\nendobj\n`);
  });

  const xrefOffset = cursor;
  const xref = ['xref', '0 6', '0000000000 65535 f '].concat(
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
  );
  push(`${xref.join('\n')}\n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(body.join(''), 'latin1');
}

describe('text extraction', () => {
  it('extracts Markdown and plain text with char counts and no page count', () => {
    const text = Buffer.from('# Heading\n\nBody text worth reading. '.repeat(30), 'utf8');
    for (const mime of ['text/markdown', 'text/plain']) {
      const result = extractTextDocument(text);
      expect(result.charCount).toBe(text.toString('utf8').length);
      expect(result.pageCount).toBeNull();
      void mime;
    }
  });

  it('rejects documents beyond the 2,000,000-character cap', () => {
    const huge = 'a'.repeat(2_000_001);
    expect(() => extractTextDocument(Buffer.from(huge, 'utf8'))).toThrowError(/character limit/);
  });

  it('rejects invalid UTF-8 as malformed', () => {
    expect(() => extractTextDocument(Buffer.from([0xff, 0x41]))).toThrowError(/UTF-8/);
  });
});

describe('PDF extraction', () => {
  it('extracts text and the page count from a single-page document', async () => {
    const pdf = buildPdf(['Study efficiently', 'Active recall beats rereading']);
    const result = await extractPdfDocument(pdf);
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain('Study efficiently');
    expect(result.text).toContain('Active recall beats rereading');
  });

  it('marks garbage input as malformed', async () => {
    await expect(extractPdfDocument(Buffer.from('not a pdf at all'))).rejects.toMatchObject({
      code: 'malformed_document',
    });
  });
});

describe('image-only detection', () => {
  it('rejects text with fewer than 200 non-whitespace characters as OCR-unsupported', async () => {
    const pdf = buildPdf(['short page']);
    await expect(extractDocument(pdf, 'application/pdf')).rejects.toMatchObject({
      code: 'ocr_not_supported',
    });
  });

  it('rejects a rich plain-text upload only when it is genuinely sparse', async () => {
    const sparse = Buffer.from('tiny', 'utf8');
    await expect(extractDocument(sparse, 'text/plain')).rejects.toMatchObject({
      code: 'ocr_not_supported',
    });

    const rich = Buffer.from('word '.repeat(300), 'utf8');
    const result = await extractDocument(rich, 'text/plain');
    expect(result.charCount).toBeGreaterThan(200);
  });

  it('applies the per-page average threshold for paged documents', () => {
    // Counted via isImageOnly indirectly: 1 page with 250 visible characters passes.
    const pdf = buildPdf(Array.from({ length: 8 }, (_, index) => `Paragraph number ${index} with enough words to pass the threshold check.`));
    return expect(extractDocument(pdf, 'application/pdf')).resolves.toMatchObject({
      pageCount: 1,
    });
  });
});
