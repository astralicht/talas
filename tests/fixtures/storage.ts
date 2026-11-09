export interface TestStorageObject {
  key: string;
  body: Buffer;
  contentType: string;
}

const PDF_MAGIC = Buffer.from('%PDF-1.7\n', 'utf8');

export function makePdfObject(key = 'materials/test/sample.pdf'): TestStorageObject {
  return {
    key,
    body: Buffer.concat([PDF_MAGIC, Buffer.from('1 0 obj\n<<>>\nendobj\n%%EOF\n', 'utf8')]),
    contentType: 'application/pdf',
  };
}

export function makeTextObject(key = 'materials/test/sample.txt'): TestStorageObject {
  return {
    key,
    body: Buffer.from('Photosynthesis converts light into chemical energy.', 'utf8'),
    contentType: 'text/plain',
  };
}

export function makeMarkdownObject(key = 'materials/test/sample.md'): TestStorageObject {
  return {
    key,
    body: Buffer.from('# Photosynthesis\n\n- Light reactions\n- Calvin cycle\n', 'utf8'),
    contentType: 'text/markdown',
  };
}

export const EICAR_TEST_STRING =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
