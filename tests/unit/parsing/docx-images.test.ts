import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { extractDocument } from '@/lib/parsing/extract';
import { buildDocxWithImage } from '../../fixtures/docx';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('DOCX image extraction (FR-008)', () => {
  it('keeps inline images as position markers with decoded payloads', async () => {
    const canvas = createCanvas(64, 48);
    const context = canvas.getContext('2d');
    context.fillStyle = '#3366aa';
    context.fillRect(0, 0, 64, 48);
    const png = canvas.toBuffer('image/png');
    expect(png.byteLength).toBeGreaterThan(0);

    const docx = await buildDocxWithImage(png);
    const result = await extractDocument(docx, DOCX_MIME);

    expect(result.images).toHaveLength(1);
    const image = result.images?.[0];
    expect(image?.contentType).toBe('image/png');
    expect(image?.positionMarker).toBe('[[talas-image:1]]');
    expect(image?.data.byteLength).toBeGreaterThan(0);
    expect(image?.pageNumber).toBeNull();

    // The marker sits between the paragraphs that surround it.
    expect(result.text).toContain('Chapter one with an image below.');
    expect(result.text).toContain('[[talas-image:1]]');
    expect(result.text).toContain('Closing paragraph after the image.');
    const markerIndex = result.text.indexOf('[[talas-image:1]]');
    expect(markerIndex).toBeGreaterThan(
      result.text.indexOf('Chapter one'),
    );
    expect(markerIndex).toBeLessThan(result.text.indexOf('Closing paragraph'));
  });

  it('strips the marker syntax that could smuggle tags into prompts', async () => {
    const docx = await buildDocxWithImage(
      (() => {
        const canvas = createCanvas(8, 8);
        return canvas.toBuffer('image/png');
      })(),
    );
    const result = await extractDocument(docx, DOCX_MIME);
    expect(result.text).not.toContain('<untrusted_material>');
    expect(result.text).not.toContain('<img');
  });
});
