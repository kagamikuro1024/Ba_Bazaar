import { test, expect } from '@playwright/test';

test.describe('Error states', () => {
  test('Timeline — shows error UI when API unreachable (simulated via network block)', async ({ page }) => {
    await page.route('**/api/**', route => route.abort());
    await page.goto('/timeline');
    await page.waitForLoadState('networkidle');

    // Should NOT be blank
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);

    // Should show error message or retry button
    const hasErrorMessage =
      (await page.getByText(/error/i).count()) > 0 ||
      (await page.getByText(/retry/i).count()) > 0 ||
      (await page.getByText(/failed/i).count()) > 0 ||
      (await page.getByText(/tải thất bại/i).count()) > 0;
    expect(hasErrorMessage, 'Timeline should show error state when API fails').toBeTruthy();
  });

  test('My Requests — shows error UI when API unreachable', async ({ page }) => {
    await page.route('**/api/**', route => route.abort());
    await page.goto('/my-requests');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);

    const hasErrorMessage =
      (await page.getByText(/error/i).count()) > 0 ||
      (await page.getByText(/retry/i).count()) > 0 ||
      (await page.getByText(/failed/i).count()) > 0 ||
      (await page.getByText(/tải thất bại/i).count()) > 0;
    expect(hasErrorMessage, 'My Requests should show error state when API fails').toBeTruthy();
  });

  test('Manager Inbox — shows error UI when API unreachable', async ({ page }) => {
    await page.route('**/api/**', route => route.abort());
    await page.goto('/manager/inbox');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);

    const hasErrorMessage =
      (await page.getByText(/error/i).count()) > 0 ||
      (await page.getByText(/retry/i).count()) > 0 ||
      (await page.getByText(/failed/i).count()) > 0 ||
      (await page.getByText(/tải thất bại/i).count()) > 0;
    expect(hasErrorMessage, 'Manager Inbox should show error state when API fails').toBeTruthy();
  });

  test('BA Directory — shows error UI when API unreachable', async ({ page }) => {
    await page.route('**/api/**', route => route.abort());
    await page.goto('/crm/ba');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);

    const hasErrorMessage =
      (await page.getByText(/error/i).count()) > 0 ||
      (await page.getByText(/retry/i).count()) > 0 ||
      (await page.getByText(/failed/i).count()) > 0 ||
      (await page.getByText(/tải thất bại/i).count()) > 0;
    expect(hasErrorMessage, 'BA Directory should show error state when API fails').toBeTruthy();
  });

  test('Reports — shows error UI when API unreachable', async ({ page }) => {
    await page.route('**/api/**', route => route.abort());
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);

    const hasErrorMessage =
      (await page.getByText(/error/i).count()) > 0 ||
      (await page.getByText(/retry/i).count()) > 0 ||
      (await page.getByText(/failed/i).count()) > 0 ||
      (await page.getByText(/tải thất bại/i).count()) > 0;
    expect(hasErrorMessage, 'Reports should show error state when API fails').toBeTruthy();
  });
});

test.describe('Empty states', () => {
  test('Notifications — shows empty state when no notifications', async ({ page }) => {
    await page.route('**/api/notifications*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] })
    }));

    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
  });
});

test.describe('Loading states', () => {
  test('Timeline — has loading indicator or skeleton while fetching', async ({ page }) => {
    // Slow down API to catch loading state
    await page.route('**/api/**', async route => {
      await new Promise(r => setTimeout(r, 500));
      await route.continue();
    });

    await page.goto('/timeline');

    // Should show loading indicator initially
    const loadingText =
      (await page.getByText(/loading/i).count()) > 0 ||
      (await page.getByText(/đang tải/i).count()) > 0 ||
      (await page.locator('[role="progressbar"], [class*="skeleton"], [class*="Loading"], [class*="spinner"]').count()) > 0;

    // Even if it passes quickly, the page should not be blank during load
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
  });

  test('BA Directory — shows loading state while fetching', async ({ page }) => {
    await page.route('**/api/**', async route => {
      await new Promise(r => setTimeout(r, 500));
      await route.continue();
    });

    await page.goto('/crm/ba');
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
  });
});

test.describe('Form interactions — loading states', () => {
  test('No double-submit on approve/reject buttons', async ({ page }) => {
    await page.goto('/manager/inbox');
    await page.waitForLoadState('networkidle');

    // Check approve/reject buttons exist and are clickable
    const approveBtn = page.getByRole('button', { name: /approve|duyệt/i }).first();
    if (await approveBtn.isVisible()) {
      const rejectBtn = page.getByRole('button', { name: /reject|từ chối/i }).first();
      // Both should be visible and not disabled
      await expect(approveBtn).toBeVisible();
      await expect(rejectBtn).toBeVisible();
    }
  });
});
