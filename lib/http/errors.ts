import { ZodError } from 'zod';

export type ErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unverified_email'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'internal_error'
  | 'service_unavailable';

export interface FieldError {
  path: string;
  message: string;
}

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  correlationId: string;
  fields?: FieldError[];
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldError[];
  readonly expose: boolean;
  readonly retryAfter?: number;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { fields?: FieldError[]; expose?: boolean; retryAfter?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.fields = options.fields;
    this.expose = options.expose ?? true;
    this.retryAfter = options.retryAfter;
  }
}

export const errors = {
  validation: (fields?: FieldError[], message = 'The request could not be validated.') =>
    new AppError('validation_failed', 400, message, { fields }),
  unauthorized: (message = 'Sign in to continue.') =>
    new AppError('unauthorized', 401, message),
  forbidden: (message = 'You do not have access to this resource.') =>
    new AppError('forbidden', 403, message),
  notFound: (message = 'The requested resource was not found.') =>
    new AppError('not_found', 404, message),
  conflict: (message = 'The resource changed. Reload and try again.') =>
    new AppError('conflict', 409, message),
  rateLimited: (retryAfter: number, message = 'Too many requests. Try again later.') =>
    new AppError('rate_limited', 429, message, { retryAfter }),
  unverified: (message = 'Verify your email before using this feature.') =>
    new AppError('unverified_email', 403, message),
  payloadTooLarge: (message = 'The request is larger than the allowed limit.') =>
    new AppError('payload_too_large', 413, message),
  unsupportedMedia: (message = 'The supplied media type is not supported.') =>
    new AppError('unsupported_media_type', 415, message),
  internal: (cause?: unknown, message = 'An unexpected error occurred.') =>
    new AppError('internal_error', 500, message, { cause }),
  unavailable: (message = 'The service is temporarily unavailable.', cause?: unknown) =>
    new AppError('service_unavailable', 503, message, { cause }),
} as const;

export function fieldErrorsFromZod(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

export function toEnvelope(error: unknown, correlationId: string): ErrorEnvelope {
  if (error instanceof ZodError) {
    return {
      code: 'validation_failed',
      message: 'The request could not be validated.',
      correlationId,
      fields: fieldErrorsFromZod(error),
    };
  }
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.expose ? error.message : 'An unexpected error occurred.',
      correlationId,
      ...(error.fields ? { fields: error.fields } : {}),
    };
  }
  return {
    code: 'internal_error',
    message: 'An unexpected error occurred.',
    correlationId,
  };
}
