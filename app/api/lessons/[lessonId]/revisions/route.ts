import { z } from 'zod';
import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { listRevisions } from '@/lib/lessons/revision-service';
import { serializeRevision } from '@/lib/http/serializers';

export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({ lessonId: z.string().regex(/^[a-f0-9]{24}$/) })
  .strict();

export const GET = route({ auth: true, params: paramsSchema }, async ({ user, params }) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  const revisions = await listRevisions(user.id, params.lessonId);
  return json({ data: revisions.map(serializeRevision) });
});
