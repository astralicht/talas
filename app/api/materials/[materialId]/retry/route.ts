import { z } from 'zod';
import { route } from '@/lib/http/handler';
import { accepted } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import {
  enqueueScanForMaterial,
  enqueueParseForMaterial,
  enqueueGenerateForMaterial,
} from '@/lib/jobs/material-jobs';
import { enforceUploadRateLimit } from '@/lib/security/upload-rate-limit';
import { serializeMaterial } from '@/lib/http/serializers';
import { auditEvents } from '@/lib/logging/audit-events';
import { RETRYABLE_FAILURES } from '@/lib/materials/failure-messages';

export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({ materialId: z.string().regex(/^[a-f0-9]{24}$/) })
  .strict();

type Stage = 'scan' | 'parse' | 'generate';

/** The material state each stage expects to resume from. */
const STAGE_SOURCE_STATUS: Record<Stage, 'uploaded' | 'queued' | 'processing'> = {
  scan: 'uploaded',
  parse: 'queued',
  generate: 'processing',
};

/**
 * Picks the stage a retry should restart from, based on what already succeeded:
 * clean scans skip straight to parsing, parsed documents skip straight to
 * generation, and everything else restarts the pipeline.
 */
function stageForRetry(material: {
  scanResult: string;
  charCount: number | null;
  pageCount: number | null;
  failureCode: string | null;
}): Stage {
  if (material.failureCode === 'scanner_unavailable') {
    return 'scan';
  }
  const parsed =
    material.scanResult === 'clean' &&
    material.charCount !== null &&
    material.pageCount !== null;
  if (!parsed) {
    return material.scanResult === 'clean' ? 'parse' : 'scan';
  }
  if (
    material.failureCode === 'generation_failed' ||
    material.failureCode === 'provider_unavailable' ||
    material.failureCode === 'malformed_model_output' ||
    material.failureCode === 'budget_exceeded'
  ) {
    return 'generate';
  }
  return 'parse';
}

export const POST = route({ auth: true, verified: true, csrf: true, params: paramsSchema }, async ({
  user,
  params,
  correlationId,
}) => {
  if (!user) throw new Error('Authenticated user missing from request context');

  await enforceUploadRateLimit(user.id);

  const materials = new MaterialRepository(user.id);
  const material = await materials.findOwnedById(params.materialId);
  if (!material || material.status === 'deleted') throw errors.notFound();

  if (material.status !== 'failed') {
    throw errors.conflict('Only failed materials can be retried.');
  }
  if (!material.failureCode || !RETRYABLE_FAILURES.has(material.failureCode as never)) {
    throw errors.conflict('This failure cannot be retried. Upload the file again.');
  }

  const stage = stageForRetry(material);

  const jobs = new ProcessingJobRepository(user.id);
  await jobs.markQueuedForRetry(params.materialId);

  const queued = await materials.transition(
    material._id.toHexString(),
    ['failed'],
    STAGE_SOURCE_STATUS[stage],
    { failureCode: null, failureMessage: null },
  );
  if (!queued) throw errors.conflict('The material is already being retried.');

  const context = {
    materialId: queued._id.toHexString(),
    userId: user.id,
    correlationId,
  };
  if (stage === 'scan') await enqueueScanForMaterial(context);
  else if (stage === 'parse') await enqueueParseForMaterial(context);
  else await enqueueGenerateForMaterial(context);

  await auditEvents.materialRetry({
    userId: user.id,
    correlationId,
    metadata: { materialId: context.materialId, stage },
  });

  return accepted(serializeMaterial(queued));
});
