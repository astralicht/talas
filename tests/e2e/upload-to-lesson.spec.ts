import { expect, test } from '@playwright/test';

const password = 'playwright-strong-password-1';
const email = `e2e-upload-${Date.now()}@example.com`;

async function registerAndSignIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test.describe.serial('upload → lesson', () => {
  test('uploads a text material and reaches the ready material overview', async ({ page }) => {
    await registerAndSignIn(page);

    await page.goto('/materials/new');
    await page.setInputFiles('#material-file', {
      name: 'e2e-study.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        [
          '# E2E fixture study guide',
          '',
          'Spaced repetition schedules reviews at rising intervals.',
          'Active recall strengthens memory far beyond passive rereading.',
          'Interleaving different problem types builds discrimination skills.',
          'Sleep consolidates memory after study sessions.',
          'Retrieval practice beats elaboration for retention.',
        ].join('\n'),
      ),
    } as never);

    await page.getByRole('button', { name: 'Upload material' }).click();
    await expect(page).toHaveURL(/materials\/[a-f0-9]{24}/);

    // Status eventually settles (worker may be running against the local stack).
    await expect(page.getByText('Your lesson is ready').or(page.getByText(/Ready/))).toBeVisible({
      timeout: 180_000,
    });
  });

  test('renders the sanitized lesson read view with the material available for download', async ({
    page,
  }) => {
    await registerAndSignIn(page);
    await page.goto('/dashboard');
    await page
      .getByRole('link', { name: /Open lesson|Edit lesson/ })
      .first()
      .click();
    await expect(page.locator('.markdown-body')).toBeVisible();
    await expect(page.getByTestId('download-material')).toBeVisible();
  });
});
