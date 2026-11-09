import { extractDocxDocument } from './docx';
import { extractPdfDocument } from './pdf';
import { isImageOnly } from './quality';
import { extractTextDocument } from './text';
import { DocumentParseError, type ExtractResult } from './types';

export type { ExtractResult } from './types';
export { DocumentParseError, MAX_CHARACTERS, MAX_PAGES } from './types';

export async function extractDocument(
  buffer: Buffer,
  detectedMime: string,
): Promise<ExtractResult> {
  let result: ExtractResult;

  switch (detectedMime) {
    case 'application/pdf':
      result = await extractPdfDocument(buffer);
      break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      result = await extractDocxDocument(buffer);
      break;
    case 'text/markdown':
    case 'text/plain':
      result = extractTextDocument(buffer);
      break;
    default:
      throw new DocumentParseError('unsupported_type', 'This document type is not supported.');
  }

  if (isImageOnly(result.text, result.pageCount)) {
    throw new DocumentParseError(
      'ocr_not_supported',
      'This document appears to be image-only and OCR is not supported.',
    );
  }

  return {
    text: result.text.trim(),
    pageCount: result.pageCount,
    charCount: result.text.trim().length,
  };
}
