import { z } from 'zod';
import { route } from '@/lib/http/handler';
import { json, noContent } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { lessonSaveSchema } from '@/lib/validation/lessons';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { deleteMaterialCascade } from '@/lib/materials/delete-service';
import { saveLesson } from '@/lib/lessons/save-service';
import { serializeLesson, serializeRevision } from '@/lib/http/serializers';
import { auditEvents } from '@/lib/logging/audit-events';

export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({ lessonId: z.string().regex(/^[a-f0-9]{24}$/) })
  .strict();

export const GET = route({ auth: true, params: paramsSchema }, async ({ user, params }) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  const repository = new LessonRepository(user.id);
  const lesson = await repository.findOwnedById(params.lessonId);
  if (!lesson) throw errors.notFound();
  return json(serializeLesson(lesson));
});

export const PATCH = route(
  { auth: true, csrf: true, params: paramsSchema, body: lessonSaveSchema },
  async ({ user, params, body, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    const result = await saveLesson(user.id, params.lessonId, {
      version: body.version,
      title: body.title,
      contentMarkdown: body.contentMarkdown,
      authorType: 'user',
    });

    await auditEvents.lessonSaved({
      userId: user.id,
      correlationId,
      metadata: { lessonId: params.lessonId, version: result.lesson.version },
    });

    return json({
      lesson: serializeLesson(result.lesson),
      revision: serializeRevision(result.revision),
    });
  },
);

export const DELETE = route({ auth: true, csrf: true, params: paramsSchema }, async ({
  user,
  params,
  correlationId,
}) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  const repository = new LessonRepository(user.id);
  const lesson = await repository.findOwnedById(params.lessonId);
  if (!lesson) throw errors.notFound();

  // Lessons are derived from materials, so deleting a lesson deletes the
  // material and everything derived from it — same cascade, same 204.
  await deleteMaterialCascade(user.id, lesson.materialId.toHexString());
  await auditEvents.lessonDeleted({
    userId: user.id,
    correlationId,
    metadata: { lessonId: params.lessonId },
  });

  return noContent();
});
