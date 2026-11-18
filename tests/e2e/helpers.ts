import type { APIRequestContext } from '@playwright/test';

/**
 * Clears rate-limit and plan-allowance state in the e2e dev server between
 * tests. The server is long-lived (`reuseExistingServer`), so per-run state
 * would otherwise accumulate — registration or generation limits could trip on
 * the second run of the same server. Only answers in e2e mode (E2E_MODE=true);
 * the route 404s in normal development and production.
 */
export async function resetLimits(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/test/reset-limits', {
    headers: { 'x-talas-test-reset': '1' },
  });
  if (response.status() !== 200) {
    throw new Error(
      `The e2e limiter reset endpoint is unavailable (${response.status()}). ` +
        'Run the e2e suite through the Playwright webServer (E2E_MODE=true) instead of a plain dev server.',
    );
  }
}

/**
 * Empties a demo account's lessons and materials through the public API so
 * plan storage quotas cannot fill up across repeated e2e runs against the
 * persistent dev database. Lesson deletion cascades its source material.
 * A no-op while the account is well inside its plan limits.
 */
export async function clearAccountContent(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const firstCsrf = await request.get('/api/auth/csrf');
  const { csrfToken } = (await firstCsrf.json()) as { csrfToken: string };
  const login = await request.post('/api/auth/login', {
    data: { email, password },
    headers: { 'X-CSRF-Token': csrfToken },
  });
  if (!login.ok()) {
    throw new Error(`Account cleanup could not sign in as ${email} (${login.status()})`);
  }

  // Always clear: stale rows from manual attempts (e.g. an upload interrupted
  // mid-flight, left in awaiting_upload) would otherwise break the journeys'
  // filtered-list assertions. Deleting a handful of rows is cheap.
  //
  // Materials are deleted per live status: the default list view includes
  // soft-deleted rows (they never leave the list), so a bare fetch-then-delete
  // loop would never terminate.

  // Auth routes rotate the CSRF pair; fetch a fresh token for the deletions.
  const rotated = await request.get('/api/auth/csrf');
  const { csrfToken: deletionToken } = (await rotated.json()) as { csrfToken: string };
  const headers = { 'X-CSRF-Token': deletionToken };

  // Always re-read page 1: deletions shift the pagination.
  for (;;) {
    const lessons = await request.get('/api/lessons?limit=50');
    const { data } = (await lessons.json()) as { data: { id: string }[] };
    if (data.length === 0) break;
    for (const lesson of data) {
      await request.delete(`/api/lessons/${lesson.id}`, { headers });
    }
  }

  const LIVE_MATERIAL_STATUSES = [
    'awaiting_upload',
    'uploaded',
    'processing',
    'ready',
    'failed',
    'quarantined',
  ];
  for (const status of LIVE_MATERIAL_STATUSES) {
    for (;;) {
      const materials = await request.get(`/api/materials?status=${status}&limit=50`);
      const { data } = (await materials.json()) as { data: { id: string }[] };
      if (data.length === 0) break;
      for (const material of data) {
        await request.delete(`/api/materials/${material.id}`, { headers });
      }
    }
  }
}

