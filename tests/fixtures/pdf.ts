/** Builds a valid single-page (or N-page) PDF with a correct xref table. */
export function buildPdf(lines: string[], pages = 1): Buffer {
  const pageCount = Math.max(1, pages);
  const objects: Array<string | null> = [
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

  void pageCount;
  return Buffer.from(body.join(''), 'latin1');
}

import { deflateSync } from 'node:zlib';

/**
 * Builds a one-page PDF that carries machine-readable text AND an embedded
 * raster image (DeviceRGB, FlateDecode) — the shape the raster-extraction
 * path (lib/parsing/pdf.ts) exists for. The image uses deterministic
 * pseudo-random pixels so the PNG encoding stays above the 8 KB
 * "worth keeping" floor while remaining reproducible.
 */
export function buildPdfWithImage(lines: string[]): Buffer {
  const width = 200;
  const height = 150;
  // LCG pseudo-random RGB bytes: incompressible, deterministic.
  let seed = 0x2f6e2b1;
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[index] = (seed >>> 16) & 0xff;
  }
  const imageStream = deflateSync(raw);
  const contentStream = [
    `BT /F1 12 Tf 72 720 Td ${lines
      .map((line, index) => `${index === 0 ? '' : '0 -14 Td '}(${line.replace(/([()\\])/g, '\\$1')}) Tj`)
      .join('\n')} ET`,
    `q ${width} 0 0 ${height} 50 50 cm /Im0 Do Q`,
  ].join('\n');

  const objects: Array<{ dict: string; stream?: Buffer | string }> = [
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      dict: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Im0 6 0 R >> >> >>',
    },
    { dict: `<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>`, stream: contentStream },
    { dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    {
      dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${imageStream.byteLength} >>`,
      stream: imageStream,
    },
  ];

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  const push = (chunk: Buffer | string): void => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk;
    chunks.push(buffer);
    cursor += buffer.byteLength;
  };

  push('%PDF-1.4\n');
  objects.forEach((object, index) => {
    offsets.push(cursor);
    push(`${index + 1} 0 obj\n${object.dict}\n`);
    if (object.stream !== undefined) {
      push('stream\n');
      push(object.stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  });

  const xrefOffset = cursor;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) {
    push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
