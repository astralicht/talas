import mammoth from 'mammoth';
import { DocumentParseError, MAX_CHARACTERS, type ExtractedImage, type ExtractResult } from './types';
import { MAX_IMAGES_PER_MATERIAL } from './raster';

const DATA_URI_PATTERN = /<img src="data:([^;"]+);base64,([^"]+)"\s*\/?>/g;

/**
 * Extracts DOCX text with inline images kept as `[[talas-image:N]]` position
 * markers, plus the decoded image payloads (specs/005 FR-008). Images are
 * best-effort: converter failures degrade to text-only extraction.
 */
export async function extractDocxDocument(buffer: Buffer): Promise<ExtractResult> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      { convertImage: mammoth.images.dataUri },
    );
    html = result.value;
  } catch (error) {
    throw new DocumentParseError(
      'malformed_document',
      'The DOCX file could not be read. It may be damaged or password-protected.',
      { cause: error },
    );
  }

  const images: ExtractedImage[] = [];
  const withMarkers = html.replace(DATA_URI_PATTERN, (_match, mime: string, base64: string) => {
    const index = images.length + 1;
    if (images.length < MAX_IMAGES_PER_MATERIAL) {
      try {
        images.push({
          data: Buffer.from(base64, 'base64'),
          contentType: mime.startsWith('image/') ? mime : 'image/png',
          width: null,
          height: null,
          pageNumber: null,
          positionMarker: `[[talas-image:${index}]]`,
        });
      } catch {
        return '';
      }
    }
    return `[[talas-image:${index}]]`;
  });

  // Strip remaining tags to plain text; block-level tags become newlines.
  const text = withMarkers
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length > MAX_CHARACTERS) {
    throw new DocumentParseError(
      'document_too_large',
      `The document exceeds the ${MAX_CHARACTERS.toLocaleString()} character limit.`,
    );
  }

  return { text, pageCount: null, charCount: text.length, images };
}
