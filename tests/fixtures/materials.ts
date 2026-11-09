import archiver from 'archiver';
import { createHash } from 'node:crypto';

/**
 * Deterministic-enough test documents. `contentHash` keeps fixtures stable.
 */

export const TEXT_MATERIAL_BYTES = Buffer.from(
  [
    'Study Guide: Cell Biology',
    '',
    'Eukaryotic cells contain organelles that compartmentalize function.',
    'The mitochondrion produces ATP through oxidative phosphorylation.',
    'The nucleus stores DNA and coordinates replication.',
    'Active recall strengthens memory better than passive rereading.',
    'Spaced repetition schedules review sessions at increasing intervals.',
    'Interleaving problem types improves discrimination learning.',
  ].join('\n'),
  'utf8',
);

/** A minimal but real PDF with text content, built like the unit-test builder. */
export function minimalPdf(pages: string[][]): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let cursor = 0;
  const chunks: string[] = [];
  const offsets: number[] = [];
  const push = (chunk: string) => {
    chunks.push(chunk);
    cursor += chunk.length;
  };
  push('%PDF-1.4\n');

  // Single-page content: the fixture only needs a parseable, image-rich document.
  const contentStream = `BT /F1 14 Tf 72 720 Td ${pages[0]
    ?.map((line) => `(${line.replace(/([()\\])/g, '\\$1')}) Tj 0 -18 Td`)
    .join(' ')} ET`;
  const numberOfObjects = objects.length + 1;
  let objectIndex = 1;
  for (; objectIndex <= objects.length; objectIndex += 1) {
    offsets.push(cursor);
    push(`${objectIndex} 0 obj\n${objects[objectIndex - 1]}\nendobj\n`);
  }
  offsets.push(cursor);
  push(`4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`);
  void numberOfObjects;

  const xrefOffset = cursor;
  const xref = ['xref', `0 ${offsets.length + 1}`, '0000000000 65535 f '].concat(
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
  );
  push(`${xref.join('\n')}\n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(''), 'latin1');
}

export const EICAR_BYTES = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'utf8',
);

export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

/** Streams a tiny valid ZIP — used to assert export ZIP contents. */
export function createZip(entries: Array<{ name: string; content: string | Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const collected: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => collected.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(collected)));
    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }
    void archive.finalize();
  });
}
