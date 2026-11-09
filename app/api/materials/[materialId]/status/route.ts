import { z } from 'zod';
import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import { serializeMaterial } from '@/lib/http/serializers';

export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({ materialId: z.string().regex(/^[a-f0-9]{24}$/) })
  .strict();

/** Lightweight polling endpoint: status plus the attempts behind the current stage. */
export const GET = route({ auth: true, params: paramsSchema }, async ({ user, params }) => {
  if (!user) throw new Error('Authenticated user missing from request context');

  const materials = new MaterialRepository(user.id);
  const jobs = new ProcessingJobRepository(user.id);

  const [material, job] = await Promise.all([
    materials.findOwnedById(params.materialId),
    jobs.findForMaterial(params.materialId),
  ]);

  if (!material || material.status === 'deleted') throw errors.notFound();

  const serialized = serializeMaterial(material);
  return json({
    ...serialized,
    attempts: job?.attempts ?? 0,
    updatedAt: material.updatedAt,
  });
});
