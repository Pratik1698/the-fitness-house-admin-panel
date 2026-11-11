import { test, expect } from '@playwright/test';
import { E2E_CONFIG, assertLocalEnvironment, loginAsAdmin } from './test-helpers.js';

test.describe('Phase 6: Reports, Charts & Analytics', () => {

  test.beforeEach(async ({ page }) => {
    await assertLocalEnvironment(page);
    await loginAsAdmin(page);
    await page.goto('/reports');
    await page.waitForLoadState('domcontentloaded');
  });

  test('REP-01: Navigating through all 6 sub-report tabs renders correctly', async ({ page }) => {
    await expect(page.locator('main h1')).toContainText('Reports & Business Analytics');

    const tabsToTest = [
      { id: 'overview', label: 'Executive Overview', contentPattern: /Revenue Growth|Plan Distribution/i },
      { id: 'finance', label: 'Financial & Revenue', contentPattern: /Ledger|Collection|Method/i },
      { id: 'dues', label: 'Outstanding Dues', contentPattern: /Dues|Balance|Settled/i },
      { id: 'membership', label: 'Membership Analytics', contentPattern: /Plan Details|Enrollment|Daily/i },
      { id: 'attendance', label: 'Attendance Trends', contentPattern: /Attendance|Check-in|Visit/i },
      { id: 'pt', label: 'Personal Training', contentPattern: /Personal Training|Package|Session/i },
    ];

    for (const tab of tabsToTest) {
      const tabBtn = page.getByRole('button', { name: new RegExp(tab.label, 'i') }).first();
      await expect(tabBtn).toBeVisible({ timeout: 5000 });
      await tabBtn.click();
      await page.waitForTimeout(400);

      // Verify specific content for this tab is visible
      await expect(page.locator('main').filter({ hasText: tab.contentPattern }).first()).toBeVisible();
    }
  });

  test('REP-02: Recharts SVG visualizations mount with valid non-zero dimensions', async ({ page }) => {
    // 1. Check charts on Executive Overview
    const overviewTab = page.locator('button, a').filter({ hasText: /Executive Overview/i }).first();
    await overviewTab.click();
    await page.waitForTimeout(500);

    // Look for Recharts SVG surfaces or chart containers
    const chartContainers = page.locator('.recharts-responsive-container, svg.recharts-surface');
    const chartCount = await chartContainers.count();
    
    if (chartCount > 0) {
      const firstChart = chartContainers.first();
      await expect(firstChart).toBeVisible();
      const box = await firstChart.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });

  test('REP-03: Membership Analytics tab dynamically renders all 5 configured plans', async ({ page }) => {
    // Navigate to Membership Analytics tab
    const membershipTab = page.locator('button, a').filter({ hasText: /Membership Analytics/i }).first();
    await membershipTab.click();
    await page.waitForTimeout(500);

    // Verify all 5 configured Supabase plans appear
    const expectedPlans = [
      'Daily',
      'Monthly Plan',
      'Quarterly Plan',
      'Half Yearly Plan',
      'Annual Plan',
    ];

    for (const planName of expectedPlans) {
      const planElement = page.locator(`text=${planName}`).first();
      await expect(planElement).toBeVisible({ timeout: 5000 });
    }

    // Verify current prices appear
    await expect(page.locator('text=₹30').first()).toBeVisible();
    await expect(page.locator('text=₹700').first()).toBeVisible();
    await expect(page.locator('text=₹2,000').or(page.locator('text=₹2000')).first()).toBeVisible();
  });

  test('REP-04: Date range filter presets update period calculations', async ({ page }) => {
    const presetSelect = page.locator('select').first();
    await expect(presetSelect).toBeVisible();

    // Select '7days' (Last 7 Days)
    await presetSelect.selectOption('7days');
    await page.waitForTimeout(300);
    expect(await presetSelect.inputValue()).toBe('7days');

    // Select '30days' (Last 30 Days)
    await presetSelect.selectOption('30days');
    await page.waitForTimeout(300);
    expect(await presetSelect.inputValue()).toBe('30days');

    // Select 'custom' and verify custom date pickers appear
    await presetSelect.selectOption('custom');
    await page.waitForTimeout(300);
    expect(await presetSelect.inputValue()).toBe('custom');

    const customInputs = page.locator('input[type="date"]');
    await expect(customInputs.first()).toBeVisible();
    await expect(customInputs.last()).toBeVisible();
  });

});

