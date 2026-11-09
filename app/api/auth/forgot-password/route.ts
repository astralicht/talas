import { User } from '@/lib/db/models/user';
import { PasswordResetToken } from '@/lib/db/models/password-reset-token';
import { generateOpaqueToken, hashToken } from '@/lib/auth/tokens';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { getEmailService } from '@/lib/email/sender';
import { hashIdentifier } from '@/lib/logging/correlation';
import { auditEvents } from '@/lib/logging/audit-events';
import { getLogger } from '@/lib/logging/logger';
import { accepted } from '@/lib/http/responses';
import { route } from '@/lib/http/handler';
import { emailRequestSchema } from '@/lib/validation/auth';
import { ensureDbConnection } from '@/lib/db/connection';

export const dynamic = 'force-dynamic';

const RESET_TTL_MS = 30 * 60 * 1000;

export const POST = route(
  { body: emailRequestSchema },
  async ({ body, ip, userAgent, correlationId }) => {
    await ensureDbConnection();
    await enforceRateLimit(`auth:forgot:ip:${ip}`, RATE_LIMITS.AUTH_IP);
    await enforceRateLimit(`auth:forgot:account:${body.email}`, RATE_LIMITS.AUTH_IP);

    const user = await User.findOne({ email: body.email, status: 'active' }).exec();
    if (user) {
      await PasswordResetToken.deleteMany({ userId: user._id, consumedAt: null }).exec();
      const token = generateOpaqueToken();
      await PasswordResetToken.create({
        userId: user._id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
        requestedIpHash: hashIdentifier(ip),
      });
      try {
        await getEmailService().sendPasswordResetEmail(user.email, token);
      } catch (error) {
        getLogger().error({ err: error, userId: user._id.toHexString() }, 'Reset email failed');
      }
      await auditEvents.passwordResetRequested({
        userId: user._id.toHexString(),
        correlationId,
        ip,
        userAgent,
      });
    }

    return accepted({ status: 'accepted' });
  },
);
