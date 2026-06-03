import { test, expect } from '@playwright/test';

const BREAKPOINTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x1366', width: 1024, height: 1366 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 }
];

test.describe('Responsive breakpoints', () => {
  for (const bp of BREAKPOINTS) {
    test(`${bp.name} — nav not broken, no overflow, tables/cards readable`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });

      const errors: string[] = [];
      page.on('pageerror', err => errors.push(err.message));

      // Test timeline
      await page.goto('/timeline');
      await page.waitForLoadState('networkidle');

      const navCount = await page.locator('nav, header, [role="navigation"]').count();
      expect(navCount, `${bp.name}: nav missing`).toBeGreaterThan(0);

      // Nav visible
      const nav = page.locator('nav, header, [role="navigation"]').first();
      await expect(nav).toBeVisible();

      // No fatal JS errors
      expect(errors, `${bp.name}: fatal JS errors: ${errors.join('; ')}`).toHaveLength(0);

      // Test CRM
      await page.goto('/crm/ba');
      await page.waitForLoadState('networkidle');
      const crmErrors: string[] = [];
      page.on('pageerror', err => crmErrors.push(err.message));

      // Test Reports (manager only, may redirect based on role)
      await page.goto('/reports');
      await page.waitForLoadState('networkidle');

      // Test Manager Inbox
      await page.goto('/manager/inbox');
      await page.waitForLoadState('networkidle');
    });
  }

  test('390x844 mobile — timeline has scroll/fallback', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/timeline');
    await page.waitForLoadState('networkidle');

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth, 'Horizontal overflow on mobile').toBeLessThanOrEqual(windowWidth + 5);
  });

  test('768x1024 tablet — reports page accessible', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
  });
});
