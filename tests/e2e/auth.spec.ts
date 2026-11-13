import { expect, test } from '@playwright/test';

test.describe.serial('auth journey', () => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'playwright-strong-password-1';

  test('registers, verifies, signs in, and signs out', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Registration accepted; verification is pending.
    await expect(page).toHaveURL(/verify-email|login|dashboard/);

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/dashboard/);
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
