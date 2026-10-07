import { test, expect } from '@playwright/test';

test.use({ baseURL: `http://127.0.0.1:${process.env.ASK_I18N_E2E_PORT}` });

const UTF8_QUESTION = 'How should I declare UTF-8 character encoding in HTML?';

test('ask flow renders a cited answer from the indexed sources', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#health-status')).toContainText('5 documents and 9 chunks');

  await page.locator('#question').fill(UTF8_QUESTION);
  await page.locator('#submit-button').click();

  await expect(page.locator('#answer')).toContainText('UTF-8');
  await expect(page.locator('#answer-heading')).toBeFocused();
  const citation = page.locator('#citation-1');
  await expect(citation).toBeVisible();
  await expect(citation.locator('a')).toHaveAttribute('href', /http-charset/);
});

test('switching the UI language localizes the interface', async ({ page }) => {
  await page.goto('/');

  await page.locator('#ui-language').selectOption('zh-hans');

  await expect(page.locator('#submit-button')).toHaveText('提问');
  await expect(page.locator('label[for="question"]')).toHaveText('问题');
  await expect(page.locator('#question')).toHaveValue('');
  await expect(page.locator('#question')).toHaveAttribute('placeholder', '如何在HTML中设置内容的语言？');
  await expect(page.locator('.header-link img')).toBeVisible();

  await page.locator('#ui-language').selectOption('en');
  await expect(page.locator('#question')).toHaveAttribute('placeholder', UTF8_QUESTION);
});

test('mobile keeps the ask action visible before collapsed settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.locator('#submit-button')).toBeVisible();
  const submitBox = await page.locator('#submit-button').boundingBox();
  expect(submitBox?.y + (submitBox?.height || 0)).toBeLessThan(844);
  await expect(page.locator('.settings-disclosure')).not.toHaveAttribute('open', '');
  await expect(page.locator('#language')).not.toBeVisible();
  await expect(page.locator('.shortcut-hint')).not.toBeVisible();

  await page.locator('.settings-disclosure summary').click();
  await expect(page.locator('#language')).toBeVisible();
});

test('switching the UI language defaults the answer language to match', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#language')).toHaveValue('en');

  await page.locator('#ui-language').selectOption('zh-hans');
  await expect(page.locator('#language')).toHaveValue('zh-hans');

  await page.locator('#ui-language').selectOption('en');
  await expect(page.locator('#language')).toHaveValue('en');
});

test('a manually chosen answer language survives UI language switches', async ({ page }) => {
  await page.goto('/');

  await page.locator('.settings-disclosure summary').click();
  await page.locator('#language').selectOption('fr');
  await page.locator('#ui-language').selectOption('zh-hans');

  await expect(page.locator('#language')).toHaveValue('fr');
});

test('switching the UI language preserves a typed question', async ({ page }) => {
  await page.goto('/');

  await page.locator('#question').fill('How should I handle bidi text in HTML?');
  await page.locator('#ui-language').selectOption('zh-hans');

  await expect(page.locator('#question')).toHaveValue('How should I handle bidi text in HTML?');
});

test('answer language follows the selected answer language', async ({ page }) => {
  await page.goto('/');

  await page.locator('#question').fill(UTF8_QUESTION);
  await page.locator('.settings-disclosure summary').click();
  await page.locator('#language').selectOption('zh-hans');
  await page.locator('#submit-button').click();
  await expect(page.locator('#answer')).toHaveAttribute('lang', 'zh-hans');

  await page.locator('#language').selectOption('ar');
  await page.locator('#submit-button').click();
  await expect(page.locator('#answer')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('#answer')).toHaveAttribute('dir', 'auto');
});

test('a whitespace-only question shows a validation error without sending a request', async ({ page }) => {
  let askRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/ask')) askRequests += 1;
  });

  await page.goto('/');
  await page.locator('#question').fill('   ');
  await page.locator('#submit-button').click();

  await expect(page.locator('#message-area')).toHaveText('Enter at least 3 characters.');
  await expect(page.locator('#answer')).toContainText('Ask a question to see an answer');
  expect(askRequests).toBe(0);
});

test('Control+Enter submits the question', async ({ page }) => {
  await page.goto('/');

  await page.locator('#question').fill(UTF8_QUESTION);
  await page.locator('#question').press('Control+Enter');

  await expect(page.locator('#answer')).toContainText('UTF-8');
});

test('a question unsupported by the index shows the no-answer state', async ({ page }) => {
  await page.goto('/');

  await page.locator('#question').fill('banana recipes for breakfast');
  await page.locator('#submit-button').click();

  await expect(page.locator('#message-area')).toHaveText('No supported answer was found.');
  await expect(page.locator('#answer')).toContainText('I could not find enough support');
  await expect(page.locator('#citations')).toBeEmpty();
});
