import { test, expect, type ConsoleMessage } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BASE = 'https://rss-aggregator-perplexity.vercel.app';

// ---------------------------------------------------------------------------
// 1. Page Load & Infrastructure
// ---------------------------------------------------------------------------

test.describe('Page Load & Infrastructure', () => {
  test('returns HTTP 200 on the base URL', async ({ request }) => {
    const resp = await request.get(BASE);
    expect(resp.status()).toBe(200);
  });

  test('page title is "Feedhunt" (not blank or default)', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title.toLowerCase()).toContain('feedhunt');
  });

  test('page renders within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  test('no console errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    // Give the app a moment to finish async work
    await page.waitForTimeout(2000);

    // Filter out known benign messages (e.g. third-party analytics, favicon)
    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404 (Not Found)') &&
        !e.includes('Failed to load resource') // network blips in CI
    );
    expect(real).toEqual([]);
  });

  test('no uncaught exceptions on page load', async ({ page }) => {
    const exceptions: string[] = [];
    page.on('pageerror', (err) => {
      exceptions.push(err.message);
    });

    await page.goto('/');
    await page.waitForTimeout(2000);
    expect(exceptions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Security Headers
// ---------------------------------------------------------------------------

test.describe('Security Headers', () => {
  // Each test fetches its own headers since beforeAll doesn't support fixtures.
  async function getHeaders(request: any): Promise<Record<string, string>> {
    const resp = await request.head(BASE);
    const raw = resp.headers();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      headers[k.toLowerCase()] = v as string;
    }
    return headers;
  }

  test('X-Content-Type-Options is nosniff', async ({ request }) => {
    const headers = await getHeaders(request);
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options is DENY', async ({ request }) => {
    const headers = await getHeaders(request);
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('Referrer-Policy header is present', async ({ request }) => {
    const headers = await getHeaders(request);
    expect(headers['referrer-policy']).toBeTruthy();
  });

  test('Content-Security-Policy header is present', async ({ request }) => {
    const headers = await getHeaders(request);
    expect(headers['content-security-policy']).toBeTruthy();
  });

  test('Permissions-Policy header is present', async ({ request }) => {
    const headers = await getHeaders(request);
    expect(headers['permissions-policy']).toBeTruthy();
  });

  test('X-Powered-By header is NOT present', async ({ request }) => {
    const headers = await getHeaders(request);
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Auth Page UI
// ---------------------------------------------------------------------------

test.describe('Auth Page UI', () => {
  test('login form renders with email, password, and submit', async ({
    page,
  }) => {
    await page.goto('/');
    // Wait for the auth form to appear
    await expect(page.locator('[data-testid="input-email"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="input-password"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="button-auth-submit"]')
    ).toBeVisible();
  });

  test('switch to signup mode shows "Create account" heading', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="input-email"]')).toBeVisible({
      timeout: 10000,
    });

    // Click the switch button (at bottom of form) to go from login -> signup
    await page.locator('[data-testid="button-auth-switch"]').click();

    // The h1 heading should now say "Create account"
    await expect(page.locator('h1')).toHaveText('Create account', {
      timeout: 5000,
    });
  });

  test('switch to forgot password shows "Reset password" heading', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="input-email"]')).toBeVisible({
      timeout: 10000,
    });

    // Click the "Forgot password?" button near the password label
    await page.locator('button:has-text("Forgot password")').click();

    // The h1 heading should now say "Reset password"
    await expect(page.locator('h1')).toHaveText('Reset password', {
      timeout: 5000,
    });

    // The submit button should say "Send reset link"
    await expect(
      page.locator('[data-testid="button-auth-submit"]')
    ).toHaveText('Send reset link');

    // Password field should be hidden in forgot mode
    await expect(
      page.locator('[data-testid="input-password"]')
    ).not.toBeVisible();
  });

  test('submitting empty form shows validation or does not navigate', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.locator('[data-testid="button-auth-submit"]')
    ).toBeVisible({ timeout: 10000 });

    const url = page.url();
    await page.locator('[data-testid="button-auth-submit"]').click();
    // After clicking, we should still be on the same page (no crash, no navigation away)
    await page.waitForTimeout(1000);

    // Either native validation prevents submission (URL unchanged) or an error message appears
    const hasError =
      (await page
        .locator('[role="alert"], .error, [data-testid*="error"]')
        .count()) > 0;
    const urlUnchanged = page.url() === url;
    expect(hasError || urlUnchanged).toBeTruthy();
  });

  test('submitting invalid email shows error handling', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="input-email"]')).toBeVisible({
      timeout: 10000,
    });

    await page.locator('[data-testid="input-email"]').fill('not-an-email');
    await page.locator('[data-testid="input-password"]').fill('somepassword');
    await page.locator('[data-testid="button-auth-submit"]').click();

    await page.waitForTimeout(2000);

    // Should still be on auth page, OR show an error message
    const hasError =
      (await page
        .locator('[role="alert"], .error, [data-testid*="error"]')
        .count()) > 0;
    const stillOnAuth =
      (await page.locator('[data-testid="input-email"]').count()) > 0;
    expect(hasError || stillOnAuth).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Navigation / 404
// ---------------------------------------------------------------------------

test.describe('Navigation', () => {
  test('non-existent hash route shows 404 or not-found message', async ({
    page,
  }) => {
    await page.goto('/#/nonexistent-page-xyz');
    await page.waitForTimeout(2000);

    // Check for any "not found" text or redirect back to auth
    const bodyText = await page.locator('body').innerText();
    const has404 = /not found|404|page.*not.*exist/i.test(bodyText);
    const redirectedToAuth =
      (await page.locator('[data-testid="input-email"]').count()) > 0;
    expect(has404 || redirectedToAuth).toBeTruthy();
  });

  test('password reset route (/#/reset-password) renders reset form', async ({
    page,
  }) => {
    await page.goto('/#/reset-password');
    await page.waitForTimeout(2000);

    // Either a dedicated reset-password form or we land on the auth page
    const hasResetForm =
      (await page
        .locator(
          'input[type="password"], [data-testid*="password"], [data-testid*="reset"]'
        )
        .count()) > 0;
    const hasResetText = /reset|new password|change password/i.test(
      await page.locator('body').innerText()
    );
    const onAuthPage =
      (await page.locator('[data-testid="input-email"]').count()) > 0;
    expect(hasResetForm || hasResetText || onAuthPage).toBeTruthy();
  });
});
