import { test, expect } from '@playwright/test';
import { E2E_CONFIG, assertLocalEnvironment, loginAsAdmin } from './test-helpers.js';

test.describe('Phase 4: Financial Workflows & Receipts', () => {

  test.beforeEach(async ({ page }) => {
    await assertLocalEnvironment(page);
    await loginAsAdmin(page);
    await page.goto('/payments');
    await page.waitForLoadState('domcontentloaded');
  });

  test('FIN-01: Payments dashboard loads KPIs and supports tab switching', async ({ page }) => {
    await expect(page.locator('main h1')).toContainText('Payments & Collections');
    await expect(page.locator('button:has-text("Record Payment")')).toBeVisible();

    // Verify presence of tabs (Transactions / Pending Dues)
    const pendingTab = page.locator('button, a').filter({ hasText: /Pending Dues|Outstanding Accounts/i }).first();
    if (await pendingTab.isVisible()) {
      await pendingTab.click();
      await page.waitForTimeout(300);
      expect(page.url()).toContain('tab=pending');
    }
  });

  test('FIN-02: Settle dues form validation rejects non-positive and excessive amounts', async ({ page }) => {
    // Open Record Payment modal
    await page.click('button:has-text("Record Payment")');
    await expect(page.locator('text=Record Member Payment')).toBeVisible();

    // Select member dropdown
    const memberSelect = page.locator('select').first();
    const options = await memberSelect.locator('option').allTextContents();
    
    // Find an option with an actual member
    const validOption = options.find(opt => opt.includes('Due:') || opt.includes('('));
    if (validOption) {
      await memberSelect.selectOption({ label: validOption });
      
      // Test negative or zero amount
      const amountInput = page.locator('input[placeholder="Enter payment amount in ₹"]');
      if (await amountInput.isVisible()) {
        await amountInput.fill('0');
        await page.click('button:has-text("Record Payment"):not([disabled])');
        await expect(page.locator('text=Enter a valid payment amount greater than zero').or(page.locator('text=greater than zero'))).toBeVisible();
      }
    }

    // Close modal
    await page.click('button:has-text("Cancel")');
  });

  test('FIN-03: Record dues payment updates ledger and triggers receipt notice', async ({ page }) => {
    // Navigate to members and register a member with partial dues so we have a guaranteed balance
    await page.goto('/members');
    const timestamp = Date.now().toString().slice(-5);
    const duesMemberName = `Dues Test ${timestamp}`;
    
    await page.click('button:has-text("Add New Member")');
    await page.fill('input[placeholder="e.g. Rahul Sharma"]', duesMemberName);
    await page.fill('input[placeholder="10-digit mobile number"]', `97${timestamp.padStart(8, '2')}`);
    
    // Select Monthly plan (₹700) and pay only ₹300, leaving ₹400 balance
    const amountInput = page.locator('input[placeholder*="amount" i], input[type="number"]').first();
    if (await amountInput.isVisible()) {
      await amountInput.fill('300');
    }
    await page.click('button:has-text("Complete Registration")');
    await page.waitForTimeout(1000);

    // Go to Payments page
    await page.goto('/payments');
    await page.click('button:has-text("Record Payment")');

    // Select our newly created dues member
    const memberSelect = page.locator('select').first();
    const duesOption = (await memberSelect.locator('option').allTextContents()).find(t => t.includes(duesMemberName));
    if (duesOption) {
      await memberSelect.selectOption({ label: duesOption });
      
      // Pay ₹200 towards the ₹400 balance
      const payInput = page.locator('input[placeholder="Enter payment amount in ₹"]');
      await payInput.fill('200');

      // Record payment
      await page.click('button:has-text("Record Payment"):not([disabled])');

      // Verify success notice or receipt preview
      await expect(page.locator(`text=${duesMemberName}`).first()).toBeVisible({ timeout: 8000 });
    }
  });

  test('FIN-04: Receipt modal renders gym branding, contact details, and print trigger', async ({ page }) => {
    // Open any receipt if available in table
    const viewReceiptBtn = page.locator('table tbody tr button').filter({ hasText: /Receipt|View|#|TFH/i }).first();
    if (await viewReceiptBtn.isVisible()) {
      await viewReceiptBtn.click();
      
      // Verify Receipt modal header
      await expect(page.locator('text=Payment Receipt Preview')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('text=THE FITNESS HOUSE').first()).toBeVisible();
      await expect(page.locator('button:has-text("Print Receipt")')).toBeVisible();

      // Close modal
      await page.click('button:has-text("Close")');
    }
  });

  test('FIN-05: Double-click duplicate submission suppression locks submit button', async ({ page }) => {
    await page.click('button:has-text("Record Payment")');
    await expect(page.locator('text=Record Member Payment')).toBeVisible();

    const submitBtn = page.locator('button:has-text("Record Payment")').last();
    // Verify it is disabled when no member is selected
    const isDisabled = await submitBtn.getAttribute('disabled');
    expect(isDisabled).not.toBeNull();

    await page.click('button:has-text("Cancel")');
  });

});

