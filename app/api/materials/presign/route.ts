import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { created } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { enforceUploadRateLimit } from '@/lib/security/upload-rate-limit';
import { sanitizeFilename, presignSchema } from '@/lib/validation/materials';
import { MaterialRepository, storageKeyFor } from '@/lib/db/repositories/material-repository';
import { planLimitsFor, PLAN_FAILURE_CODES } from '@/lib/plans';
import { countUserMaterials, purgeCharLimitFailures } from '@/lib/plans/usage';

export const dynamic = 'force-dynamic';

export const POST = route(
  { auth: true, verified: true, body: presignSchema },
  async ({ user, body, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    await enforceUploadRateLimit(user.id);

    const limits = planLimitsFor(user.plan);
    const used = await countUserMaterials(user.id);
    if (used >= limits.materials) {
      // Quota wall (constitution v2.3.0). Uploads that failed the character cap
      // are dead weight: the 403 informs first, then they are purged (audited),
      // so a split-upload retry fits into the freed slots.
      const purged = await purgeCharLimitFailures(user.id, correlationId);
      const remaining = used - purged;
      const message =
        purged > 0
          ? `Your ${user.plan} plan stores up to ${limits.materials} materials. ${purged} oversized upload${
              purged === 1 ? '' : 's'
            } that failed the character limit w${purged === 1 ? 'as' : 'ere'} removed to free space — ${remaining} material${
              remaining === 1 ? '' : 's'
            } remain${remaining === 1 ? 's' : ''}. Upload your split files again.`
          : `Your ${user.plan} plan stores up to ${limits.materials} materials (${used} in use). Delete a material to free a slot, or upgrade your plan.`;
      throw errors.planLimit(message, {
        reason: PLAN_FAILURE_CODES.materials,
        used: remaining,
        limit: limits.materials,
        purged,
      });
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
