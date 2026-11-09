import { NextResponse } from 'next/server';
import { CORRELATION_HEADER } from '@/lib/http/handler';
import { getCorrelationId } from '@/lib/logging/correlation';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { status: 'ok' },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        [CORRELATION_HEADER]: getCorrelationId(),
      },
    },
  );
}
