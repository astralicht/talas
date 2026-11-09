import request from 'supertest';

export class TestSession {
  private cookieJar = new Map<string, string>();
  private currentCsrf: string | null = null;

  constructor(private readonly url: string) {}

  private cookieHeader(): string {
    return [...this.cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private absorb(headers: Record<string, unknown>): void {
    const raw = headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    for (const line of list) {
      const [pair] = line.split(';');
      const [name, ...valueParts] = pair.split('=');
      if (!name) continue;
      const value = valueParts.join('=').trim();
      this.cookieJar.set(name.trim(), value);
      // Auth routes rotate the CSRF pair; the header must always match the cookie.
      if (name.trim() === 'csrf_token') this.currentCsrf = value;
    }
  }

  private async request(
    method: string,
    path: string,
    options: { body?: unknown; auth?: boolean } = {},
  ): Promise<request.Response> {
    const test = request(this.url)[method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](path) as request.Test;
    test.set('Cookie', this.cookieHeader());
    test.set('Accept', 'application/json');
    if (options.auth) {
      await this.ensureCsrf();
      if (this.currentCsrf) test.set('X-CSRF-Token', this.currentCsrf);
    }
    if (options.body !== undefined && options.body !== null) test.send(options.body as object);
    const response = await test;
    this.absorb(response.headers as Record<string, unknown>);
    return response;
  }

  private async ensureCsrf(): Promise<void> {
    if (this.currentCsrf) return;
    const response = await request(this.url).get('/api/auth/csrf').set('Accept', 'application/json');
    this.absorb(response.headers as Record<string, unknown>);
    const body = response.body as { csrfToken?: string };
    this.currentCsrf = body.csrfToken ?? null;
  }

  async get(path: string): Promise<request.Response> {
    return this.request('GET', path);
  }

  /**
   * GET with named cookies removed from the jar — used to simulate an expired
   * access token while keeping the (still valid) refresh cookie.
   */
  async getWithoutCookies(path: string, names: string[]): Promise<request.Response> {
    const jar = new Map(this.cookieJar);
    for (const name of names) jar.delete(name);
    const test = request(this.url)
      .get(path)
      .set('Cookie', [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; '))
      .set('Accept', 'application/json');
    const response = await test;
    this.absorb(response.headers as Record<string, unknown>);
    return response;
  }

  /** Buffers a binary response (e.g. the ZIP export). */
  async binaryGet(path: string): Promise<request.Response> {
    const test = request(this.url)
      .get(path)
      .set('Cookie', this.cookieHeader())
      .buffer(true)
      .parse((message, callback) => {
        const chunks: Buffer[] = [];
        message.on('data', (chunk: Buffer) => chunks.push(chunk));
        message.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return test;
  }

  async post(path: string, body?: unknown): Promise<request.Response> {
    return this.request('POST', path, { body, auth: true });
  }

  async patch(path: string, body?: unknown): Promise<request.Response> {
    return this.request('PATCH', path, { body, auth: true });
  }

  async delete(path: string): Promise<request.Response> {
    return this.request('DELETE', path, { auth: true });
  }

  cookie(name: string): string | undefined {
    return this.cookieJar.get(name);
  }

  csrfToken(): string | null {
    return this.currentCsrf;
  }
}

export interface PublicUserView {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

/** Extracts the raw verification token the memory outbox emailed the user. */
export async function latestLinkToken(email: string, subject: string): Promise<string> {
  const { getMemoryEmailSender } = await import('@/lib/email/sender');
  const outbox = getMemoryEmailSender().outbox;
  for (let index = outbox.length - 1; index >= 0; index -= 1) {
    const message = outbox[index];
    if (!message) continue;
    if (message.to !== email || !message.subject.includes(subject)) continue;
    const source = message.text || message.html;
    const match = /token=([A-Za-z0-9_-]+)/.exec(source);
    if (match?.[1]) return match[1];
  }
  throw new Error(`No ${subject} email found for ${email}`);
}

export interface RegisteredUser {
  session: TestSession;
  user: PublicUserView;
  email: string;
  password: string;
}

/** Registers a user, verifies the email via the outboxed link, and signs in. */
export async function registerVerifiedUser(
  url: string,
  overrides: { email?: string; password?: string } = {},
): Promise<RegisteredUser> {
  const session = new TestSession(url);
  const email = overrides.email ?? `user-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
  const password = overrides.password ?? 'correct horse battery staple';

  const register = await session.post('/api/auth/register', { email, password });
  if (register.status !== 201) {
    throw new Error(`register failed: ${register.status} ${JSON.stringify(register.body)}`);
  }

  const token = await latestLinkToken(email, 'Verify your Talas email');
  const verify = await session.post('/api/auth/verify-email', { token });
  if (verify.status !== 200) {
    throw new Error(`verify-email failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  }

  const login = await session.post('/api/auth/login', { email, password });
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  const user = (login.body as { user: PublicUserView }).user;
  return { session, user, email, password };
}
