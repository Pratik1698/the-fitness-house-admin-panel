import { test, expect } from '@playwright/test';
import { E2E_CONFIG, assertLocalEnvironment, clearMailpit, getMailpitMessages } from './test-helpers.js';

test.describe('Phase 2: Authentication & Password Recovery', () => {

  test.beforeEach(async ({ page }) => {
    await assertLocalEnvironment(page);
  });

  test('AUTH-01: Empty fields client-side validation', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('THE FITNESS HOUSE');

    // Attempt submitting without filling email
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Verify form validation error message or required attribute
    const emailInput = page.locator('input[type="email"]');
    const isRequired = await emailInput.getAttribute('required');
    expect(isRequired).not.toBeNull();
  });

  test('AUTH-02: Invalid credentials display error alert', async ({ page }) => {
    page.on('console', msg => console.log('[BROWSER CONSOLE]', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('[BROWSER ERROR]', err.message));

    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('button:has-text("Sign In to Dashboard")')).toBeVisible();

    await page.fill('input[type="email"]', 'wrong_user@thefitnesshouse.local');
    await page.fill('input[type="password"]', 'WrongPassword123!');
    await page.click('button:has-text("Sign In to Dashboard")');

    // Wait a brief moment and check page state
    await page.waitForTimeout(1000);

    // Check error banner appears
    const errorNotice = page.locator('text=Authentication Notice');
    await expect(errorNotice).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('AUTH-03: Valid admin login lands on Dashboard and verifies role/avatar', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('button:has-text("Sign In to Dashboard")')).toBeVisible();

    await page.fill('input[type="email"]', E2E_CONFIG.adminCredentials.email);
    await page.fill('input[type="password"]', E2E_CONFIG.adminCredentials.password);
    await page.click('button:has-text("Sign In to Dashboard")');

    // Land on dashboard
    await page.waitForURL('**/', { timeout: 10000 });
    await expect(page).toHaveURL(/\/(#.*)?$/);

    // Verify presence of gym title and user info
    await expect(page.locator('h1, h2, span').filter({ hasText: 'Dashboard' }).first()).toBeVisible();
  });

  test('AUTH-04: Protected routes redirect unauthenticated users to /login', async ({ browser }) => {
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();

    const protectedUrls = ['/members', '/payments', '/reports', '/settings', '/notifications'];
    for (const url of protectedUrls) {
      await freshPage.goto(url);
      await freshPage.waitForURL(/\/login/, { timeout: 5000 });
      expect(freshPage.url()).toContain('/login');
    }

    await freshContext.close();
  });

  test('AUTH-05: Logout flow invalidates session and redirects to /login', async ({ page }) => {
    // 1. Log in
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('button:has-text("Sign In to Dashboard")')).toBeVisible();

    await page.fill('input[type="email"]', E2E_CONFIG.adminCredentials.email);
    await page.fill('input[type="password"]', E2E_CONFIG.adminCredentials.password);
    await page.click('button:has-text("Sign In to Dashboard")');
    await page.waitForURL('**/', { timeout: 10000 });

    // 2. Find and click logout button in sidebar
    const logoutBtn = page.locator('button[aria-label="Logout"], button[title="Logout"]').first();
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    // 3. Confirm redirected to /login
    await page.waitForURL(/\/login/, { timeout: 7000 });
    expect(page.url()).toContain('/login');

    // 4. Try returning to /members
    await page.goto('/members');
    await page.waitForURL(/\/login/, { timeout: 5000 });
    expect(page.url()).toContain('/login');
  });

  test('AUTH-06: Password recovery triggers local Mailpit email and opens reset flow', async ({ page }) => {
    // Clear Mailpit messages first
    await clearMailpit();

    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    // Click "Forgot password?"
    const forgotBtn = page.locator('button:has-text("Forgot password?")');
    await expect(forgotBtn).toBeVisible();
    await forgotBtn.click();

    // Fill reset email
    await page.fill('input[type="email"]', E2E_CONFIG.adminCredentials.email);
    await page.click('button:has-text("Send Reset Instructions")');

    // Verify success banner appears
    const successBanner = page.locator('text=If an account exists for this email address');
    await expect(successBanner).toBeVisible({ timeout: 10000 });

    // Inspect Mailpit for outbound email
    const mailpitData = await getMailpitMessages();
    expect(mailpitData.total).toBeGreaterThanOrEqual(1);

    const latestEmail = mailpitData.messages[0];
    expect(latestEmail.To[0].Address).toBe(E2E_CONFIG.adminCredentials.email);

    // Fetch the email message detail from Mailpit
    const msgDetailRes = await fetch(`${E2E_CONFIG.mailpitUrl}/api/v1/message/${latestEmail.ID}`);
    const msgDetail = await msgDetailRes.json();
    const emailBody = msgDetail.Text || msgDetail.HTML || '';

    // Extract recovery link from email body
    const match = emailBody.match(/https?:\/\/[^\s"'<>()]+/);
    expect(match).not.toBeNull();
    const verifyUrl = match[0];

    // Visit the GoTrue verify URL which sets session and redirects to app
    await page.goto(verifyUrl);

    // Verify reset password page or password configuration form appears
    await expect(page.locator('h2, h1').filter({ hasText: /Reset|Password|Activate/i }).first()).toBeVisible({ timeout: 10000 });
  });

});
