import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { LessonGenerationRequest } from '@/lib/db/models/lesson-generation-request';
import { serializeLessonGenerationRequest } from '@/lib/http/serializers';
import { requestIdParamsSchema } from '@/lib/validation/lessons';

export const dynamic = 'force-dynamic';

/**
 * Polling route for a lesson-generation request (specs/005). Tenant-scoped and
 * non-revealing: foreign or unknown request ids answer the same 404.
 */
export const GET = route(
  { auth: true, verified: true, params: requestIdParamsSchema },
  async ({ user, params }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    const request = await LessonGenerationRequest.findOne({
      _id: new Types.ObjectId(params.requestId),
      userId: user.id,
    })
      .lean()
      .exec();
    if (!request) throw errors.notFound();

    return json(serializeLessonGenerationRequest(request));
  },
);
