/**
 * E2E Test Helpers & Safety Guardrails
 * strictly targeting local Supabase Docker stack (127.0.0.1:54321)
 */

export const E2E_CONFIG = {
  baseURL: 'http://127.0.0.1:5173',
  supabaseUrl: 'http://127.0.0.1:54321',
  mailpitUrl: 'http://127.0.0.1:54324',
  adminCredentials: {
    email: 'e2e_admin@thefitnesshouse.local',
    password: 'TestAdmin@123',
    userId: '00000000-0000-0000-0000-0000000000e2',
  },
};

/**
 * Asserts that the current browser environment points strictly to local Supabase.
 * Blocks tests if connected to production or any external host.
 */
export async function assertLocalEnvironment(page) {
  // Verify that baseURL is localhost
  const currentUrl = page ? page.url() : '';
  if (currentUrl && !currentUrl.includes('127.0.0.1') && !currentUrl.includes('localhost') && currentUrl !== 'about:blank') {
    throw new Error(`CRITICAL ISOLATION ERROR: Current page URL is "${currentUrl}". Refusing to run tests on non-local environment!`);
  }

  // Check Supabase URL
  if (!E2E_CONFIG.supabaseUrl.includes('127.0.0.1') && !E2E_CONFIG.supabaseUrl.includes('localhost')) {
    throw new Error(`CRITICAL ISOLATION ERROR: Target Supabase URL is "${E2E_CONFIG.supabaseUrl}". Refusing to run tests on non-local environment!`);
  }
}

/**
 * Logs in as Admin via the UI form
 */
export async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('button:has-text("Sign In to Dashboard")');

  // Fill credentials
  await page.fill('input[type="email"]', E2E_CONFIG.adminCredentials.email);
  await page.fill('input[type="password"]', E2E_CONFIG.adminCredentials.password);

  // Click Submit
  await page.click('button:has-text("Sign In to Dashboard")');

  // Wait for Dashboard redirection
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
}

/**
 * Mailpit helper: Clears all captured emails in Mailpit
 */
export async function clearMailpit() {
  try {
    await fetch(`${E2E_CONFIG.mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
  } catch (err) {
    console.warn('Mailpit cleanup failed:', err.message);
  }
}

/**
 * Mailpit helper: Fetches captured emails
 */
export async function getMailpitMessages() {
  const res = await fetch(`${E2E_CONFIG.mailpitUrl}/api/v1/messages`);
  if (!res.ok) throw new Error(`Mailpit returned status ${res.status}`);
  return await res.json();
}

