import { NextResponse } from 'next/server';
import { route, CORRELATION_HEADER } from '@/lib/http/handler';
import { createAccountExport, exportFilename } from '@/lib/account/export';
import { auditEvents } from '@/lib/logging/audit-events';
import { getCorrelationId } from '@/lib/logging/correlation';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: true }, async ({ user, ip, userAgent, correlationId }) => {
  if (!user) throw new Error('Authenticated user missing from request context');

  const stream = await createAccountExport(user.id);
  await auditEvents.exportRequested({
    userId: user.id,
    correlationId,
    ip,
    userAgent,
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFilename()}"`,
      'Cache-Control': 'no-store, max-age=0',
      [CORRELATION_HEADER]: getCorrelationId(),
    },
  });
});
