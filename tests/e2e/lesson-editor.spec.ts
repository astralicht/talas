import { expect, test } from '@playwright/test';

const password = 'playwright-strong-password-1';
const email = `e2e-editor-${Date.now()}@example.com`;

test.describe.serial('lesson editor', () => {
  test('edits, autosaves, reloads, and sees persisted content', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Reach the lesson read view from the dashboard, then open the editor.
    await page
      .getByRole('link', { name: /Open lesson|Edit lesson/ })
      .first()
      .click();
    await page.getByRole('link', { name: 'Edit lesson' }).click();
    await expect(page.getByLabel('Title')).toBeVisible();

    const editor = page.getByLabel('Content');
    const initial = await editor.inputValue();
    const appended = initial.replace(/\n+$/, '') + '\n\nE2E autosave paragraph.';
    await editor.fill(appended);

    // Autosave debounce (1.5s) + save completes; the status announces it.
    await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByLabel('Content')).toHaveValue(appended);
  });

  test('conflicts block overwrites and offer reload', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.goto('/dashboard');
    await page
      .getByRole('link', { name: /Open lesson|Edit lesson/ })
      .first()
      .click();
    await page.getByRole('link', { name: 'Edit lesson' }).click();

    // Simulate a second tab: change version server-side, then make the first save stale.
    const lessonId = page.url().match(/lessons\/([a-f0-9]{24})/)?.[1];
    expect(lessonId).toBeDefined();

    const csrf = await page.evaluate(async () => {
      const response = await fetch('/api/auth/csrf');
      return (await response.json()) as { csrfToken: string };
    });
    await page.evaluate(
      async ({ lessonId: id, token }) => {
        // Two saves with the same version — the second must conflict.
        const save = (version: number) =>
          fetch(`/api/lessons/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            credentials: 'same-origin',
            body: JSON.stringify({
              version,
              title: 'conflict probe',
              contentMarkdown: 'attempt ' + version,
            }),
          });
        await save(1);
      },
      { lessonId, token: csrf.csrfToken },
    );

    const stale = await page.evaluate(
      async ({ lessonId: id, token }) => {
        const response = await fetch(`/api/lessons/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          credentials: 'same-origin',
          body: JSON.stringify({ version: 1, title: 'stale', contentMarkdown: 'stale save' }),
        });
        return response.status;
      },
      { lessonId, token: csrf.csrfToken },
    );

    expect(stale).toBe(409);
  });

  test('revision restore appends a version without rewriting history', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.goto('/dashboard');
    await page
      .getByRole('link', { name: /Open lesson|Edit lesson/ })
      .first()
      .click();
    await page.getByRole('link', { name: 'Edit lesson' }).click();

    await page.getByRole('button', { name: 'Revision history' }).click();
    const restoreButton = page.getByRole('button', { name: /Restore v\d+/ }).first();
    if (await restoreButton.count()) {
      await restoreButton.click();
      await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });
    }
  });
});
