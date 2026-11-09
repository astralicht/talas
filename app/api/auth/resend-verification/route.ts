import { User } from '@/lib/db/models/user';
import { EmailVerificationToken } from '@/lib/db/models/email-verification-token';
import { generateOpaqueToken, hashToken } from '@/lib/auth/tokens';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { getEmailService } from '@/lib/email/sender';
import { auditEvents } from '@/lib/logging/audit-events';
import { getLogger } from '@/lib/logging/logger';
import { accepted } from '@/lib/http/responses';
import { route } from '@/lib/http/handler';
import { emailRequestSchema } from '@/lib/validation/auth';
import { ensureDbConnection } from '@/lib/db/connection';

export const dynamic = 'force-dynamic';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export const POST = route(
  { body: emailRequestSchema },
  async ({ body, ip, userAgent, correlationId }) => {
    await ensureDbConnection();
    await enforceRateLimit(`auth:resend-verification:ip:${ip}`, RATE_LIMITS.AUTH_IP);
    await enforceRateLimit(`auth:resend-verification:account:${body.email}`, RATE_LIMITS.AUTH_IP);

    const user = await User.findOne({ email: body.email, status: { $ne: 'deleted' } }).exec();
    if (user && !user.emailVerifiedAt) {
      await EmailVerificationToken.deleteMany({ userId: user._id, consumedAt: null }).exec();
      const token = generateOpaqueToken();
      await EmailVerificationToken.create({
        userId: user._id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      });
      try {
        await getEmailService().sendVerificationEmail(user.email, token);
      } catch (error) {
        getLogger().error({ err: error, userId: user._id.toHexString() }, 'Verification email failed');
      }
      await auditEvents.verificationSent({
        userId: user._id.toHexString(),
        correlationId,
        ip,
        userAgent,
      });
    }

    return accepted({ status: 'queued' });
  },
);
