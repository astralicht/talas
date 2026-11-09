export const MIN_TOTAL_NON_WHITESPACE = 200;
export const MIN_NON_WHITESPACE_PER_PAGE = 100;

export function nonWhitespaceCount(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * Treats a document as image-only when it has too little machine-readable text.
 * For paged documents the per-page average must also clear the threshold.
 */
export function isImageOnly(text: string, pageCount: number | null): boolean {
  const total = nonWhitespaceCount(text);
  if (total < MIN_TOTAL_NON_WHITESPACE) return true;
  if (pageCount && pageCount > 0) {
    return total / pageCount < MIN_NON_WHITESPACE_PER_PAGE;
  }
  return false;
}
