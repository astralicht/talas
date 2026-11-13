import {
  DocumentParseError,
  MAX_CHARACTERS,
  MAX_PAGES,
  type ExtractedImage,
  type ExtractResult,
} from './types';
import {
  MAX_IMAGES_PER_MATERIAL,
  MAX_IMAGE_PIXELS,
  encodeRasterToPng,
  imageHash,
  type PdfImageKind,
} from './raster';

/**
 * Registers @napi-rs/canvas classes on globalThis BEFORE pdfjs is imported:
 * pdfjs builds glyph paths with `Path2D` and the napi canvas accepts only its
 * own instances. Must run ahead of the pdfjs module import so pdfjs does not
 * capture a different polyfill.
 */
async function registerCanvasGlobals(): Promise<typeof import('@napi-rs/canvas')> {
  const napi = await import('@napi-rs/canvas');
  const globalForCanvas = globalThis as unknown as {
    Path2D?: unknown;
    Image?: unknown;
    ImageData?: unknown;
  };
  globalForCanvas.Path2D ??= napi.Path2D;
  globalForCanvas.Image ??= napi.Image;
  globalForCanvas.ImageData ??= napi.ImageData;
  return napi;
}

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs?: { get?(name: string): unknown };
  render?(options: Record<string, unknown>): { promise: Promise<void> };
  getViewport(options: { scale: number }): { width: number; height: number };
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
  /** pdfjs operator names (stable across 4.x). */
  OPS?: Record<string, number>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
}

interface PdfModule {
  getDocument(options: Record<string, unknown>): PdfLoadingTask;
  OPS?: Record<string, number>;
}

const IMAGE_OP_NAMES = new Set([
  'paintImageXObject',
  'paintImageXObjectRepeat',
  'paintJpegXObject',
]);

/** Small or decorative rasters (logos, bullets) are not worth storing. */
function imageWorthKeeping(png: Buffer): boolean {
  return png.byteLength >= 8 * 1024;
}

