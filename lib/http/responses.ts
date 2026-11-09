import { NextResponse } from 'next/server';
import { AppError, toEnvelope, type ErrorCode } from './errors';
import { getCorrelationId, getCorrelationContext } from '@/lib/logging/correlation';

export const CORRELATION_HEADER = 'x-correlation-id';

function correlationHeaders(correlationId: string, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set(CORRELATION_HEADER, correlationId);
  return headers;
}

export function json<T>(data: T, init: ResponseInit = {}): NextResponse<T> {
  const correlationId = getCorrelationId();
  const headers = correlationHeaders(correlationId, init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return NextResponse.json(data, { ...init, headers });
}

export function created<T>(data: T): NextResponse<T> {
  return json(data, { status: 201 });
}

export function accepted<T>(data: T): NextResponse<T> {
  return json(data, { status: 202 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: correlationHeaders(getCorrelationId()),
  });
}

export function errorResponse(error: unknown): NextResponse {
  const correlationId = getCorrelationId();
  const envelope = toEnvelope(error, correlationId);
  const status = error instanceof AppError ? error.status : 500;
  const headers = correlationHeaders(correlationId);
  if (error instanceof AppError && error.retryAfter !== undefined) {
    headers.set('Retry-After', String(Math.max(1, Math.ceil(error.retryAfter))));
    headers.set('X-RateLimit-Remaining', '0');
  }
  return NextResponse.json(envelope, { status, headers });
}

export function safeError(code: ErrorCode, message: string, status: number): NextResponse {
  return errorResponse(new AppError(code, status, message));
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function currentUserId(): string | undefined {
  return getCorrelationContext()?.userId;
}
