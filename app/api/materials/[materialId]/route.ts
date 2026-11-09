import { z } from 'zod';
import { route } from '@/lib/http/handler';
import { json, noContent } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { deleteMaterialCascade } from '@/lib/materials/delete-service';
import { serializeMaterial } from '@/lib/http/serializers';
import { auditEvents } from '@/lib/logging/audit-events';

export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({ materialId: z.string().regex(/^[a-f0-9]{24}$/) })
  .strict();

export const GET = route({ auth: true, params: paramsSchema }, async ({ user, params }) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  const repository = new MaterialRepository(user.id);
  const material = await repository.findOwnedById(params.materialId);
  if (!material || material.status === 'deleted') throw errors.notFound();
  return json(serializeMaterial(material));
});

export const DELETE = route(
  { auth: true, csrf: true, params: paramsSchema },
  async ({ user, params, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    const repository = new MaterialRepository(user.id);
    const material = await repository.findOwnedById(params.materialId);
    if (!material || material.status === 'deleted') throw errors.notFound();

    await deleteMaterialCascade(user.id, params.materialId);
    await auditEvents.materialDeleted({
      userId: user.id,
      correlationId,
      metadata: { materialId: params.materialId },
    });

    return noContent();
  },
);