export async function extractPdfDocument(buffer: Buffer): Promise<ExtractResult> {
  // Canvas globals must be registered before pdfjs evaluates its module graph.
  const [, pdfjs] = await Promise.all([
    registerCanvasGlobals(),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  ]) as [unknown, PdfModule];

  let document: PdfDocument;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
      useWorkerFetch: false,
    }).promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') {
      throw new DocumentParseError(
        'encrypted_document',
        'Password-protected PDFs are not supported.',
        { cause: error },
      );
    }
    throw new DocumentParseError('malformed_document', 'The PDF could not be opened.', {
      cause: error,
    });
  }

  try {
    if (document.numPages > MAX_PAGES) {
      throw new DocumentParseError(
        'document_too_large',
        `PDFs are limited to ${MAX_PAGES} pages.`,
      );
    }

    const ops = document.OPS ?? {};
    const imageOps = new Set(
      Object.entries(ops)
        .filter(([name]) => IMAGE_OP_NAMES.has(name))
        .map(([, code]) => code),
    );

    const pages: string[] = [];
    const images: ExtractedImage[] = [];
    const seenHashes = new Set<string>();
    let charCount = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`)
        .join('')
        .replace(/[ \t]+\n/g, '\n');
      charCount += pageText.length;
      if (charCount > MAX_CHARACTERS) {
        throw new DocumentParseError(
          'document_too_large',
          `The document exceeds the ${MAX_CHARACTERS.toLocaleString()} character limit.`,
        );
      }
      pages.push(pageText.trim());

      // Raster XObjects (FR-008): dedupe, skip tiny icons and oversized
      // rasters, cap the per-material count. Best-effort — a failure on one
      // image never fails the parse.
      if (images.length >= MAX_IMAGES_PER_MATERIAL) continue;
      try {
        const operatorList = await page.getOperatorList();
        const args = operatorList.argsArray;
        for (let index = 0; index < operatorList.fnArray.length; index += 1) {
          if (images.length >= MAX_IMAGES_PER_MATERIAL) break;
          const fn = operatorList.fnArray[index];
          if (fn === undefined || !imageOps.has(fn)) continue;
          const objName = args[index]?.[0];
          if (typeof objName !== 'string') continue;
          try {
            const raw = page.objs?.get?.(objName) as
              | { width?: number; height?: number; kind?: number; data?: Uint8Array }
              | undefined;
            const width = raw?.width ?? 0;
            const height = raw?.height ?? 0;
            const kind = raw?.kind ?? 0;
            const data = raw?.data;
            if (!width || !height || !data || typeof kind !== 'number') continue;
            if (width * height > MAX_IMAGE_PIXELS) continue;

            const encoded = encodeRasterToPng(kind as PdfImageKind, width, height, data);
            if (!encoded || !imageWorthKeeping(encoded.png)) continue;
            const hash = imageHash(encoded.png);
            if (seenHashes.has(hash)) continue;
            seenHashes.add(hash);

            images.push({
              data: encoded.png,
              contentType: 'image/png',
              width: encoded.width,
              height: encoded.height,
              pageNumber,
              positionMarker: `[[talas-image:${images.length + 1}]]`,
            });
          } catch {
            continue;
          }
        }
      } catch {
        // Operator list unavailable for this page — keep text-only.
      }
    }

    const text = pages.join('\n\n');

    // FR-008: image-only PDFs are supported — render the pages themselves as
    // image assets when there is not enough machine-readable text.
    if (isSparse(text, document.numPages)) {
      const rendered = await renderPagesAsImages(buffer, document.numPages);
      if (rendered.length > 0) {
        return {
          text: '',
          pageCount: document.numPages,
          charCount: 0,
          images: rendered,
        };
      }
      throw new DocumentParseError(
        'ocr_not_supported',
        'This document appears to be image-only and could not be read.',
      );
    }

    return {
      text,
      pageCount: document.numPages,
      charCount,
      images: images.length > 0 ? images : undefined,
    };
  } finally {
    await document.destroy().catch(() => undefined);
  }
}

function isSparse(text: string, pageCount: number): boolean {
  const total = text.replace(/\s/g, '').length;
  if (total < 200) return true;
  return total / Math.max(1, pageCount) < 100;
}

/** Renders up to MAX_IMAGES_PER_MATERIAL pages at a bounded scale (FR-008). */
async function renderPagesAsImages(
  buffer: Buffer,
  pageCount: number,
): Promise<ExtractedImage[]> {
  const napi = await registerCanvasGlobals();
  const rendered: ExtractedImage[] = [];

  let document: PdfDocument;
  try {
    document = await ((await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfModule).getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
      useWorkerFetch: false,
    }).promise;
  } catch {
    return rendered;
  }

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (rendered.length >= MAX_IMAGES_PER_MATERIAL) break;
      try {
        const page = await document.getPage(pageNumber);
        if (typeof page.render !== 'function') break;

        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          2,
          1280 / Math.max(base.width, base.height),
          4096 / Math.max(base.width, base.height),
        );
        const viewport = page.getViewport({ scale: Math.max(0.5, scale) });
        const canvas = napi.createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, viewport.width, viewport.height);
        await page.render({
          canvasContext: context,
          viewport,
          canvas,
        }).promise;

        const png = canvas.toBuffer('image/png');
        if (png.byteLength === 0) continue;
        rendered.push({
          data: png,
          contentType: 'image/png',
          width: viewport.width,
          height: viewport.height,
          pageNumber,
          positionMarker: `[[talas-image:${rendered.length + 1}]]`,
        });
      } catch (renderError) {
        console.error('[render-debug]', renderError instanceof Error ? `${renderError.name}: ${renderError.message}` : renderError);
        continue;
      }
    }
  } finally {
    await document.destroy().catch(() => undefined);
  }

  return rendered;
}
