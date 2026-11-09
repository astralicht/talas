export type MaterialFailureCode =
  | 'upload_expired'
  | 'upload_missing'
  | 'size_mismatch'
  | 'unsupported_type'
  | 'mime_mismatch'
  | 'scanner_unavailable'
  | 'infected'
  | 'parse_failed'
  | 'ocr_not_supported'
  | 'document_too_large'
  | 'encrypted_document'
  | 'malformed_document'
  | 'generation_failed'
  | 'provider_unavailable'
  | 'budget_exceeded'
  | 'malformed_model_output'
  | 'internal_error';

const MESSAGES: Record<MaterialFailureCode, string> = {
  upload_expired: 'The upload window expired. Start the upload again.',
  upload_missing: 'The uploaded file could not be found. Upload it again.',
  size_mismatch: 'The uploaded file size did not match the declared size.',
  unsupported_type: 'This file type is not supported. Use PDF, DOCX, Markdown, or plain text.',
  mime_mismatch: 'The file content does not match its extension or declared type.',
  scanner_unavailable: 'The file could not be scanned right now. Try again later.',
  infected: 'The file failed the malware scan and was removed.',
  parse_failed: 'The document could not be read.',
  ocr_not_supported:
    'This document appears to be image-only. OCR is not supported yet; upload a text-based file.',
  document_too_large: 'The document is larger than the processing limit.',
  encrypted_document: 'Password-protected documents are not supported.',
  malformed_document: 'The document appears to be damaged or malformed.',
  generation_failed: 'The lesson could not be generated. Try again.',
  provider_unavailable: 'The AI provider is temporarily unavailable. Try again later.',
  budget_exceeded: 'You have reached today’s lesson generation limit. Try again tomorrow.',
  malformed_model_output: 'The generated lesson was invalid and was discarded. Try again.',
  internal_error: 'Something went wrong while processing this material.',
};

export function failureMessage(code: MaterialFailureCode): string {
  return MESSAGES[code];
}

export function failure(code: MaterialFailureCode): {
  failureCode: MaterialFailureCode;
  failureMessage: string;
} {
  return { failureCode: code, failureMessage: failureMessage(code) };
}

export const RETRYABLE_FAILURES: ReadonlySet<MaterialFailureCode> = new Set([
  'scanner_unavailable',
  'parse_failed',
  'generation_failed',
  'provider_unavailable',
  'budget_exceeded',
  'malformed_model_output',
  'internal_error',
]);
