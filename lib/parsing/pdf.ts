import {
  DocumentParseError,
  MAX_CHARACTERS,
  MAX_PAGES,
  type ExtractResult,
} from './types';

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
}

interface PdfModule {
  getDocument(options: Record<string, unknown>): PdfLoadingTask;
}

export async function extractPdfDocument(buffer: Buffer): Promise<ExtractResult> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfModule;

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

    const pages: string[] = [];
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
    }

    return {
      text: pages.join('\n\n'),
      pageCount: document.numPages,
      charCount,
    };
  } finally {
    await document.destroy().catch(() => undefined);
  }
}
