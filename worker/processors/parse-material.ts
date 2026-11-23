import { getLogger } from '@/lib/logging/logger';
import { UnrecoverableError } from 'bullmq';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import { getObjectBytes } from '@/lib/storage/object-store';
import { extractDocument, DocumentParseError } from '@/lib/parsing/extract';
import type { ExtractedImage } from '@/lib/parsing/types';
import { persistMaterialAssets } from '@/lib/materials/asset-service';
import { failureMessage, type MaterialFailureCode } from '@/lib/materials/failure-messages';
import { PLAN_FAILURE_CODES } from '@/lib/plans';
import { userPlanContext } from '@/lib/plans/usage';
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
  const { materialId, userId } = payload;

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
  let images: ExtractedImage[] = [];
  try {
    const bytes = await getObjectBytes(material.storageKey);
    const detectedMime = material.detectedMime ?? material.declaredMime;
    const result = await extractDocument(bytes, detectedMime);
    text = result.text;
    pageCount = result.pageCount;
    images = result.images ?? [];
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

  // Plan character cap (constitution v2.3.0): a document longer than the
  // user's plan allows fails here, before chunking or any model cost. The
  // message tells the user how to split the upload into quota-counting files.
  const { plan, limits } = await userPlanContext(userId);
  if (text.length > limits.maxMaterialChars) {
    const code = PLAN_FAILURE_CODES.chars;
    const message =
      `This document contains ${text.length} characters — the ${plan} plan allows ${limits.maxMaterialChars} per material. ` +
      'Split the document into smaller files (each counts toward your material limit), or delete this upload to reclaim space.';
    await materials.markFailed(materialId, code, message);
    await jobs.markFailed(materialId, code, message);
    logger.info(
      { materialId, charCount: text.length, limit: limits.maxMaterialChars },
      'Material exceeds the plan character limit',
    );
    // Deterministic outcome: retrying the same document would fail again.
    throw new UnrecoverableError('Material exceeds the plan character limit');
  }

  await materials.saveParseResult(materialId, pageCount, text.length);
  // FR-008: extracted images become tenant-scoped assets; best-effort.
  if (images.length > 0) {
    await persistMaterialAssets(userId, materialId, images);
  }

  // Explicit-only generation (specs/005): a parsed material ends the automatic
  // pipeline in the `ready` state. Lesson creation happens only when the user
  // requests it through the lesson-generation flow — no generate stage is
  // enqueued here anymore.
  const ready = await materials.transition(materialId, ['processing'], 'ready');
  if (!ready) {
    logger.warn({ materialId, status: material.status }, 'Material skipped the ready transition');
    return;
  }
  await jobs.markReady(materialId);

  logger.info(
    { materialId, pageCount, charCount: text.length, images: images.length },
    'Document parsed; material is ready for lesson generation on request',
  );
}
