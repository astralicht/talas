import { requireUser, type AuthenticatedUser } from './session';
import { errors } from '@/lib/http/errors';

export async function requireVerified(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!user.emailVerified) throw errors.unverified();
  return user;
}

export async function assertVerified(user: AuthenticatedUser): Promise<void> {
  if (!user.emailVerified) throw errors.unverified();
}
