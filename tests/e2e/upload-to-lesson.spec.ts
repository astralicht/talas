import { expect, test } from '@playwright/test';
import { clearAccountContent, resetLimits } from './helpers';

// Bob is seeded on the plus plan: the upload→generate journey needs more than
// the free tier's single material/lesson slots (plan limits, constitution
// v2.3.0). Alice stays on free to demo the quota limits by hand.
const email = 'bob@talas.local';
const password = 'talas-local-password';

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
}

const MATERIAL_LINES = [
  '# E2E fixture study guide',
  '',
  'Spaced repetition schedules reviews at rising intervals.',
  'Active recall strengthens memory far beyond passive rereading.',
  'Interleaving different problem types builds discrimination skills.',
  'Sleep consolidates memory after study sessions.',
  'Retrieval practice beats elaboration for retention.',
];

test.describe.serial('upload → explicit lesson request → read view', () => {
  test.beforeEach(async ({ request }) => {
    await resetLimits(request);
  });

  test('uploads a text material and reaches the ready overview with a use-in-lesson hint', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    // Repeated runs against the persistent dev database would eventually fill
    // Bob's plus-plan storage; reclaim his content before the journey (runs
    // inside the test so the 240s test timeout covers cold route compiles).
    await clearAccountContent(request, email, password);
    await signIn(page);

    await page.goto('/materials/new');
    // Dev-mode compiles make the presign/confirm hops occasionally slow; retry
    // the whole upload rather than racing each step.
    await expect(async () => {
      await page.goto('/materials/new');
      await page.setInputFiles('#material-file', {
        name: 'e2e-study.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(MATERIAL_LINES.join('\n')),
      } as never);
      await page.getByRole('button', { name: 'Upload material' }).click();
      await expect(page).toHaveURL(/materials\/[a-f0-9]{24}/, { timeout: 15_000 });
    }).toPass({ timeout: 120_000, intervals: [1_000, 5_000] });

    // The automatic pipeline is scan -> parse -> ready; generation is explicit.
    // The server-rendered hint appears once the worker finishes; poll with
    // reloads so the RSC refresh cannot race the locator.
    await expect(async () => {
      await page.reload();
      await expect(
        page.getByText('This document is processed and ready to be used in a lesson.'),
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 180_000, intervals: [5_000, 10_000] });
  });

  test('requests a lesson from the new-lesson flow and lands on the read view', async ({
    page,
  }) => {
    await signIn(page);

    await page.goto('/lessons/new');
    await page.getByLabel('Lesson title').fill('E2E generated lesson');
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: 'Generate lesson' }).click();

    // Polling completes and the browser lands on the fresh lesson.
    await expect(page).toHaveURL(/lessons\/[a-f0-9]{24}/, { timeout: 300_000 });
    await expect(page.locator('.markdown-body')).toBeVisible({ timeout: 60_000 });
  });

  test('opens the lesson read view from the dashboard and shows the sources', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page
      .getByRole('link', { name: /E2E generated lesson/ })
      .first()
      .click();
    await expect(page.locator('.markdown-body')).toBeVisible();
    await expect(page.getByTestId('download-material')).toBeVisible();
    await expect(page.getByTestId('regenerate-lesson')).toBeVisible();
  });

  test('searches, filters, and sorts the materials and lessons lists', async ({ page }) => {
    await signIn(page);

    // Materials: search matches the uploaded filename case-insensitively.
    // (.first() — dev databases persist across runs, so duplicates are normal.)
    await page.goto('/materials');
    await expect(page.getByTestId('materials-count')).toBeVisible();
    await page.getByTestId('materials-search').fill('e2e-study');
    await expect(page).toHaveURL(/materials\?q=e2e-study/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'e2e-study.md' }).first()).toBeVisible();

    // A miss shows the filtered empty state; Clear resets to the unfiltered URL.
    await page.getByTestId('materials-search').fill('zzz-no-such-material-xyz');
    await expect(page.getByText('No materials match your search or filters.')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId('list-toolbar-clear').click();
    await expect(page).toHaveURL(/\/materials$/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'e2e-study.md' }).first()).toBeVisible();

    // Sort and status pills keep the other params and navigate immediately.
    await page.getByRole('button', { name: 'Name A–Z' }).click();
    await expect(page).toHaveURL(/materials\?sort=name/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Awaiting upload' }).click();
    await expect(page).toHaveURL(/materials\?status=awaiting_upload&sort=name/, {
      timeout: 15_000,
    });
    // The confirmed material can never be awaiting_upload again.
    await expect(page.getByText('No materials match your search or filters.')).toBeVisible();
    await page.getByTestId('list-toolbar-clear').click();
    await expect(page.getByRole('link', { name: 'e2e-study.md' }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Lessons: title search finds the generated lesson; draft filter shows none.
    await page.goto('/lessons');
    await page.getByTestId('lessons-search').fill('E2E generated lesson');
    await expect(page).toHaveURL(/lessons\?q=E2E\+generated\+lesson/, { timeout: 15_000 });
    await expect(
      page.getByTestId('lesson-link').filter({ hasText: 'E2E generated lesson' }).first(),
    ).toBeVisible();

    await page.goto('/lessons?status=draft');
    await expect(page.getByText('No lessons match your search or filters.')).toBeVisible();
    await page.getByTestId('list-toolbar-clear').click();
    await expect(page).toHaveURL(/\/lessons$/, { timeout: 15_000 });
    await expect(page.getByTestId('lesson-link').first()).toBeVisible();
  });
});
