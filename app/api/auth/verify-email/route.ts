import { auditEvents } from '@/lib/logging/audit-events';
import { json } from '@/lib/http/responses';
import { route } from '@/lib/http/handler';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { publicUser, verifyEmailSchema } from '@/lib/validation/auth';
import { verifyEmailToken } from '@/lib/auth/verification';
import { ensureDbConnection } from '@/lib/db/connection';

export const dynamic = 'force-dynamic';

export const POST = route(
  { body: verifyEmailSchema },
  async ({ body, ip, userAgent, correlationId }) => {
    await ensureDbConnection();
    await enforceRateLimit(`auth:verify-email:ip:${ip}`, RATE_LIMITS.AUTH_IP);
    const user = await verifyEmailToken(body.token);
    await auditEvents.emailVerified({
      userId: user._id.toHexString(),
      correlationId,
      ip,
      userAgent,
    });
    return json(publicUser(user));
  },
);
