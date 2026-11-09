import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { restoreRevisionSchema, revisionIdParamsSchema } from '@/lib/validation/lessons';
import { restoreRevision } from '@/lib/lessons/revision-service';
import { serializeLesson, serializeRevision } from '@/lib/http/serializers';
import { auditEvents } from '@/lib/logging/audit-events';

export const dynamic = 'force-dynamic';

const paramsSchema = revisionIdParamsSchema;

export const POST = route(
  {
    auth: true,
    csrf: true,
    params: paramsSchema,
    body: restoreRevisionSchema,
  },
  async ({ user, params, body, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    const result = await restoreRevision(
      user.id,
      params.lessonId,
      params.revisionId,
      body.version,
    );

    await auditEvents.revisionRestored({
      userId: user.id,
      correlationId,
      metadata: {
        lessonId: params.lessonId,
        restoredFrom: body.version,
        newVersion: result.lesson.version,
      },
    });

    return json({
      lesson: serializeLesson(result.lesson),
      revision: serializeRevision(result.revision),
    });
  },
);
