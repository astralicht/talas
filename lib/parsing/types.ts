import type { MaterialFailureCode } from '@/lib/materials/failure-messages';

export class DocumentParseError extends Error {
  readonly code: MaterialFailureCode;

  constructor(code: MaterialFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DocumentParseError';
    this.code = code;
  }
}

/** One image extracted from a document (specs/005 FR-008). */
export interface ExtractedImage {
  /** Encoded image bytes, ready to store as-is. */
  data: Buffer;
  contentType: string;
  width?: number | null;
  height?: number | null;
  /** 1-based page for PDFs; null for DOCX. */
  pageNumber?: number | null;
  /** Position marker inserted into the extracted text at the image site. */
  positionMarker: string;
}

export interface ExtractResult {
  text: string;
  pageCount: number | null;
  charCount: number;
  images?: ExtractedImage[];
}

export const MAX_PAGES = 200;
export const MAX_CHARACTERS = 2_000_000;
