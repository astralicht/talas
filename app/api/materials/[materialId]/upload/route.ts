import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { materialIdParamsSchema } from '@/lib/validation/materials';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { MAX_UPLOAD_BYTES } from '@/lib/db/models/material';
import { putObject } from '@/lib/storage/object-store';

export const dynamic = 'force-dynamic';

const paramsSchema = materialIdParamsSchema;

/**
 * Commits the bytes for a material created by presign (constitution v2.4.0):
 * the browser PUTs the file here and the server writes it into the object
 * store, so the flow works identically on localhost and through the dev
 * tunnel — the store itself stays unreachable from browsers.
 *
 * Guards mirror the presigned transport it replaces: tenant ownership,
 * `awaiting_upload` status, an unexpired upload window, and the exact byte
 * size declared at presign (checked on the header for a fast fail and again
 * on the buffered body, which is authoritative). Confirm still verifies the
 * stored object's size and magic bytes.
 */
export const PUT = route(
  { auth: true, verified: true, csrf: true, params: paramsSchema },
  async ({ user, params, request }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    const repository = new MaterialRepository(user.id);
    const material = await repository.findOwnedById(params.materialId);
    if (!material || material.status === 'deleted') throw errors.notFound();
    if (material.status !== 'awaiting_upload') {
      throw errors.conflict('This upload has already been received.');
    }
    if (material.uploadExpiresAt.getTime() < Date.now()) {
      throw errors.conflict('The upload window expired. Start the upload again.');
    }

    const declared = material.sizeBytes;
    const headerLength = Number(request.headers.get('content-length') ?? NaN);
    if (!Number.isInteger(headerLength) || headerLength < 1) {
      throw errors.validation(undefined, 'The request must carry the file body.');
    }
    if (headerLength > MAX_UPLOAD_BYTES) {
      throw errors.payloadTooLarge('Files must be 150 MB or smaller.');
    }
    if (headerLength !== declared) {
      throw errors.validation(
        undefined,
        'The uploaded file size did not match the declared size.',
      );
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength !== declared) {
      throw errors.validation(
        undefined,
        'The uploaded file size did not match the declared size.',
      );
    }

    // declaredMime is a validated allowed type from the presign schema.
    await putObject({
      key: material.storageKey,
      body: bytes,
      contentType: material.declaredMime,
    });

    return json({ ok: true });
  },
);
