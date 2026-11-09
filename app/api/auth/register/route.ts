import { createHash } from 'node:crypto';
import { User } from '@/lib/db/models/user';
import { EmailVerificationToken } from '@/lib/db/models/email-verification-token';
import { isDuplicateKeyError } from '@/lib/db/errors';
import { hashPassword } from '@/lib/auth/password';
import { generateOpaqueToken, hashToken } from '@/lib/auth/tokens';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { getEmailService } from '@/lib/email/sender';
import { auditEvents } from '@/lib/logging/audit-events';
import { getLogger } from '@/lib/logging/logger';
import { created } from '@/lib/http/responses';
import { route } from '@/lib/http/handler';
import { errors } from '@/lib/http/errors';
import { publicUser, registerSchema } from '@/lib/validation/auth';
import { ensureDbConnection } from '@/lib/db/connection';

export const dynamic = 'force-dynamic';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function fallbackIpKey(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export const POST = route(
  { body: registerSchema },
  async ({ body, ip, userAgent, correlationId }) => {
    await ensureDbConnection();
    await enforceRateLimit(`auth:register:ip:${fallbackIpKey(ip)}`, RATE_LIMITS.AUTH_IP);

    const existing = await User.findOne({ email: body.email }).select('_id').lean().exec();
    if (existing) {
      throw errors.conflict('An account with that email address already exists.');
    }

    const passwordHash = await hashPassword(body.password);

    let user;
    try {
      user = await User.create({ email: body.email, passwordHash, status: 'active' });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw errors.conflict('An account with that email address already exists.');
      }
      throw error;
    }

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

    await auditEvents.registration({
      userId: user._id.toHexString(),
      correlationId,
      ip,
      userAgent,
    });
    await auditEvents.verificationSent({
      userId: user._id.toHexString(),
      correlationId,
      ip,
      userAgent,
    });

    return created(publicUser(user));
  },
);

