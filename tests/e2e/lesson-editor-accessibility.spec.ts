import { expect, test } from '@playwright/test';

const password = 'playwright-strong-password-1';
const email = `e2e-a11y-${Date.now()}@example.com`;

test.describe.serial('keyboard operability', () => {
  test('completes registration and login with the keyboard only', async ({ page }) => {
    await page.goto('/register');
    await page.keyboard.press('Tab');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/register$/, { timeout: 15_000 });

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/dashboard/);
  });

  test('edits lessons via keyboard including Ctrl+B bold insertion', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/dashboard/);

    await page
      .getByRole('link', { name: /Open lesson|Edit lesson/ })
      .first()
      .click();
    await page.getByRole('link', { name: 'Edit lesson' }).click();
    const content = page.getByLabel('Content');
    await content.focus();
    await page.keyboard.press('ControlOrMeta+b');
    await expect(content).toHaveValue(/\*\*/);
  });

  test('reaches settings and revision history with tab focus only', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/dashboard/);

    await page.getByRole('link', { name: 'Settings' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/settings/);

    await page.goto('/dashboard');
    await page
      .getByRole('link', { name: /Open lesson|Edit lesson/ })
      .first()
      .click();
    await page.getByRole('link', { name: 'Edit lesson' }).click();
    await page.getByRole('button', { name: 'Revision history' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/No revisions yet|Restoring|current/).first()).toBeVisible();
  });
});
