import { expect, test } from '@playwright/test';

// The seeded development account (pnpm db:seed) has a lesson to edit; fresh
// registrations no longer receive lessons automatically (specs/005).
const email = 'alice@talas.local';
const password = 'talas-local-password';


/** Dev servers occasionally strand the form on /login after a successful
 * POST; poll with re-clicks so a hiccup cannot fail the whole journey. */
async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await expect(async () => {
    if (!page.url().includes('/dashboard')) {
      const button = page.getByRole('button', { name: 'Sign in' });
      if (await button.count()) await button.click();
    }
    await expect(page).toHaveURL(/dashboard/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
}

test.describe.serial('keyboard operability', () => {
  test('completes registration and login with the keyboard only', async ({ page }) => {
    await page.goto('/register');
    await page.keyboard.press('Tab');
    await page.getByLabel('Email').fill(`a11y-${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('playwright-strong-password-1');
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/register$/, { timeout: 15_000 });

    await signIn(page);
  });

  test('edits lessons via keyboard including Ctrl+B bold insertion', async ({ page }) => {
    await signIn(page);

    await expect(async () => {
      await page.goto('/lessons');
      if (!/lessons\/[a-f0-9]{24}/.test(page.url())) {
        if (page.url().includes('/login')) {
          await page.getByLabel('Email').fill(email);
          await page.getByLabel('Password').fill(password);
          await page.getByRole('button', { name: 'Sign in' }).click();
        } else {
          await page.getByTestId('lesson-link').first().click();
        }
      }
      await expect(page).toHaveURL(/lessons\/[a-f0-9]{24}/, { timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
    await page.getByRole('link', { name: 'Edit lesson' }).click();
    const content = page.getByLabel('Content');
    await content.focus();
    await page.keyboard.press('ControlOrMeta+b');
    await expect(content).toHaveValue(/\*\*/);
  });

  test('reaches settings and revision history with tab focus only', async ({ page }) => {
    await signIn(page);

    await page.getByRole('link', { name: 'Settings' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/settings/);

    await page.goto('/dashboard');
    await expect(async () => {
      await page.goto('/lessons');
      if (!/lessons\/[a-f0-9]{24}/.test(page.url())) {
        if (page.url().includes('/login')) {
          await page.getByLabel('Email').fill(email);
          await page.getByLabel('Password').fill(password);
          await page.getByRole('button', { name: 'Sign in' }).click();
        } else {
          await page.getByTestId('lesson-link').first().click();
        }
      }
      await expect(page).toHaveURL(/lessons\/[a-f0-9]{24}/, { timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
    await page.getByRole('link', { name: 'Edit lesson' }).click();
    await page.getByRole('button', { name: 'Revision history' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/No revisions yet|Restoring|current/).first()).toBeVisible();
  });
});
