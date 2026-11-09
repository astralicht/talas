import { issueAndStoreCsrfToken } from '@/lib/auth/csrf';
import { json } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const csrfToken = await issueAndStoreCsrfToken();
  return json({ csrfToken });
}
