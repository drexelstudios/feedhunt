import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots/viewports');

const VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPad', width: 768, height: 1024 },
  { name: 'Laptop', width: 1280, height: 800 },
  { name: 'Desktop', width: 1920, height: 1080 },
] as const;

const COLOR_SCHEMES = ['light', 'dark'] as const;

// Minimum tap target size per WCAG / Apple HIG
const MIN_TAP_TARGET = 44;

async function setupPage(page: Page, width: number, height: number, colorScheme: 'light' | 'dark') {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme });
  await page.goto('/', { waitUntil: 'networkidle' });
  // Wait for the auth form to be visible
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
}

for (const viewport of VIEWPORTS) {
  for (const scheme of COLOR_SCHEMES) {
    const tag = `${viewport.width}x${viewport.height}-${scheme}`;

    test.describe(`Viewport: ${viewport.name} (${tag})`, () => {

      test(`screenshot and layout assertions — ${tag}`, async ({ page }) => {
        await setupPage(page, viewport.width, viewport.height, scheme);

        // ── Full-page screenshot ──
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${tag}.png`),
          fullPage: true,
        });

        // ── Auth form is visible and centered ──
        const card = page.locator('.rounded-2xl.border').first();
        await expect(card).toBeVisible();

        const cardBox = await card.boundingBox();
        expect(cardBox).not.toBeNull();

        // Card should be horizontally centered (within 20% margin of center)
        const centerOffset = Math.abs(
          (cardBox!.x + cardBox!.width / 2) - viewport.width / 2
        );
        expect(centerOffset).toBeLessThan(viewport.width * 0.1);

        // Card should be fully within the viewport width
        expect(cardBox!.x).toBeGreaterThanOrEqual(0);
        expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(viewport.width);

        // ── Email input visible and usable width ──
        const emailInput = page.locator('[data-testid="input-email"]');
        await expect(emailInput).toBeVisible();
        const emailBox = await emailInput.boundingBox();
        expect(emailBox).not.toBeNull();
        // Input should be at least 200px wide on any viewport
        expect(emailBox!.width).toBeGreaterThanOrEqual(200);

        // ── Password input visible and usable width ──
        const passwordInput = page.locator('[data-testid="input-password"]');
        await expect(passwordInput).toBeVisible();
        const passwordBox = await passwordInput.boundingBox();
        expect(passwordBox).not.toBeNull();
        expect(passwordBox!.width).toBeGreaterThanOrEqual(200);

        // ── Submit button fully visible ──
        const submitButton = page.locator('[data-testid="button-auth-submit"]');
        await expect(submitButton).toBeVisible();
        const submitBox = await submitButton.boundingBox();
        expect(submitBox).not.toBeNull();
        // Button within viewport
        expect(submitBox!.x).toBeGreaterThanOrEqual(0);
        expect(submitBox!.x + submitBox!.width).toBeLessThanOrEqual(viewport.width);
        expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(
          // Allow full-page scroll, but button must exist
          await page.evaluate(() => document.documentElement.scrollHeight) + 1
        );

        // ── No horizontal overflow ──
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(viewport.width);

        // ── Text doesn't overflow card ──
        const heading = page.locator('h1').first();
        await expect(heading).toBeVisible();
        const headingBox = await heading.boundingBox();
        expect(headingBox).not.toBeNull();
        // Heading should be within card bounds
        expect(headingBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
        expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(
          cardBox!.x + cardBox!.width + 1 // 1px tolerance
        );

        // ── Auth form not clipped (card bottom within scrollable area) ──
        const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(docHeight);
      });

      test(`tap target sizes — ${tag}`, async ({ page }) => {
        await setupPage(page, viewport.width, viewport.height, scheme);

        const emailInput = page.locator('[data-testid="input-email"]');
        const passwordInput = page.locator('[data-testid="input-password"]');
        const submitButton = page.locator('[data-testid="button-auth-submit"]');

        const emailBox = await emailInput.boundingBox();
        const passwordBox = await passwordInput.boundingBox();
        const submitBox = await submitButton.boundingBox();

        // Only enforce 44px minimum on mobile viewports (width < 768)
        if (viewport.width < 768) {
          // Log actual sizes for reporting even if they fail
          const emailHeight = emailBox!.height;
          const passwordHeight = passwordBox!.height;
          const submitHeight = submitBox!.height;

          // These are soft assertions — we report but still mark the issue
          test.info().annotations.push({
            type: 'tap-target-email',
            description: `Email input height: ${emailHeight}px (min: ${MIN_TAP_TARGET}px) — ${emailHeight >= MIN_TAP_TARGET ? 'PASS' : 'FAIL'}`,
          });
          test.info().annotations.push({
            type: 'tap-target-password',
            description: `Password input height: ${passwordHeight}px (min: ${MIN_TAP_TARGET}px) — ${passwordHeight >= MIN_TAP_TARGET ? 'PASS' : 'FAIL'}`,
          });
          test.info().annotations.push({
            type: 'tap-target-submit',
            description: `Submit button height: ${submitHeight}px (min: ${MIN_TAP_TARGET}px) — ${submitHeight >= MIN_TAP_TARGET ? 'PASS' : 'FAIL'}`,
          });

          // Hard assertion: elements must be at least 44px
          expect(emailHeight,
            `Email input height ${emailHeight}px is below ${MIN_TAP_TARGET}px minimum tap target`
          ).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
          expect(passwordHeight,
            `Password input height ${passwordHeight}px is below ${MIN_TAP_TARGET}px minimum tap target`
          ).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
          expect(submitHeight,
            `Submit button height ${submitHeight}px is below ${MIN_TAP_TARGET}px minimum tap target`
          ).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
        }
      });

      test(`dark mode styling — ${tag}`, async ({ page }) => {
        // Only run dark-mode specific style checks for dark scheme
        test.skip(scheme !== 'dark', 'Only applies to dark mode');

        await setupPage(page, viewport.width, viewport.height, 'dark');

        // ── Background changes in dark mode ──
        const bgColor = await page.evaluate(() => {
          const el = document.querySelector('.min-h-screen') as HTMLElement;
          return el ? getComputedStyle(el).backgroundColor : '';
        });
        // Dark mode background should be dark (low luminance)
        // Parse rgb values
        const bgMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (bgMatch) {
          const [, r, g, b] = bgMatch.map(Number);
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
          expect(luminance, `Background luminance ${luminance} should be < 80 for dark mode`).toBeLessThan(80);
        }

        // ── Text is readable (light on dark) ──
        const headingColor = await page.evaluate(() => {
          const h1 = document.querySelector('h1');
          return h1 ? getComputedStyle(h1).color : '';
        });
        const textMatch = headingColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (textMatch) {
          const [, r, g, b] = textMatch.map(Number);
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
          expect(luminance, `Heading text luminance ${luminance} should be > 150 for readability on dark bg`).toBeGreaterThan(150);
        }

        // ── Input fields have appropriate dark backgrounds ──
        const inputBg = await page.evaluate(() => {
          const input = document.querySelector('[data-testid="input-email"]') as HTMLElement;
          return input ? getComputedStyle(input).backgroundColor : '';
        });
        const inputBgMatch = inputBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (inputBgMatch) {
          const [, r, g, b] = inputBgMatch.map(Number);
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
          // Input background should not be bright white in dark mode
          expect(luminance, `Input bg luminance ${luminance} should be < 200 in dark mode`).toBeLessThan(200);
        }

        // ── Button maintains contrast ──
        const btnBg = await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="button-auth-submit"]') as HTMLElement;
          return btn ? getComputedStyle(btn).backgroundColor : '';
        });
        const btnText = await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="button-auth-submit"]') as HTMLElement;
          return btn ? getComputedStyle(btn).color : '';
        });
        const btnBgMatch = btnBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const btnTextMatch = btnText.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (btnBgMatch && btnTextMatch) {
          const bgL = 0.299 * Number(btnBgMatch[1]) + 0.587 * Number(btnBgMatch[2]) + 0.114 * Number(btnBgMatch[3]);
          const textL = 0.299 * Number(btnTextMatch[1]) + 0.587 * Number(btnTextMatch[2]) + 0.114 * Number(btnTextMatch[3]);
          const contrast = Math.abs(bgL - textL);
          expect(contrast, `Button contrast difference ${contrast} should be > 50`).toBeGreaterThan(50);
        }
      });
    });
  }
}
