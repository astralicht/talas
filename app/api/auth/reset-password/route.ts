import { withTransaction, ensureDbConnection } from '@/lib/db/connection';
import { PasswordResetToken } from '@/lib/db/models/password-reset-token';
import { User } from '@/lib/db/models/user';
import { hashToken } from '@/lib/auth/tokens';
import { hashPassword } from '@/lib/auth/password';
import { revokeAllForUser } from '@/lib/auth/refresh';
import { clearAuthCookies } from '@/lib/auth/cookies';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { auditEvents } from '@/lib/logging/audit-events';
import { errors } from '@/lib/http/errors';
import { json } from '@/lib/http/responses';
import { route } from '@/lib/http/handler';
import { resetPasswordSchema } from '@/lib/validation/auth';

export const dynamic = 'force-dynamic';

export const POST = route(
  { body: resetPasswordSchema },
  async ({ body, ip, userAgent, correlationId }) => {
    await ensureDbConnection();
    await enforceRateLimit(`auth:reset:ip:${ip}`, RATE_LIMITS.AUTH_IP);

    const passwordHash = await hashPassword(body.password);

    const user = await withTransaction(async (session) => {
      const record = await PasswordResetToken.findOne({
        tokenHash: hashToken(body.token),
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      })
        .session(session)
        .exec();

      if (!record) {
        throw errors.validation(undefined, 'This reset link is invalid or has expired.');
      }

      record.consumedAt = new Date();
      await record.save({ session });

      const user = await User.findById(record.userId).session(session).exec();
      if (!user || user.status === 'deleted') {
        throw errors.validation(undefined, 'This reset link is invalid or has expired.');
      }

      user.passwordHash = passwordHash;
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      await user.save({ session });
      await revokeAllForUser(user._id, session);

      return user;
    });

    await clearAuthCookies();
    await auditEvents.passwordResetCompleted({
      userId: user._id.toHexString(),
      correlationId,
      ip,
      userAgent,
    });

    return json({ status: 'ok' });
  },
);
