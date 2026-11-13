import { expect, test } from '@playwright/test';

// The seeded development account (pnpm db:seed) has a lesson to edit; fresh
// registrations no longer receive lessons automatically (specs/005).
const email = 'alice@talas.local';
const password = 'talas-local-password';

/** Opens the first lesson's read view from the lessons list; a middleware
 * session bounce lands on /login?next=/lessons and is retried via sign-in. */
async function openFirstLesson(page: import('@playwright/test').Page): Promise<void> {
  await expect(async () => {
    if (!/lessons\/[a-f0-9]{24}/.test(page.url())) {
      if (page.url().includes('/login')) {
        await page.getByLabel('Email').fill(email);
        await page.getByLabel('Password').fill(password);
        await page.getByRole('button', { name: 'Sign in' }).click();
      } else {
        await page.goto('/lessons');
        await page.getByTestId('lesson-link').first().click();
      }
    }
    await expect(page).toHaveURL(/lessons\/[a-f0-9]{24}/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
}


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

test.describe.serial('lesson editor', () => {
  test('edits, autosaves, reloads, and sees persisted content', async ({ page }) => {
    await signIn(page);

    // Open the lesson read view from the lessons list, then the editor.
    await openFirstLesson(page);
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

    await openFirstLesson(page);
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

    await openFirstLesson(page);
    await page.getByRole('link', { name: 'Edit lesson' }).click();
    await expect(page.getByLabel('Title')).toBeVisible();

    // Save a distinct edit so the newest revision differs from the oldest one;
    // restoring the oldest is then a real change the autosave persists.
    const editor = page.getByLabel('Content');
    const edited = `${(await editor.inputValue()).replace(/\n+$/, '')}\n\nRestore probe paragraph.`;
    await editor.fill(edited);
    await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Revision history' }).click();
    // Newest first — the oldest revision holds the pre-probe content.
    const restoreButton = page.getByRole('button', { name: /Restore v\d+/ }).last();
    await restoreButton.click();

    // The restore replaces the editor content and persists server-side (the
    // status resets to the unedited state on the bumped version).
    await expect(editor).not.toHaveValue(/Restore probe paragraph/, { timeout: 20_000 });
    await expect(page.getByText(/Unedited · v\d+/)).toBeVisible({ timeout: 20_000 });
  });
});
