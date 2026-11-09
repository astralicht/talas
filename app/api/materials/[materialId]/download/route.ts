import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route, CORRELATION_HEADER } from '@/lib/http/handler';
import { errors } from '@/lib/http/errors';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { sanitizeFilename } from '@/lib/validation/materials';
import { getObjectBytes } from '@/lib/storage/s3';
import { auditEvents } from '@/lib/logging/audit-events';
import { getCorrelationId } from '@/lib/logging/correlation';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ materialId: z.string().regex(/^[a-f0-9]{24}$/) }).strict();

/** Statuses whose stored object may be handed back to the owner. */
const DOWNLOADABLE_STATUSES: ReadonlySet<string> = new Set([
  'awaiting_upload',
  'uploaded',
  'scanning',
  'queued',
  'processing',
  'ready',
  'failed',
]);

/**
 * Streams the original uploaded file to its owner as a download. Quarantined
 * (malware-flagged) and deleted materials are never served back.
 */
export const GET = route(
  { auth: true, params: paramsSchema },
  async ({ user, params, ip, userAgent, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    const repository = new MaterialRepository(user.id);
    const material = await repository.findOwnedById(params.materialId);
    if (!material || !DOWNLOADABLE_STATUSES.has(material.status)) throw errors.notFound();

    const bytes = await getObjectBytes(material.storageKey);

    // Header-safe filename: already sanitized at upload, but re-apply for defense
    // and strip header metacharacters that could split the Content-Disposition.
    const filename = sanitizeFilename(material.originalFilename).replace(/["\\]/g, '');

    await auditEvents.materialDownloaded({
      userId: user.id,
      correlationId,
      ip,
      userAgent,
      metadata: { materialId: material._id.toHexString() },
    });

    const contentType = material.detectedMime ?? material.declaredMime;

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Never renegotiate: the object is served exactly as scanned/detected.
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, max-age=0',
        [CORRELATION_HEADER]: getCorrelationId(),
      },
    });
  },
);
