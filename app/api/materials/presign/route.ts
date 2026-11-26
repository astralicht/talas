import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { created } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { enforceUploadRateLimit } from '@/lib/security/upload-rate-limit';
import { sanitizeFilename, presignSchema } from '@/lib/validation/materials';
import { MaterialRepository, storageKeyFor } from '@/lib/db/repositories/material-repository';
import { planLimitsFor, PLAN_FAILURE_CODES } from '@/lib/plans';
import { sumUserStorageBytes, purgeCharLimitFailures, purgeExpiredUploads } from '@/lib/plans/usage';

export const dynamic = 'force-dynamic';

export const POST = route(
  { auth: true, verified: true, body: presignSchema },
  async ({ user, body, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    await enforceUploadRateLimit(user.id);

    const limits = planLimitsFor(user.plan);
    const usedBytes = await sumUserStorageBytes(user.id);
    if (usedBytes + body.sizeBytes > limits.storageBytes) {
      const purgedExpired = await purgeExpiredUploads(user.id, correlationId);
      const purgedFailed = await purgeCharLimitFailures(user.id, correlationId);
      const purged = purgedExpired + purgedFailed;
      const remainingBytes = await sumUserStorageBytes(user.id);
      const toGB = (b: number) => (b / (1024 * 1024 * 1024)).toFixed(2);
      if (remainingBytes + body.sizeBytes > limits.storageBytes) {
        throw errors.planLimit(
          purged > 0
            ? `Your ${user.plan} plan stores up to ${toGB(limits.storageBytes)} GB of materials. ${purged} stale oversized upload${purged === 1 ? '' : 's'} w${purged === 1 ? 'as' : 'ere'} removed — ${toGB(remainingBytes)} GB in use. Try the upload again.`
            : `Your ${user.plan} plan stores up to ${toGB(limits.storageBytes)} GB of materials (${toGB(remainingBytes)} GB in use). Delete a material to free space, or upgrade your plan.`,
          {
            reason: PLAN_FAILURE_CODES.storage,
            used: remainingBytes,
            limit: limits.storageBytes,
            purged,
          },
        );
      }
    }

    const filename = sanitizeFilename(body.filename);
    const repository = new MaterialRepository(user.id);

    const materialId = new Types.ObjectId();
    const storageKey = storageKeyFor(user.id, materialId);
    const uploadExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const material = await repository.createForUpload(
      {
        originalFilename: filename,
        storageKey,
        declaredMime: body.declaredMime,
        sizeBytes: body.sizeBytes,
        uploadExpiresAt,
      },
      materialId,
    );

    return created({
      materialId: material._id.toHexString(),
      // The upload window: the confirm step rejects uploads after this instant.
      expiresAt: uploadExpiresAt,
    });
  },
);
