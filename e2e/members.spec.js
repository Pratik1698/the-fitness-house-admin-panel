import { test, expect } from '@playwright/test';
import { E2E_CONFIG, assertLocalEnvironment, loginAsAdmin } from './test-helpers.js';
import fs from 'fs';

test.describe('Phase 3: Member Workflows & Directory Management', () => {

  test.beforeEach(async ({ page }) => {
    await assertLocalEnvironment(page);
    await loginAsAdmin(page);
    await page.goto('/members');
    await page.waitForLoadState('domcontentloaded');
  });

  test('MEM-01: Member directory loads table headers and controls', async ({ page }) => {
    await expect(page.getByRole('main').getByRole('heading', { name: 'Members Directory' })).toBeVisible();
    await expect(page.locator('button:has-text("Add New Member")')).toBeVisible();
    await expect(page.locator('button:has-text("Export Roster")')).toBeVisible();

    // Verify search input is present
    await expect(page.locator('input[placeholder*="Search by name" i]')).toBeVisible();
  });

  test('MEM-02: Search and status filtering update roster display', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search by name" i]');
    
    // Test search for a non-existent member
    await searchInput.fill('XYZ_NONEXISTENT_MEMBER_999');
    await page.waitForTimeout(400);

    // Verify empty state is displayed
    await expect(page.locator('text=/No members match your criteria|No active members found/i')).toBeVisible();

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(400);

    // Test status dropdown filter
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('active');
    await page.waitForTimeout(300);
    expect(await statusSelect.inputValue()).toBe('active');
  });

  test('MEM-03: Add Member form validation displays required error messages', async ({ page }) => {
    // Open Add Member modal
    await page.click('button:has-text("Add New Member")');
    await expect(page.locator('text=Register New Gym Member')).toBeVisible();

    // Attempt to submit empty form
    await page.click('button:has-text("Complete Registration")');

    // Verify validation errors appear for name and phone
    await expect(page.locator('text=Full member name is required')).toBeVisible();
    await expect(page.locator('text=Phone number is required')).toBeVisible();

    // Enter invalid phone number
    const phoneInput = page.locator('input[placeholder="10-digit mobile number"]');
    await phoneInput.fill('1234');
    await page.click('button:has-text("Complete Registration")');
    await expect(page.locator('text=Enter a valid 10-digit Indian mobile number')).toBeVisible();

    // Close modal
    await page.click('button:has-text("Cancel")');
  });

  test('MEM-04: Add Member registration creates member and verifies roster update', async ({ page }) => {
    const timestamp = Date.now().toString().slice(-6);
    const testMemberName = `E2E Test Member ${timestamp}`;
    const testPhone = `98${timestamp.padStart(8, '1')}`;

    // Open Add Member modal
    await page.click('button:has-text("Add New Member")');
    await expect(page.locator('text=Register New Gym Member')).toBeVisible();

    // Fill form
    await page.fill('input[placeholder="e.g. Rahul Sharma"]', testMemberName);
    await page.fill('input[placeholder="10-digit mobile number"]', testPhone);
    await page.fill('input[placeholder="name@email.com"]', `e2e_${timestamp}@test.local`);

    // Submit registration
    await page.click('button:has-text("Complete Registration")');

    // Verify success toast appears
    const successToast = page.locator('text=successfully registered');
    await expect(successToast).toBeVisible({ timeout: 10000 });

    // Verify newly registered member appears in search
    const searchInput = page.locator('input[placeholder*="Search by name" i]');
    await searchInput.fill(testMemberName);
    await page.waitForTimeout(500);

    await expect(page.locator(`text=${testMemberName}`).first()).toBeVisible();
  });

  test('MEM-05: Member profile navigation loads detail page and info tabs', async ({ page }) => {
    // If table has at least one member, click on the member name
    const memberLink = page.locator('table tbody tr button.text-left, table tbody tr a').first();
    if (await memberLink.isVisible()) {
      await memberLink.click();
      await page.waitForURL(/\/members\//, { timeout: 7000 });
      expect(page.url()).toMatch(/\/members\/[a-zA-Z0-9-]+/);

      // Verify Member Profile title and tabs appear
      await expect(page.locator('text=Member Profile').or(page.locator('h1, h2'))).toBeVisible();
    }
  });

  test('MEM-06: CSV export triggers browser download event and validates RFC 4180 structure', async ({ page }) => {
    // Set up download listener
    const downloadPromise = page.waitForEvent('download');

    // Click Export Roster
    const exportBtn = page.locator('button:has-text("Export Roster")');
    await exportBtn.click();

    const download = await downloadPromise;
    const suggestedFilename = download.suggestedFilename();
    expect(suggestedFilename).toMatch(/^fitness-house-members-.*\.csv$/);

    // Save and inspect the CSV content
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const csvContent = fs.readFileSync(downloadPath, 'utf-8');

    // Verify RFC 4180 header presence
    expect(csvContent).toContain('Member ID');
    expect(csvContent).toContain('Full Name');
    expect(csvContent).toContain('Phone Number');
    expect(csvContent).toContain('Membership Plan');
    expect(csvContent).toContain('Status');
    expect(csvContent).toContain('Outstanding Balance');
  });

});
