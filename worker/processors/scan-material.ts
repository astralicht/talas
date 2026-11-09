import { getLogger } from '@/lib/logging/logger';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import { getObjectBytes } from '@/lib/storage/s3';
import { scanBuffer } from '@/lib/security/clamav';
import { enqueueParseForMaterial } from '@/lib/jobs/material-jobs';
import { deleteObject } from '@/lib/storage/s3';
import { failureMessage } from '@/lib/materials/failure-messages';
import { auditEvents } from '@/lib/logging/audit-events';
import type { ScanMaterialJob } from '@/lib/jobs/schemas';

const logger = getLogger().child({ processor: 'scan_material' });

/**
 * Scans the stored object with ClamAV. Unclean input never reaches the parse
 * stage: infected files are quarantined and their object is deleted, and a
 * scanner outage fails closed so nothing is processed unscanned.
 */
export async function processScanMaterial(payload: ScanMaterialJob): Promise<void> {
  const { materialId, userId, correlationId } = payload;

  const materials = new MaterialRepository(userId);
  const jobs = new ProcessingJobRepository(userId);

  const claimed = await jobs.claimForStage(materialId);
  if (!claimed) {
    logger.warn({ materialId }, 'Scan stage already claimed or finished');
    return;
  }

  const material = await materials.findForWorker(materialId);
  if (!material) {
    await jobs.markFailed(materialId, 'upload_missing', 'The uploaded material no longer exists.');
    return;
  }

  const scanning = await materials.transition(materialId, ['uploaded'], 'scanning');
  if (!scanning) {
    logger.warn({ materialId, status: material.status }, 'Material skipped scan stage');
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(material.storageKey);
  } catch (error) {
    await materials.markFailed(materialId, 'upload_missing', 'The uploaded file could not be found. Upload it again.');
    await jobs.markFailed(materialId, 'upload_missing', 'The uploaded file could not be found. Upload it again.');
    logger.warn({ err: error, materialId }, 'Stored object missing during scan');
    return;
  }

  const result = await scanBuffer(bytes);

  if (result.status === 'infected') {
    await materials.markQuarantined(materialId, {
      detectedMime: material.detectedMime ?? material.declaredMime,
    });
    await jobs.markFailed(materialId, 'infected', 'The file failed the malware scan and was removed.');
    try {
      await deleteObject(material.storageKey);
    } catch (error) {
      logger.warn({ err: error, materialId }, 'Infected object could not be deleted');
    }
    await auditEvents.scanInfected({
      userId,
      correlationId,
      metadata: { materialId, signature: result.signature ?? 'unknown' },
    });
    return;
  }

  if (result.status === 'unavailable') {
    await materials.markFailed(materialId, 'scanner_unavailable', 'The file could not be scanned right now. Try again later.');
    await jobs.markFailed(materialId, 'scanner_unavailable', 'The malware scanner is unavailable.');
    await auditEvents.scanUnavailable({ userId, correlationId, metadata: { materialId } });
    return;
  }

  await materials.transition(materialId, ['scanning'], 'queued', { scanResult: 'clean' });
  await jobs.markQueued(materialId);
  await auditEvents.scanClean({ userId, correlationId, metadata: { materialId } });

  try {
    await enqueueParseForMaterial({ materialId, userId, correlationId });
  } catch (error) {
    await materials.markFailed(materialId, 'internal_error', failureMessage('internal_error'));
    await jobs.markFailed(materialId, 'internal_error', failureMessage('internal_error'));
    logger.error({ err: error, materialId }, 'Failed to enqueue parse stage');
    return;
  }
  logger.info({ materialId }, 'Material marked clean and queued for parsing');
}
