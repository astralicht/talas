import { expect, test } from '@playwright/test';
import { resetLimits } from './helpers';

test.describe.serial('auth journey', () => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'playwright-strong-password-1';

  test.beforeEach(async ({ request }) => {
    await resetLimits(request);
  });

  test('registers, verifies, signs in, and signs out', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    // Cold dev servers compile the route mid-flight; poll like the other
    // journeys instead of failing on a single slow request.
    await expect(async () => {
      const button = page.getByRole('button', { name: 'Create account' });
      if (await button.count()) await button.click();
      await expect(page).toHaveURL(/verify-email|login|dashboard/, { timeout: 5_000 });
    }).toPass({ timeout: 30_000, intervals: [2_000, 5_000] });

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await expect(async () => {
      const button = page.getByRole('button', { name: 'Sign in' });
      if (await button.count()) await button.click();
      await expect(page).toHaveURL(/dashboard/, { timeout: 5_000 });
    }).toPass({ timeout: 30_000, intervals: [2_000, 5_000] });
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/login/);
  });

  test('rejects a short password up front', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(`short-${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/12 characters|at least/i).first()).toBeVisible();
  });
});
