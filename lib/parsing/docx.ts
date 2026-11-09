import mammoth from 'mammoth';
import { DocumentParseError, MAX_CHARACTERS, type ExtractResult } from './types';

export async function extractDocxDocument(buffer: Buffer): Promise<ExtractResult> {
  let text: string;
  try {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } catch (error) {
    throw new DocumentParseError(
      'malformed_document',
      'The DOCX file could not be read. It may be damaged or password-protected.',
      { cause: error },
    );
  }

  if (text.length > MAX_CHARACTERS) {
    throw new DocumentParseError(
      'document_too_large',
      `The document exceeds the ${MAX_CHARACTERS.toLocaleString()} character limit.`,
    );
  }

  return { text, pageCount: null, charCount: text.length };
}
