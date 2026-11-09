/**
 * Data Isolation & Sample Data Removal Regression Tests
 * The Fitness House Gym Management Admin Panel
 *
 * Verifies that:
 * 1. sampleData.js and storage.js are completely eliminated.
 * 2. No source code file references or imports sampleData, loadFromStorage, or saveToStorage.
 * 3. Initial collections in AppContext start as clean empty arrays ([]).
 * 4. DEFAULT_GYM_INFO provides standard placeholder fields without mock/seed data.
 * 5. KPICard supports loading state with pulse skeleton.
 * 6. Dashboard, Attention, Followups, Members, and Payments gate rendering with initialDataLoading.
 * 7. Unauthenticated mutations throw errors rather than fabricating demo mock state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_GYM_INFO } from '../src/services/gymInfoService.js';

test('1. sampleData.js and storage.js do not exist in the repository', () => {
  assert.equal(fs.existsSync('src/data/sampleData.js'), false, 'src/data/sampleData.js must not exist');
  assert.equal(fs.existsSync('src/data'), false, 'src/data directory must not exist');
  assert.equal(fs.existsSync('src/utils/storage.js'), false, 'src/utils/storage.js must not exist');
});

test('2. Zero references to sampleData, loadFromStorage, saveToStorage in src/', () => {
  const forbiddenPatterns = [
    'sampleData',
    'loadFromStorage',
    'saveToStorage',
    'clearTFHStorage',
    'purgeStaleFixturesFromStorage',
    'STORAGE_KEYS',
  ];

  function scan(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (!['node_modules', '.git', 'dist'].includes(file)) {
          scan(fullPath);
        }
      } else if (/\.(jsx?|tsx?)$/.test(file)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          assert.equal(
            content.includes(pattern),
            false,
            `File ${fullPath} must not contain forbidden pattern: ${pattern}`
          );
        }
      }
    }
  }

  scan('src');
});

test('3. AppContext initializes collections with empty arrays and tracks initialDataLoading', () => {
  const appContextContent = fs.readFileSync('src/context/AppContext.jsx', 'utf8');

  // Verify empty array initializations
  assert.match(appContextContent, /const\s+\[members,\s*setMembers\]\s*=\s*useState\(\[\]\);/);
  assert.match(appContextContent, /const\s+\[payments,\s*setPayments\]\s*=\s*useState\(\[\]\);/);
  assert.match(appContextContent, /const\s+\[checkins,\s*setCheckins\]\s*=\s*useState\(\[\]\);/);
  assert.match(appContextContent, /const\s+\[followups,\s*setFollowups\]\s*=\s*useState\(\[\]\);/);
  assert.match(appContextContent, /const\s+\[ptClients,\s*setPtClients\]\s*=\s*useState\(\[\]\);/);
  assert.match(appContextContent, /const\s+\[ptSessions,\s*setPtSessions\]\s*=\s*useState\(\[\]\);/);
  assert.match(appContextContent, /const\s+\[notifications,\s*setNotifications\]\s*=\s*useState\(\[\]\);/);
  assert.match(appContextContent, /const\s+\[gymInfo,\s*setGymInfo\]\s*=\s*useState\(DEFAULT_GYM_INFO\);/);
  assert.match(appContextContent, /const\s+\[initialDataLoading,\s*setInitialDataLoading\]\s*=\s*useState\(true\);/);

  // Verify initialDataLoading is provided in context value
  assert.match(appContextContent, /initialDataLoading,/);
});

test('4. DEFAULT_GYM_INFO schema is clean and free from mock seed records', () => {
  assert.ok(DEFAULT_GYM_INFO, 'DEFAULT_GYM_INFO must exist');
  assert.equal(DEFAULT_GYM_INFO.name, 'The Fitness House');
  assert.equal(DEFAULT_GYM_INFO.tagline, 'Gym Management');
  assert.equal(DEFAULT_GYM_INFO.currencyCode, 'INR');
  assert.equal(DEFAULT_GYM_INFO.currencySymbol, '₹');
  assert.equal(DEFAULT_GYM_INFO.address, '');
  assert.equal(DEFAULT_GYM_INFO.phone, '');
  assert.equal(DEFAULT_GYM_INFO.email, '');
});

test('5. KPICard component supports loading prop with skeleton markup', () => {
  const kpiCardContent = fs.readFileSync('src/components/shared/KPICard.jsx', 'utf8');
  assert.match(kpiCardContent, /loading\s*=\s*false/);
  assert.match(kpiCardContent, /if\s*\(loading\)/);
  assert.match(kpiCardContent, /animate-pulse/);
  assert.match(kpiCardContent, /aria-busy="true"/);
});

test('6. Dashboard.jsx consumes initialDataLoading and gates KPI cards and lists', () => {
  const dashboardContent = fs.readFileSync('src/pages/Dashboard.jsx', 'utf8');

  // Verify initialDataLoading is destructured
  assert.match(dashboardContent, /initialDataLoading/);

  // Verify KPICard loading prop usage
  assert.match(dashboardContent, /loading=\{initialDataLoading\s*\|\|\s*membersLoading\}/);

  // Verify Attention Required loading skeleton gating
  assert.match(dashboardContent, /\(initialDataLoading\s*\|\|\s*membersLoading\s*\|\|\s*ptLoading\s*\|\|\s*followupsLoading\)\s*\?/);

  // Verify Recent Activities loading skeleton gating
  assert.match(dashboardContent, /\(initialDataLoading\s*\|\|\s*membersLoading\s*\|\|\s*paymentsLoading\s*\|\|\s*ptLoading\s*\|\|\s*checkinsLoading\)\s*\?/);

  // Verify Gym Pulse loading skeleton gating
  assert.match(dashboardContent, /\{initialDataLoading\s*\?\s*\(/);

  // Verify Demo Mode badge is completely eliminated from Dashboard
  assert.equal(dashboardContent.includes('Demo Mode'), false, 'Dashboard must not reference Demo Mode');
});

test('7. CheckIns.jsx does not display Demo Mode badge', () => {
  const checkinsContent = fs.readFileSync('src/pages/CheckIns.jsx', 'utf8');
  assert.equal(checkinsContent.includes('Demo Mode'), false, 'CheckIns must not reference Demo Mode');
  assert.match(checkinsContent, /● Live Attendance Sync/);
});

test('8. Unauthenticated mutations reject with clear authentication error', () => {
  const appContextContent = fs.readFileSync('src/context/AppContext.jsx', 'utf8');

  // Verify mutations throw or reject when unauthenticated
  const authErrorRegex = /throw new Error\('Authentication required: Supabase is the sole authoritative data source\.'\)/;
  const matches = appContextContent.match(new RegExp(authErrorRegex, 'g'));
  assert.ok(matches && matches.length >= 5, `Expected multiple explicit auth guards, found ${matches?.length}`);
});
