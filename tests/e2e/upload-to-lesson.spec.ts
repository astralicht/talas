import { expect, test } from '@playwright/test';

// The seeded development account (pnpm db:seed) is email-verified, which the
// lesson-generation route requires.
const email = 'alice@talas.local';
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
  test('uploads a text material and reaches the ready overview with a use-in-lesson hint', async ({
    page,
  }) => {
    test.setTimeout(240_000);
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
});
