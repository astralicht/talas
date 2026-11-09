import { DocumentParseError, MAX_CHARACTERS, type ExtractResult } from './types';

export function extractTextDocument(buffer: Buffer): ExtractResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new DocumentParseError('malformed_document', 'The text file is not valid UTF-8.');
  }

  if (text.length > MAX_CHARACTERS) {
    throw new DocumentParseError(
      'document_too_large',
      `The document exceeds the ${MAX_CHARACTERS.toLocaleString()} character limit.`,
    );
  }

  return { text, pageCount: null, charCount: text.length };
}
