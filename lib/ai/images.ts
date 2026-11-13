/** Image-asset catalog and generated-markdown allowlist (specs/005 FR-008). */

export interface CatalogImage {
  assetId: string;
  url: string;
}

/** The tenant-scoped, cookie-authenticated URL used in lesson markdown. */
export function buildImageUrl(materialId: string, assetId: string): string {
  return `/api/materials/${materialId}/images/${assetId}`;
}

/**
 * Post-processing allowlist for generated lesson markdown: every image
 * reference must point at a URL the model was offered in the catalog — anything
 * else (fabricated paths, external hosts, data: URIs, protocol-relative URLs)
 * is stripped so generated content can never embed arbitrary remote content.
 */
export function sanitizeGeneratedImages(markdown: string, allowedUrls: readonly string[]): string {
  const allowed = new Set(allowedUrls);
  let sanitized = markdown;

  sanitized = sanitized.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (match, alt: string, url: string) => (allowed.has(url) ? match : ''),
  );

  sanitized = sanitized.replace(
    /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi,
    (match, url: string) => (allowed.has(url) ? match : ''),
  );

  return sanitized;
}
