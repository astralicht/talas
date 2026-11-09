import { route } from '@/lib/http/handler';
import { accepted, json } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { paginationSchema } from '@/lib/validation/common';
import { confirmMaterialSchema } from '@/lib/validation/materials';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import { enqueueScanForMaterial } from '@/lib/jobs/material-jobs';
import { enforceUploadRateLimit } from '@/lib/security/upload-rate-limit';
import { headObject, getObjectBytes } from '@/lib/storage/s3';
import { detectAndVerifyMime } from '@/lib/storage/verify-object';
import { serializeMaterial } from '@/lib/http/serializers';
import { auditEvents } from '@/lib/logging/audit-events';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: true, query: paginationSchema }, async ({ user, query }) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  const repository = new MaterialRepository(user.id);
  const { data, total } = await repository.listPaged(query);
  return json({
    data: data.map(serializeMaterial),
    page: query.page,
    limit: query.limit,
    total,
  });
});

class ConfirmFailure extends Error {
  constructor(
    readonly code: 'upload_expired' | 'upload_missing' | 'size_mismatch' | 'mime_mismatch',
    readonly safeMessage: string,
  ) {
    super(code);
    this.name = 'ConfirmFailure';
  }
}

/**
 * Confirms that the object declared at presign is in storage, verifies its size
 * and magic-byte media type, and hands the material to the scan stage. Failures
 * are persisted on the material so the UI can show actionable reasons.
 */
export const POST = route(
  { auth: true, verified: true, body: confirmMaterialSchema },
  async ({ user, body, ip, userAgent, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    await enforceUploadRateLimit(user.id);

    const materials = new MaterialRepository(user.id);
    const material = await materials.findOwnedById(body.materialId);
    if (!material || material.status === 'deleted') throw errors.notFound();

    if (material.status !== 'awaiting_upload') {
      throw errors.conflict('The upload has already been confirmed.');
    }

    let detectedMime: string;
    try {
      const head = await headObject(material.storageKey);
      if (head.ContentLength !== material.sizeBytes) {
        throw new ConfirmFailure('size_mismatch', 'The uploaded file size did not match the declared size.');
      }
      const bytes = await getObjectBytes(material.storageKey, material.sizeBytes);
      detectedMime = await detectAndVerifyMime({
        filename: material.originalFilename,
        declaredMime: material.declaredMime,
        buffer: bytes,
      });
    } catch (error) {
      let failure: ConfirmFailure;
      if (error instanceof ConfirmFailure) {
        failure = error;
      } else if ((error as { name?: unknown } | null)?.name === 'NotFound') {
        failure = new ConfirmFailure('upload_missing', 'The uploaded file could not be found. Upload it again.');
      } else if (
        (error as { code?: unknown } | null)?.code === 'unsupported_media_type' ||
        (error as { code?: unknown } | null)?.code === 'payload_too_large'
      ) {
        failure = new ConfirmFailure('mime_mismatch', 'The file content does not match its extension or declared type.');
      } else if (material.uploadExpiresAt.getTime() < Date.now()) {
        failure = new ConfirmFailure('upload_expired', 'The upload window expired. Start the upload again.');
      } else {
        failure = new ConfirmFailure('mime_mismatch', 'The file could not be verified. Upload it again.');
      }

      await materials.markFailed(material._id.toHexString(), failure.code, failure.safeMessage);

      if (failure.code === 'mime_mismatch') {
        throw errors.unsupportedMedia(failure.safeMessage);
      }
      throw errors.conflict(failure.safeMessage);
    }

    const confirmed = await materials.transition(
      material._id.toHexString(),
      ['awaiting_upload'],
      'uploaded',
      { detectedMime },
    );
    if (!confirmed) {
      throw errors.conflict('The upload has already been confirmed.');
    }

    const jobs = new ProcessingJobRepository(user.id);
    await jobs.ensureForMaterial(confirmed._id.toHexString());

    try {
      await enqueueScanForMaterial({
        materialId: confirmed._id.toHexString(),
        userId: user.id,
        correlationId,
      });
    } catch (error) {
      // Revert so the user can confirm again instead of leaving a stuck material.
      await materials.transition(confirmed._id.toHexString(), ['uploaded'], 'awaiting_upload', {
        detectedMime: null,
      });
      throw errors.unavailable(
        'Processing is temporarily unavailable. Try confirming the upload again.',
        error,
      );
    }

    await auditEvents.uploadConfirmed({
      userId: user.id,
      correlationId,
      ip,
      userAgent,
      metadata: { materialId: confirmed._id.toHexString() },
    });

    return accepted(serializeMaterial(confirmed));
  },
);
