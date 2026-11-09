import type { MaterialFailureCode } from '@/lib/materials/failure-messages';

export class DocumentParseError extends Error {
  readonly code: MaterialFailureCode;

  constructor(code: MaterialFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DocumentParseError';
    this.code = code;
  }
}

export interface ExtractResult {
  text: string;
  pageCount: number | null;
  charCount: number;
}

export const MAX_PAGES = 200;
export const MAX_CHARACTERS = 2_000_000;
