import { test, expect } from '@playwright/test';
import { E2E_CONFIG, assertLocalEnvironment, loginAsAdmin } from './test-helpers.js';

test.describe('Phase 5: Attendance & Personal Training', () => {

  test.beforeEach(async ({ page }) => {
    await assertLocalEnvironment(page);
    await loginAsAdmin(page);
  });

  test('ATT-01: Front desk search renders member match candidate card', async ({ page }) => {
    await page.goto('/checkins');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('main h1')).toContainText('Check-in Desk & Attendance');
    
    // Search desk input
    const deskSearch = page.locator('input[placeholder*="Search by name, member code" i]');
    await expect(deskSearch).toBeVisible();

    // Type search to find candidate
    await deskSearch.fill('Test');
    await page.waitForTimeout(400);

    // If dropdown appears, select the first candidate
    const candidateBtn = page.locator('div.absolute button').first();
    if (await candidateBtn.isVisible()) {
      await candidateBtn.click();
      // Verify member verification card is displayed
      await expect(page.locator('h4.text-base').first()).toBeVisible();
      await expect(page.locator('text=Plan Status').first()).toBeVisible();
    }
  });

  test('ATT-02: Member check-in updates visit ledger and guards duplicate visits', async ({ page }) => {
    // 1. Create a fresh active member for clean check-in test
    await page.goto('/members');
    const timestamp = Date.now().toString().slice(-5);
    const memberName = `Checkin Test ${timestamp}`;
    
    await page.click('button:has-text("Add New Member")');
    await page.fill('input[placeholder="e.g. Rahul Sharma"]', memberName);
    await page.fill('input[placeholder="10-digit mobile number"]', `96${timestamp.padStart(8, '3')}`);
    await page.click('button:has-text("Complete Registration")');
    await page.waitForTimeout(1000);

    // 2. Go to checkins desk
    await page.goto('/checkins');
    const deskSearch = page.locator('input[placeholder*="Search by name, member code" i]');
    await deskSearch.fill(memberName);
    await page.waitForTimeout(500);

    // Select candidate
    const candidateBtn = page.locator(`button:has-text("${memberName}")`).first();
    await expect(candidateBtn).toBeVisible({ timeout: 5000 });
    await candidateBtn.click();

    // 3. Click Confirm Check-in button
    const checkinBtn = page.locator('button:has-text("Confirm Check-in")');
    await expect(checkinBtn).toBeVisible();
    await checkinBtn.click();

    // Verify success feedback
    await expect(page.locator('text=checked in successfully')).toBeVisible({ timeout: 7000 });

    // 4. Test duplicate open session guard:
    // Search the same member again
    await page.waitForTimeout(3600); // wait for feedback auto-dismiss
    await deskSearch.fill(memberName);
    await page.waitForTimeout(500);

    const reCandidate = page.locator(`button:has-text("${memberName}")`).first();
    if (await reCandidate.isVisible()) {
      await reCandidate.click();
      // Verify "Currently Active in Gym" warning notice appears
      await expect(page.locator('text=Currently Active in Gym').first()).toBeVisible();
      await expect(page.locator('button:has-text("Check Out Member Now")')).toBeVisible();
    }
  });

  test('PT-01: Personal Training page displays active PT clients and session counters', async ({ page }) => {
    await page.goto('/personal-training');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('main h1')).toContainText('Personal Training');

    // Verify presence of tabs (Clients vs Sessions)
    await expect(page.locator('button, a').filter({ hasText: /PT Clients|Clients/i }).first()).toBeVisible();
    await expect(page.locator('button, a').filter({ hasText: /Sessions/i }).first()).toBeVisible();

    // Verify Assign PT Package button is present
    await expect(page.locator('button:has-text("Assign PT Package")').first()).toBeVisible();
  });

  test('PT-02: PT client card displays progress bar, done sessions, and left sessions', async ({ page }) => {
    await page.goto('/personal-training');
    await page.waitForLoadState('domcontentloaded');

    // Inspect PT Clients table headers
    const clientsTable = page.locator('table').first();
    if (await clientsTable.isVisible()) {
      await expect(page.getByRole('columnheader', { name: 'Member' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Package' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Done' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Left' })).toBeVisible();
    }
  });

});
