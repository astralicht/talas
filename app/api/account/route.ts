import { withTransaction } from '@/lib/db/connection';
import { AccountDeletionRequest } from '@/lib/db/models/account-deletion-request';
import { User } from '@/lib/db/models/user';
import { isDuplicateKeyError } from '@/lib/db/errors';
import { revokeAllForUser } from '@/lib/auth/refresh';
import { clearAuthCookies } from '@/lib/auth/cookies';
import { enqueueAccountDeletionJob } from '@/lib/jobs/queues';
import { auditEvents } from '@/lib/logging/audit-events';
import { accepted } from '@/lib/http/responses';
import { route } from '@/lib/http/handler';
import { errors } from '@/lib/http/errors';

export const dynamic = 'force-dynamic';

export const DELETE = route({ auth: true }, async ({ user, ip, userAgent, correlationId }) => {
  if (!user) throw new Error('Authenticated user missing from request context');

  let request;
  try {
    request = await withTransaction(async (session) => {
      const existing = await AccountDeletionRequest.findOne({ userId: user.id })
        .session(session)
        .exec();
      if (existing && existing.status !== 'failed') {
        throw errors.conflict('Account deletion has already been requested.');
      }

      const created = await AccountDeletionRequest.create(
        [
          {
            userId: user.id,
            status: 'queued',
            attempts: 0,
            requestedAt: new Date(),
          },
        ],
        { session },
      );

      const record = created[0];
      if (!record) throw new Error('Account deletion request could not be created');

      await User.updateOne(
        { _id: user.id },
        { $set: { status: 'deleting' } },
        { session },
      ).exec();
      await revokeAllForUser(user.id, session);
      return record;
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw errors.conflict('Account deletion has already been requested.');
    }
    throw error;
  }

  await enqueueAccountDeletionJob({
    type: 'delete_account',
    userId: user.id,
    requestId: request._id.toHexString(),
    correlationId,
  });

  await auditEvents.accountDeletionRequested({
    userId: user.id,
    correlationId,
    ip,
    userAgent,
  });

  await clearAuthCookies();

  return accepted({
    status: request.status,
    requestedAt: request.requestedAt,
  });
});
