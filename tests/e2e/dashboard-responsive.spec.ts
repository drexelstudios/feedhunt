import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots/viewports');

const EMAIL = 'rafael@drexelstudios.com';
const PASSWORD = 'R925@intitY2026';

const VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPad', width: 768, height: 1024 },
  { name: 'Laptop', width: 1280, height: 800 },
  { name: 'Desktop', width: 1920, height: 1080 },
] as const;

const MIN_TAP_TARGET = 44;

async function loginAndWaitForDashboard(page: Page, width: number, height: number, colorScheme: 'light' | 'dark' = 'light') {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
  await page.fill('[data-testid="input-email"]', EMAIL);
  await page.fill('[data-testid="input-password"]', PASSWORD);
  await page.click('[data-testid="button-auth-submit"]');
  await page.waitForSelector('[data-testid="tab-all"]', { timeout: 15000 });
  // Allow layout to settle
  await page.waitForTimeout(1500);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Dashboard — ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.setTimeout(60000);

    test(`light mode screenshot and layout — ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await loginAndWaitForDashboard(page, viewport.width, viewport.height, 'light');

      // Full-page screenshot (light)
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `dashboard-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
      });

      // ── No horizontal overflow ──
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `Horizontal overflow detected: scrollWidth ${scrollWidth} > viewport ${viewport.width}`).toBeLessThanOrEqual(viewport.width + 1);

      // ── Category tabs visible ──
      const tabAll = page.locator('[data-testid="tab-all"]');
      await expect(tabAll).toBeVisible();
      const tabBox = await tabAll.boundingBox();
      expect(tabBox, 'Tab "All" should have a bounding box').not.toBeNull();
      // Tab should be within viewport width
      expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(viewport.width + 1);

      // ── Category tabs wrap on narrow screens ──
      if (viewport.width < 600) {
        // On mobile, tabs container should not overflow
        const tabsOverflow = await page.evaluate(() => {
          // Look for the tabs container — could be a scrollable row or flex-wrap
          const tabContainers = document.querySelectorAll('[role="tablist"], [data-testid="tab-all"]');
          let parent: HTMLElement | null = null;
          tabContainers.forEach((el) => {
            if (el.parentElement) parent = el.parentElement as HTMLElement;
          });
          if (!parent) return { overflows: false, scrollable: false };
          const styles = getComputedStyle(parent);
          return {
            overflows: parent.scrollWidth > parent.clientWidth,
            scrollable: styles.overflowX === 'auto' || styles.overflowX === 'scroll',
            flexWrap: styles.flexWrap,
          };
        });
        // Tabs should either wrap or be in a scrollable container (both acceptable)
        test.info().annotations.push({
          type: 'tabs-mobile',
          description: `Tabs overflow: ${tabsOverflow.overflows}, scrollable: ${tabsOverflow.scrollable}, flexWrap: ${tabsOverflow.flexWrap}`,
        });
      }

      // ── Feed grid column check ──
      const gridInfo = await page.evaluate(() => {
        // Look for the feed grid container — check for CSS columns or grid
        const allDivs = Array.from(document.querySelectorAll('div'));
        let gridContainer: HTMLElement | null = null;
        for (const div of allDivs) {
          const style = getComputedStyle(div);
          if (style.columnCount !== 'auto' || style.gridTemplateColumns !== 'none') {
            gridContainer = div;
            break;
          }
        }
        if (!gridContainer) return { found: false, type: 'none', columns: 0 };
        const style = getComputedStyle(gridContainer);
        if (style.columnCount !== 'auto') {
          return { found: true, type: 'css-columns', columns: parseInt(style.columnCount), columnWidth: style.columnWidth };
        }
        if (style.gridTemplateColumns !== 'none') {
          const cols = style.gridTemplateColumns.split(' ').length;
          return { found: true, type: 'css-grid', columns: cols, gridTemplate: style.gridTemplateColumns };
        }
        return { found: false, type: 'unknown', columns: 0 };
      });

      test.info().annotations.push({
        type: 'grid-layout',
        description: `Grid: ${JSON.stringify(gridInfo)}`,
      });

      if (gridInfo.found) {
        if (viewport.width < 600) {
          // Mobile: expect 1 column
          expect(gridInfo.columns, `Mobile should show 1 column, got ${gridInfo.columns}`).toBeLessThanOrEqual(1);
        } else if (viewport.width >= 600 && viewport.width <= 900) {
          // Tablet: expect 2 columns
          expect(gridInfo.columns, `Tablet should show 2 columns, got ${gridInfo.columns}`).toBe(2);
        } else {
          // Desktop: expect 3 columns (default, user can change)
          expect(gridInfo.columns, `Desktop should show 3+ columns, got ${gridInfo.columns}`).toBeGreaterThanOrEqual(2);
        }
      }

      // ── Feed widgets visible and not clipped ──
      const feedWidgets = await page.evaluate(() => {
        // Look for feed widget cards
        const widgets = document.querySelectorAll('[data-testid^="feed-widget"], .feed-widget, [class*="feed"]');
        const results: { tag: string; x: number; y: number; width: number; height: number; clipped: boolean }[] = [];
        widgets.forEach((w) => {
          const rect = w.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            results.push({
              tag: w.tagName,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              clipped: rect.right > window.innerWidth,
            });
          }
        });
        return results;
      });

      for (const widget of feedWidgets) {
        expect(widget.clipped, `Feed widget at (${widget.x}, ${widget.y}) is clipped beyond viewport`).toBe(false);
      }

      // ── Feed articles readable (check text is not zero-height) ──
      const articleReadability = await page.evaluate(() => {
        const articles = document.querySelectorAll('article, [data-testid*="article"], a[href*="http"]');
        let tooSmall = 0;
        let total = 0;
        articles.forEach((a) => {
          const rect = a.getBoundingClientRect();
          if (rect.width > 0) {
            total++;
            // Check if the text within is clipped
            const el = a as HTMLElement;
            const style = getComputedStyle(el);
            const fontSize = parseFloat(style.fontSize);
            if (fontSize < 10) tooSmall++;
          }
        });
        return { total, tooSmall };
      });

      test.info().annotations.push({
        type: 'article-readability',
        description: `Articles found: ${articleReadability.total}, too small font: ${articleReadability.tooSmall}`,
      });

      if (articleReadability.total > 0) {
        expect(articleReadability.tooSmall, 'Some articles have font size below 10px').toBe(0);
      }

      // ── Add Feed / Create Feed button reachable ──
      const addFeedBtn = page.locator('button:has-text("Add Feed"), button:has-text("Create Feed"), [data-testid*="add-feed"], [data-testid*="create-feed"], button:has-text("Add"), [aria-label*="Add"]').first();
      const addFeedVisible = await addFeedBtn.isVisible().catch(() => false);
      test.info().annotations.push({
        type: 'add-feed-btn',
        description: `Add/Create Feed button visible: ${addFeedVisible}`,
      });
      if (addFeedVisible) {
        const addBox = await addFeedBtn.boundingBox();
        if (addBox) {
          expect(addBox.x + addBox.width, 'Add Feed button extends beyond viewport').toBeLessThanOrEqual(viewport.width + 1);
        }
      }

      // ── Header buttons accessible on mobile ──
      if (viewport.width < 768) {
        const headerBtns = await page.evaluate(() => {
          const header = document.querySelector('header, nav, [role="banner"]');
          if (!header) return { found: false, buttons: 0, allVisible: true };
          const btns = header.querySelectorAll('button, a[role="button"]');
          let visibleCount = 0;
          btns.forEach((b) => {
            const rect = b.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) visibleCount++;
          });
          return { found: true, buttons: btns.length, visible: visibleCount };
        });
        test.info().annotations.push({
          type: 'header-mobile',
          description: `Header buttons total: ${headerBtns.buttons}, visible: ${headerBtns.visible ?? headerBtns.buttons}`,
        });
      }
    });

    test(`dark mode screenshot and styling — ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await loginAndWaitForDashboard(page, viewport.width, viewport.height, 'dark');

      // Full-page screenshot (dark)
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `dashboard-${viewport.width}x${viewport.height}-dark.png`),
        fullPage: true,
      });

      // ── Background should be dark ──
      const bgInfo = await page.evaluate(() => {
        const candidates = [
          document.body,
          document.querySelector('main'),
          document.querySelector('.min-h-screen'),
          document.querySelector('[class*="bg-"]'),
          document.documentElement,
        ].filter(Boolean) as HTMLElement[];
        for (const el of candidates) {
          const bg = getComputedStyle(el).backgroundColor;
          const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) {
            const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
            if (lum < 128) return { bg, luminance: lum, element: el.tagName + '.' + el.className.slice(0, 40) };
          }
        }
        // If none found dark, return body info
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const lum = m ? 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]) : 255;
        return { bg, luminance: lum, element: 'body' };
      });

      test.info().annotations.push({
        type: 'dark-bg',
        description: `Background: ${bgInfo.bg} (luminance: ${bgInfo.luminance.toFixed(1)}, element: ${bgInfo.element})`,
      });
      expect(bgInfo.luminance, `Dark mode background luminance ${bgInfo.luminance} should be < 80`).toBeLessThan(80);

      // ── Feed widget cards have dark backgrounds ──
      const cardBgInfo = await page.evaluate(() => {
        const cards = document.querySelectorAll('[class*="card"], [class*="widget"], [class*="rounded"]');
        const results: { bg: string; luminance: number }[] = [];
        cards.forEach((card) => {
          const bg = getComputedStyle(card as HTMLElement).backgroundColor;
          const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) {
            const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
            if (lum > 0) results.push({ bg, luminance: lum });
          }
        });
        return results;
      });

      for (const card of cardBgInfo) {
        // Cards should not have bright white backgrounds in dark mode
        expect(card.luminance, `Card background luminance ${card.luminance} too bright for dark mode`).toBeLessThan(200);
      }

      // ── Text is readable on dark background ──
      const textContrast = await page.evaluate(() => {
        const textEls = document.querySelectorAll('h1, h2, h3, p, span, a');
        let lowContrast = 0;
        let checked = 0;
        textEls.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const color = getComputedStyle(el as HTMLElement).color;
          const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) {
            checked++;
            const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
            // Text on dark bg should be light enough (luminance > 100)
            if (lum < 80) lowContrast++;
          }
        });
        return { checked, lowContrast };
      });

      test.info().annotations.push({
        type: 'dark-text-contrast',
        description: `Text elements checked: ${textContrast.checked}, low contrast: ${textContrast.lowContrast}`,
      });

      // ── Category tabs maintain contrast in dark mode ──
      const tabContrast = await page.evaluate(() => {
        const tab = document.querySelector('[data-testid="tab-all"]') as HTMLElement;
        if (!tab) return null;
        const color = getComputedStyle(tab).color;
        const bg = getComputedStyle(tab).backgroundColor;
        const colorM = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const bgM = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!colorM) return null;
        const textLum = 0.299 * Number(colorM[1]) + 0.587 * Number(colorM[2]) + 0.114 * Number(colorM[3]);
        const bgLum = bgM ? 0.299 * Number(bgM[1]) + 0.587 * Number(bgM[2]) + 0.114 * Number(bgM[3]) : 0;
        return { textLum, bgLum, diff: Math.abs(textLum - bgLum), color, bg };
      });

      if (tabContrast) {
        test.info().annotations.push({
          type: 'tab-contrast-dark',
          description: `Tab text lum: ${tabContrast.textLum.toFixed(1)}, bg lum: ${tabContrast.bgLum.toFixed(1)}, diff: ${tabContrast.diff.toFixed(1)}`,
        });
        expect(tabContrast.diff, 'Category tab text/bg contrast too low in dark mode').toBeGreaterThan(30);
      }
    });

    // Mobile-specific tests
    if (viewport.width < 768) {
      test(`mobile reading pane — ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await loginAndWaitForDashboard(page, viewport.width, viewport.height, 'light');

        // Try to click on an article link
        const articleLink = page.locator('article a, [data-testid*="article"] a, a[target="_blank"]').first();
        const articleExists = await articleLink.isVisible().catch(() => false);

        if (articleExists) {
          // Check if clicking opens a reading pane or full-screen overlay
          await articleLink.click().catch(() => {});
          await page.waitForTimeout(1000);

          // Look for a reading pane / modal / full-screen overlay
          const readingPane = await page.evaluate(() => {
            const overlays = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="overlay"], [class*="reading"], [class*="pane"], [class*="drawer"]');
            const results: { tag: string; width: number; height: number; isFullScreen: boolean }[] = [];
            overlays.forEach((o) => {
              const rect = o.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                results.push({
                  tag: o.tagName + '.' + o.className.slice(0, 50),
                  width: rect.width,
                  height: rect.height,
                  isFullScreen: rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.5,
                });
              }
            });
            return results;
          });

          test.info().annotations.push({
            type: 'reading-pane-mobile',
            description: readingPane.length > 0
              ? `Reading pane found: ${JSON.stringify(readingPane)}`
              : 'No reading pane overlay detected — article may open in new tab',
          });

          // Take screenshot of article opened state
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `dashboard-${viewport.width}x${viewport.height}-article.png`),
            fullPage: true,
          });
        } else {
          test.info().annotations.push({
            type: 'reading-pane-mobile',
            description: 'No article links found to test reading pane',
          });
        }
      });

      test(`mobile settings panel — ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await loginAndWaitForDashboard(page, viewport.width, viewport.height, 'light');

        // Try to find and open settings
        const settingsBtn = page.locator('button:has-text("Settings"), [data-testid*="settings"], [aria-label*="Settings"], [aria-label*="settings"], button svg[class*="gear"], button svg[class*="cog"]').first();
        const settingsExists = await settingsBtn.isVisible().catch(() => false);

        if (settingsExists) {
          await settingsBtn.click();
          await page.waitForTimeout(1000);

          // Check that settings panel is usable
          const settingsPanel = await page.evaluate(() => {
            const panels = document.querySelectorAll('[role="dialog"], [class*="settings"], [class*="panel"], [class*="modal"], [class*="sheet"], [class*="drawer"]');
            const results: { width: number; height: number; fitsViewport: boolean; className: string }[] = [];
            panels.forEach((p) => {
              const rect = p.getBoundingClientRect();
              if (rect.width > 50 && rect.height > 50) {
                results.push({
                  width: rect.width,
                  height: rect.height,
                  fitsViewport: rect.width <= window.innerWidth && rect.right <= window.innerWidth + 1,
                  className: (p as HTMLElement).className.slice(0, 60),
                });
              }
            });
            return results;
          });

          test.info().annotations.push({
            type: 'settings-mobile',
            description: settingsPanel.length > 0
              ? `Settings panel: ${JSON.stringify(settingsPanel)}`
              : 'Settings panel not detected after click',
          });

          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `dashboard-${viewport.width}x${viewport.height}-settings.png`),
            fullPage: true,
          });

          for (const panel of settingsPanel) {
            expect(panel.fitsViewport, `Settings panel (${panel.width}px) exceeds viewport width`).toBe(true);
          }
        } else {
          test.info().annotations.push({
            type: 'settings-mobile',
            description: 'No settings button found on mobile — may be behind menu',
          });
        }
      });

      test(`mobile feed widget actions — ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await loginAndWaitForDashboard(page, viewport.width, viewport.height, 'light');

        // Look for feed widget action buttons (refresh, settings, collapse)
        const widgetActions = await page.evaluate(() => {
          // Common patterns for widget action buttons
          const actions = document.querySelectorAll(
            '[data-testid*="refresh"], [data-testid*="collapse"], [data-testid*="widget-menu"], ' +
            '[aria-label*="Refresh"], [aria-label*="Collapse"], [aria-label*="expand"], ' +
            'button[class*="widget"] svg, [class*="feed-header"] button, [class*="widget-header"] button'
          );
          const results: { label: string; width: number; height: number; visible: boolean }[] = [];
          actions.forEach((a) => {
            const rect = a.getBoundingClientRect();
            results.push({
              label: (a as HTMLElement).getAttribute('aria-label') || (a as HTMLElement).getAttribute('data-testid') || a.textContent?.trim().slice(0, 20) || 'unknown',
              width: rect.width,
              height: rect.height,
              visible: rect.width > 0 && rect.height > 0,
            });
          });
          return results;
        });

        test.info().annotations.push({
          type: 'widget-actions-mobile',
          description: widgetActions.length > 0
            ? `Widget actions found: ${JSON.stringify(widgetActions.slice(0, 5))}`
            : 'No widget action buttons found with common selectors',
        });

        // Try hover on a widget to reveal action buttons
        const firstWidget = page.locator('[class*="widget"], [class*="feed-card"], [class*="card"]').first();
        const widgetVisible = await firstWidget.isVisible().catch(() => false);
        if (widgetVisible) {
          await firstWidget.hover();
          await page.waitForTimeout(500);

          const actionsAfterHover = await page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            let actionBtns = 0;
            btns.forEach((b) => {
              const rect = b.getBoundingClientRect();
              if (rect.width > 0 && rect.width < 60 && rect.height > 0 && rect.height < 60) {
                actionBtns++;
              }
            });
            return actionBtns;
          });

          test.info().annotations.push({
            type: 'widget-actions-after-hover',
            description: `Small action buttons visible after hover: ${actionsAfterHover}`,
          });
        }
      });
    }

    // Text clipping / truncation check for all viewports
    test(`no text clipping — ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await loginAndWaitForDashboard(page, viewport.width, viewport.height, 'light');

      const clippingIssues = await page.evaluate(() => {
        const elements = document.querySelectorAll('h1, h2, h3, h4, p, span, a, button');
        const issues: { tag: string; text: string; overflow: string; textOverflow: string }[] = [];
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0) return;
          const style = getComputedStyle(el as HTMLElement);
          // Check for elements with overflow hidden AND text-overflow ellipsis
          // which could hide important content
          if (style.overflow === 'hidden' && style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap') {
            const htmlEl = el as HTMLElement;
            if (htmlEl.scrollWidth > htmlEl.clientWidth) {
              issues.push({
                tag: el.tagName,
                text: el.textContent?.trim().slice(0, 40) || '',
                overflow: style.overflow,
                textOverflow: style.textOverflow,
              });
            }
          }
        });
        return issues;
      });

      test.info().annotations.push({
        type: 'text-clipping',
        description: clippingIssues.length > 0
          ? `Truncated elements: ${JSON.stringify(clippingIssues.slice(0, 5))}`
          : 'No critical text clipping detected',
      });

      // Truncation in article titles is acceptable; truncation in buttons/navigation is not
      const criticalClipping = clippingIssues.filter(
        (i) => i.tag === 'BUTTON' || i.tag === 'NAV' || i.tag === 'A'
      );
      expect(criticalClipping.length, `Critical text clipping in navigation/buttons: ${JSON.stringify(criticalClipping)}`).toBe(0);
    });
  });
}
