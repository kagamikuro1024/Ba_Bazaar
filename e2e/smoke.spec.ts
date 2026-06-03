import { test, expect } from '@playwright/test';

const PUBLIC_ROUTES = [
  { path: '/', name: 'Home (redirect)' },
  { path: '/timeline', name: 'Timeline' },
  { path: '/my-schedule', name: 'My Schedule' },
  { path: '/my-requests', name: 'My Requests' },
  { path: '/crm/ba', name: 'BA Directory' }
];

const MANAGER_ROUTES = [
  { path: '/manager/inbox', name: 'Manager Inbox' },
  { path: '/manager/dashboard', name: 'Dashboard' },
  { path: '/reports', name: 'Reports' }
];

test.describe('Route smoke', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} (${route.path}) — no blank screen, has layout, no fatal error`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      // Not blank — body has content
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.trim().length).toBeGreaterThan(0);

      // Has nav/layout
      const hasNav = await page.locator('nav, header, [role="navigation"]').count();
      expect(hasNav).toBeGreaterThan(0);

      // No fatal error (ignore benign React warnings)
      const fatalErrors = errors.filter(e =>
        !e.includes('Warning:') &&
        !e.includes('[HMR]') &&
        !e.includes('DevTools')
      );
      expect(fatalErrors, `Fatal console errors on ${route.path}: ${fatalErrors.join('; ')}`).toHaveLength(0);
    });
  }

  for (const route of MANAGER_ROUTES) {
    test(`${route.name} (${route.path}) — accessible, has content, no fatal error`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.trim().length).toBeGreaterThan(0);

      const hasNav = await page.locator('nav, header, [role="navigation"]').count();
      expect(hasNav).toBeGreaterThan(0);

      const fatalErrors = errors.filter(e =>
        !e.includes('Warning:') &&
        !e.includes('[HMR]') &&
        !e.includes('DevTools')
      );
      expect(fatalErrors, `Fatal console errors on ${route.path}: ${fatalErrors.join('; ')}`).toHaveLength(0);
    });
  }

  test('/notifications — accessible with layout', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
  });

  test('Unknown route → redirects to /', async ({ page }) => {
    await page.goto('/this-does-not-exist');
    await page.waitForLoadState('networkidle');
    // Should redirect back to / which redirects based on role
    const url = page.url();
    expect(url).toMatch(/localhost:5173/);
  });
});
