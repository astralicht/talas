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
