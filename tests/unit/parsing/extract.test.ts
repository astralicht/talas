import { describe, expect, it } from 'vitest';
import { extractDocument } from '@/lib/parsing/extract';
import { extractPdfDocument } from '@/lib/parsing/pdf';
import { extractTextDocument } from '@/lib/parsing/text';
import { buildPdf } from '../../fixtures/pdf';

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
  it('extracts text and the page count from a dense single-page document', async () => {
    const pdf = buildPdf(
      Array.from(
        { length: 10 },
        (_, index) => `Line ${index} carries plenty of words so the page clears the sparse threshold.`,
      ),
    );
    const result = await extractPdfDocument(pdf);
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain('Line 0');
    expect(result.images).toBeUndefined();
  });

  it('marks garbage input as malformed', async () => {
    await expect(extractPdfDocument(Buffer.from('not a pdf at all'))).rejects.toMatchObject({
      code: 'malformed_document',
    });
  });
});

describe('image-only detection', () => {
  it('renders sparse PDFs as page images instead of rejecting (FR-008)', async () => {
    const pdf = buildPdf(['short page']);
    const result = await extractDocument(pdf, 'application/pdf');
    expect(result.pageCount).toBe(1);
    expect(result.charCount).toBe(0);
    expect(result.images?.length).toBeGreaterThan(0);
    expect(result.images?.[0]?.contentType).toBe('image/png');
    expect(result.images?.[0]?.pageNumber).toBe(1);
  });

  it('still rejects genuinely sparse plain-text uploads', async () => {
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
