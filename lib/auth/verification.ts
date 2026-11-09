import { withTransaction } from '@/lib/db/connection';
import { User } from '@/lib/db/models/user';
import { EmailVerificationToken } from '@/lib/db/models/email-verification-token';
import { hashToken } from '@/lib/auth/tokens';
import { errors } from '@/lib/http/errors';

/**
 * Consumes a single-use email verification token inside one transaction and
 * marks the owning user verified. Invalid or expired links never reveal whether
 * an account exists.
 */
export async function verifyEmailToken(rawToken: string) {
  return withTransaction(async (session) => {
    const record = await EmailVerificationToken.findOne({
      tokenHash: hashToken(rawToken),
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .session(session)
      .exec();

    if (!record) {
      throw errors.validation(undefined, 'This verification link is invalid or has expired.');
    }

    record.consumedAt = new Date();
    await record.save({ session });

    const user = await User.findById(record.userId).session(session).exec();
    if (!user) {
      throw errors.validation(undefined, 'This verification link is invalid or has expired.');
    }

    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      if (user.status === 'disabled') user.status = 'active';
      await user.save({ session });
    }

    return user;
  });
}
