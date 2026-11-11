import { test, expect } from '@playwright/test';
import { E2E_CONFIG, assertLocalEnvironment, loginAsAdmin } from './test-helpers.js';

const VIEWPORTS = [
  { name: 'Desktop (1440x900)', width: 1440, height: 900 },
  { name: 'Laptop (1366x768)', width: 1366, height: 768 },
  { name: 'Tablet (768x1024)', width: 768, height: 1024 },
  { name: 'Mobile (390x844)', width: 390, height: 844 },
];

const PAGES_TO_TEST = [
  { path: '/', name: 'Dashboard' },
  { path: '/members', name: 'Members' },
  { path: '/checkins', name: 'Check-ins' },
  { path: '/personal-training', name: 'Personal Training' },
  { path: '/payments', name: 'Payments' },
  { path: '/reports', name: 'Reports' },
  { path: '/notifications', name: 'Notifications' },
  { path: '/settings', name: 'Settings' },
];

test.describe('Phase 7: Responsive Layouts & Horizontal Overflow Investigation', () => {

  test.beforeEach(async ({ page }) => {
    await assertLocalEnvironment(page);
    await loginAsAdmin(page);
  });

  for (const vp of VIEWPORTS) {
    test(`RESP-01: Layout rendering and overflow check at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const p of PAGES_TO_TEST) {
        await page.goto(p.path);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(400);

        // Check horizontal overflow
        const overflowDetails = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const windowWidth = window.innerWidth;
          const scrollWidth = Math.max(docEl.scrollWidth, body.scrollWidth);
          const hasOverflow = scrollWidth > windowWidth;

          let offendingElements = [];
          if (hasOverflow) {
            const allElements = Array.from(document.querySelectorAll('*'));
            offendingElements = allElements
              .filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.right > windowWidth + 1; // 1px threshold for sub-pixel anti-aliasing
              })
              .map(el => ({
                tag: el.tagName.toLowerCase(),
                className: typeof el.className === 'string' ? el.className.slice(0, 100) : '',
                id: el.id || '',
                right: Math.round(el.getBoundingClientRect().right),
                width: Math.round(el.getBoundingClientRect().width),
                overflowPx: Math.round(el.getBoundingClientRect().right - windowWidth),
              }))
              .slice(0, 5); // top 5 culprits
          }

          return {
            windowWidth,
            scrollWidth,
            overflowPx: Math.max(0, scrollWidth - windowWidth),
            hasOverflow,
            offendingElements,
          };
        });

        if (overflowDetails.hasOverflow) {
          console.warn(`[OVERFLOW DETECTED] Page: ${p.name} at ${vp.name} — Overflow: ${overflowDetails.overflowPx}px`, overflowDetails.offendingElements);
        }

        // Strict assertion: zero horizontal overflow permitted across all viewports (Desktop, Laptop, Tablet, Mobile)
        expect(overflowDetails.overflowPx, `Unexpected horizontal overflow on ${p.name} at ${vp.name}: ${overflowDetails.overflowPx}px`).toBe(0);
        expect(overflowDetails.hasOverflow, `Document has horizontal scroll on ${p.name} at ${vp.name}`).toBe(false);
      }
    });
  }

  test('RESP-02: Deep investigation of reported 66px overflow on Reports and Notifications', async ({ page }) => {
    // Specifically test Reports and Notifications at 390px (Mobile) and 768px (Tablet)
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });

      for (const path of ['/reports', '/notifications']) {
        await page.goto(path);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(500);

        const audit = await page.evaluate(() => {
          const winW = window.innerWidth;
          const scrollW = document.documentElement.scrollWidth;
          const elements = Array.from(document.querySelectorAll('*'));
          const rightMax = elements.reduce((max, el) => {
            const r = el.getBoundingClientRect().right;
            return r > max ? r : max;
          }, 0);

          const culprits = elements
            .filter(el => el.getBoundingClientRect().right > winW + 2)
            .map(el => ({
              tag: el.tagName,
              class: typeof el.className === 'string' ? el.className : '',
              right: Math.round(el.getBoundingClientRect().right),
              overflow: Math.round(el.getBoundingClientRect().right - winW),
            }));

          return {
            winW,
            scrollW,
            delta: Math.max(0, scrollW - winW),
            maxRight: rightMax,
            culpritsCount: culprits.length,
            topCulprits: culprits.slice(0, 5),
          };
        });

        console.log(`[RESP-02 Audit] Width: ${width}px | Path: ${path} | Delta: ${audit.delta}px | Culprits: ${audit.culpritsCount}`);
        if (audit.culpritsCount > 0) {
          console.log(`Culprits on ${path}:`, audit.topCulprits);
        }

        expect(audit.delta, `Horizontal overflow detected on ${path} at ${width}px: ${audit.delta}px`).toBe(0);
      }
    }
  });

});

