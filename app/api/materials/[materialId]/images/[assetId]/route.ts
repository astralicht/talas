import { z } from 'zod';
import { Types } from 'mongoose';
import type { NextResponse } from 'next/server';
import { route } from '@/lib/http/handler';
import { errors } from '@/lib/http/errors';
import { MaterialAsset } from '@/lib/db/models/material-asset';
import { getObjectBytes } from '@/lib/storage/s3';

export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({
    materialId: z.string().regex(/^[a-f0-9]{24}$/),
    assetId: z.string().regex(/^[a-f0-9]{24}$/),
  })
  .strict();

/**
 * Serves one extracted image asset (specs/005 FR-008). Tenant-scoped: the
 * asset row must belong to the session user; anything else answers the same
 * non-revealing 404. Responses are private — no shared caches.
 */
export const GET = route({ auth: true, params: paramsSchema }, async ({ user, params }) => {
  if (!user) throw new Error('Authenticated user missing from request context');

  const asset = await MaterialAsset.findOne({
    _id: new Types.ObjectId(params.assetId),
    userId: user.id,
    materialId: new Types.ObjectId(params.materialId),
  })
    .lean<{ assetKey: string; contentType: string } | null>()
    .exec();
  if (!asset) throw errors.notFound();

  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(asset.assetKey);
  } catch {
    throw errors.notFound();
  }

  const response = new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': asset.contentType,
      'Content-Length': String(bytes.byteLength),
      // Private: the bytes are tenant-scoped; never shared or CDN-cached.
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  }) as NextResponse;
  return response;
});
