import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: true }, async ({ user }) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  return json({
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  });
});

