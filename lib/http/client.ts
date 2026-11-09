export interface ApiErrorBody {
  code: string;
  message: string;
  correlationId?: string;
  fields?: Array<{ path: string; message: string }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId?: string;
  readonly fields: Array<{ path: string; message: string }>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.correlationId = body.correlationId;
    this.fields = body.fields ?? [];
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

const CSRF_PATH = '/api/auth/csrf';
const REFRESH_PATH = '/api/auth/refresh';

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const response = await fetch(CSRF_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { csrfToken?: string };
    if (typeof body.csrfToken === 'string') {
      csrfToken = body.csrfToken;
      return csrfToken;
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  return fetchCsrfToken();
}

async function refreshSession(): Promise<boolean> {
  const token = await ensureCsrfToken();
  if (!token) return false;
  try {
    const response = await fetch(REFRESH_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': token, Accept: 'application/json' },
    });
    if (!response.ok) {
      setCsrfToken(null);
      return false;
    }
    const body = (await response.json()) as { csrfToken?: string };
    if (typeof body.csrfToken === 'string') csrfToken = body.csrfToken;
    return true;
  } catch {
    return false;
  }
}

function isMutating(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

async function performRequest(url: string, options: RequestOptions): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  if (isMutating(method)) {
    const token = await ensureCsrfToken();
    if (token) headers.set('X-CSRF-Token', token);
  }

  return fetch(url, {
    method,
    headers,
    body,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function apiRequest<T>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  let response = await performRequest(url, options);

  if (response.status === 401 && method !== 'POST') {
    const refreshed = await refreshSession();
    if (refreshed) response = await performRequest(url, options);
  } else if (response.status === 401 && method === 'POST' && url !== REFRESH_PATH) {
    // A POST may fail because the access token expired; retry once after a refresh.
    const refreshed = await refreshSession();
    if (refreshed) response = await performRequest(url, options);
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as ApiErrorBody;
      throw new ApiError(response.status, body);
    }
    throw new ApiError(response.status, {
      code: 'internal_error',
      message: 'The request failed. Try again.',
    });
  }

  if (!contentType.includes('application/json')) return undefined as T;
  return (await response.json()) as T;
}

export async function apiDownload(url: string): Promise<Blob> {
  const response = await performRequest(url, { method: 'GET' });
  if (!response.ok) {
    throw new ApiError(response.status, {
      code: 'internal_error',
      message: 'The download could not be prepared.',
    });
  }
  return response.blob();
}
