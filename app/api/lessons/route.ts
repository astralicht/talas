import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { paginationSchema } from '@/lib/validation/common';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { serializeLessonSummary } from '@/lib/http/serializers';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: true, query: paginationSchema }, async ({ user, query }) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  const repository = new LessonRepository(user.id);
  const { data, total } = await repository.listPaged(query);
  return json({
    data: data.map(serializeLessonSummary),
    page: query.page,
    limit: query.limit,
    total,
  });
});
