import { getLogger } from '@/lib/logging/logger';
import { User } from '@/lib/db/models/user';
import { Material } from '@/lib/db/models/material';
import { ProcessingJob } from '@/lib/db/models/processing-job';
import { Lesson } from '@/lib/db/models/lesson';
import { LessonRevision } from '@/lib/db/models/lesson-revision';
import { RefreshToken } from '@/lib/db/models/refresh-token';
import { EmailVerificationToken } from '@/lib/db/models/email-verification-token';
import { PasswordResetToken } from '@/lib/db/models/password-reset-token';
import { AccountDeletionRequest } from '@/lib/db/models/account-deletion-request';
import { deleteObjectPrefix } from '@/lib/storage/s3';
import { auditEvents } from '@/lib/logging/audit-events';
import type { DeleteAccountJob } from '@/lib/jobs/schemas';

const logger = getLogger().child({ processor: 'delete_account' });

const MAX_DELETION_ATTEMPTS = 3;

/**
 * Cascade deletion for a closed account. Removes materials, lessons, revisions,
 * processing jobs, stored objects, and authentication tokens, then anonymizes
 * the user row so no personal data remains while audit IDs stay meaningful.
 */
export async function processDeleteAccount(payload: DeleteAccountJob): Promise<void> {
  const { userId, requestId } = payload;

  const request = await AccountDeletionRequest.findOne({ _id: requestId, userId }).exec();
  if (!request) {
    logger.warn({ userId, requestId }, 'Deletion request not found');
    return;
  }
  if (request.status === 'completed') return;

  if (request.attempts >= MAX_DELETION_ATTEMPTS) {
    logger.warn({ userId, requestId }, 'Deletion attempts exhausted');
    return;
  }

  await AccountDeletionRequest.updateOne(
    { _id: requestId },
    {
      $set: { status: 'processing', startedAt: new Date() },
      $inc: { attempts: 1 },
    },
  ).exec();

  try {
    await deleteObjectPrefix(`materials/${userId}/`);
  } catch (error) {
    logger.warn({ err: error, userId }, 'Storage cleanup failed during account deletion');
  }

  await Material.deleteMany({ userId }).exec();
  await ProcessingJob.deleteMany({ userId }).exec();
  await Lesson.deleteMany({ userId }).exec();
  await LessonRevision.deleteMany({ userId }).exec();
  await RefreshToken.deleteMany({ userId }).exec();
  await EmailVerificationToken.deleteMany({ userId }).exec();
  await PasswordResetToken.deleteMany({ userId }).exec();

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        email: `deleted-${userId}@deleted.invalid`,
        passwordHash: `deleted:${userId}`,
        emailVerifiedAt: null,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        status: 'deleted',
        deletedAt: new Date(),
      },
    },
  ).exec();

  await AccountDeletionRequest.updateOne(
    { _id: requestId },
    { $set: { status: 'completed', completedAt: new Date(), failureCode: null } },
  ).exec();

  await auditEvents.accountDeleted({ userId, correlationId: payload.correlationId });
  logger.info({ userId }, 'Account deletion cascade completed');
}
