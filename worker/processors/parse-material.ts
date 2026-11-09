import { getLogger } from '@/lib/logging/logger';
import { UnrecoverableError } from 'bullmq';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import { getObjectBytes } from '@/lib/storage/s3';
import { extractDocument, DocumentParseError } from '@/lib/parsing/extract';
import { enqueueGenerateForMaterial } from '@/lib/jobs/material-jobs';
import { failureMessage, type MaterialFailureCode } from '@/lib/materials/failure-messages';
import type { ParseMaterialJob } from '@/lib/jobs/schemas';

const logger = getLogger().child({ processor: 'parse_material' });

const PARSE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'ocr_not_supported',
  'document_too_large',
  'encrypted_document',
  'malformed_document',
]);

/**
 * Extracts raw text from the scanned document. Extraction is bounded by the page
 * and character caps enforced inside the extractors, and unsupported or damaged
 * documents fail with safe, actionable codes.
 */
export async function processParseMaterial(payload: ParseMaterialJob): Promise<void> {
  const { materialId, userId, correlationId } = payload;

  const materials = new MaterialRepository(userId);
  const jobs = new ProcessingJobRepository(userId);

  const claimed = await jobs.claimForStage(materialId);
  if (!claimed) {
    logger.warn({ materialId }, 'Parse stage already claimed or finished');
    return;
  }

  const material = await materials.findForWorker(materialId);
  if (!material) {
    await jobs.markFailed(materialId, 'upload_missing', 'The uploaded material no longer exists.');
    return;
  }

  const processing = await materials.transition(materialId, ['queued'], 'processing');
  if (!processing) {
    logger.warn({ materialId, status: material.status }, 'Material skipped parse stage');
    return;
  }

  if (!material.scanResult || material.scanResult !== 'clean') {
    await materials.markFailed(
      materialId,
      'scanner_unavailable',
      'The file could not be scanned right now. Try again later.',
    );
    await jobs.markFailed(materialId, 'scanner_unavailable', 'A clean scan is required before parsing.');
    return;
  }

  let text: string;
  let pageCount: number | null;
  try {
    const bytes = await getObjectBytes(material.storageKey);
    const detectedMime = material.detectedMime ?? material.declaredMime;
    const result = await extractDocument(bytes, detectedMime);
    text = result.text;
    pageCount = result.pageCount;
  } catch (error) {
    if (error instanceof DocumentParseError && PARSE_FAILURE_CODES.has(error.code)) {
      await materials.markFailed(materialId, error.code, failureMessage(error.code as MaterialFailureCode));
      await jobs.markFailed(materialId, error.code, failureMessage(error.code as MaterialFailureCode));
      logger.info({ materialId, code: error.code }, 'Document rejected during parsing');
      // Terminal classification: no point burning automatic retries.
      throw new UnrecoverableError(`Material rejected during parsing: ${error.code}`);
    }
    const parseFailure = error instanceof DocumentParseError ? error.code : 'parse_failed';
    await materials.markFailed(materialId, parseFailure, failureMessage('parse_failed'));
    await jobs.markFailed(materialId, parseFailure, failureMessage('parse_failed'));
    logger.warn({ err: error, materialId }, 'Document extraction failed');
    return;
  }

  await materials.saveParseResult(materialId, pageCount, text.length);
  await jobs.markQueued(materialId);

  try {
    await enqueueGenerateForMaterial({ materialId, userId, correlationId });
  } catch (error) {
    await materials.markFailed(materialId, 'internal_error', failureMessage('internal_error'));
    await jobs.markFailed(materialId, 'internal_error', failureMessage('internal_error'));
    logger.error({ err: error, materialId }, 'Failed to enqueue generation stage');
    return;
  }
  logger.info({ materialId, pageCount, charCount: text.length }, 'Document parsed and queued for generation');
}
