import { Types } from 'mongoose';
import { ensureDbConnection } from '@/lib/db/connection';
import { User } from '@/lib/db/models/user';
import { errors } from '@/lib/http/errors';
import { readCookie, ACCESS_COOKIE } from './cookies';
import { verifyAccessToken } from './tokens';

export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  status: 'active' | 'disabled' | 'deleting' | 'deleted';
}

const BLOCKED_STATUSES = new Set(['disabled', 'deleting', 'deleted']);

export async function getSessionUser(): Promise<AuthenticatedUser | null> {
  await ensureDbConnection();
  const token = await readCookie(ACCESS_COOKIE);
  if (!token) return null;

  let claims: { userId: string; email: string };
  try {
    claims = await verifyAccessToken(token);
  } catch {
    return null;
  }

  if (!Types.ObjectId.isValid(claims.userId)) return null;

  const user = await User.findById(claims.userId)
    .select('email emailVerifiedAt status createdAt')
    .lean()
    .exec();

  if (!user) return null;
  if (BLOCKED_STATUSES.has(user.status)) return null;

  return {
    id: user._id.toHexString(),
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    createdAt: user.createdAt,
    status: user.status,
  };
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getSessionUser();
  if (!user) throw errors.unauthorized();
  return user;
}

export async function requireVerifiedUser(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!user.emailVerified) throw errors.unverified();
  return user;
}

export function isBlockedStatus(status: string): boolean {
  return BLOCKED_STATUSES.has(status);
}
