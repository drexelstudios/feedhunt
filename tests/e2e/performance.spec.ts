import { test, expect } from '@playwright/test';

const BASE_URL = 'https://rss-aggregator-perplexity.vercel.app';

// ─── 1. Page Load Performance ────────────────────────────────────────────────

test.describe('Page Load Performance', () => {
  const runs: {
    ttfb: number;
    domContentLoaded: number;
    fullLoad: number;
    requestCount: number;
    transferSize: number;
  }[] = [];

  for (let i = 1; i <= 3; i++) {
    test(`Run ${i}: measure page load metrics`, async ({ page }) => {
      // Collect network request info
      let requestCount = 0;
      let totalTransferSize = 0;

      page.on('response', async (response) => {
        requestCount++;
        const headers = response.headers();
        const contentLength = parseInt(headers['content-length'] || '0', 10);
        totalTransferSize += contentLength;
      });

      await page.goto(BASE_URL, { waitUntil: 'load' });

      // Extract Navigation Timing API metrics
      const timing = await page.evaluate(() => {
        const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return {
          ttfb: perf.responseStart - perf.requestStart,
          domContentLoaded: perf.domContentLoadedEventEnd - perf.startTime,
          fullLoad: perf.loadEventEnd - perf.startTime,
        };
      });

      console.log(`  Run ${i}:`);
      console.log(`    TTFB: ${timing.ttfb.toFixed(1)} ms`);
      console.log(`    DOMContentLoaded: ${timing.domContentLoaded.toFixed(1)} ms`);
      console.log(`    Full Load: ${timing.fullLoad.toFixed(1)} ms`);
      console.log(`    Network Requests: ${requestCount}`);
      console.log(`    Transfer Size: ${(totalTransferSize / 1024).toFixed(1)} KB`);

      runs.push({
        ttfb: timing.ttfb,
        domContentLoaded: timing.domContentLoaded,
        fullLoad: timing.fullLoad,
        requestCount,
        transferSize: totalTransferSize,
      });

      expect(timing.fullLoad).toBeGreaterThan(0);
    });
  }
});

// ─── 2. API Endpoint Stress Test ─────────────────────────────────────────────

test.describe('API Endpoint Stress Test', () => {
  test('10 concurrent requests to base URL', async ({ request }) => {
    const promises = Array.from({ length: 10 }, () =>
      request.get(BASE_URL)
    );
    const responses = await Promise.all(promises);
    const statuses = responses.map((r) => r.status());
    console.log(`  Concurrent base URL statuses: ${statuses.join(', ')}`);
    for (const r of responses) {
      expect(r.status()).toBeLessThan(500);
    }
  });

  test('POST /api/feeds/preview without auth returns 401', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/feeds/preview`, {
      data: { url: 'https://example.com/feed.xml' },
    });
    console.log(`  POST /api/feeds/preview (no auth) => ${resp.status()}`);
    expect(resp.status()).toBe(401);
  });

  test('POST /api/scrape/preview without auth returns 401', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/scrape/preview`, {
      data: { url: 'https://example.com' },
    });
    console.log(`  POST /api/scrape/preview (no auth) => ${resp.status()}`);
    expect(resp.status()).toBe(401);
  });

  test('GET /api/feeds/preview returns 404 (POST-only endpoint)', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/feeds/preview`);
    console.log(`  GET /api/feeds/preview => ${resp.status()}`);
    expect(resp.status()).toBe(404);
  });

  test('GET /api/scrape/preview returns 404 (POST-only endpoint)', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/scrape/preview`);
    console.log(`  GET /api/scrape/preview => ${resp.status()}`);
    expect(resp.status()).toBe(404);
  });
});

// ─── 3. SSRF Verification ────────────────────────────────────────────────────

test.describe('SSRF Verification', () => {
  test('POST /api/feeds/preview with localhost URL returns 401 (no auth)', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/feeds/preview`, {
      data: { url: 'http://localhost:3000' },
    });
    console.log(`  POST /api/feeds/preview (localhost) => ${resp.status()}`);
    expect(resp.status()).toBe(401);
  });

  test('POST /api/scrape/preview with metadata URL returns 401 (no auth)', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/scrape/preview`, {
      data: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    console.log(`  POST /api/scrape/preview (metadata) => ${resp.status()}`);
    expect(resp.status()).toBe(401);
  });
});

// ─── 4. Error Handling ───────────────────────────────────────────────────────

test.describe('Error Handling', () => {
  test('GET /api/nonexistent returns 404 and no stack trace', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/nonexistent`);
    console.log(`  GET /api/nonexistent => ${resp.status()}`);
    const body = await resp.text();
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    expect(resp.status()).toBeLessThan(500);
    // Should not leak stack traces
    expect(body).not.toContain('at Object.');
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('Error:');
    console.log(`  Response body (truncated): ${body.substring(0, 200)}`);
  });

  test('POST /api/feeds/preview with malformed JSON returns error without leak', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/feeds/preview`, {
      headers: { 'Content-Type': 'application/json' },
      data: 'this is not json{{{',
    });
    console.log(`  POST /api/feeds/preview (malformed JSON) => ${resp.status()}`);
    const body = await resp.text();
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    expect(resp.status()).toBeLessThan(500);
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('at Object.');
    console.log(`  Response body (truncated): ${body.substring(0, 200)}`);
  });
});

// ─── 5. TLS/SSL Check ───────────────────────────────────────────────────────

test.describe('TLS/SSL Check', () => {
  test('Site is served over HTTPS', async ({ request }) => {
    const resp = await request.get(BASE_URL);
    expect(resp.url()).toMatch(/^https:\/\//);
    console.log(`  Final URL: ${resp.url()} (HTTPS confirmed)`);
  });

  test('HTTP redirects to HTTPS', async ({ request }) => {
    // Playwright request context follows redirects, so just verify final URL is HTTPS
    const httpUrl = BASE_URL.replace('https://', 'http://');
    const resp = await request.get(httpUrl);
    expect(resp.url()).toMatch(/^https:\/\//);
    console.log(`  HTTP -> ${resp.url()} (redirect confirmed)`);
  });
});
