import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { usageSnapshot } from '@/lib/plans/usage';

export const dynamic = 'force-dynamic';

/**
 * Live plan quota view for the signed-in user (constitution v2.3.0).
 * Deliberately separate from the list APIs, whose response envelope shapes
 * must not change.
 */
export const GET = route({ auth: true }, async ({ user }) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  const snapshot = await usageSnapshot(user.id, user.plan);
  return json(snapshot);
});
