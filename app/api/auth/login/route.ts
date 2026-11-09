import { User } from '@/lib/db/models/user';
import { ensureDbConnection } from '@/lib/db/connection';
import { errors } from '@/lib/http/errors';
import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { verifyPassword } from '@/lib/auth/password';
import { signAccessToken } from '@/lib/auth/tokens';
import { issueRefreshToken } from '@/lib/auth/refresh';
import { issueAndStoreCsrfToken } from '@/lib/auth/csrf';
import { setAccessCookie, setRefreshCookie } from '@/lib/auth/cookies';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { auditEvents } from '@/lib/logging/audit-events';
import { loginSchema, publicUser } from '@/lib/validation/auth';

export const dynamic = 'force-dynamic';

const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export const POST = route(
  { body: loginSchema },
  async ({ body, ip, userAgent, correlationId }) => {
    await ensureDbConnection();
    await enforceRateLimit(`auth:login:ip:${ip}`, RATE_LIMITS.AUTH_IP);

    const user = await User.findOne({ email: body.email })
      .select('+passwordHash')
      .exec();

    if (!user || user.status === 'deleted' || user.status === 'deleting') {
      await auditEvents.signInFailed({
        userId: user?._id.toHexString() ?? null,
        correlationId,
        ip,
        userAgent,
        metadata: { reason: 'unknown_or_blocked_account' },
      });
      throw errors.unauthorized('Email or password is incorrect.');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const retryAfter = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
      await auditEvents.accountLocked({
        userId: user._id.toHexString(),
        correlationId,
        ip,
        userAgent,
      });
      throw errors.rateLimited(retryAfter, 'This account is temporarily locked. Try again later.');
    }

    const valid = await verifyPassword(user.passwordHash, body.password);
    if (!valid) {
      const failures = user.failedLoginAttempts + 1;
      user.failedLoginAttempts = failures;
      if (failures >= MAX_FAILURES) {
        user.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
        user.failedLoginAttempts = 0;
      }
      await user.save();
      await auditEvents.signInFailed({
        userId: user._id.toHexString(),
        correlationId,
        ip,
        userAgent,
        metadata: { failures },
      });
      if (user.lockedUntil) {
        await auditEvents.accountLocked({
          userId: user._id.toHexString(),
          correlationId,
          ip,
          userAgent,
        });
      }
      throw errors.unauthorized('Email or password is incorrect.');
    }

    if (user.status !== 'active') {
      await auditEvents.signInFailed({
        userId: user._id.toHexString(),
        correlationId,
        ip,
        userAgent,
        metadata: { reason: `status_${user.status}` },
      });
      throw errors.unauthorized('Email or password is incorrect.');
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    const accessToken = await signAccessToken({
      userId: user._id.toHexString(),
      email: user.email,
    });
    const refresh = await issueRefreshToken(user._id, { ip, userAgent });
    const csrfToken = await issueAndStoreCsrfToken();

    await setAccessCookie(accessToken);
    await setRefreshCookie(refresh.token);

    await auditEvents.signIn({
      userId: user._id.toHexString(),
      correlationId,
      ip,
      userAgent,
    });

    return json({ user: publicUser(user), csrfToken });
  },
);
