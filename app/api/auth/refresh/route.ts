import { User } from '@/lib/db/models/user';
import { errors } from '@/lib/http/errors';
import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { signAccessToken } from '@/lib/auth/tokens';
import {
  RefreshTokenReuseError,
  revokeAllForUser,
  rotateRefreshToken,
} from '@/lib/auth/refresh';
import { issueAndStoreCsrfToken } from '@/lib/auth/csrf';
import {
  clearAuthCookies,
  readCookie,
  REFRESH_COOKIE,
  setAccessCookie,
  setRefreshCookie,
} from '@/lib/auth/cookies';
import { auditEvents } from '@/lib/logging/audit-events';
import { publicUser } from '@/lib/validation/auth';

export const dynamic = 'force-dynamic';

export const POST = route({ csrf: true }, async ({ ip, userAgent, correlationId }) => {
  const rawRefresh = await readCookie(REFRESH_COOKIE);
  if (!rawRefresh) {
    await clearAuthCookies();
    throw errors.unauthorized('Your session has expired. Sign in again.');
  }

  let rotated;
  try {
    rotated = await rotateRefreshToken(rawRefresh, { ip, userAgent });
  } catch (error) {
    await clearAuthCookies();
    if (error instanceof RefreshTokenReuseError) {
      await auditEvents.refreshReuse({
        userId: null,
        correlationId,
        ip,
        userAgent,
        metadata: { tokenId: error.reusedTokenId },
      });
    }
    throw error;
  }

  const user = await User.findById(rotated.userId).exec();
  if (!user || user.status !== 'active') {
    await revokeAllForUser(rotated.userId);
    await clearAuthCookies();
    throw errors.unauthorized('Your session has expired. Sign in again.');
  }

  const accessToken = await signAccessToken({
    userId: user._id.toHexString(),
    email: user.email,
  });
  const csrfToken = await issueAndStoreCsrfToken();
  await setAccessCookie(accessToken);
  await setRefreshCookie(rotated.token);

  await auditEvents.tokenRefresh({
    userId: user._id.toHexString(),
    correlationId,
    ip,
    userAgent,
  });

  return json({ user: publicUser(user), csrfToken });
});
