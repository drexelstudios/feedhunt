import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Security Tests — feedhunt.app live deployment
// ---------------------------------------------------------------------------

const BASE = 'https://rss-aggregator-perplexity.vercel.app';

// ---------------------------------------------------------------------------
// 1. Security Headers
// ---------------------------------------------------------------------------

test.describe('Security Headers', () => {
  let headers: Record<string, string>;

  test.beforeAll(async ({ request }) => {
    const resp = await request.get(BASE);
    const raw = resp.headers();
    // Normalize header keys to lowercase for consistent assertions
    headers = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v])
    );
  });

  test('X-Content-Type-Options is nosniff', async () => {
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options is DENY', async () => {
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('Content-Security-Policy is present', async () => {
    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['content-security-policy']).toContain("default-src");
  });

  test('Referrer-Policy is present', async () => {
    expect(headers['referrer-policy']).toBeDefined();
  });

  test('Permissions-Policy is present', async () => {
    expect(headers['permissions-policy']).toBeDefined();
  });

  test('X-Powered-By is NOT present', async () => {
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('API routes also include security headers', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/feeds`);
    const apiHeaders = Object.fromEntries(
      Object.entries(resp.headers()).map(([k, v]) => [k.toLowerCase(), v])
    );
    expect(apiHeaders['x-content-type-options']).toBe('nosniff');
    expect(apiHeaders['x-powered-by']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Authentication Enforcement
// ---------------------------------------------------------------------------

test.describe('Auth Enforcement — unauthenticated requests return 401', () => {
  const endpoints: Array<{ method: 'GET' | 'POST'; path: string }> = [
    { method: 'POST', path: '/api/feeds/preview' },
    { method: 'POST', path: '/api/scrape/preview' },
    { method: 'POST', path: '/api/feeds' },
    { method: 'GET', path: '/api/feeds' },
    { method: 'POST', path: '/api/extract' },
    { method: 'POST', path: '/api/newsletter/sync' },
    { method: 'GET', path: '/api/categories' },
  ];

  for (const { method, path } of endpoints) {
    test(`${method} ${path} -> 401`, async ({ request }) => {
      const opts: any = {};
      if (method === 'POST') {
        opts.data = { url: 'https://example.com' };
      }
      const resp = method === 'GET'
        ? await request.get(`${BASE}${path}`)
        : await request.post(`${BASE}${path}`, opts);
      expect(resp.status()).toBe(401);
      const body = await resp.json();
      expect(body.error).toBe('Unauthorized');
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Dev Auth Bypass Blocked in Production
// ---------------------------------------------------------------------------

test.describe('Dev Auth Bypass', () => {
  test('X-Dev-Bypass-Auth header does NOT grant access in production', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/feeds`, {
      headers: { 'X-Dev-Bypass-Auth': 'true' },
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// 4. Error Message Leakage
// ---------------------------------------------------------------------------

test.describe('Error Message Leakage', () => {
  test('invalid token yields generic error, no stack trace', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/feeds/preview`, {
      headers: { Authorization: 'Bearer fake-token-12345' },
      data: { url: 'not-a-url' },
    });
    const body = await resp.json();
    // Should be a generic auth rejection, not a stack trace
    expect(JSON.stringify(body)).not.toContain('at ');
    expect(JSON.stringify(body)).not.toContain('node_modules');
    expect(JSON.stringify(body)).not.toContain('Error:');
  });

  test('scrape preview with bad domain yields generic error', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/scrape/preview`, {
      headers: { Authorization: 'Bearer fake-token-12345' },
      data: { url: 'http://nonexistent.invalid' },
    });
    const body = await resp.json();
    expect(JSON.stringify(body)).not.toContain('at ');
    expect(JSON.stringify(body)).not.toContain('node_modules');
    expect(JSON.stringify(body)).not.toContain('ENOTFOUND');
  });
});

// ---------------------------------------------------------------------------
// 5. CORS / Credential Exposure
// ---------------------------------------------------------------------------

test.describe('CORS & Credential Exposure', () => {
  test('no credentials leak in unauthenticated API responses', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/feeds`);
    const body = await resp.text();
    // Should not contain any tokens, passwords, or connection strings
    expect(body).not.toContain('supabase_service_role');
    expect(body).not.toContain('password');
    expect(body).not.toContain('secret');
  });

  test('root page does not expose server-side secrets', async ({ request }) => {
    const resp = await request.get(BASE);
    const html = await resp.text();
    expect(html).not.toContain('SUPABASE_SERVICE_ROLE');
    expect(html).not.toContain('DATABASE_URL');
    expect(html).not.toContain('process.env');
  });
});
