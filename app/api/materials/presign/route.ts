import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { created } from '@/lib/http/responses';
import { enforceUploadRateLimit } from '@/lib/security/upload-rate-limit';
import { createPresignedUpload } from '@/lib/storage/s3';
import { sanitizeFilename, presignSchema } from '@/lib/validation/materials';
import { MaterialRepository, storageKeyFor } from '@/lib/db/repositories/material-repository';

export const dynamic = 'force-dynamic';

export const POST = route(
  { auth: true, verified: true, body: presignSchema },
  async ({ user, body }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    await enforceUploadRateLimit(user.id);

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

    const presigned = await createPresignedUpload({
      key: storageKey,
      contentType: body.declaredMime,
      contentLength: body.sizeBytes,
    });

    return created({
      materialId: material._id.toHexString(),
      uploadUrl: presigned.uploadUrl,
      method: presigned.method,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt,
    });
  },
);
