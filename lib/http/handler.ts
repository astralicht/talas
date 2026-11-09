import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { errorResponse } from './responses';
import { AppError, errors } from './errors';
import { getCorrelationId, newCorrelationId, runWithCorrelation } from '@/lib/logging/correlation';
import { getLogger } from '@/lib/logging/logger';
import { requireUser, type AuthenticatedUser } from '@/lib/auth/session';
import { requireVerified } from '@/lib/auth/require-verified';
import { readCsrfCookie, verifyCsrfToken } from '@/lib/auth/csrf';
import { clientIp } from './responses';

export const CSRF_HEADER = 'x-csrf-token';
export const CORRELATION_HEADER = 'x-correlation-id';

export interface RouteOptions<TBody = undefined, TQuery = undefined, TParams = undefined> {
  auth?: boolean;
  verified?: boolean;
  csrf?: boolean;
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  params?: ZodType<TParams>;
}

export interface HandlerContext<TBody, TQuery, TParams> {
  request: NextRequest;
  body: TBody;
  query: TQuery;
  params: TParams;
  user: AuthenticatedUser | null;
  correlationId: string;
  ip: string;
  userAgent: string;
}

export type RouteHandler<TBody, TQuery, TParams> = (
  context: HandlerContext<TBody, TQuery, TParams>,
) => Promise<NextResponse> | NextResponse;

type NextRouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function readJson(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw errors.validation(undefined, 'Request body must be valid JSON.');
  }
}

function queryObject(request: NextRequest): Record<string, string> {
  return Object.fromEntries(request.nextUrl.searchParams.entries());
}

export function route<TBody = undefined, TQuery = undefined, TParams = undefined>(
  options: RouteOptions<TBody, TQuery, TParams>,
  handler: RouteHandler<TBody, TQuery, TParams>,
): (request: NextRequest, context: NextRouteContext) => Promise<NextResponse> {
  return async (request, context) => {
    const incomingCorrelation = request.headers.get(CORRELATION_HEADER);
    const correlationId =
      incomingCorrelation && incomingCorrelation.length <= 128
        ? incomingCorrelation
        : newCorrelationId();
    const correlation: { correlationId: string; userId?: string } = { correlationId };

    return runWithCorrelation(correlation, async () => {
      try {
        const user = options.auth ? await requireUser() : null;
        if (options.verified) {
          await requireVerified();
        }
        if (user) correlation.userId = user.id;

        const requiresCsrf =
          options.csrf ?? (options.auth === true && MUTATING_METHODS.has(request.method));
        if (requiresCsrf) {
          const header = request.headers.get(CSRF_HEADER);
          const cookie = await readCsrfCookie();
          if (!verifyCsrfToken(header, cookie)) {
            throw errors.forbidden('The CSRF token is missing or invalid.');
          }
        }

        const rawParams = (await context.params) as Record<string, string>;
        const rawBody = options.body ? await readJson(request) : undefined;

        const body = options.body ? options.body.parse(rawBody) : (undefined as TBody);
        const query = options.query
          ? options.query.parse(queryObject(request))
          : (undefined as TQuery);
        const params = options.params
          ? options.params.parse(rawParams)
          : (rawParams as TParams);

        return await handler({
          request,
          body,
          query,
          params,
          user,
          correlationId,
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent') ?? 'unknown',
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return errorResponse(errors.validation(error.issues.map((issue) => ({
            path: issue.path.join('.') || 'body',
            message: issue.message,
          }))));
        }
        if (error instanceof AppError) {
          if (error.status >= 500) {
            getLogger().error({ err: error, correlationId: getCorrelationId() }, error.message);
          }
          return errorResponse(error);
        }
        getLogger().error({ err: error, correlationId: getCorrelationId() }, 'Unhandled route error');
        return errorResponse(errors.internal(error));
      }
    });
  };
}

export function noStoreHeaders(headers: Headers): Headers {
  headers.set('Cache-Control', 'no-store, max-age=0');
  return headers;
}
